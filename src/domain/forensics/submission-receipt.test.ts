import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { digestEvidenceReceiptPayloadV2 } from "./evidence-receipt";
import { loadGoldenVectors } from "./golden-vectors/load";
import {
  digestSubmissionReceiptPayloadV1,
  isSignedSubmissionReceiptV1,
  isSubmissionInstant,
  isSubmissionReceiptPayloadV1,
  SUBMISSION_RECEIPT_V1_SIGNING_INPUT_BYTES,
  type SubmissionReceiptPayloadV1,
} from "./submission-receipt";

/**
 * Submission receipt v1 (B-12, P4 on issue 385). The expected bytes, digest
 * and signature were derived outside this module: JCS written by hand,
 * node:crypto SHA-256 and Ed25519 with the published RFC 8032 test seed
 * (test only, never a real key). All data is invented.
 */
const RFC8032_SEED = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
const privateKey = createPrivateKey({
  key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(RFC8032_SEED, "hex")]),
  format: "der",
  type: "pkcs8",
});
const publicKey = createPublicKey(privateKey);

const CANONICAL =
  '{"afterDeadline":false,"artifactSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",' +
  '"assignmentId":"3b7e2f4a-9c1d-4e8b-a5f6-0d2c4b6a8e91","assignmentVersion":1,"documentId":"doc-1",' +
  '"dueAt":"2026-11-02T11:00:00.000000Z","evidenceDomainId":"d21fe0a3-103c-42e5-a29e-c102f9030af5",' +
  '"evidenceHeadSegmentHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",' +
  '"evidencePackageId":"evidence-1","evidenceRecord":"continuous",' +
  '"principalId":"72cd1705-85fc-4754-a382-c2500d038368","receiptSchema":"ductus-submission-receipt-v1",' +
  '"requestedAt":"2026-11-02T10:58:00.123456Z","revision":7,"submissionId":"c4a1e9d2-7b3f-4a65-8e0c-1f2d3b4c5a69"}';
const DIGEST = "f24592900fb8c817c52186dda58e025139f0da331cb95f0bf7cb0f8456dddd61";
const SIGNING_INPUT =
  "6475637475732d7375626d697373696f6e2d726563656970742d76310af24592900fb8c817c52186dda58e025139f0da331cb95f0bf7cb0f8456dddd61";
const SIGNATURE =
  "add389dc7589b3c9bc2183b5c539152b4887ff590ae4d59f3b17c74125bf8e36cca1daa68f7173a4273a89a789134971c6c25e49301514d24ed34ba585daaa08";

const contract = JSON.parse(CANONICAL) as SubmissionReceiptPayloadV1;
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const edit = (change: Record<string, unknown>) => ({ ...contract, ...change });

