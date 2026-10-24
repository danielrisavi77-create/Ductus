import { isPlainObject } from "../json";
import { ed25519KeyFromSpki, isCanonicalEd25519Signature, isSoundEd25519Point } from "./ed25519-encoding";
import { canonicalInstant, isEvidenceDomainId } from "./evidence-receipt";
import type { EvidenceDomainKey } from "./evidence-receipt-verifier";
import { isEvidenceMinuteV2 } from "./evidence-segment-v2";
import { isPublicVerificationKey } from "./signature";
import {
  digestSubmissionReceiptPayloadV2, isSignedSubmissionReceiptV2, isSubmissionReceiptPayloadV2,
  SUBMISSION_RECEIPT_SCHEMA_V2, type SubmissionReceiptPayloadV2,
} from "./submission-receipt-v2";

/** Caller-owned authorized context, obtained separately from the receipt response. */
export type SubmissionReceiptExpectationV2 = Omit<SubmissionReceiptPayloadV2, "receiptSchema" | "signedAt">;
export type SubmissionReceiptVerificationV2 =
  | { ok: true; payload: SubmissionReceiptPayloadV2 }
  | { ok: false; reason: "expectation_invalid" | "receipt_malformed" | "digest_mismatch" |
    "key_unknown" | "key_scope" | "key_revoked" | "key_not_valid" | "signature_invalid" |
    "submission_mismatch" | "verification_unavailable" };
const EXPECTED = new Set([
  "submissionId", "principalId", "evidenceDomainId", "assignmentId", "assignmentVersion",
  "documentId", "evidencePackageId", "revision", "artifactSha256", "evidenceHeadSegmentHash",
  "evidenceRecord", "requestedAt", "dueAt", "afterDeadline",
]);
const RECEIPT = new Set(["payload", "payloadDigestSha256", "signature"]);
const SIGNATURE = new Set(["algorithm", "keyId", "keyVersion", "signatureEncoding", "signatureBase64Url"]);
const KEY = new Set([
  "algorithm", "keyId", "keyVersion", "encoding", "keyBase64Url", "evidenceDomainId", "purpose",
  "validFrom", "validTo", "revokedAt",
]);
const refuse = (reason: Extract<SubmissionReceiptVerificationV2, { ok: false }>["reason"]): SubmissionReceiptVerificationV2 => ({ ok: false, reason });

/** Refuse accessors, symbols, missing/hidden/extra fields before reading values. */
function dataObject(value: unknown, keys: ReadonlySet<string>): value is Record<string, unknown> {
  return isPlainObject(value) && Reflect.ownKeys(value).length === keys.size &&
    Reflect.ownKeys(value).every((name) => typeof name === "string" && keys.has(name)) &&
    Object.entries(Object.getOwnPropertyDescriptors(value)).every(([name, d]) => keys.has(name) && d.enumerable && "value" in d);
}
function isExpected(value: unknown): value is SubmissionReceiptExpectationV2 {
  return dataObject(value, EXPECTED) && isSubmissionReceiptPayloadV2({
    ...value, receiptSchema: SUBMISSION_RECEIPT_SCHEMA_V2, signedAt: value.requestedAt,
  });
}
function isKey(value: unknown): value is EvidenceDomainKey {
  if (!dataObject(value, KEY)) return false;
  const { evidenceDomainId, purpose, validFrom, validTo, revokedAt, ...publicKey } = value;
  return isPublicVerificationKey(publicKey) && isEvidenceDomainId(evidenceDomainId) &&
    (purpose === "receipt" || purpose === "checkpoint") && isEvidenceMinuteV2(validFrom) &&
    (validTo === null || (isEvidenceMinuteV2(validTo) && validFrom < validTo)) &&
    (revokedAt === null || canonicalInstant(revokedAt));
}
function decode(value: string, length: number): Uint8Array<ArrayBuffer> | null {
  if (value.length !== Math.ceil(length * 4 / 3) || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const raw = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
    const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
    return bytes.length === length && btoa(raw).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "") === value ? bytes : null;
  } catch { return null; }
}

/**
 * Pure, never-throw verifier of the accepted v2 contract (#599).
 * trustedKeys and expected MUST come from independent authorized sources;
 * this function cannot establish their provenance or registry freshness.
 * No runtime caller yet: no UI success, DB time/persistence or KMS claim.
 */
export async function verifySignedSubmissionReceiptV2(
  signedReceipt: unknown, expected: unknown, trustedKeys: readonly unknown[],
): Promise<SubmissionReceiptVerificationV2> {
  try {
    if (typeof structuredClone !== "function" || typeof atob !== "function" || typeof btoa !== "function")
      return refuse("verification_unavailable");
    if (!isExpected(expected) || !Array.isArray(trustedKeys)) return refuse("expectation_invalid");
    if (!dataObject(signedReceipt, RECEIPT) || !dataObject(signedReceipt.signature, SIGNATURE) ||
      !isSignedSubmissionReceiptV2(signedReceipt)) return refuse("receipt_malformed");
    // Freeze every input before hashing or importing a key yields control.
    const receipt = structuredClone(signedReceipt);
    const expectation = structuredClone(expected);
    // A malformed duplicate must not disappear before uniqueness is checked.
    if (!trustedKeys.every(isKey)) return refuse("key_unknown");
    const named = trustedKeys.filter((k) => k.keyId === receipt.signature.keyId);
    const key = named.length === 1 && isKey(named[0]) ? structuredClone(named[0]) : null;
    if (!key || key.keyVersion !== receipt.signature.keyVersion) return refuse("key_unknown");
    if (key.algorithm !== "Ed25519" || key.purpose !== "receipt" || key.evidenceDomainId !== receipt.payload.evidenceDomainId)
      return refuse("key_scope");
    if (key.revokedAt !== null) return refuse("key_revoked");
    // Registry bounds are canonical whole UTC minutes; expand to UTC6 instead
    // of truncating signedAt to milliseconds. validTo remains exclusive.
    const utc6 = (minute: string) => minute.replace(".000Z", ".000000Z");
    if (receipt.payload.signedAt < utc6(key.validFrom) ||
      (key.validTo !== null && receipt.payload.signedAt >= utc6(key.validTo))) return refuse("key_not_valid");
    const signature = decode(receipt.signature.signatureBase64Url, 64);
    if (!signature || !isCanonicalEd25519Signature(signature)) return refuse("receipt_malformed");
    const spki = decode(key.keyBase64Url, 44);
    const point = spki ? ed25519KeyFromSpki(spki) : null;
    if (!spki || !point || !isSoundEd25519Point(point)) return refuse("key_unknown");
    let digest: Awaited<ReturnType<typeof digestSubmissionReceiptPayloadV2>>;
    try { digest = await digestSubmissionReceiptPayloadV2(receipt.payload); }
    catch { return refuse("verification_unavailable"); }
    if (receipt.payloadDigestSha256 !== digest.sha256) return refuse("digest_mismatch");
    let valid: unknown;
    try {
      const imported = await globalThis.crypto.subtle.importKey("spki", spki, { name: "Ed25519" }, false, ["verify"]);
      valid = await globalThis.crypto.subtle.verify({ name: "Ed25519" }, imported, signature, digest.signingInput);
    } catch { return refuse("verification_unavailable"); }
    if (valid !== true) return refuse("signature_invalid");
    if (Object.entries(expectation).some(([name, value]) => receipt.payload[name as keyof SubmissionReceiptPayloadV2] !== value))
      return refuse("submission_mismatch");
    return { ok: true, payload: receipt.payload };
  } catch { return refuse("receipt_malformed"); }
}
