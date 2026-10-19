import { randomBytes } from "node:crypto";

import { beforeAll, describe, expect, it, vi } from "vitest";

import { loadEvidenceStorageConfig } from "@/adapters/evidence/evidence-storage-config";
import {
  InstitutionRoutedPayloadStore,
  STORAGE_UNAVAILABLE,
} from "@/adapters/evidence/institution-routed-payload-store";
import { STORAGE_IDENTITY_KEY } from "@/adapters/evidence/s3-evidence-payload-store";
import { sha256Hex, signS3Request } from "@/adapters/evidence/s3-signature";
import { reconstructAndCompareEvidence } from "@/application/evidence/evidence-reconstruction";
import {
  bindPayloadReader,
  type EvidenceChainReader,
  type EvidencePayloadReader,
} from "@/application/ports/evidence-reconstruction";
import { readProcessSummary } from "@/application/projection/process-summary-reader";
import { verifyEvidenceChainV2 } from "@/domain/forensics/evidence-chain-v2";
import {
  fromHex,
  goldenKeyVerifier,
  loadGoldenVectors,
} from "@/domain/forensics/golden-vectors/load";

// The read side of the storage domains (B-8i, B2) against the local
// S3-compatible store of compose.yaml: what ingest stored, reconstruction and
// the process summary read back through a reader bound to one institution.
// Invented institutions; the record is the golden vector chain (synthetic).
const S3_ENDPOINT = process.env.S3_ENDPOINT ?? "http://127.0.0.1:9100";
const credentials = {
  accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "ductus-local",
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "ductus-local-only",
};
const region = "us-east-1";
const FAK_A = "00000000-0000-4000-8000-0000000000a1";
const FAK_B = "00000000-0000-4000-8000-0000000000b1";
const buckets = { [FAK_A]: "ductus-read-fak-a", [FAK_B]: "ductus-read-fak-b" };
const capabilityOf = (endpoint: string) => ({
  provider: "rustfs-local",
  endpoint,
  conditionalWrite: "verified",
  checksumEcho: "verified",
  verifiedOn: "2026-10-11",
  contractTest: "local-stack/s3-evidence-payload-store.integration",
});

const { chain } = loadGoldenVectors();

function assertLocalTarget() {
  const url = new URL(S3_ENDPOINT);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("S3_ENDPOINT must name the local store of compose.yaml");
  }
}

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
  const response = await fetch(signed.url, { method: "PUT", body, headers: signed.headers, redirect: "error" });
  await response.arrayBuffer();
  return response.status;
}

function router(endpoint = S3_ENDPOINT, warn: (message: string, fields: Record<string, string>) => void = () => undefined) {
  const config = loadEvidenceStorageConfig({
    EVIDENCE_STORAGE_DOMAINS: JSON.stringify({
      requestTimeoutMs: 5_000,
      sharedCredentials: "loopback-only",
      domains: Object.entries(buckets).map(([institutionId, bucket]) => ({
        label: bucket.replace("ductus-", "local-"),
        institutionId,
        endpoint,
        region,
        bucket,
        accessKeyIdVar: "EVIDENCE_S3_LOCAL_KEY_ID",
        secretAccessKeyVar: "EVIDENCE_S3_LOCAL_SECRET",
        capability: capabilityOf(endpoint),
      })),
    }),
    EVIDENCE_S3_LOCAL_KEY_ID: credentials.accessKeyId,
    EVIDENCE_S3_LOCAL_SECRET: credentials.secretAccessKey,
  });
  return InstitutionRoutedPayloadStore.fromConfig(config, { warn, allowPlainHttpOnLoopback: true });
}

const chainReader: EvidenceChainReader = {
  readChain: async () => ({
    status: "found",
    head: chain.head,
    segments: chain.segments.map((vector) => ({
      segmentHash: vector.segmentHash,
      receipt: {
        payload: vector.receipt.payload,
        payloadDigestSha256: vector.receipt.payloadDigestSha256,
        signature: vector.receipt.signature,
      },
    })),
  }),
};

/** Reconstruction up to the storage step; nothing here may reach the replay. */
const reconstruct = (payloads: EvidencePayloadReader) =>
  reconstructAndCompareEvidence(
    {
      chain: chainReader,
      payloads,
      signer: goldenKeyVerifier(chain.verificationKey),
      replayer: {
        transactionFormat: "ductus-edit-steps-v1",
        load: () => {
          throw new Error("no replay in this test");
        },
        apply: () => {
          throw new Error("no replay in this test");
        },
        toCanonical: () => null,
      },
    },
    { evidencePackageId: chain.evidencePackageId, initialDocument: null, expectedDocument: null },
  );

