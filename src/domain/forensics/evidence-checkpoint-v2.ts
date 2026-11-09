import {
  decodeStrictUtf8,
  exceedsEvidenceSegmentLimit,
  findEvidenceBreakV2,
  sameBytes,
  type EvidenceChainDiscontinuityV2,
} from "./evidence-chain-v2";
import {
  findEvidenceStartBreakV2,
  replayEvidenceSegmentsV2,
  type AsyncEvidenceStepReplayerV2,
  type EvidenceReplayFailureV2,
} from "./evidence-replay-v2";
import type { EvidenceSegment } from "./evidence-segment-v2";
import { canonicalizeJcs, type JcsJsonValue } from "./jcs";

/**
 * Checkpoints of a reconstruction (B-12, D-191 t. 4; ARCHITECTURE §5): after
 * a gap the replay starts again from the document the next segment starts
 * from. Pure: no I/O. A checkpoint is trusted only as far as the chain vouches
 * for it: its bytes must hash to the `initialDocumentHash` of the segment
 * after the gap and be the exact canonical form of a document the replayer
 * loads. The gap stays in the result (D-11); a checkpoint never hides it.
 */

export type EvidenceCheckpointFailureV2 = "too_large" | "invalid" | "not_canonical" | "hash_mismatch";

async function sha256Bytes(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("evidence-checkpoint-v2: Web Crypto unavailable");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Accepts checkpoint bytes only if they are at most the segment limit, strict
 * UTF-8 without a byte order mark, JSON the replayer loads, byte for byte the
 * JCS form of what it loaded, and hash to `expectedSha256`. The returned
 * document is the replayer's canonical form, never the parsed input.
 */
export async function verifyEvidenceCheckpointV2<TDocument>(
  bytes: Uint8Array,
  expectedSha256: string,
  replayer: Pick<AsyncEvidenceStepReplayerV2<TDocument>, "load" | "toCanonical">,
): Promise<{ ok: true; document: JcsJsonValue } | { ok: false; reason: EvidenceCheckpointFailureV2 }> {
  if (exceedsEvidenceSegmentLimit(bytes.byteLength)) return { ok: false, reason: "too_large" };
  // Copy once so the bytes that are checked are the bytes that are hashed.
  const received = new Uint8Array(bytes);
  // A kept BOM is a character, so it fails to parse below.
  const text = decodeStrictUtf8(received);
  if (text === null || text.length === 0) return { ok: false, reason: "invalid" };

  let document: JcsJsonValue;
  try {
    document = replayer.toCanonical(replayer.load(JSON.parse(text) as JcsJsonValue));
    if (!sameBytes(new TextEncoder().encode(canonicalizeJcs(document)), received)) {
      return { ok: false, reason: "not_canonical" };
    }
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if ((await sha256Bytes(received)) !== expectedSha256) return { ok: false, reason: "hash_mismatch" };
  return { ok: true, document };
}

/**
 * Every break of a record, in order: at the start (index 0) against
 * `initialDocument`, then between consecutive segments, by the one rule of
 * {@link findEvidenceBreakV2}.
 */
export async function findEvidenceBreaksV2<TDocument>(
  initialDocument: JcsJsonValue,
  segments: readonly EvidenceSegment[],
  replayer: AsyncEvidenceStepReplayerV2<TDocument>,
): Promise<{ ok: true; breaks: EvidenceChainDiscontinuityV2[] } | { ok: false; reason: "invalid_document" }> {
  if (segments.length === 0) return { ok: true, breaks: [] };
  const start = await findEvidenceStartBreakV2(initialDocument, segments[0], replayer);
  if (!start.ok) return start;
  const breaks = start.discontinuity ? [start.discontinuity] : [];
  for (let index = 1; index < segments.length; index++) {
    const found = findEvidenceBreakV2(index, segments[index - 1], segments[index]);
    if (found) breaks.push(found);
  }
  return { ok: true, breaks };
}

/** Only a gap (skipped event numbers) may continue from a checkpoint. */
function resumable(discontinuity: EvidenceChainDiscontinuityV2): boolean {
  return discontinuity.sequence === "gap";
}

/**
 * Hashes of the checkpoints a replay across these breaks needs: the initial
 * document hash of the segment after each gap, sorted and without repeats.
 * A checkpoint at any other position is never asked for.
 */
export function evidenceCheckpointHashesV2(
  segments: readonly EvidenceSegment[],
  breaks: readonly EvidenceChainDiscontinuityV2[],
): string[] {
  const hashes = new Set(breaks.filter(resumable).map((item) => segments[item.index].initialDocumentHash));
  return [...hashes].sort();
}

/** Why the replay stopped at a break rather than inside a run of segments. */
export type EvidenceBreakFailureV2 = "break_not_resumable" | "checkpoint_missing" | "checkpoint_invalid";

export type EvidenceGapReplayFailureV2 = EvidenceReplayFailureV2 | EvidenceBreakFailureV2;

export type EvidenceGapReplayResultV2 =
  | { ok: true; canonicalDocument: string; documentSha256: string; breaks: EvidenceChainDiscontinuityV2[] }
  | {
      ok: false;
      reason: EvidenceReplayFailureV2;
      segmentIndex: number | null;
      sequence: number | null;
      /** A fault of the replay itself, not of a break. */
      discontinuity: null;
    }
  | {
      ok: false;
      reason: EvidenceBreakFailureV2;
      /** The index of the break the replay stopped at. */
      segmentIndex: number;
      sequence: null;
      discontinuity: EvidenceChainDiscontinuityV2;
    };

/**
 * Replays the whole record, continuing past each gap from its checkpoint.
 * The breaks are computed here from the segments, never taken from the
 * caller. Between breaks the replay is {@link replayEvidenceSegmentsV2}, so
 * every event is still checked against its recorded hash. A regression or a
 * break in the document alone stops the replay (`break_not_resumable`), as
 * does a gap with no checkpoint (`checkpoint_missing`) or with one that fails
 * {@link verifyEvidenceCheckpointV2} (`checkpoint_invalid`). Faults are
 * reported in record order: a broken segment before a break comes first.
 */
export async function replayEvidenceAcrossGapsV2<TDocument>(
  initialDocument: JcsJsonValue,
  segments: readonly EvidenceSegment[],
  replayer: AsyncEvidenceStepReplayerV2<TDocument>,
  checkpoints: ReadonlyMap<string, Uint8Array>,
): Promise<EvidenceGapReplayResultV2> {
  const found = await findEvidenceBreaksV2(initialDocument, segments, replayer);
  if (!found.ok) {
    return { ok: false, reason: found.reason, segmentIndex: null, sequence: null, discontinuity: null };
  }
  const { breaks } = found;

  let document = initialDocument;
  let from = 0;
  let replayed: { canonicalDocument: string; documentSha256: string } | null = null;
  for (let run = 0; run <= breaks.length; run++) {
    const to = run < breaks.length ? breaks[run].index : segments.length;
    if (to > from || replayed === null) {
      const result = await replayEvidenceSegmentsV2(document, segments.slice(from, to), replayer);
      if (!result.ok) {
        const segmentIndex = result.segmentIndex === null ? null : from + result.segmentIndex;
        return { ...result, segmentIndex, discontinuity: null };
      }
      replayed = result;
    }
    if (run === breaks.length) break;

    const discontinuity = breaks[run];
    const failure = (reason: EvidenceBreakFailureV2): EvidenceGapReplayResultV2 => ({
      ok: false,
      reason,
      segmentIndex: discontinuity.index,
      sequence: null,
      discontinuity,
    });
    if (!resumable(discontinuity)) return failure("break_not_resumable");
    const expected = segments[discontinuity.index].initialDocumentHash;
    const bytes = checkpoints.get(expected);
    if (bytes === undefined) return failure("checkpoint_missing");
    const checkpoint = await verifyEvidenceCheckpointV2(bytes, expected, replayer);
    if (!checkpoint.ok) return failure("checkpoint_invalid");
    document = checkpoint.document;
    from = discontinuity.index;
    replayed = null;
  }

  return { ok: true, canonicalDocument: replayed!.canonicalDocument, documentSha256: replayed!.documentSha256, breaks };
}
