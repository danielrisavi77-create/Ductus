import { isSignatureEnvelope, type SignatureEnvelope } from "./signature";
import { isEvidenceDomainId, isReceiptPrincipalId, isReceiptRevision } from "./evidence-receipt";
import { canonicalizeJcs } from "./jcs";
import { hasOnlyKeys, isPlainObject } from "../json";

/*
 * Signed submission receipt v1 (B-12, owner decision P4 on issue 385): the
 * server's signed statement that one submission was recorded after the
 * reconstruction of its revision matched. Modelled on receipt v2 (D-92) with
 * its own signing prefix, so neither signature passes for the other.
 * docs/BACKEND.md 4.1 holds the known-answer vector.
 *
 * It states the record, never authorship (PRODUCT 5 rules 1 and 9).
 */

export const SUBMISSION_RECEIPT_SCHEMA_V1 = "ductus-submission-receipt-v1" as const;

/** `UTF-8("ductus-submission-receipt-v1") || 0x0A || D`, with `D` as 32 raw bytes. */
export const SUBMISSION_RECEIPT_V1_SIGNING_INPUT_BYTES = 61;

/**
 * `requestedAt` is the database clock at the click (BACKEND 4.6), the one
 * legal time; `dueAt` the deadline of the assignment version the request
 * names. Both keep the database's microseconds, written
 * `YYYY-MM-DDTHH:mm:ss.ffffffZ`, so a request one microsecond after the
 * deadline never reads as on time. `afterDeadline` is `requestedAt > dueAt`
 * (P6: exactly at the deadline is on time) and a payload where it is not is
 * refused. `evidenceHeadSegmentHash` is the last segment the reconstruction
 * replayed, the one that produced `revision`; `artifactSha256` is the hash of
 * the reconstructed document (BACKEND 4.1). `evidenceRecord` marks a record
 * with gaps (P1, D-11); this version of the server never issues `with_gaps`,
 * because it records no gaps yet.
 */
export type SubmissionReceiptPayloadV1 = {
  receiptSchema: typeof SUBMISSION_RECEIPT_SCHEMA_V1;
  submissionId: string;
  evidenceDomainId: string;
  principalId: string;
  assignmentId: string;
  assignmentVersion: number;
  documentId: string;
  evidencePackageId: string;
  revision: number;
  artifactSha256: string;
  evidenceHeadSegmentHash: string;
  evidenceRecord: "continuous" | "with_gaps";
  requestedAt: string;
  dueAt: string;
  afterDeadline: boolean;
};

export type SignedSubmissionReceiptV1 = {
  payload: SubmissionReceiptPayloadV1;
  payloadDigestSha256: string;
  signature: SignatureEnvelope;
};

const PAYLOAD_KEYS: ReadonlySet<string> = new Set<keyof SubmissionReceiptPayloadV1>([
  "receiptSchema",
  "submissionId",
  "evidenceDomainId",
  "principalId",
  "assignmentId",
  "assignmentVersion",
  "documentId",
  "evidencePackageId",
  "revision",
  "artifactSha256",
  "evidenceHeadSegmentHash",
  "evidenceRecord",
  "requestedAt",
  "dueAt",
  "afterDeadline",
]);
const SIGNED_KEYS: ReadonlySet<string> = new Set<keyof SignedSubmissionReceiptV1>([
  "payload",
  "payloadDigestSha256",
  "signature",
]);
const SHA256_HEX = /^[0-9a-f]{64}$/;
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// The forms the database allows for these ids (evidence.document, evidence.package).
const PACKAGE_ID = /^[a-z0-9][a-z0-9_-]{0,127}$/;
const CONTROL_OR_LONE_SURROGATE = /[\p{Cc}\p{Cs}]/u;
const MICROSECOND_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const SIGNING_PREFIX = new TextEncoder().encode(`${SUBMISSION_RECEIPT_SCHEMA_V1}\n`);

