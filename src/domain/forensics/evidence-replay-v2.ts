import { sha256WebCrypto } from "./crypto";
import type { EvidenceEventV2, EvidenceSegmentV2 } from "./evidence-segment-v2";
import { canonicalizeJcs, type JcsJsonValue } from "./jcs";

/**
 * Replay of evidence segments v2 on top of a known document (B-14). Pure: no
 * I/O and no identity. The caller has already verified the segment chain;
 * this module checks that the recorded steps really produce the recorded
 * document hashes.
 */

/**
 * Applies the steps of one transaction format to one document model. The
 * replay below never looks inside a step, so the editor's own step code can
 * sit behind this interface (ProseMirror in Node, B-12).
 */
export interface EvidenceStepReplayerV2<TDocument> {
  /** The `captureContext.transactionFormat` this replayer understands. */
  readonly transactionFormat: string;
  /** Reads a canonical document; throws if it is not a valid one. */
  load(canonical: JcsJsonValue): TDocument;
  /** Applies every step of the event exactly, or throws. Never guesses. */
  apply(document: TDocument, event: EvidenceEventV2): TDocument;
  /** JSON form whose JCS string is hashed and compared. */
  toCanonical(document: TDocument): JcsJsonValue;
}

export type EvidenceReplayFailureV2 =
  | "unsupported_format"
  | "invalid_document"
  | "step_failed"
  | "document_hash_mismatch";

export type EvidenceReplayResultV2 =
  | { ok: true; canonicalDocument: string; documentSha256: string }
  | {
      ok: false;
      reason: EvidenceReplayFailureV2;
      segmentIndex: number | null;
      /** Event at which the replay stopped; `null` before the first event. */
      sequence: number | null;
    };

/** Document hash of evidence v2: SHA-256 over the RFC 8785 JCS form. */
export async function digestCanonicalDocumentV2(
  canonical: JcsJsonValue,
): Promise<{ canonical: string; sha256: string }> {
  const text = canonicalizeJcs(canonical);
  return { canonical: text, sha256: await sha256WebCrypto(text) };
}

/**
 * Replays `segments` in order from `initialDocument`. The document must hash
 * to each segment's `initialDocumentHash` before its first event and to
 * `afterDocumentHash` after every event. The segment validator already ties
 * every `beforeDocumentHash` to the hash before it, so these two checks cover
 * the whole run. Anything the replayer cannot apply fails closed.
 */
export async function replayEvidenceSegmentsV2<TDocument>(
  initialDocument: JcsJsonValue,
  segments: readonly EvidenceSegmentV2[],
  replayer: EvidenceStepReplayerV2<TDocument>,
): Promise<EvidenceReplayResultV2> {
  let document: TDocument;
  let current: { canonical: string; sha256: string };
  try {
    document = replayer.load(initialDocument);
    current = await digestCanonicalDocumentV2(replayer.toCanonical(document));
  } catch {
    return { ok: false, reason: "invalid_document", segmentIndex: null, sequence: null };
  }

  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
    const segment = segments[segmentIndex];
    if (segment.captureContext.transactionFormat !== replayer.transactionFormat) {
      return { ok: false, reason: "unsupported_format", segmentIndex, sequence: null };
    }
    if (segment.initialDocumentHash !== current.sha256) {
      return { ok: false, reason: "document_hash_mismatch", segmentIndex, sequence: null };
    }
    for (const event of segment.events) {
      try {
        document = replayer.apply(document, event);
        current = await digestCanonicalDocumentV2(replayer.toCanonical(document));
      } catch {
        return { ok: false, reason: "step_failed", segmentIndex, sequence: event.sequence };
      }
      if (current.sha256 !== event.afterDocumentHash) {
        return {
          ok: false,
          reason: "document_hash_mismatch",
          segmentIndex,
          sequence: event.sequence,
        };
      }
    }
  }

  return { ok: true, canonicalDocument: current.canonical, documentSha256: current.sha256 };
}
