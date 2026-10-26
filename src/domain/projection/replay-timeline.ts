import { EDIT_STEP_FORMAT_V1, parseEditSteps, type EditStepV1 } from "@/domain/document/edit-step";
import { REVISION_ZERO_SHA256 } from "@/domain/document/revision-zero";
import { sha256WebCrypto } from "@/domain/forensics/crypto";
import {
  verifyEvidenceChainV2,
  type EvidenceChainHeadV2,
} from "@/domain/forensics/evidence-chain-v2";
import { EvidenceContentNotSupportedV2 } from "@/domain/forensics/evidence-replay-v2";
import type { EvidenceEventV2, EvidenceSegmentV2, EvidenceSourceV2 } from "@/domain/forensics/evidence-segment-v2";
import { canonicalizeJcs, type JcsJsonValue } from "@/domain/forensics/jcs";

/**
 * The replay timeline of one work (DAN-344, contract on #923 §4; D-143): one
 * change per recorded step, in chain order, and the document after each.
 * Pure apart from the injected step replayer; the same function for the
 * student and the teacher, with no input about who looks (PRODUCT §5 rule 5).
 *
 * Every byte, the chain to the head and every step are checked. The first
 * failure gives `{ ok: false }` and no timeline at all, never a partial or
 * repaired one. A break in the chain stops the replay there; it continues
 * only from a document whose hash is exactly the one the next segment starts
 * from (P2), and the break stays visible as a `gap` marker.
 *
 * Nothing here measures a person: no speed, duration, count per time, share
 * or score (D-143, PRODUCT §5 rules 2 and 4). A pause has no duration.
 */

/** Applies the steps of one event one by one; supplied by an adapter. */
export interface ReplayStepReplayer<TDocument> {
  readonly transactionFormat: string;
  /** Reads a canonical document; throws if it is not a valid one. */
  load(canonical: JcsJsonValue): TDocument;
  /** JSON form whose JCS string is hashed and compared. */
  toCanonical(document: TDocument): JcsJsonValue;
  /**
   * Every step of the event applied exactly and in order: the document after
   * each step and the ids of the top-level blocks the step touched, before or
   * after it. Throws or rejects on any step it refuses.
   */
  steps(document: TDocument, event: EvidenceEventV2): AsyncIterable<{ document: TDocument; blockIds: readonly string[] }>;
  /** Plain text of the top-level block with that id, or `null` when there is none. */
  blockText(document: TDocument, blockId: string): string | null;
}

export type ReplayChangeKind = "insert" | "delete" | "replace" | "format" | "structure";

export type ReplayChange = {
  /** 1 to N, in chain order. */
  index: number;
  sequence: number;
  kind: ReplayChangeKind;
  source: EvidenceSourceV2;
  evidenceKind: "observed";
  /** The minutes of the segment (D-24); nothing finer. */
  minute: { from: string; to: string };
  blockIds: readonly string[];
};

/** Before the change `beforeIndex`. A pause has no duration. */
export type ReplayMarker =
  | { kind: "pause"; beforeIndex: number }
  | { kind: "gap"; beforeIndex: number; resumed: boolean };

export type ReplayBlockChange = {
  index: number;
  before: string | null;
  after: string | null;
  removed: string;
  inserted: string;
};

export type ReplayTimelineFailure =
  | "invalid_segment"
  | "chain_mismatch"
  | "document_mismatch"
  | "invalid_document"
  | "unsupported_format"
  | "step_failed";

export type ReplayTimeline =
  | {
      ok: true;
      changes: readonly ReplayChange[];
      markers: readonly ReplayMarker[];
      /** `stopped` when a break had no document to continue from. */
      end: "complete" | "stopped";
      /** JCS text of the document after change `index`; 0 is the start. */
      documentAt(index: number): string;
      blockHistory(blockId: string): ReplayBlockChange[];
    }
  | { ok: false; reason: ReplayTimelineFailure };

export type ReplayTimelineInput = {
  startDocument: string | null;
  /** Exact segment texts of the whole record, in chain order. */
  segments: readonly string[];
  head: EvidenceChainHeadV2 | null;
  resumeDocuments: Readonly<Record<string, string>>;
  /** P-01 (faculty configuration). */
  sessionBreakAboveMinutes: number;
};

const MINUTE_MS = 60_000;

function kindOf(step: EditStepV1): ReplayChangeKind {
  if (step.stepType === "addMark" || step.stepType === "removeMark") return "format";
  if (step.stepType !== "replace" || step.structure) return "structure";
  const inserts = (step.slice?.content.length ?? 0) > 0;
  if (step.to > step.from) return inserts ? "replace" : "delete";
  return "insert";
}

/** The part of `before` replaced by the part of `after`, by common prefix and suffix. */
function difference(before: string, after: string): { removed: string; inserted: string } {
  const a = [...before];
  const b = [...after];
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  return { removed: a.slice(start, a.length - end).join(""), inserted: b.slice(start, b.length - end).join("") };
}

