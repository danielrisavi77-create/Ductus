import { isSignatureEnvelope, type SignatureEnvelope } from "./signature";
import {
  isSubmissionInstant, isSubmissionReceiptPayloadV1, SUBMISSION_RECEIPT_SCHEMA_V1,
  type SubmissionReceiptPayloadV1,
} from "./submission-receipt";
import { canonicalizeJcs } from "./jcs";
import { hasOnlyKeys, isPlainObject } from "../json";

// Versioned separately: the signed issuance time is not the request time.
// Contract: docs/contracts/submission-receipt-v2.md (DAN-87, plan #592).
export const SUBMISSION_RECEIPT_SCHEMA_V2 = "ductus-submission-receipt-v2" as const;
export const SUBMISSION_RECEIPT_V2_SIGNING_INPUT_BYTES = 61;
const PREFIX = new TextEncoder().encode(SUBMISSION_RECEIPT_SCHEMA_V2 + "\n");

export type SubmissionReceiptPayloadV2 = Omit<SubmissionReceiptPayloadV1, "receiptSchema"> & {
  receiptSchema: typeof SUBMISSION_RECEIPT_SCHEMA_V2;
  signedAt: string;
};

export type SignedSubmissionReceiptV2 = {
  payload: SubmissionReceiptPayloadV2;
  payloadDigestSha256: string;
  signature: SignatureEnvelope;
};

const PAYLOAD_KEYS = new Set<keyof SubmissionReceiptPayloadV2>([
  "receiptSchema", "submissionId", "evidenceDomainId", "principalId", "assignmentId",
  "assignmentVersion", "documentId", "evidencePackageId", "revision", "artifactSha256",
  "evidenceHeadSegmentHash", "evidenceRecord", "requestedAt", "dueAt", "afterDeadline", "signedAt",
]);
const SIGNED_KEYS = new Set(["payload", "payloadDigestSha256", "signature"]);

/** Exactly the enumerable data fields that will enter JCS; never invoke a getter. */
function dataObject(value: unknown, keys: ReadonlySet<string>): value is Record<string, unknown> {
  return isPlainObject(value) && hasOnlyKeys(value, keys) &&
    Reflect.ownKeys(value).length === keys.size &&
    Object.values(Object.getOwnPropertyDescriptors(value)).every((d) => "value" in d && d.enumerable);
}

export function isSubmissionReceiptPayloadV2(value: unknown): value is SubmissionReceiptPayloadV2 {
  if (!dataObject(value, PAYLOAD_KEYS) || value.receiptSchema !== SUBMISSION_RECEIPT_SCHEMA_V2) return false;
  const { signedAt, ...base } = value;
  // Reuse only the unchanged field rules, after checking this version and its
  // complete own-key set. This does not parse or accept a v1 receipt as v2.
  return isSubmissionReceiptPayloadV1({ ...base, receiptSchema: SUBMISSION_RECEIPT_SCHEMA_V1 }) &&
    isSubmissionInstant(signedAt) && signedAt >= String(base.requestedAt);
}

/** Format/digest only. Issuers must obtain signedAt from the DB after reconstruction. */
export async function digestSubmissionReceiptPayloadV2(payload: SubmissionReceiptPayloadV2): Promise<{
  canonical: string; sha256: string; signingInput: Uint8Array<ArrayBuffer>;
}> {
  if (!isSubmissionReceiptPayloadV2(payload)) throw new Error("submission receipt v2: not a v2 payload");
  const canonical = canonicalizeJcs(payload);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical)));
  if (digest.byteLength !== 32) throw new Error("submission receipt v2: SHA-256 unavailable");
  const signingInput = new Uint8Array(SUBMISSION_RECEIPT_V2_SIGNING_INPUT_BYTES);
  signingInput.set(PREFIX);
  signingInput.set(digest, PREFIX.byteLength);
  return { canonical, sha256: [...digest].map((b) => b.toString(16).padStart(2, "0")).join(""), signingInput };
}

/** Shape only. This checks neither a signature nor a trusted key/expected tuple. */
export function isSignedSubmissionReceiptV2(value: unknown): value is SignedSubmissionReceiptV2 {
  return dataObject(value, SIGNED_KEYS) && isSubmissionReceiptPayloadV2(value.payload) &&
    typeof value.payloadDigestSha256 === "string" && /^[0-9a-f]{64}$/.test(value.payloadDigestSha256) &&
    isSignatureEnvelope(value.signature) && value.signature.algorithm === "Ed25519";
}

