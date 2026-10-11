import { isSignatureEnvelope, type SignatureEnvelope } from "./signature";
import { sha256WebCrypto } from "./crypto";
import { canonicalizeJcs } from "./jcs";
import {
  EVIDENCE_SEGMENT_SCHEMA_V2,
  MAX_EVIDENCE_PROFILE_ID_LENGTH,
  type EvidenceSegmentV2,
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
  evidenceSchema: EvidenceSegmentV2["evidenceSchema"];
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

function nonEmpty(value: unknown, max = 256): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= max
  );
}

export function canonicalInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
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
    typeof v.segmentHash === "string" &&
    SHA256_HEX.test(v.segmentHash) &&
    (v.predecessorSegmentHash === null ||
      (typeof v.predecessorSegmentHash === "string" &&
        SHA256_HEX.test(v.predecessorSegmentHash))) &&
    (v.previousReceiptId === null || nonEmpty(v.previousReceiptId)) &&
    v.evidenceSchema === EVIDENCE_SEGMENT_SCHEMA_V2 &&
    nonEmpty(v.evidenceProfileId, MAX_EVIDENCE_PROFILE_ID_LENGTH) &&
    Number.isSafeInteger(v.sequenceFrom) &&
    Number(v.sequenceFrom) >= 1 &&
    Number.isSafeInteger(v.sequenceTo) &&
    Number(v.sequenceTo) >= Number(v.sequenceFrom) &&
    Number.isSafeInteger(v.eventCount) &&
    Number(v.eventCount) >= 1 &&
    Number(v.sequenceTo) ===
      Number(v.sequenceFrom) + Number(v.eventCount) - 1 &&
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
    typeof v.payloadDigestSha256 === "string" &&
    SHA256_HEX.test(v.payloadDigestSha256) &&
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
 */
export type EvidenceReceiptPayloadV2 = Omit<
  EvidenceReceiptPayloadV1,
  "receiptSchema"
> & {
  receiptSchema: typeof EVIDENCE_RECEIPT_SCHEMA_V2;
  revision: number;
  clientTransactionId: string;
  evidenceDomainId: string;
};

export type SignedEvidenceReceiptV2 = {
  payload: EvidenceReceiptPayloadV2;
  payloadDigestSha256: string;
  signature: SignatureEnvelope;
};

const RECEIPT_PAYLOAD_V2_KEYS: ReadonlySet<string> = new Set<string>([
  ...RECEIPT_PAYLOAD_KEYS,
  ...(["revision", "clientTransactionId", "evidenceDomainId"] satisfies
    (keyof EvidenceReceiptPayloadV2)[]),
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
  return typeof value === "string" && CANONICAL_UUID_V4.test(value);
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
    isReceiptRevision(value.revision) &&
    isReceiptClientTransactionId(value.clientTransactionId) &&
    isEvidenceDomainId(value.evidenceDomainId)
  );
}

/**
 * The digest `D = SHA-256(JCS(payload))` and the only bytes a receipt v2 may
 * be signed over: `UTF-8("ductus-evidence-receipt-v2") || 0x0A || D`, with `D`
 * as its 32 raw bytes (D-92). Throws for anything that is not a valid v2
 * payload, so the v2 signing input can never be made for a v1 record.
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
  if (!globalThis.crypto?.subtle) {
    throw new Error("evidence receipt v2: Web Crypto unavailable");
  }
  const canonical = canonicalizeJcs(payload);
  const bytes = new TextEncoder().encode(canonical);
  const digest = new Uint8Array(
    await globalThis.crypto.subtle.digest("SHA-256", bytes),
  );
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
    typeof value.payloadDigestSha256 === "string" &&
    SHA256_HEX.test(value.payloadDigestSha256) &&
    isSignatureEnvelope(value.signature) &&
    // D-92: pure Ed25519, and no other algorithm.
    value.signature.algorithm === "Ed25519"
  );
}
