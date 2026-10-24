import { createPrivateKey, sign } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { digestSubmissionReceiptPayloadV2, type SubmissionReceiptPayloadV2 } from "./submission-receipt-v2";
import { verifySignedSubmissionReceiptV2 } from "./submission-receipt-verifier-v2";

// Invented payload; public RFC8032 test vector1 seed, never a deployed key.
const payload: SubmissionReceiptPayloadV2 = {
  receiptSchema: "ductus-submission-receipt-v2", signedAt: "2026-11-02T10:59:00.654321Z",
  submissionId: "c4a1e9d2-7b3f-4a65-8e0c-1f2d3b4c5a69", principalId: "72cd1705-85fc-4754-a382-c2500d038368",
  evidenceDomainId: "d21fe0a3-103c-42e5-a29e-c102f9030af5", assignmentId: "3b7e2f4a-9c1d-4e8b-a5f6-0d2c4b6a8e91",
  assignmentVersion: 1, documentId: "doc-1", evidencePackageId: "evidence-1", revision: 7,
  artifactSha256: "b".repeat(64), evidenceHeadSegmentHash: "a".repeat(64), evidenceRecord: "continuous",
  requestedAt: "2026-11-02T10:58:00.123456Z", dueAt: "2026-11-02T11:00:00.000000Z", afterDeadline: false,
};
const privateKey = createPrivateKey({ key: Buffer.from("302e020100300506032b6570042204209d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60", "hex"), format: "der", type: "pkcs8" });
const key = {
  algorithm: "Ed25519" as const, keyId: "synthetic-test-key", keyVersion: "1", encoding: "spki-der" as const,
  keyBase64Url: Buffer.from("302a300506032b6570032100d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a", "hex").toString("base64url"),
  evidenceDomainId: payload.evidenceDomainId, purpose: "receipt" as const,
  validFrom: "2026-11-02T10:59:00.000Z", validTo: "2026-11-02T11:00:00.000Z", revokedAt: null,
};
const expected = () => {
  const { receiptSchema: _schema, signedAt: _time, ...rest } = payload;
  void _schema; void _time;
  return rest;
};
const signed = () => ({
  payload: structuredClone(payload), payloadDigestSha256: "b8bed7b0129d597cbdd9903b020e2bdcff4c7b46cba8a4ac673b4126a6188408",
  signature: { algorithm: "Ed25519" as const, keyId: key.keyId, keyVersion: "1", signatureEncoding: "raw" as const,
    signatureBase64Url: Buffer.from("99e40777eea0f9208d735442a1f72231f9b678d22f20842b2a91f956f0c1ee7776ce9d5eddc1c2d28041461b9d4c4115eb701172b9d4d782489215095a1a5009", "hex").toString("base64url") },
});
async function resign(change: Partial<SubmissionReceiptPayloadV2>, prefix?: string) {
  const r = signed(); Object.assign(r.payload, change);
  const digest = await digestSubmissionReceiptPayloadV2(r.payload);
  r.payloadDigestSha256 = digest.sha256;
  const bytes = prefix ? Buffer.concat([Buffer.from(prefix + "\n"), Buffer.from(digest.sha256, "hex")]) : digest.signingInput;
  r.signature.signatureBase64Url = sign(null, bytes, privateKey).toString("base64url");
  return r;
}
const check = (r: unknown = signed(), k: unknown = key, e: unknown = expected()) =>
  verifySignedSubmissionReceiptV2(r, e, [k]);
afterEach(() => vi.unstubAllGlobals());

