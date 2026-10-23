import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isSubmissionReceiptPayloadV1 } from "./submission-receipt";
import {
  digestSubmissionReceiptPayloadV2, isSignedSubmissionReceiptV2, isSubmissionReceiptPayloadV2,
  SUBMISSION_RECEIPT_V2_SIGNING_INPUT_BYTES, type SubmissionReceiptPayloadV2,
} from "./submission-receipt-v2";

// Synthetic known-answer calculated outside this module with Node and OpenSSL;
// public RFC 8032 test vector 1 seed, never a deployed signing key.
const CANONICAL = "{\"afterDeadline\":false,\"artifactSha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"assignmentId\":\"3b7e2f4a-9c1d-4e8b-a5f6-0d2c4b6a8e91\",\"assignmentVersion\":1,\"documentId\":\"doc-1\",\"dueAt\":\"2026-11-02T11:00:00.000000Z\",\"evidenceDomainId\":\"d21fe0a3-103c-42e5-a29e-c102f9030af5\",\"evidenceHeadSegmentHash\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"evidencePackageId\":\"evidence-1\",\"evidenceRecord\":\"continuous\",\"principalId\":\"72cd1705-85fc-4754-a382-c2500d038368\",\"receiptSchema\":\"ductus-submission-receipt-v2\",\"requestedAt\":\"2026-11-02T10:58:00.123456Z\",\"revision\":7,\"signedAt\":\"2026-11-02T10:59:00.654321Z\",\"submissionId\":\"c4a1e9d2-7b3f-4a65-8e0c-1f2d3b4c5a69\"}";
const DIGEST = "b8bed7b0129d597cbdd9903b020e2bdcff4c7b46cba8a4ac673b4126a6188408";
const INPUT = "6475637475732d7375626d697373696f6e2d726563656970742d76320ab8bed7b0129d597cbdd9903b020e2bdcff4c7b46cba8a4ac673b4126a6188408";
const SIGNATURE = "99e40777eea0f9208d735442a1f72231f9b678d22f20842b2a91f956f0c1ee7776ce9d5eddc1c2d28041461b9d4c4115eb701172b9d4d782489215095a1a5009";
const SPKI = "302a300506032b6570032100d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";
const privateKey = createPrivateKey({
  key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"),
    Buffer.from("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60", "hex")]),
  type: "pkcs8", format: "der",
});
const publicKey = createPublicKey(privateKey);
const payload = JSON.parse(CANONICAL) as SubmissionReceiptPayloadV2;
const edit = (change: Record<string, unknown>) => ({ ...payload, ...change });
const signed = () => ({
  payload, payloadDigestSha256: DIGEST, signature: {
    algorithm: "Ed25519", keyId: "synthetic-test-key", keyVersion: "1", signatureEncoding: "raw",
    signatureBase64Url: Buffer.from(SIGNATURE, "hex").toString("base64url"),
  },
});

