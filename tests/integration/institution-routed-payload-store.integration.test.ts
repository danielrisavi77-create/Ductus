import { randomBytes } from "node:crypto";

import { beforeAll, describe, expect, it, vi } from "vitest";

import { loadEvidenceStorageConfig } from "@/adapters/evidence/evidence-storage-config";
import {
  InstitutionRoutedPayloadStore,
  STORAGE_UNAVAILABLE,
} from "@/adapters/evidence/institution-routed-payload-store";
import { STORAGE_IDENTITY_KEY } from "@/adapters/evidence/s3-evidence-payload-store";
import { sha256Hex, signS3Request } from "@/adapters/evidence/s3-signature";

// Storage domains (B-8i, P2, P3, P5) against the local S3-compatible store of
// compose.yaml: one bucket per institution, loaded through the operator
// configuration. Locally every domain shares the one store key, which the
// configuration allows only with "loopback-only".
const S3_ENDPOINT = process.env.S3_ENDPOINT ?? "http://127.0.0.1:9100";
const credentials = {
  accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "ductus-local",
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "ductus-local-only",
};
const region = "us-east-1";
// Invented institutions.
const FAK_A = "00000000-0000-4000-8000-00000000000a";
const FAK_B = "00000000-0000-4000-8000-00000000000b";
const FAK_C = "00000000-0000-4000-8000-00000000000c";
const FAK_D = "00000000-0000-4000-8000-00000000000d";
const buckets = {
  [FAK_A]: "ductus-domain-fak-a",
  [FAK_B]: "ductus-domain-fak-b",
  // Labelled for FAK_A: a bucket set up for the wrong institution.
  [FAK_C]: "ductus-domain-fak-c",
};

async function rawPut(path: string[], body: Uint8Array<ArrayBuffer>) {
  const signed = signS3Request({
    method: "PUT",
    endpoint: new URL(S3_ENDPOINT),
    path,
    headers: {},
    body,
    region,
    credentials,
    now: new Date(),
  });
  const response = await fetch(signed.url, {
    method: "PUT",
    body,
    headers: signed.headers,
    redirect: "error",
  });
  await response.arrayBuffer();
  return response.status;
}

/**
 * Refuses any target but a loopback store before the first request: the
 * shared local key and plain HTTP are allowed only there.
 */
function assertLocalTarget() {
  const url = new URL(S3_ENDPOINT);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("S3_ENDPOINT must name the local store of compose.yaml");
  }
}

// The local store as the contract test of this stack confirmed it.
const capability = {
  provider: "rustfs-local",
  endpoint: S3_ENDPOINT,
  conditionalWrite: "verified",
  checksumEcho: "verified",
  verifiedOn: "2026-10-11",
  contractTest: "local-stack/s3-evidence-payload-store.integration",
};

async function rawGet(path: string[]) {
  const signed = signS3Request({
    method: "GET",
    endpoint: new URL(S3_ENDPOINT),
    path,
    headers: {},
    body: new Uint8Array(),
    region,
    credentials,
    now: new Date(),
  });
  const response = await fetch(signed.url, { headers: signed.headers, redirect: "error" });
  return { status: response.status, body: new Uint8Array(await response.arrayBuffer()) };
}

const rawGetStatus = async (path: string[]) => (await rawGet(path)).status;

/** Lets the macrotask the router writes its log line in run. */
const logged = () => new Promise<void>((resolve) => setImmediate(resolve));

const label = (institutionId: string) =>
  new TextEncoder().encode(JSON.stringify({ institutionId, region }));

async function ensureIdentityLabel(bucket: string, institutionId: string) {
  const expected = label(institutionId);
  const status = await rawPut([bucket, STORAGE_IDENTITY_KEY], expected);
  if (status === 200) return;

  expect(status).toBe(412); // The create-only identity marker already exists.
  const existing = await rawGet([bucket, STORAGE_IDENTITY_KEY]);
  expect(existing.status).toBe(200);
  expect(existing.body).toEqual(expected);
}

