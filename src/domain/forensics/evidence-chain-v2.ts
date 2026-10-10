import { sha256WebCrypto } from "./crypto";
import {
  canonicalEvidenceSegmentV2,
  isEvidenceSegmentV2,
  type EvidenceSegmentV2,
} from "./evidence-segment-v2";

/**
 * Pure ingest core for evidence segments v2 (B-8a): exact canonical bytes,
 * the segment hash chain and the retry decision. No I/O and no identity; the
 * route, the RPC and the object store build on these functions.
 */

/**
 * Hard upper bound for one canonical segment, in UTF-8 bytes. The client
 * (before it sends) and the server (before it parses) import this one
 * constant, so the two sides cannot drift apart. A package may set a lower
 * limit, never a higher one.
 */
export const MAX_EVIDENCE_SEGMENT_BYTES = 2 * 1024 * 1024;

export function exceedsEvidenceSegmentLimit(byteLength: number): boolean {
  return !(byteLength <= MAX_EVIDENCE_SEGMENT_BYTES);
}

export type VerifiedEvidencePayloadV2 = {
  segment: EvidenceSegmentV2;
  sha256: string;
  byteLength: number;
};

export type EvidencePayloadVerificationV2 =
  | ({ ok: true } & VerifiedEvidencePayloadV2)
  | { ok: false; reason: "too_large" | "invalid" };

/**
 * Accepts a payload only if it is, byte for byte, the RFC 8785 JCS form of a
 * valid segment (unknown fields are rejected by the segment validator). The
 * returned hash therefore covers exactly the bytes that were received.
 */
export async function verifyCanonicalEvidencePayloadV2(
  canonicalPayload: unknown,
): Promise<EvidencePayloadVerificationV2> {
  if (typeof canonicalPayload !== "string" || canonicalPayload.length === 0) {
    return { ok: false, reason: "invalid" };
  }
  // A UTF-16 code unit is at least one UTF-8 byte, so this cheap check runs
  // before any encoding or parsing of an oversized body.
  if (exceedsEvidenceSegmentLimit(canonicalPayload.length)) {
    return { ok: false, reason: "too_large" };
  }
  const byteLength = new TextEncoder().encode(canonicalPayload).byteLength;
  if (exceedsEvidenceSegmentLimit(byteLength)) {
    return { ok: false, reason: "too_large" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(canonicalPayload);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (
    !isEvidenceSegmentV2(parsed) ||
    canonicalEvidenceSegmentV2(parsed) !== canonicalPayload
  ) {
    return { ok: false, reason: "invalid" };
  }

  return {
    ok: true,
    segment: parsed,
    sha256: await sha256WebCrypto(canonicalPayload),
    byteLength,
  };
}

/** Head of a package chain: hash and ordinal (1-based) of its last segment. */
export type EvidenceChainHeadV2 = {
  segmentHash: string;
  segmentCount: number;
};

export type EvidenceChainFailureV2 =
  | "too_large"
  | "invalid_segment"
  | "predecessor_mismatch"
  | "document_mismatch"
  | "head_mismatch";

export type EvidenceChainVerificationV2 =
  | { ok: true; head: EvidenceChainHeadV2 | null }
  | { ok: false; reason: EvidenceChainFailureV2; index: number | null };

/**
 * Verifies stored segments in chain order against the recorded head.
 *
 * Every segment must be canonical, name the hash of the segment before it
 * (`null` for the first) and belong to the same document; the last hash and
 * the segment count must equal the head. A changed, removed or reordered
 * segment breaks one of those. `expectedHead` is `null` only for a package
 * with no accepted segments.
 *
 * Event sequence numbers are checked inside each segment only: a gap between
 * segments is legitimate and is recorded by the server, never assumed away.
 */
export async function verifyEvidenceChainV2(
  canonicalPayloads: readonly unknown[],
  expectedHead: EvidenceChainHeadV2 | null,
): Promise<EvidenceChainVerificationV2> {
  let previousHash: string | null = null;
  let documentId: string | null = null;

  for (let index = 0; index < canonicalPayloads.length; index++) {
    const verified = await verifyCanonicalEvidencePayloadV2(
      canonicalPayloads[index],
    );
    if (!verified.ok) {
      return {
        ok: false,
        reason: verified.reason === "too_large" ? "too_large" : "invalid_segment",
        index,
      };
    }
    if (verified.segment.predecessorSegmentHash !== previousHash) {
      return { ok: false, reason: "predecessor_mismatch", index };
    }
    if (documentId !== null && verified.segment.documentId !== documentId) {
      return { ok: false, reason: "document_mismatch", index };
    }
    documentId = verified.segment.documentId;
    previousHash = verified.sha256;
  }

  const head: EvidenceChainHeadV2 | null =
    previousHash === null
      ? null
      : { segmentHash: previousHash, segmentCount: canonicalPayloads.length };

  if (
    head?.segmentHash !== expectedHead?.segmentHash ||
    head?.segmentCount !== expectedHead?.segmentCount
  ) {
    return { ok: false, reason: "head_mismatch", index: null };
  }
  return { ok: true, head };
}

export type EvidenceRetryDecision = "new" | "duplicate" | "idempotency_conflict";

/**
 * Decides what a submission under one idempotency key means.
 *
 * `acceptedSegmentHash` is the content hash already accepted under that key
 * (`null` if none); `submittedSegmentHash` is the hash of the bytes now being
 * submitted. Same key and same content is a duplicate and must not create a
 * second acceptance; same key with different content is refused and the
 * original acceptance stays as it is.
 */
export function decideEvidenceRetry(
  acceptedSegmentHash: string | null,
  submittedSegmentHash: string,
): EvidenceRetryDecision {
  if (acceptedSegmentHash === null) return "new";
  return acceptedSegmentHash === submittedSegmentHash
    ? "duplicate"
    : "idempotency_conflict";
}