const isSha256Hex = (v: unknown): v is string => typeof v === "string" && v.length === 64 && SHA256_HEX.test(v);
const isUuid = (v: unknown): v is string => typeof v === "string" && v.length === 36 && CANONICAL_UUID.test(v);

function isDocumentId(v: unknown): v is string {
  return (
    typeof v === "string" &&
    v.length >= 1 &&
    v.length <= 256 &&
    v.trim() === v &&
    !CONTROL_OR_LONE_SURROGATE.test(v)
  );
}

/**
 * A UTC instant with exactly six fraction digits. Fixed width with a
 * four-digit year, so comparing two of them as text is comparing the times.
 */
export function isSubmissionInstant(value: unknown): value is string {
  if (typeof value !== "string" || value.length !== 27 || !MICROSECOND_INSTANT.test(value)) return false;
  const milliseconds = `${value.slice(0, 23)}Z`;
  const time = Date.parse(milliseconds);
  return Number.isFinite(time) && new Date(time).toISOString() === milliseconds;
}

export function isSubmissionReceiptPayloadV1(value: unknown): value is SubmissionReceiptPayloadV1 {
  if (!isPlainObject(value) || !hasOnlyKeys(value, PAYLOAD_KEYS)) return false;
  const v = value;
  return (
    v.receiptSchema === SUBMISSION_RECEIPT_SCHEMA_V1 &&
    isUuid(v.submissionId) &&
    isEvidenceDomainId(v.evidenceDomainId) &&
    isReceiptPrincipalId(v.principalId) &&
    isUuid(v.assignmentId) &&
    Number.isSafeInteger(v.assignmentVersion) &&
    Number(v.assignmentVersion) >= 1 &&
    isDocumentId(v.documentId) &&
    typeof v.evidencePackageId === "string" &&
    PACKAGE_ID.test(v.evidencePackageId) &&
    isReceiptRevision(v.revision) &&
    isSha256Hex(v.artifactSha256) &&
    isSha256Hex(v.evidenceHeadSegmentHash) &&
    (v.evidenceRecord === "continuous" || v.evidenceRecord === "with_gaps") &&
    isSubmissionInstant(v.requestedAt) &&
    isSubmissionInstant(v.dueAt) &&
    v.afterDeadline === v.requestedAt > v.dueAt
  );
}

/**
 * `D = SHA-256(JCS(payload))` and the only bytes a submission receipt v1 is
 * signed over. Throws for anything that is not a valid v1 payload and where
 * the runtime cannot hash; a caller that issues receipts treats both as "no
 * receipt", never as an unsigned one.
 */
export async function digestSubmissionReceiptPayloadV1(payload: SubmissionReceiptPayloadV1): Promise<{
  canonical: string;
  sha256: string;
  signingInput: Uint8Array<ArrayBuffer>;
}> {
  if (!isSubmissionReceiptPayloadV1(payload)) {
    throw new Error("submission receipt v1: not a v1 payload");
  }
  const canonical = canonicalizeJcs(payload);
  const digest = new Uint8Array(
    await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical)),
  );
  if (digest.byteLength !== 32) throw new Error("submission receipt v1: SHA-256 unavailable");
  const signingInput = new Uint8Array(SUBMISSION_RECEIPT_V1_SIGNING_INPUT_BYTES);
  signingInput.set(SIGNING_PREFIX);
  signingInput.set(digest, SIGNING_PREFIX.byteLength);
  return {
    canonical,
    sha256: [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
    signingInput,
  };
}

/** Shape only: pure Ed25519 over a valid payload. The signature is checked by the caller. */
export function isSignedSubmissionReceiptV1(value: unknown): value is SignedSubmissionReceiptV1 {
  if (!isPlainObject(value) || !hasOnlyKeys(value, SIGNED_KEYS)) return false;
  return (
    isSubmissionReceiptPayloadV1(value.payload) &&
    isSha256Hex(value.payloadDigestSha256) &&
    isSignatureEnvelope(value.signature) &&
    value.signature.algorithm === "Ed25519"
  );
}
