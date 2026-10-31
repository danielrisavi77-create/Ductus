import { isSignatureEnvelope, type SignatureEnvelope } from "./signature";
import { sha256WebCrypto } from "./crypto";
import { canonicalizeJcs } from "./jcs";
import {
  isEvidenceMinuteV2,
  isEvidenceSegmentSchema,
  MAX_EVIDENCE_PROFILE_ID_LENGTH,
  type EvidenceSegmentSchema,
} from "./evidence-segment-v2";
import { hasOnlyKeys, isPlainObject } from "../json";

export const EVIDENCE_RECEIPT_SCHEMA_V1 = "ductus-evidence-receipt-v1" as const;

export type EvidenceReceiptPayloadV1 = {
  receiptSchema: typeof EVIDENCE_RECEIPT_SCHEMA_V1;
  receiptId: string;
  evidencePackageId: string;
  documentId: string;
  sessionId: string;
  segmentId: string;
  segmentHash: string;
  predecessorSegmentHash: string | null;
  previousReceiptId: string | null;
  /** The schema of the accepted segment, v2 or v3. */
  evidenceSchema: EvidenceSegmentSchema;
  evidenceProfileId: string;
  sequenceFrom: number;
  sequenceTo: number;
  eventCount: number;
  payloadBytes: number;
  acceptedAt: string;
};

export type SignedEvidenceReceipt = {
  payload: EvidenceReceiptPayloadV1;
  payloadDigestSha256: string;
  signature: SignatureEnvelope;
};

export function canonicalEvidenceReceiptPayload(
  payload: EvidenceReceiptPayloadV1,
): string {
  return canonicalizeJcs(payload);
}

export async function digestEvidenceReceiptPayload(
  payload: EvidenceReceiptPayloadV1,
): Promise<{
  canonical: string;
  bytes: Uint8Array;
  sha256: string;
}> {
  const canonical = canonicalEvidenceReceiptPayload(payload);
  const bytes = new TextEncoder().encode(canonical);
  return {
    canonical,
    bytes,
    sha256: await sha256WebCrypto(canonical),
  };
}


const SHA256_HEX = /^[0-9a-f]{64}$/;
// The payload is what gets signed and the envelope is what the client keeps as
// proof: a field outside these sets was checked by nobody, so it is refused.
const RECEIPT_PAYLOAD_KEYS: ReadonlySet<string> = new Set<
  keyof EvidenceReceiptPayloadV1
>([
  "receiptSchema",
  "receiptId",
  "evidencePackageId",
  "documentId",
  "sessionId",
  "segmentId",
  "segmentHash",
  "predecessorSegmentHash",
  "previousReceiptId",
  "evidenceSchema",
  "evidenceProfileId",
  "sequenceFrom",
  "sequenceTo",
  "eventCount",
  "payloadBytes",
  "acceptedAt",
]);
const SIGNED_RECEIPT_KEYS: ReadonlySet<string> = new Set<
  keyof SignedEvidenceReceipt
>(["payload", "payloadDigestSha256", "signature"]);

// Every text is measured before it is read: a validator never trims, parses
// or matches a value of unbounded size.
function nonEmpty(value: unknown, max = 256): value is string {
  return (
    typeof value === "string" &&
    value.length <= max &&
    value.trim().length > 0
  );
}

function isSha256Hex(value: unknown): value is string {
  return (
    typeof value === "string" && value.length === 64 && SHA256_HEX.test(value)
  );
}

/** A non-blank id of at most 256 UTF-16 code units, as a receipt carries it. */
export function isReceiptId(value: unknown): value is string {
  return nonEmpty(value);
}

// The longest text `toISOString` writes is 27 characters (a year of six digits).
const MAX_INSTANT_LENGTH = 27;

