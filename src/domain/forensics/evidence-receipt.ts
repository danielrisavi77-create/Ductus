import { isSignatureEnvelope, type SignatureEnvelope } from "./signature";
import { sha256WebCrypto } from "./crypto";
import { canonicalizeJcs } from "./jcs";
import { EVIDENCE_SEGMENT_SCHEMA_V2, type EvidenceSegmentV2 } from "./evidence-segment-v2";

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

function nonEmpty(value: unknown, max = 256): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= max
  );
}

function canonicalInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

export function isEvidenceReceiptPayloadV1(
  value: unknown,
): value is EvidenceReceiptPayloadV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    v.receiptSchema === EVIDENCE_RECEIPT_SCHEMA_V1 &&
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
    nonEmpty(v.evidenceProfileId, 120) &&
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
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    isEvidenceReceiptPayloadV1(v.payload) &&
    typeof v.payloadDigestSha256 === "string" &&
    SHA256_HEX.test(v.payloadDigestSha256) &&
    isSignatureEnvelope(v.signature)
  );
}
