import { REVISION_ZERO_SHA256 } from "@/domain/document/revision-zero";
import type { EvidenceChainHeadV2 } from "@/domain/forensics/evidence-chain-v2";
import type { EvidenceSegmentV2, EvidenceSourceV2 } from "@/domain/forensics/evidence-segment-v2";
import type { JcsJsonValue } from "@/domain/forensics/jcs";

import {
  buildReplayTimeline,
  type ReplayChangeKind,
  type ReplayStepReplayer,
  type ReplayTimelineFailure,
} from "./replay-timeline";

/**
 * The one replay player of a work (DAN-537, rb 261, contract on #1836): the
 * student and the teacher see the same changes, the same gaps and the same
 * paragraph history from the same record, and nothing here takes who looks
 * as an input (PRODUCT §5 rule 5).
 *
 * It is the replay timeline without time. No minute, no pause and no
 * distance between segments reaches its output: the timeline is built with
 * no session break at all, so the time between segments is never compared
 * (D-143, D-239; tempo is rb 262). A change is only "change n of N".
 *
 * Every gap in the record is an entry of its own at its place, never filled
 * in and never left out: the record starts later than the work, the record
 * breaks and resumes from a verified document, or the record breaks with no
 * document to resume from and the rest is not replayed. Paragraph history
 * carries every gap of the record at its place too, since a paragraph may
 * have changed inside any of them. A record that fails any check gives no
 * player at all, never a partial one.
 */

export type ReplayGap =
  /** The record begins after the work began: history before it is not here. */
  | "starts_later"
  /** A break in the record; the replay resumes from a verified document. */
  | "resumed"
  /** A break with no document to resume from: what follows is not replayed. */
  | "not_resumed";

/** One change, as the player shows it: no time of any kind. */
export type ReplayPlayerChange = {
  /** 1 to N, in chain order. */
  index: number;
  kind: ReplayChangeKind;
  source: EvidenceSourceV2;
  evidenceKind: "observed";
  blockIds: readonly string[];
};

export type ReplayPlayerEntry =
  | { entry: "change"; change: ReplayPlayerChange }
  /** Before change `beforeIndex`; N + 1 when it ends a stopped record. */
  | { entry: "gap"; gap: ReplayGap; beforeIndex: number };

export type ParagraphHistoryEntry =
  | {
      entry: "change";
      index: number;
      kind: ReplayChangeKind;
      source: EvidenceSourceV2;
      before: string | null;
      after: string | null;
      removed: string;
      inserted: string;
    }
  | { entry: "gap"; gap: ReplayGap; beforeIndex: number };

export type ReplayPlayer =
  | {
      ok: true;
      /** N: the number of changes replayed. */
      total: number;
      /** Changes and gaps in record order. */
      entries: readonly ReplayPlayerEntry[];
      /** `stopped` when a break had no document to resume from. */
      end: "complete" | "stopped";
      /** The editor's JSON of the document after change `index`; 0 is the start. */
      documentAt(index: number): JcsJsonValue;
      /** The changes that touched one paragraph, in order, with every gap of the record at its place. */
      paragraphHistory(blockId: string): readonly ParagraphHistoryEntry[];
    }
  | { ok: false; reason: ReplayTimelineFailure };

/** The whole record as the replay pages gave it; no time, no reader. */
export type ReplayRecord = {
  startDocument: string | null;
  segments: readonly string[];
  head: EvidenceChainHeadV2 | null;
  resumeDocuments: Readonly<Record<string, string>>;
};

type Gap = { gap: ReplayGap; beforeIndex: number };

/** Places each gap before the entry of its index; a gap past the last change goes last. */
function interleave<T>(items: readonly { index: number; item: T }[], gaps: readonly Gap[]): (T | ({ entry: "gap" } & Gap))[] {
  const out: (T | ({ entry: "gap" } & Gap))[] = [];
  let next = 0;
  for (const { index, item } of items) {
    while (next < gaps.length && gaps[next].beforeIndex <= index) out.push({ entry: "gap", ...gaps[next++] });
    out.push(item);
  }
  while (next < gaps.length) out.push({ entry: "gap", ...gaps[next++] });
  return out;
}

export async function buildReplayPlayer<TDocument>(
  record: ReplayRecord,
  replayer: ReplayStepReplayer<TDocument>,
): Promise<ReplayPlayer> {
  const timeline = await buildReplayTimeline(
    // No session break: the time between segments is never compared (D-239).
    { ...record, sessionBreakAboveMinutes: Number.POSITIVE_INFINITY },
    replayer,
  );
  if (!timeline.ok) return timeline;

  // The timeline puts the "starts later" gap first, before any break; it is
  // recognised here from the verified first segment, not from its index.
  let startsLater = false;
  if (record.segments.length > 0) {
    const first = JSON.parse(record.segments[0]) as EvidenceSegmentV2;
    startsLater = first.sequenceFrom !== 1 || first.initialDocumentHash !== REVISION_ZERO_SHA256;
  }
  const gaps: Gap[] = [];
  for (const marker of timeline.markers) {
    if (marker.kind !== "gap") continue;
    const gap: ReplayGap = startsLater && gaps.length === 0 ? "starts_later" : marker.resumed ? "resumed" : "not_resumed";
    gaps.push({ gap, beforeIndex: marker.beforeIndex });
  }

  const changes = timeline.changes.map(({ index, kind, source, blockIds }) => ({
    index,
    kind,
    source,
    evidenceKind: "observed" as const,
    blockIds: [...blockIds],
  }));
  const entries = interleave<ReplayPlayerEntry>(
    changes.map((change) => ({ index: change.index, item: { entry: "change", change } })),
    gaps,
  ) as ReplayPlayerEntry[];

  const kindAt = new Map(changes.map((change) => [change.index, change]));
  return {
    ok: true,
    total: changes.length,
    entries,
    end: timeline.end,
    documentAt: (index) => timeline.documentAt(index),
    paragraphHistory: (blockId) =>
      interleave<ParagraphHistoryEntry>(
        timeline.blockHistory(blockId).map(({ index, before, after, removed, inserted }) => {
          const change = kindAt.get(index) as ReplayPlayerChange;
          return {
            index,
            item: { entry: "change", index, kind: change.kind, source: change.source, before, after, removed, inserted },
          };
        }),
        gaps,
      ) as ParagraphHistoryEntry[],
  };
}