describe("submission receipt v1: known-answer vector", () => {
  it("gives the canonical bytes, digest, 61 signing bytes and signature of the contract", async () => {
    expect(isSubmissionReceiptPayloadV1(contract)).toBe(true);
    const digest = await digestSubmissionReceiptPayloadV1(contract);
    expect(digest.canonical).toBe(CANONICAL);
    expect(createHash("sha256").update(CANONICAL, "utf8").digest("hex")).toBe(DIGEST);
    expect(digest.sha256).toBe(DIGEST);
    expect(hex(digest.signingInput)).toBe(SIGNING_INPUT);
    expect(digest.signingInput.byteLength).toBe(61);
    expect(SUBMISSION_RECEIPT_V1_SIGNING_INPUT_BYTES).toBe(61);
    // Ed25519 is deterministic: the RFC seed gives exactly the written signature.
    expect(sign(null, digest.signingInput, privateKey).toString("hex")).toBe(SIGNATURE);
    expect(verify(null, digest.signingInput, publicKey, Buffer.from(SIGNATURE, "hex"))).toBe(true);
    // Never over the JCS text or the bare digest.
    expect(verify(null, Buffer.from(CANONICAL), publicKey, Buffer.from(SIGNATURE, "hex"))).toBe(false);
    expect(verify(null, Buffer.from(DIGEST, "hex"), publicKey, Buffer.from(SIGNATURE, "hex"))).toBe(false);
  });

  it("is the vector written in docs/BACKEND.md section 4.1", () => {
    const backend = readFileSync(new URL("../../../docs/BACKEND.md", import.meta.url), "utf8");
    expect(backend).toContain(`payload \`${CANONICAL}\``);
    expect(backend).toContain(`SHA-256/JCS predaje: \`${DIGEST}\``);
    expect(backend).toContain(`RAW ulaz predaje (61B): \`${SIGNING_INPUT}\``);
    expect(backend).toContain(`potpis nad RAW 61B: \`${SIGNATURE}\``);
  });

  it("gives the same bytes in any key order", async () => {
    const reordered = Object.fromEntries(Object.entries(contract).reverse()) as SubmissionReceiptPayloadV1;
    expect((await digestSubmissionReceiptPayloadV1(reordered)).canonical).toBe(CANONICAL);
  });

  it("breaks the signature when any field changes by one character (E1)", async () => {
    const changes: Record<string, unknown>[] = [
      { submissionId: "c4a1e9d2-7b3f-4a65-8e0c-1f2d3b4c5a6a" },
      { assignmentVersion: 2 },
      { revision: 8 },
      { artifactSha256: `${"b".repeat(63)}c` },
      { evidenceHeadSegmentHash: `${"a".repeat(63)}b` },
      { requestedAt: "2026-11-02T10:58:00.123457Z" },
      { dueAt: "2026-11-02T11:00:00.000001Z" },
      { documentId: "doc-2" },
      { evidenceRecord: "with_gaps" },
    ];
    for (const change of changes) {
      const digest = await digestSubmissionReceiptPayloadV1(edit(change) as SubmissionReceiptPayloadV1);
      expect(digest.sha256).not.toBe(DIGEST);
      expect(verify(null, digest.signingInput, publicKey, Buffer.from(SIGNATURE, "hex"))).toBe(false);
    }
  });

  it("never shares signing bytes with an evidence receipt v2 (E2)", async () => {
    const digest = await digestSubmissionReceiptPayloadV1(contract);
    const { receiptV2 } = loadGoldenVectors();
    const v2Prefix = new TextEncoder().encode(`${receiptV2.signingPrefix}\n`);
    // The same digest under the receipt v2 prefix is other bytes, so the signature fails there.
    const asV2 = Buffer.concat([v2Prefix, Buffer.from(DIGEST, "hex")]);
    expect(verify(null, asV2, publicKey, Buffer.from(SIGNATURE, "hex"))).toBe(false);
    // And a receipt v2 signature does not pass over the submission bytes.
    const [v2] = receiptV2.accepted;
    const v2Digest = await digestEvidenceReceiptPayloadV2(v2.payload);
    const v2Signature = sign(null, v2Digest.signingInput, privateKey);
    const v2AsSubmission = Buffer.concat([
      Buffer.from(digest.signingInput.subarray(0, 29)),
      Buffer.from(v2Digest.sha256, "hex"),
    ]);
    expect(verify(null, v2AsSubmission, publicKey, v2Signature)).toBe(false);
    // Nor is either payload accepted as the other.
    expect(isSubmissionReceiptPayloadV1(v2.payload)).toBe(false);
  });
});