export function canonicalInstant(value: unknown): value is string {
  if (typeof value !== "string" || value.length > MAX_INSTANT_LENGTH) {
    return false;
  }
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

export function isEvidenceReceiptPayloadV1(
  value: unknown,
): value is EvidenceReceiptPayloadV1 {
  if (!isPlainObject(value) || !hasOnlyKeys(value, RECEIPT_PAYLOAD_KEYS)) {
    return false;
  }
  return (
    value.receiptSchema === EVIDENCE_RECEIPT_SCHEMA_V1 &&
    hasValidAcceptanceFields(value)
  );
}

/** The fields receipt v1 and receipt v2 share, under one rule for both. */
function hasValidAcceptanceFields(v: Record<string, unknown>): boolean {
  return (
    nonEmpty(v.receiptId) &&
    nonEmpty(v.evidencePackageId) &&
    nonEmpty(v.documentId) &&
    nonEmpty(v.sessionId) &&
    nonEmpty(v.segmentId) &&
    isSha256Hex(v.segmentHash) &&
    (v.predecessorSegmentHash === null ||
      isSha256Hex(v.predecessorSegmentHash)) &&
    (v.previousReceiptId === null || nonEmpty(v.previousReceiptId)) &&
    isEvidenceSegmentSchema(v.evidenceSchema) &&
    nonEmpty(v.evidenceProfileId, MAX_EVIDENCE_PROFILE_ID_LENGTH) &&
    Number.isSafeInteger(v.sequenceFrom) &&
    Number(v.sequenceFrom) >= 1 &&
    Number.isSafeInteger(v.sequenceTo) &&
    Number(v.sequenceTo) >= Number(v.sequenceFrom) &&
    Number.isSafeInteger(v.eventCount) &&
    Number(v.eventCount) >= 1 &&
    // Counted as to - from, which is exact for these numbers: from + count - 1
    // can round in a double and pass a count the range does not hold.
    Number(v.sequenceTo) - Number(v.sequenceFrom) ===
      Number(v.eventCount) - 1 &&
    Number.isSafeInteger(v.payloadBytes) &&
    Number(v.payloadBytes) >= 1 &&
    canonicalInstant(v.acceptedAt)
  );
}

export function isSignedEvidenceReceipt(
  value: unknown,
): value is SignedEvidenceReceipt {
  if (!isPlainObject(value) || !hasOnlyKeys(value, SIGNED_RECEIPT_KEYS)) {
    return false;
  }
  const v = value;
  return (
    isEvidenceReceiptPayloadV1(v.payload) &&
    isSha256Hex(v.payloadDigestSha256) &&
    isSignatureEnvelope(v.signature)
  );
}

/*
 * Receipt v2 (D-92, DAN-54). Receipt v1 above stays as it is: which rules
 * apply is chosen by `receiptSchema`, and nothing below accepts a v1 payload.
 */

export const EVIDENCE_RECEIPT_SCHEMA_V2 = "ductus-evidence-receipt-v2" as const;

/** The cap of the commit request and of its column (`commitRequestFromTransaction`). */
export const MAX_RECEIPT_CLIENT_TRANSACTION_ID_LENGTH = 128;

/** Length of the bytes a receipt v2 signature is made over (D-92). */
export const EVIDENCE_RECEIPT_V2_SIGNING_INPUT_BYTES = 59;

/**
 * `revision` and `clientTransactionId` mean "the commit in which this segment
 * was accepted": the revision that commit wrote and its idempotency key
 * (owner decision of 11 October 2026, issue 87 comment 6105502093, point 5).
 * A receipt names one commit. No verifier, table or test may assume that a
 * revision has exactly one receipt, or that the sequence numbers of a segment
 * follow the revision. `evidenceDomainId` names the evidence domain (one
 * institution in one region) and says nothing else about it.
 *
 * `principalId` is the author the server took from the session of the request
 * that sent the segment, never a value the client wrote: a canonical lowercase
 * UUID of version 4, as the server mints its user ids. The role of the author
 * and a mark of offline work are left out of a receipt v2 on purpose (owner
 * decision of 11 October 2026, issue 87 comment 6108404647, point 2).
 *
 * `acceptedAt` is the start of the UTC minute in which the server accepted
 * the segment, written `YYYY-MM-DDTHH:mm:00.000Z` (the form of D-24). The
 * server drops seconds and milliseconds before it signs; a reader refuses
 * every other form and never rounds one. Receipt v1 keeps the full instant.
 * (Issue 87, comment 6107934097, point 2.)
 */
export type EvidenceReceiptPayloadV2 = Omit<
  EvidenceReceiptPayloadV1,
  "receiptSchema"
> & {
  receiptSchema: typeof EVIDENCE_RECEIPT_SCHEMA_V2;
  revision: number;
  clientTransactionId: string;
  evidenceDomainId: string;
  principalId: string;
};

export type SignedEvidenceReceiptV2 = {
  payload: EvidenceReceiptPayloadV2;
  payloadDigestSha256: string;
  signature: SignatureEnvelope;
};

const RECEIPT_PAYLOAD_V2_KEYS: ReadonlySet<string> = new Set<string>([
  ...RECEIPT_PAYLOAD_KEYS,
  ...([
    "revision",
    "clientTransactionId",
    "evidenceDomainId",
    "principalId",
  ] satisfies (keyof EvidenceReceiptPayloadV2)[]),
]);
// Version 4 only: a random identifier, with no time and nothing derived in it.
const CANONICAL_UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// With the u flag a surrogate matches only when it is not half of a pair.
const CONTROL_OR_LONE_SURROGATE = /[\p{Cc}\p{Cs}]/u;
const RECEIPT_V2_SIGNING_PREFIX = new TextEncoder().encode(
  `${EVIDENCE_RECEIPT_SCHEMA_V2}\n`,
);

/** A canonical lowercase UUID of version 4, and nothing else. */
export function isEvidenceDomainId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length === 36 &&
    CANONICAL_UUID_V4.test(value)
  );
}