const logged = () => new Promise<void>((resolve) => setImmediate(resolve));

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
  // The signer makes every PUT conditional: 412 is the label of an earlier run
  // on a store that was not reset, written by this setup with the same value.
  for (const [institutionId, bucket] of Object.entries(buckets)) {
    const label = new TextEncoder().encode(JSON.stringify({ institutionId, region }));
    expect([200, 412]).toContain(await rawPut([bucket, STORAGE_IDENTITY_KEY], label));
  }
  // What ingest stores: the golden chain, through the router, for FAK_A.
  const store = router();
  for (const vector of chain.segments) {
    const stored = await store.putImmutable({
      institutionId: FAK_A,
      evidencePackageId: chain.evidencePackageId,
      segmentHash: vector.segmentHash,
      canonicalPayload: new TextDecoder().decode(fromHex(vector.canonicalUtf8Hex)),
    });
    expect(["stored", "existing"]).toContain(stored.status);
  }
}, 60_000);

describe("evidence payload read against the local object store (B-8i, B2)", () => {
  it("reads back the exact bytes ingest stored, and they verify against the head", async () => {
    const reader = bindPayloadReader(router(), FAK_A);
    const payloads: Uint8Array[] = [];
    for (const vector of chain.segments) {
      const read = await reader.readImmutable({
        evidencePackageId: chain.evidencePackageId,
        segmentHash: vector.segmentHash,
      });
      if (read.status !== "found") throw new Error(`expected found, got ${read.status}`);
      expect(Buffer.from(read.bytes).toString("hex")).toBe(vector.canonicalUtf8Hex);
      payloads.push(read.bytes);
    }
    await expect(verifyEvidenceChainV2(payloads, chain.head)).resolves.toMatchObject({ ok: true });
  });

  it("gives the process summary the stored record (B-13)", async () => {
    const summary = await readProcessSummary(
      {
        source: {
          readSource: async () => ({
            status: "found",
            evidencePackageId: chain.evidencePackageId,
            head: chain.head,
            segmentHashes: chain.segments.map((vector) => vector.segmentHash),
          }),
        },
        payloads: bindPayloadReader(router(), FAK_A),
        thresholds: { sessionBreakAboveMinutes: 30, pasteListedAboveCharacters: 200 },
      },
      chain.segments[0].segment.documentId,
    );
    expect(summary.status).toBe("ok");
  });

  it("never finds the record through another institution's reader: its own bucket says NoSuchKey", async () => {
    const reader = bindPayloadReader(router(), FAK_B);
    await expect(
      reader.readImmutable({ evidencePackageId: chain.evidencePackageId, segmentHash: chain.segments[0].segmentHash }),
    ).resolves.toEqual({ status: "not_found" });
    await expect(reconstruct(reader)).resolves.toEqual({ status: "mismatch", reason: "missing_payload", index: 0 });
  });

  it("answers a damaged object as unavailable, so reconstruction retries instead of judging the record", async () => {
    const warn = vi.fn();
    const pkg = `paket-${randomBytes(6).toString("hex")}`;
    const hash = sha256Hex("izmisljeni izvorni bajtovi");
    const key = ["v2", FAK_A, pkg, `${hash}.json`];
    expect(await rawPut([buckets[FAK_A], ...key], new TextEncoder().encode("drugi bajtovi"))).toBe(200);

    const reader = bindPayloadReader(router(S3_ENDPOINT, warn), FAK_A);
    await expect(reader.readImmutable({ evidencePackageId: pkg, segmentHash: hash })).resolves.toEqual({
      status: "unavailable",
      reason: STORAGE_UNAVAILABLE,
    });
    await logged();
    expect(warn.mock.calls.map(([, fields]) => fields.reason)).toContain("storage_object_corrupt");
  });

  it("answers an unreachable store as unavailable at the storage stage, never a mismatch", async () => {
    const reader = bindPayloadReader(router("http://127.0.0.1:9"), FAK_A);
    await expect(reconstruct(reader)).resolves.toMatchObject({ status: "unavailable", stage: "storage" });
  });
});
