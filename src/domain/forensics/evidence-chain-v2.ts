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

/**
 * A segment that links to the one before it by hash but does not continue it:
 * its first event does not follow the previous last event, or its initial
 * document hash is not the previous final one. Either means events are missing
 * between the two segments.
 */
export type EvidenceChainDiscontinuityV2 = {
  /** Index of the later segment of the pair. */
  index: number;
  previousSequenceTo: number;
  sequenceFrom: number;
  sequenceBreak: boolean;
  documentHashBreak: boolean;
};

export type EvidenceChainVerificationV2 =
  | {
      ok: true;
      head: EvidenceChainHeadV2 | null;
      discontinuities: EvidenceChainDiscontinuityV2[];
    }
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
 * A gap between linked segments does not fail verification, because a client
 * recovering from lost segments legitimately continues from the server head.
 * It is never passed over in silence either: every such pair is returned in
 * `discontinuities`, for comparison with the gaps the server recorded.
 */
export async function verifyEvidenceChainV2(
  canonicalPayloads: readonly unknown[],
  expectedHead: EvidenceChainHeadV2 | null,
): Promise<EvidenceChainVerificationV2> {
  let previousHash: string | null = null;
  let previous: EvidenceSegmentV2 | null = null;
  const discontinuities: EvidenceChainDiscontinuityV2[] = [];

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
    const segment = verified.segment;
    if (previous !== null) {
      if (segment.documentId !== previous.documentId) {
        return { ok: false, reason: "document_mismatch", index };
      }
      const sequenceBreak = segment.sequenceFrom !== previous.sequenceTo + 1;
      const documentHashBreak =
        segment.initialDocumentHash !== previous.finalDocumentHash;
      if (sequenceBreak || documentHashBreak) {
        discontinuities.push({
          index,
          previousSequenceTo: previous.sequenceTo,
          sequenceFrom: segment.sequenceFrom,
          sequenceBreak,
          documentHashBreak,
        });
      }
    }
    previous = segment;
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
  return { ok: true, head, discontinuities };
}

export type EvidenceRetryDecision = "new" | "duplicate" | "content_mismatch";

/**
 * Compares a submission with what was already accepted under the same
 * idempotency key.
 *
 * `acceptedSegmentHash` is the content hash already accepted under that key
 * (`null` if none); `submittedSegmentHash` is the content hash of the new
 * submission. Same content is a duplicate and must not create a second
 * acceptance. Different content is reported as `content_mismatch`, a neutral
 * fact: it is never a new acceptance and never replaces the original one, but
 * which outcome the caller returns for it is decided in the application layer
 * (DAN-46), not here.
 */
export function decideEvidenceRetry(
  acceptedSegmentHash: string | null,
  submittedSegmentHash: string,
): EvidenceRetryDecision {
  if (acceptedSegmentHash === null) return "new";
  return acceptedSegmentHash === submittedSegmentHash
    ? "duplicate"
    : "content_mismatch";
}
