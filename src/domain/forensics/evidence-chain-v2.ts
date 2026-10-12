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

const SHA256_HEX = /^[0-9a-f]{64}$/;

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("evidence-v2: Web Crypto unavailable");
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Strict UTF-8: an invalid sequence is an error, never U+FFFD, and a byte
 * order mark is kept as a character (which then fails to parse) rather than
 * dropped. A lenient decoder would map different bytes to the same text.
 */
function decodeStrictUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
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
 * valid segment (unknown fields are rejected by the segment validator).
 *
 * Pass the bytes as they were received (`Uint8Array`): they are decoded
 * strictly, compared with the re-encoded canonical form, and the returned
 * hash is the SHA-256 of those very bytes. A `string` is accepted only for
 * text that never existed as untrusted bytes or was already decoded strictly;
 * a caller that holds a request body must not decode it itself.
 */
export async function verifyCanonicalEvidencePayloadV2(
  payload: unknown,
): Promise<EvidencePayloadVerificationV2> {
  let received: Uint8Array<ArrayBuffer>;
  let text: string | null;

  if (typeof payload === "string") {
    // A UTF-16 code unit is at least one UTF-8 byte, so this cheap check runs
    // before an oversized string is encoded.
    if (exceedsEvidenceSegmentLimit(payload.length)) {
      return { ok: false, reason: "too_large" };
    }
    received = new TextEncoder().encode(payload);
    text = payload;
  } else if (payload instanceof Uint8Array) {
    if (exceedsEvidenceSegmentLimit(payload.byteLength)) {
      return { ok: false, reason: "too_large" };
    }
    // Copy once so the bytes that are checked are the bytes that are hashed.
    received = new Uint8Array(payload);
    text = decodeStrictUtf8(received);
  } else {
    return { ok: false, reason: "invalid" };
  }

  if (exceedsEvidenceSegmentLimit(received.byteLength)) {
    return { ok: false, reason: "too_large" };
  }
  if (text === null || text.length === 0) {
    return { ok: false, reason: "invalid" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (!isEvidenceSegmentV2(parsed)) {
    return { ok: false, reason: "invalid" };
  }
  const canonical = new TextEncoder().encode(canonicalEvidenceSegmentV2(parsed));
  if (!sameBytes(canonical, received)) {
    return { ok: false, reason: "invalid" };
  }

  return {
    ok: true,
    segment: parsed,
    sha256: await sha256Hex(received),
    byteLength: received.byteLength,
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
 * A segment that links to the one before it by hash but does not continue it.
 *
 * `sequence` is `gap` when event numbers are skipped (events are missing),
 * `regression` when the segment starts at or before the previous last event
 * (a repeated or rewound range), and `continuous` otherwise.
 * `documentHashBreak` is set when the initial document hash is not the
 * previous final one.
 */
export type EvidenceChainDiscontinuityV2 = {
  /** Index of the later segment of the pair. */
  index: number;
  previousSequenceTo: number;
  sequenceFrom: number;
  sequence: "continuous" | "gap" | "regression";
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
 * A head is `null` or a hash with an integer count. Anything else is a caller
 * bug (a mistyped column, say) and throws: read leniently, a head with both
 * fields `undefined` would equal the computed head of an empty package and
 * pass, and the bug would show only once segments arrive. A well-typed head
 * with the wrong count, zero or negative included, is not a bug of that kind:
 * it never equals a computed head and is answered as `head_mismatch`.
 */
function assertChainHead(
  head: unknown,
): asserts head is EvidenceChainHeadV2 | null {
  if (head === null) return;
  const candidate =
    typeof head === "object" ? (head as Partial<EvidenceChainHeadV2>) : {};
  if (
    typeof candidate.segmentHash !== "string" ||
    !SHA256_HEX.test(candidate.segmentHash) ||
    !Number.isSafeInteger(candidate.segmentCount)
  ) {
    throw new Error("evidence-v2: expectedHead is not a chain head");
  }
}

/**
 * Verifies stored segments in chain order against the recorded head.
 *
 * Every segment must be canonical, name the hash of the segment before it
 * (`null` for the first) and belong to the same document; the last hash and
 * the segment count must equal the head. A changed, removed or reordered
 * segment breaks one of those. `expectedHead` is `null` only for a package
 * with no accepted segments.
 *
 * `ok: true` means the bytes are the ones the head commits to. It does not
 * mean the record is unbroken: a client recovering from lost segments
 * legitimately continues from the server head, so a break in event sequence
 * or document hash does not fail verification. Every such pair is returned in
 * `discontinuities`, and the caller must compare them with the gaps the
 * server recorded; a `regression` is never a recorded gap.
 *
 * Not compared across segments, on purpose: observed times (the client clock
 * may move), `sessionId` (a package spans sessions) and `evidenceProfileId`.
 */
export async function verifyEvidenceChainV2(
  payloads: readonly unknown[],
  expectedHead: EvidenceChainHeadV2 | null,
): Promise<EvidenceChainVerificationV2> {
  assertChainHead(expectedHead);
  let previousHash: string | null = null;
  let previous: EvidenceSegmentV2 | null = null;
  const discontinuities: EvidenceChainDiscontinuityV2[] = [];

  for (let index = 0; index < payloads.length; index++) {
    const verified = await verifyCanonicalEvidencePayloadV2(payloads[index]);
    if (!verified.ok) {
      return {
        ok: false,
        reason: verified.reason === "too_large" ? "too_large" : "invalid_segment",
        index,
      };
    }
    const segment = verified.segment;
    if (segment.predecessorSegmentHash !== previousHash) {
      return { ok: false, reason: "predecessor_mismatch", index };
    }
    if (previous !== null) {
      if (segment.documentId !== previous.documentId) {
        return { ok: false, reason: "document_mismatch", index };
      }
      const sequence =
        segment.sequenceFrom === previous.sequenceTo + 1
          ? "continuous"
          : segment.sequenceFrom > previous.sequenceTo
            ? "gap"
            : "regression";
      const documentHashBreak =
        segment.initialDocumentHash !== previous.finalDocumentHash;
      if (sequence !== "continuous" || documentHashBreak) {
        discontinuities.push({
          index,
          previousSequenceTo: previous.sequenceTo,
          sequenceFrom: segment.sequenceFrom,
          sequence,
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
      : { segmentHash: previousHash, segmentCount: payloads.length };

  if (
    head?.segmentHash !== expectedHead?.segmentHash ||
    head?.segmentCount !== expectedHead?.segmentCount
  ) {
    return { ok: false, reason: "head_mismatch", index: null };
  }
  return { ok: true, head, discontinuities };
}

export type EvidenceRetryDecision =
  | "new"
  | "duplicate"
  | "invalid"
  | "idempotency_conflict";

export type EvidenceRetryInput = {
  /** Segment hash already accepted under this idempotency key, or `null`. */
  acceptedSegmentHash: string | null;
  /**
   * Whether the submitted descriptor equals the accepted one. Ignored when
   * nothing was accepted under the key.
   */
  descriptorMatches: boolean;
  /**
   * SHA-256 of the bytes received in this submission, as returned by
   * `verifyCanonicalEvidencePayloadV2`. Never the `segmentHash` the client
   * declares in its descriptor: that would confirm bytes nobody checked.
   */
  receivedPayloadSha256: string;
};

function assertSha256(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !SHA256_HEX.test(value)) {
    throw new Error(`evidence-v2: ${name} is not a lowercase SHA-256 hex digest`);
  }
}

/**
 * Decides what a submission under one idempotency key (principal, package,
 * client request id) means, per the retry contract decided in DAN-46:
 *
 * - nothing accepted under the key: `new`;
 * - different descriptor: `idempotency_conflict`;
 * - same descriptor, same bytes: `duplicate`, the original acceptance is
 *   returned and nothing is stored, reserved or signed again;
 * - same descriptor, different bytes: `invalid`, the original acceptance
 *   stays untouched and the changed bytes are neither stored nor signed.
 *
 * Only `new` may create an acceptance. A malformed hash is a caller bug and
 * throws rather than being read as "nothing accepted" or as a mismatch.
 */
export function decideEvidenceRetry(input: EvidenceRetryInput): EvidenceRetryDecision {
  assertSha256(input.receivedPayloadSha256, "receivedPayloadSha256");
  if (input.acceptedSegmentHash === null) return "new";
  assertSha256(input.acceptedSegmentHash, "acceptedSegmentHash");

  if (input.descriptorMatches !== true) return "idempotency_conflict";
  return input.acceptedSegmentHash === input.receivedPayloadSha256
    ? "duplicate"
    : "invalid";
}