describe("trusted submission receipt v2 verifier", () => {
  it("verifies the independent known answer using a separately supplied registry and expected record", async () => {
    expect(await check()).toEqual({ ok: true, payload });
    expect(await check(signed(), { ...key, validTo: null })).toEqual({ ok: true, payload });
    const r = signed(); r.payload = Object.fromEntries(Object.entries(r.payload).reverse()) as SubmissionReceiptPayloadV2;
    expect(await check(r)).toEqual({ ok: true, payload });
  });
  it("requires a trusted key; the signature's own key id conveys no authority", async () => {
    expect(await verifySignedSubmissionReceiptV2(signed(), expected(), [])).toEqual({ ok: false, reason: "key_unknown" });
    expect(await verifySignedSubmissionReceiptV2(signed(), expected(), [key, key])).toEqual({ ok: false, reason: "key_unknown" });
    expect(await verifySignedSubmissionReceiptV2(signed(), expected(), [key, { ...key, extra: true }])).toEqual({ ok: false, reason: "key_unknown" });
  });
  it.each([
    ["keyVersion", "2", "key_unknown"], ["keyId", "unknown", "key_unknown"],
    ["purpose", "checkpoint", "key_scope"], ["evidenceDomainId", "e21fe0a3-103c-42e5-a29e-c102f9030af5", "key_scope"],
    ["revokedAt", "2026-11-03T00:00:00.000Z", "key_revoked"],
    ["validFrom", "2026-11-02T11:00:00.000Z", "key_unknown"],
    ["validTo", "2026-11-02T10:59:00.000Z", "key_unknown"],
    ["validFrom", "2026-11-02T10:59:00.001Z", "key_unknown"],
  ])("rejects registry %s=%s", async (field, value, reason) => {
    expect(await check(signed(), { ...key, [field]: value })).toEqual({ ok: false, reason });
  });
  it("bounds signedAt by validFrom inclusive and validTo exclusive with microseconds", async () => {
    for (const time of ["2026-11-02T10:59:00.000000Z", "2026-11-02T10:59:59.999999Z"])
      expect(await check(await resign({ signedAt: time }))).toMatchObject({ ok: true });
    for (const time of ["2026-11-02T10:58:59.999999Z", "2026-11-02T11:00:00.000000Z", "2026-11-02T11:00:00.000001Z"])
      expect(await check(await resign({ signedAt: time }))).toEqual({ ok: false, reason: "key_not_valid" });
  });
  it("binds every expected immutable field after a real signature", async () => {
    const changes = {
      submissionId: "d4a1e9d2-7b3f-4a65-8e0c-1f2d3b4c5a69", principalId: "82cd1705-85fc-4754-a382-c2500d038368",
      evidenceDomainId: "e21fe0a3-103c-42e5-a29e-c102f9030af5", assignmentId: "4b7e2f4a-9c1d-4e8b-a5f6-0d2c4b6a8e91",
      assignmentVersion: 2, documentId: "doc-2", evidencePackageId: "evidence-2", revision: 8,
      artifactSha256: "c".repeat(64), evidenceHeadSegmentHash: "d".repeat(64), evidenceRecord: "with_gaps",
      requestedAt: "2026-11-02T10:58:00.123457Z", dueAt: "2026-11-02T11:01:00.000000Z",
    };
    for (const [field, value] of Object.entries(changes))
      expect(await check(signed(), key, { ...expected(), [field]: value }), field).toEqual({ ok: false, reason: "submission_mismatch" });
    // afterDeadline cannot be changed alone without invalidating expected's invariant.
    expect(await check(signed(), key, { ...expected(), afterDeadline: true })).toEqual({ ok: false, reason: "expectation_invalid" });
    expect(await check(signed(), key, { ...expected(), dueAt: "2026-11-02T10:57:00.000000Z", afterDeadline: true })).toEqual({ ok: false, reason: "submission_mismatch" });
  });
  it("rejects a changed payload, digest, signature, v1 prefix and v1 shape", async () => {
    const changed = signed(); changed.payload.signedAt = "2026-11-02T10:59:00.654322Z";
    expect(await check(changed)).toEqual({ ok: false, reason: "digest_mismatch" });
    changed.payloadDigestSha256 = (await digestSubmissionReceiptPayloadV2(changed.payload)).sha256;
    expect(await check(changed)).toEqual({ ok: false, reason: "signature_invalid" });
    expect(await check(await resign({}, "ductus-submission-receipt-v1"))).toEqual({ ok: false, reason: "signature_invalid" });
    expect(await check({ ...signed(), payload: { ...payload, receiptSchema: "ductus-submission-receipt-v1" } })).toEqual({ ok: false, reason: "receipt_malformed" });
    const raw = signed(); raw.signature.signatureBase64Url += "=";
    expect(await check(raw)).toEqual({ ok: false, reason: "receipt_malformed" });
  });
  it("refuses small-order keys/R, noncanonical S and wrong SPKI before runtime acceptance", async () => {
    vi.stubGlobal("crypto", { subtle: { digest: crypto.subtle.digest.bind(crypto.subtle), importKey: vi.fn(), verify: vi.fn().mockResolvedValue(true) } });
    expect(await check(signed(), { ...key, keyBase64Url: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.alloc(32)]).toString("base64url") })).toEqual({ ok: false, reason: "key_unknown" });
    expect(await check(signed(), { ...key, keyBase64Url: Buffer.alloc(44).toString("base64url") })).toEqual({ ok: false, reason: "key_unknown" });
    const r = signed(); r.signature.signatureBase64Url = Buffer.alloc(64).toString("base64url");
    expect(await check(r)).toEqual({ ok: false, reason: "receipt_malformed" });
    const s = signed(); const bytes = Buffer.from(s.signature.signatureBase64Url, "base64url"); bytes.fill(255, 32);
    s.signature.signatureBase64Url = bytes.toString("base64url");
    expect(await check(s)).toEqual({ ok: false, reason: "receipt_malformed" });
    expect(crypto.subtle.importKey).not.toHaveBeenCalled();
  });
  it("rejects getter/hidden/symbol fields without calling getters", async () => {
    let calls = 0;
    const accessor = <T extends object>(value: T, field: string) => Object.defineProperty(value, field, { enumerable: true, get() { calls++; return "x"; } });
    expect(await check(accessor(signed(), "payload"))).toEqual({ ok: false, reason: "receipt_malformed" });
    const r = signed(); accessor(r.signature, "keyId");
    expect(await check(r)).toEqual({ ok: false, reason: "receipt_malformed" });
    expect(await check(signed(), key, accessor(expected(), "principalId"))).toEqual({ ok: false, reason: "expectation_invalid" });
    expect(await check(signed(), accessor({ ...key }, "keyId"))).toEqual({ ok: false, reason: "key_unknown" });
    expect(await check(Object.defineProperty(signed(), "hidden", { value: true }))).toEqual({ ok: false, reason: "receipt_malformed" });
    expect(await check({ ...signed(), [Symbol("extra")]: true })).toEqual({ ok: false, reason: "receipt_malformed" });
    expect(calls).toBe(0);
  });
  it("snapshots receipt, expected record and key before the first asynchronous boundary", async () => {
    const r = signed(), e = expected(), k = { ...key };
    const pending = check(r, k, e);
    r.payload.revision++; e.revision++; k.keyVersion = "2";
    const result = await pending;
    expect(result).toEqual({ ok: true, payload });
    expect(result.ok && result.payload).not.toBe(r.payload);
  });
  it("fails closed for unavailable crypto and anything but a true verification", async () => {
    const subtle = crypto.subtle;
    for (const failure of [undefined, { subtle: { digest: () => Promise.reject(new Error("offline runtime")) } },
      { subtle: { digest: subtle.digest.bind(subtle), importKey: () => Promise.reject(new Error("Ed25519 unavailable")) } }]) {
      vi.stubGlobal("crypto", failure);
      expect(await check()).toEqual({ ok: false, reason: "verification_unavailable" });
    }
    for (const result of [false, "true", 1, null]) {
      vi.stubGlobal("crypto", { subtle: { digest: subtle.digest.bind(subtle), importKey: subtle.importKey.bind(subtle), verify: () => Promise.resolve(result) } });
      expect(await check()).toEqual({ ok: false, reason: "signature_invalid" });
    }
  });
});