function routerFromEnv(warn: (message: string, fields: Record<string, string>) => void = () => undefined) {
  const domains = Object.entries(buckets).map(([institutionId, bucket]) => ({
    label: bucket.replace("ductus-domain-", "local-"),
    institutionId,
    endpoint: S3_ENDPOINT,
    region,
    bucket,
    accessKeyIdVar: "EVIDENCE_S3_LOCAL_KEY_ID",
    secretAccessKeyVar: "EVIDENCE_S3_LOCAL_SECRET",
    capability,
  }));
  const config = loadEvidenceStorageConfig({
    EVIDENCE_STORAGE_DOMAINS: JSON.stringify({
      requestTimeoutMs: 10_000,
      sharedCredentials: "loopback-only",
      domains,
    }),
    EVIDENCE_S3_LOCAL_KEY_ID: credentials.accessKeyId,
    EVIDENCE_S3_LOCAL_SECRET: credentials.secretAccessKey,
  });
  return InstitutionRoutedPayloadStore.fromConfig(config, {
    warn,
    allowPlainHttpOnLoopback: true,
  });
}

function segment(institutionId: string) {
  const canonicalPayload = JSON.stringify({
    text: "izmisljeni odlomak",
    nonce: randomBytes(8).toString("hex"),
  });
  return {
    institutionId,
    evidencePackageId: `paket-${randomBytes(6).toString("hex")}`,
    segmentHash: sha256Hex(canonicalPayload),
    canonicalPayload,
  };
}

// Test setup, not the adapter: the buckets and their identity labels are what
// an operator provisions. Creating a bucket is retried for a bounded time
// because storage can answer before it accepts writes.
beforeAll(async () => {
  assertLocalTarget();
  for (const bucket of Object.values(buckets)) {
    let status = 0;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      status = await rawPut([bucket], new Uint8Array()).catch(() => 0);
      if (status === 200 || status === 409) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect([200, 409]).toContain(status);
  }
  await ensureIdentityLabel(buckets[FAK_A], FAK_A);
  await ensureIdentityLabel(buckets[FAK_B], FAK_B);
  await ensureIdentityLabel(buckets[FAK_C], FAK_A);
}, 60_000);

describe("InstitutionRoutedPayloadStore against the local object store", () => {
  it("verifies matching labels and disables the bucket labelled for another institution (P3)", async () => {
    await expect(routerFromEnv().verifyAll()).resolves.toEqual({
      "local-fak-a": "verified",
      "local-fak-b": "verified",
      "local-fak-c": "disabled",
    });
  });

  it("stores one hash of two institutions in two buckets, both as new (P5)", async () => {
    const router = routerFromEnv();
    const a = segment(FAK_A);
    const b = { ...a, institutionId: FAK_B };

    const first = await router.putImmutable(a);
    const second = await router.putImmutable(b);
    expect(first).toEqual({
      status: "stored",
      storageRef: `local-fak-a:v2/${FAK_A}/${a.evidencePackageId}/${a.segmentHash}.json`,
    });
    expect(second).toEqual({
      status: "stored",
      storageRef: `local-fak-b:v2/${FAK_B}/${b.evidencePackageId}/${b.segmentHash}.json`,
    });
    await expect(router.putImmutable(b)).resolves.toMatchObject({
      status: "existing",
    });
  });

  it("writes nothing to a disabled domain and names the cause only in the log (P3)", async () => {
    const warn = vi.fn();
    const input = segment(FAK_C);
    await expect(routerFromEnv(warn).putImmutable(input)).resolves.toEqual({
      status: "unavailable",
      reason: STORAGE_UNAVAILABLE,
    });
    await logged();
    expect(warn.mock.calls.map(([, fields]) => fields.reason)).toContain(
      "storage_domain_identity_mismatch",
    );
    expect(await rawGetStatus([buckets[FAK_C], "v2", FAK_C, input.evidencePackageId, `${input.segmentHash}.json`])).toBe(404);
  });

  it("answers an institution without a domain as unavailable (P2)", async () => {
    const warn = vi.fn();
    await expect(routerFromEnv(warn).putImmutable(segment(FAK_D))).resolves.toEqual({
      status: "unavailable",
      reason: STORAGE_UNAVAILABLE,
    });
    await logged();
    expect(warn.mock.calls.map(([, fields]) => fields.reason)).toEqual([
      "storage_domain_not_configured",
    ]);
  });
});