describe("submission receipt v1: payload rules", () => {
  it.each([
    ["an unknown key", { extra: 1 }],
    ["another schema", { receiptSchema: "ductus-evidence-receipt-v2" }],
    ["an uppercase uuid", { submissionId: "C4A1E9D2-7B3F-4A65-8E0C-1F2D3B4C5A69" }],
    ["a domain id that is not version 4", { evidenceDomainId: "d21fe0a3-103c-12e5-a29e-c102f9030af5" }],
    ["a principal id that is not version 4", { principalId: "72cd1705-85fc-1754-a382-c2500d038368" }],
    ["version 0", { assignmentVersion: 0 }],
    ["a fractional version", { assignmentVersion: 1.5 }],
    ["revision 0", { revision: 0 }],
    ["an unsafe revision", { revision: 2 ** 53 }],
    ["a padded document id", { documentId: " doc-1" }],
    ["a document id with a control character", { documentId: "doc\u00071" }],
    ["a document id of 257 units", { documentId: "d".repeat(257) }],
    ["an uppercase package id", { evidencePackageId: "Evidence-1" }],
    ["an uppercase hash", { artifactSha256: "B".repeat(64) }],
    ["a short head hash", { evidenceHeadSegmentHash: "a".repeat(63) }],
    ["an unknown record mark", { evidenceRecord: "partial" }],
    ["milliseconds only", { requestedAt: "2026-11-02T10:58:00.123Z" }],
    ["an offset instead of Z", { requestedAt: "2026-11-02T10:58:00.123456+00:00" }],
    ["a day that does not exist", { dueAt: "2026-02-30T11:00:00.000000Z" }],
    ["a flag that is not a boolean", { afterDeadline: 0 }],
    ["a late flag on an on-time request", { afterDeadline: true }],
  ])("refuses %s", async (_name, change) => {
    const payload = edit(change);
    expect(isSubmissionReceiptPayloadV1(payload)).toBe(false);
    await expect(digestSubmissionReceiptPayloadV1(payload as SubmissionReceiptPayloadV1)).rejects.toThrow(
      "submission receipt v1: not a v1 payload",
    );
  });

  it("never signs bytes that differ from the payload it judged", async () => {
    let reads = 0;
    const shifty = { ...contract };
    Object.defineProperty(shifty, "afterDeadline", {
      enumerable: true,
      get: () => (reads++ === 0 ? false : true),
    });
    await expect(digestSubmissionReceiptPayloadV1(shifty)).rejects.toThrow("jcs: accessor property");
  });

  it("refuses a missing key", () => {
    for (const key of Object.keys(contract)) {
      const payload: Record<string, unknown> = { ...contract };
      delete payload[key];
      expect(isSubmissionReceiptPayloadV1(payload)).toBe(false);
    }
  });

  it("holds the deadline to the microsecond (P6)", () => {
    const due = "2026-11-02T11:00:00.000000Z";
    expect(isSubmissionReceiptPayloadV1(edit({ dueAt: due, requestedAt: due, afterDeadline: false }))).toBe(true);
    expect(isSubmissionReceiptPayloadV1(edit({ dueAt: due, requestedAt: due, afterDeadline: true }))).toBe(false);
    const late = "2026-11-02T11:00:00.000001Z";
    expect(isSubmissionReceiptPayloadV1(edit({ dueAt: due, requestedAt: late, afterDeadline: true }))).toBe(true);
    expect(isSubmissionReceiptPayloadV1(edit({ dueAt: due, requestedAt: late, afterDeadline: false }))).toBe(false);
  });

  it("reads instants of one fixed form only", () => {
    expect(isSubmissionInstant("2026-10-25T00:30:00.000000Z")).toBe(true);
    expect(isSubmissionInstant("2026-10-25T24:00:00.000000Z")).toBe(false);
    expect(isSubmissionInstant("+02026-10-25T00:30:00.000000Z")).toBe(false);
    expect(isSubmissionInstant("2026-10-25T00:30:00.0000000Z")).toBe(false);
    expect(isSubmissionInstant(Date.parse("2026-10-25T00:30:00Z"))).toBe(false);
  });

  it("checks the shape of a signed receipt", () => {
    const signed = {
      payload: contract,
      payloadDigestSha256: DIGEST,
      signature: {
        algorithm: "Ed25519",
        keyId: "test-key",
        keyVersion: "1",
        signatureEncoding: "raw",
        signatureBase64Url: Buffer.from(SIGNATURE, "hex").toString("base64url"),
      },
    };
    expect(isSignedSubmissionReceiptV1(signed)).toBe(true);
    expect(isSignedSubmissionReceiptV1({ ...signed, extra: true })).toBe(false);
    expect(
      isSignedSubmissionReceiptV1({
        ...signed,
        signature: { ...signed.signature, algorithm: "ECDSA_P256_SHA256", signatureEncoding: "der" },
      }),
    ).toBe(false);
    expect(isSignedSubmissionReceiptV1({ ...signed, payload: edit({ afterDeadline: true }) })).toBe(false);
  });
});