export async function buildReplayTimeline<TDocument>(
  input: ReplayTimelineInput,
  replayer: ReplayStepReplayer<TDocument>,
): Promise<ReplayTimeline> {
  const chain = await verifyEvidenceChainV2(input.segments, input.head);
  if (!chain.ok) {
    return { ok: false, reason: chain.reason === "too_large" || chain.reason === "invalid_segment" ? "invalid_segment" : "chain_mismatch" };
  }
  const segments = input.segments.map((text) => JSON.parse(text) as EvidenceSegmentV2);

  const changes: ReplayChange[] = [];
  const markers: ReplayMarker[] = [];
  // The document before and after each change, by index; structure is shared between them.
  const before: TDocument[] = [];
  const documents: TDocument[] = [];
  let end: "complete" | "stopped" = "complete";

  /** The document of exactly these bytes, `null` when they are not under `hash`, "invalid" when not a document. */
  async function loadExact(text: string, hash: string): Promise<TDocument | null | "invalid"> {
    if ((await sha256WebCrypto(text)) !== hash) return null;
    try {
      const document = replayer.load(JSON.parse(text) as JcsJsonValue);
      // The model must give back exactly these bytes, or the steps run on another document.
      return canonicalizeJcs(replayer.toCanonical(document)) === text ? document : "invalid";
    } catch {
      return "invalid";
    }
  }

  try {
    let current: TDocument | null = null;
    if (segments.length > 0) {
      const first = segments[0];
      if (input.startDocument === null) return { ok: false, reason: "document_mismatch" };
      const start = await loadExact(input.startDocument, first.initialDocumentHash);
      if (start === null) return { ok: false, reason: "document_mismatch" };
      if (start === "invalid") return { ok: false, reason: "invalid_document" };
      current = start;
      documents.push(start);
      // A record that does not begin at revision 0 and event 1 has history before it that is not here.
      if (first.sequenceFrom !== 1 || first.initialDocumentHash !== REVISION_ZERO_SHA256) {
        markers.push({ kind: "gap", beforeIndex: 1, resumed: true });
      }
    }

    for (const [segmentIndex, segment] of segments.entries()) {
      if (segment.captureContext.transactionFormat !== replayer.transactionFormat) {
        return { ok: false, reason: "unsupported_format" };
      }
      if (segmentIndex > 0) {
        const previous = segments[segmentIndex - 1];
        const nextIndex = changes.length + 1;
        const broken =
          segment.sequenceFrom !== previous.sequenceTo + 1 ||
          segment.initialDocumentHash !== previous.finalDocumentHash;
        if (broken) {
          if (segment.initialDocumentHash !== previous.finalDocumentHash) {
            const text = input.resumeDocuments[segment.initialDocumentHash];
            const resumed = text === undefined ? null : await loadExact(text, segment.initialDocumentHash);
            if (resumed === "invalid") return { ok: false, reason: "invalid_document" };
            markers.push({ kind: "gap", beforeIndex: nextIndex, resumed: resumed !== null });
            if (resumed === null) {
              end = "stopped";
              break;
            }
            current = resumed;
          } else {
            markers.push({ kind: "gap", beforeIndex: nextIndex, resumed: true });
          }
        } else {
          const apart = Date.parse(segment.observedStartedAt) - Date.parse(previous.observedEndedAt);
          if (apart > input.sessionBreakAboveMinutes * MINUTE_MS) markers.push({ kind: "pause", beforeIndex: nextIndex });
        }
      }

      for (const event of segment.events) {
        const parsed = parseEditSteps(EDIT_STEP_FORMAT_V1, event.steps);
        if (!parsed.ok) return { ok: false, reason: "step_failed" };
        let step = 0;
        for await (const applied of replayer.steps(current as TDocument, event)) {
          const recorded = parsed.steps[step];
          if (recorded === undefined) return { ok: false, reason: "step_failed" };
          step++;
          before.push(current as TDocument);
          current = applied.document;
          documents.push(current);
          changes.push({
            index: changes.length + 1,
            sequence: event.sequence,
            kind: kindOf(recorded),
            source: event.source,
            evidenceKind: "observed",
            minute: { from: segment.observedStartedAt, to: segment.observedEndedAt },
            blockIds: [...applied.blockIds],
          });
        }
        const after = await sha256WebCrypto(canonicalizeJcs(replayer.toCanonical(current as TDocument)));
        if (step !== parsed.steps.length || after !== event.afterDocumentHash) {
          return { ok: false, reason: "document_mismatch" };
        }
      }
    }
  } catch (error) {
    return { ok: false, reason: error instanceof EvidenceContentNotSupportedV2 ? "unsupported_format" : "step_failed" };
  }

  const at = (index: number): TDocument => {
    if (!Number.isSafeInteger(index) || index < 0 || index >= documents.length) {
      throw new RangeError("replay: no change with that index");
    }
    return documents[index];
  };
  return {
    ok: true,
    changes,
    markers,
    end,
    documentAt: (index) => canonicalizeJcs(replayer.toCanonical(at(index))),
    blockHistory: (blockId) =>
      changes
        .filter((change) => change.blockIds.includes(blockId))
        .map((change) => {
          const prior = replayer.blockText(before[change.index - 1], blockId);
          const after = replayer.blockText(at(change.index), blockId);
          return { index: change.index, before: prior, after, ...difference(prior ?? "", after ?? "") };
        }),
  };
}
