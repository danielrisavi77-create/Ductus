import { randomBytes } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import { loadEvidenceStorageConfig } from "@/adapters/evidence/evidence-storage-config";
import { InstitutionRoutedPayloadStore } from "@/adapters/evidence/institution-routed-payload-store";
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

const label = (institutionId: string) =>
  new TextEncoder().encode(JSON.stringify({ institutionId, region }));

function routerFromEnv() {
  const domains = Object.entries(buckets).map(([institutionId, bucket]) => ({
    label: bucket.replace("ductus-domain-", "local-"),
    institutionId,
    endpoint: S3_ENDPOINT,
    region,
    bucket,
    accessKeyIdVar: "EVIDENCE_S3_LOCAL_KEY_ID",
    secretAccessKeyVar: "EVIDENCE_S3_LOCAL_SECRET",
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
    warn: () => undefined,
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
  for (const bucket of Object.values(buckets)) {
    let status = 0;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      status = await rawPut([bucket], new Uint8Array()).catch(() => 0);
      if (status === 200 || status === 409) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect([200, 409]).toContain(status);
  }
  expect(await rawPut([buckets[FAK_A], STORAGE_IDENTITY_KEY], label(FAK_A))).toBe(200);
  expect(await rawPut([buckets[FAK_B], STORAGE_IDENTITY_KEY], label(FAK_B))).toBe(200);
  expect(await rawPut([buckets[FAK_C], STORAGE_IDENTITY_KEY], label(FAK_A))).toBe(200);
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

  it("writes nothing to a disabled domain (P3)", async () => {
    await expect(routerFromEnv().putImmutable(segment(FAK_C))).resolves.toEqual({
      status: "unavailable",
      reason: "storage_domain_identity_mismatch",
    });
  });

  it("answers an institution without a domain as unavailable (P2)", async () => {
    await expect(routerFromEnv().putImmutable(segment(FAK_D))).resolves.toEqual({
      status: "unavailable",
      reason: "storage_domain_not_configured",
    });
  });
});
