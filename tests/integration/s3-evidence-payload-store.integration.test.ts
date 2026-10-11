import { createHash, randomBytes } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import { S3EvidencePayloadStore } from "@/adapters/evidence/s3-evidence-payload-store";
import { sha256Hex, signS3Request } from "@/adapters/evidence/s3-signature";

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

async function raw(
  path: string,
  body: Uint8Array<ArrayBuffer>,
  headers: Record<string, string> = {},
) {
  const url = new URL(path, S3_ENDPOINT);
  return fetch(url, {
    method: "PUT",
    body,
    headers: signS3Request({
      method: "PUT",
      url,
      headers,
      payloadSha256Hex: sha256Hex(body),
      region,
      credentials,
      now: new Date(),
    }),
  });
}

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

beforeAll(async () => {
  const created = await raw(`/${bucket}`, new Uint8Array());
  // 409: the bucket is already there from an earlier run.
  expect([200, 409]).toContain(created.status);
});

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
    const key = `/${bucket}/v2/${input.evidencePackageId}/${input.segmentHash}.json`;
    const other = new TextEncoder().encode('{"text":"b"}');

    const response = await raw(key, other, { "if-none-match": "*" });
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

  it("refuses bytes that do not match the sent checksum", async () => {
    const input = segment("d");
    const key = `/${bucket}/v2/${input.evidencePackageId}/${input.segmentHash}.json`;
    const bytes = new TextEncoder().encode(input.canonicalPayload);
    const wrong = createHash("sha256").update("other").digest("base64");

    const response = await raw(key, bytes, {
      "if-none-match": "*",
      "x-amz-checksum-sha256": wrong,
    });
    expect(response.status).toBe(400);
    await expect(store.putImmutable(input)).resolves.toMatchObject({
      status: "stored",
    });
  });
});
