import { randomBytes } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import { S3EvidencePayloadStore } from "@/adapters/evidence/s3-evidence-payload-store";
import {
  sha256Hex,
  signS3Request,
  type SignedS3Request,
} from "@/adapters/evidence/s3-signature";

// Contract test of the conditional write (B-8i, plan E1) against the local
// S3-compatible store of compose.yaml. It proves the adapter for this store
// only; the store used in production needs the same test before it is used.
const S3_ENDPOINT = process.env.S3_ENDPOINT ?? "http://127.0.0.1:9100";
const credentials = {
  accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "ductus-local",
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "ductus-local-only",
};
const region = "us-east-1";
const bucket = "ductus-evidence-contract";

/**
 * A signed PUT sent as is, or changed after signing by `tamper`, which may
 * edit the headers and returns the bytes to send.
 */
async function raw(
  path: string[],
  body: Uint8Array<ArrayBuffer>,
  options: {
    now?: Date;
    tamper?: (signed: SignedS3Request) => Uint8Array<ArrayBuffer>;
  } = {},
) {
  const signed = signS3Request({
    method: "PUT",
    endpoint: new URL(S3_ENDPOINT),
    path,
    headers: {},
    body,
    region,
    credentials,
    now: options.now ?? new Date(),
  });
  const sent = options.tamper ? options.tamper(signed) : body;
  const response = await fetch(signed.url, {
    method: "PUT",
    body: sent,
    headers: signed.headers,
    redirect: "error",
  });
  return { status: response.status, text: await response.text() };
}

const keyOf = (input: { evidencePackageId: string; segmentHash: string }) => [
  bucket,
  "v2",
  input.evidencePackageId,
  `${input.segmentHash}.json`,
];

const store = new S3EvidencePayloadStore({
  endpoint: S3_ENDPOINT,
  region,
  bucket,
  credentials,
  requestTimeoutMs: 10_000,
});

function segment(text: string) {
  const canonicalPayload = JSON.stringify({
    text,
    nonce: randomBytes(8).toString("hex"),
  });
  return {
    evidencePackageId: `paket-${randomBytes(6).toString("hex")}`,
    segmentHash: sha256Hex(canonicalPayload),
    canonicalPayload,
  };
}

// Test setup, not the adapter: storage can report healthy (any HTTP answer)
// before it accepts writes, so creating the bucket is retried for a bounded
// time. The adapter itself never retries.
beforeAll(async () => {
  let status = 0;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    status = await raw([bucket], new Uint8Array()).then(
      (r) => r.status,
      () => 0,
    );
    // 409: the bucket is already there from an earlier run.
    if (status === 200 || status === 409) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  expect([200, 409]).toContain(status);
}, 30_000);

describe("S3EvidencePayloadStore against the local object store", () => {
  it("stores once, then answers existing for the same bytes", async () => {
    const input = segment("a");
    await expect(store.putImmutable(input)).resolves.toMatchObject({
      status: "stored",
    });
    await expect(store.putImmutable(input)).resolves.toMatchObject({
      status: "existing",
    });
  });

  it("never overwrites: a second conditional write with other bytes is refused", async () => {
    const input = segment("a");
    await store.putImmutable(input);
    const other = new TextEncoder().encode('{"text":"b"}');

    const response = await raw(keyOf(input), other);
    expect(response.status).toBe(412);
    await expect(store.putImmutable(input)).resolves.toMatchObject({
      status: "existing",
    });
  });

  it("decides concurrent writes of one key by the condition", async () => {
    const input = segment("c");
    const results = await Promise.all(
      Array.from({ length: 4 }, () => store.putImmutable(input)),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === "stored")).toHaveLength(1);
    expect(statuses.filter((s) => s === "existing")).toHaveLength(3);
  });

  it("refuses a body with one byte changed after signing (S7)", async () => {
    const input = segment("d");
    const bytes = new TextEncoder().encode(input.canonicalPayload);

    const response = await raw(keyOf(input), bytes, {
      tamper: () => {
        const changed = bytes.slice();
        changed[3] ^= 1;
        return changed;
      },
    });
    expect([400, 403]).toContain(response.status);
    await expect(store.putImmutable(input)).resolves.toMatchObject({
      status: "stored",
    });
  });

  it.each(["if-none-match", "x-amz-checksum-sha256"])(
    "refuses a write whose signed %s was removed (S6)",
    async (header) => {
      const input = segment("e");
      const bytes = new TextEncoder().encode(input.canonicalPayload);

      const response = await raw(keyOf(input), bytes, {
        tamper: (signed) => {
          delete signed.headers[header];
          return bytes;
        },
      });
      expect(response.status).toBe(403);
      expect(response.text).toContain("SignatureDoesNotMatch");
      await expect(store.putImmutable(input)).resolves.toMatchObject({
        status: "stored",
      });
    },
  );

  it("refuses a request signed an hour off and the adapter names the skew (S9)", async () => {
    const input = segment("f");
    const bytes = new TextEncoder().encode(input.canonicalPayload);
    const response = await raw(keyOf(input), bytes, {
      now: new Date(Date.now() - 3_600_000),
    });
    expect(response.status).toBe(403);

    const skewed = new S3EvidencePayloadStore({
      endpoint: S3_ENDPOINT,
      region,
      bucket,
      credentials,
      requestTimeoutMs: 10_000,
      now: () => new Date(Date.now() + 3_600_000),
      warn: () => undefined,
    });
    await expect(skewed.putImmutable(input)).resolves.toEqual({
      status: "unavailable",
      reason: "storage_clock_skew",
    });
    await expect(store.putImmutable(input)).resolves.toMatchObject({
      status: "stored",
    });
  });

  it("answers a wrong secret as a configuration fault (S11)", async () => {
    const wrong = new S3EvidencePayloadStore({
      endpoint: S3_ENDPOINT,
      region,
      bucket,
      credentials: { ...credentials, secretAccessKey: "not-the-local-secret" },
      requestTimeoutMs: 10_000,
      warn: () => undefined,
    });
    await expect(wrong.putImmutable(segment("g"))).resolves.toEqual({
      status: "unavailable",
      reason: "storage_signature_rejected",
    });
  });
});