describe("submission receipt v2: signing time format", () => {
  it("matches the independent canonical/digest/RAW61B/signature vector and document", async () => {
    const result = await digestSubmissionReceiptPayloadV2(payload);
    expect(result.canonical).toBe(CANONICAL);
    expect(result.sha256).toBe(DIGEST);
    expect(createHash("sha256").update(CANONICAL).digest("hex")).toBe(DIGEST);
    expect(Buffer.from(result.signingInput).toString("hex")).toBe(INPUT);
    expect(result.signingInput.byteLength).toBe(61);
    expect(SUBMISSION_RECEIPT_V2_SIGNING_INPUT_BYTES).toBe(61);
    expect(sign(null, result.signingInput, privateKey).toString("hex")).toBe(SIGNATURE);
    expect(verify(null, result.signingInput, publicKey, Buffer.from(SIGNATURE, "hex"))).toBe(true);
    expect(publicKey.export({ format: "der", type: "spki" }).toString("hex")).toBe(SPKI);
    const doc = readFileSync(new URL("../../../docs/contracts/submission-receipt-v2.md", import.meta.url), "utf8");
    for (const value of [CANONICAL, DIGEST, INPUT, SIGNATURE, SPKI]) expect(doc).toContain(value);
  });

  it("canonicalizes the same fields in another order to identical bytes", async () => {
    const reversed = Object.fromEntries(Object.entries(payload).reverse()) as SubmissionReceiptPayloadV2;
    expect(await digestSubmissionReceiptPayloadV2(reversed)).toEqual(await digestSubmissionReceiptPayloadV2(payload));
  });

  it("breaks the signature when signedAt changes by one microsecond", async () => {
    const changed = await digestSubmissionReceiptPayloadV2(edit({ signedAt: "2026-11-02T10:59:00.654322Z" }) as SubmissionReceiptPayloadV2);
    expect(changed.sha256).not.toBe(DIGEST);
    expect(verify(null, changed.signingInput, publicKey, Buffer.from(SIGNATURE, "hex"))).toBe(false);
  });

  it("separates submission v1, submission v2, evidence v2, bare digest and JCS", () => {
    const bytes = Buffer.from(SIGNATURE, "hex");
    for (const prefix of ["ductus-submission-receipt-v1", "ductus-evidence-receipt-v2"]) {
      expect(verify(null, Buffer.concat([Buffer.from(prefix + "\n"), Buffer.from(DIGEST, "hex")]), publicKey, bytes)).toBe(false);
    }
    expect(verify(null, Buffer.from(DIGEST, "hex"), publicKey, bytes)).toBe(false);
    expect(verify(null, Buffer.from(CANONICAL), publicKey, bytes)).toBe(false);
    expect(isSubmissionReceiptPayloadV1(payload)).toBe(false);
    expect(isSubmissionReceiptPayloadV2(edit({ receiptSchema: "ductus-submission-receipt-v1" }))).toBe(false);
  });

  it("requires every one of the sixteen fields", () => {
    for (const key of Object.keys(payload)) {
      const missing = { ...payload } as Record<string, unknown>;
      delete missing[key];
      expect(isSubmissionReceiptPayloadV2(missing), key).toBe(false);
    }
  });

  it("rejects unknown, non-enumerable, symbolic and accessor properties without invoking getters", async () => {
    expect(isSubmissionReceiptPayloadV2(edit({ extra: true }))).toBe(false);
    expect(isSubmissionReceiptPayloadV2({ ...payload, [Symbol("extra")]: true })).toBe(false);
    const hidden = Object.defineProperty({ ...payload }, "extra", { value: true });
    expect(isSubmissionReceiptPayloadV2(hidden)).toBe(false);
    const hiddenTime = Object.defineProperty({ ...payload }, "signedAt", { value: payload.signedAt, enumerable: false });
    expect(isSubmissionReceiptPayloadV2(hiddenTime)).toBe(false);
    let calls = 0;
    const getter = Object.defineProperty({ ...payload }, "signedAt", { get: () => { calls++; return payload.signedAt; }, enumerable: true });
    expect(isSubmissionReceiptPayloadV2(getter)).toBe(false);
    await expect(digestSubmissionReceiptPayloadV2(getter)).rejects.toThrow("not a v2 payload");
    expect(calls).toBe(0);
  });

  it.each([null, undefined, 12, "", "2026-11-02T10:59:00.654Z", "2026-11-02T10:59:00.654321+00:00",
    "2026-02-30T10:59:00.654321Z", "2026-11-02T10:59:00.6543210Z"])("rejects noncanonical signing time %s", (signedAt) => {
    expect(isSubmissionReceiptPayloadV2(edit({ signedAt }))).toBe(false);
  });

  it("preserves microseconds when comparing signing time with request time", () => {
    const requestedAt = "2026-11-02T10:58:00.123456Z";
    expect(isSubmissionReceiptPayloadV2(edit({ signedAt: requestedAt }))).toBe(true);
    expect(isSubmissionReceiptPayloadV2(edit({ signedAt: "2026-11-02T10:58:00.123455Z" }))).toBe(false);
    expect(isSubmissionReceiptPayloadV2(edit({ signedAt: "2026-11-02T10:58:00.123457Z" }))).toBe(true);
  });

  it("keeps the deadline decision tied to requestedAt even when signing is later", () => {
    expect(isSubmissionReceiptPayloadV2(edit({ signedAt: "2026-11-02T11:01:00.000001Z" }))).toBe(true);
    expect(isSubmissionReceiptPayloadV2(edit({ afterDeadline: true }))).toBe(false);
    expect(isSubmissionReceiptPayloadV2(edit({ requestedAt: payload.dueAt, signedAt: payload.dueAt }))).toBe(true);
  });

  it("keeps the unchanged field validation and refuses non-payload values", async () => {
    for (const value of [null, [], "payload", new Date(), edit({ revision: -1 }), edit({ artifactSha256: "not-a-hash" }),
      edit({ assignmentVersion: 0 }), edit({ evidenceRecord: "unknown" }), edit({ requestedAt: "invalid" })]) {
      expect(isSubmissionReceiptPayloadV2(value)).toBe(false);
      await expect(digestSubmissionReceiptPayloadV2(value as SubmissionReceiptPayloadV2)).rejects.toThrow("not a v2 payload");
    }
  });

  it("checks signed envelope shape without claiming cryptographic verification", () => {
    expect(isSignedSubmissionReceiptV2(signed())).toBe(true);
    expect(isSignedSubmissionReceiptV2({ ...signed(), extra: true })).toBe(false);
    expect(isSignedSubmissionReceiptV2({ ...signed(), payloadDigestSha256: "invalid" })).toBe(false);
    expect(isSignedSubmissionReceiptV2({ ...signed(), signature: { ...signed().signature, algorithm: "RSA_PSS_SHA256" } })).toBe(false);
    // Valid-looking but false bytes still have the shape: the future verifier must refuse them.
    expect(isSignedSubmissionReceiptV2({ ...signed(), signature: { ...signed().signature,
      signatureBase64Url: Buffer.alloc(64).toString("base64url") } })).toBe(true);
  });
});