/** The author of a receipt: the same one form as an evidence domain id. */
export function isReceiptPrincipalId(value: unknown): value is string {
  return isEvidenceDomainId(value);
}

/** A transaction id a receipt may carry: bounded, with no control character. */
export function isReceiptClientTransactionId(value: unknown): value is string {
  return (
    nonEmpty(value, MAX_RECEIPT_CLIENT_TRANSACTION_ID_LENGTH) &&
    !CONTROL_OR_LONE_SURROGATE.test(value)
  );
}

/** A revision a commit can have written: 0 is a document with no commit yet. */
export function isReceiptRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}

export function isEvidenceReceiptPayloadV2(
  value: unknown,
): value is EvidenceReceiptPayloadV2 {
  if (!isPlainObject(value) || !hasOnlyKeys(value, RECEIPT_PAYLOAD_V2_KEYS)) {
    return false;
  }
  return (
    value.receiptSchema === EVIDENCE_RECEIPT_SCHEMA_V2 &&
    hasValidAcceptanceFields(value) &&
    // After the shared rules, which bound the length of the text.
    isEvidenceMinuteV2(value.acceptedAt) &&
    isReceiptRevision(value.revision) &&
    isReceiptClientTransactionId(value.clientTransactionId) &&
    isEvidenceDomainId(value.evidenceDomainId) &&
    isReceiptPrincipalId(value.principalId)
  );
}

/**
 * Thrown where the runtime cannot hash: no Web Crypto, or a SHA-256 that
 * fails or is not 32 bytes. It says nothing about the payload.
 */
export class EvidenceHashUnavailableError extends Error {}

/**
 * The digest `D = SHA-256(JCS(payload))` and the only bytes a receipt v2 may
 * be signed over: `UTF-8("ductus-evidence-receipt-v2") || 0x0A || D`, with `D`
 * as its 32 raw bytes (D-92). Throws for anything that is not a valid v2
 * payload, so the v2 signing input can never be made for a v1 record, and
 * `EvidenceHashUnavailableError` where the runtime cannot hash.
 */
export async function digestEvidenceReceiptPayloadV2(
  payload: EvidenceReceiptPayloadV2,
): Promise<{
  canonical: string;
  bytes: Uint8Array<ArrayBuffer>;
  sha256: string;
  signingInput: Uint8Array<ArrayBuffer>;
}> {
  if (!isEvidenceReceiptPayloadV2(payload)) {
    throw new Error("evidence receipt v2: not a v2 payload");
  }
  const canonical = canonicalizeJcs(payload);
  const bytes = new TextEncoder().encode(canonical);
  // The payload is valid and has its canonical bytes: what fails from here on
  // is the runtime, also where it has no Web Crypto at all.
  const digest = await Promise.resolve()
    .then(() => globalThis.crypto.subtle.digest("SHA-256", bytes))
    .then((hash) => new Uint8Array(hash))
    .catch(() => null);
  if (digest?.byteLength !== 32) {
    throw new EvidenceHashUnavailableError(
      "evidence receipt v2: SHA-256 unavailable",
    );
  }
  const signingInput = new Uint8Array(EVIDENCE_RECEIPT_V2_SIGNING_INPUT_BYTES);
  signingInput.set(RECEIPT_V2_SIGNING_PREFIX);
  signingInput.set(digest, RECEIPT_V2_SIGNING_PREFIX.byteLength);
  return {
    canonical,
    bytes,
    sha256: [...digest].map((b) => b.toString(16).padStart(2, "0")).join(""),
    signingInput,
  };
}

/** Shape only; `verifySignedEvidenceReceiptV2` is what checks the signature. */
export function isSignedEvidenceReceiptV2(
  value: unknown,
): value is SignedEvidenceReceiptV2 {
  if (!isPlainObject(value) || !hasOnlyKeys(value, SIGNED_RECEIPT_KEYS)) {
    return false;
  }
  return (
    isEvidenceReceiptPayloadV2(value.payload) &&
    isSha256Hex(value.payloadDigestSha256) &&
    isSignatureEnvelope(value.signature) &&
    // D-92: pure Ed25519, and no other algorithm.
    value.signature.algorithm === "Ed25519"
  );
}
