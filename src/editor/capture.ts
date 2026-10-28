/**
 * Capture of evidence segment v2 from editor transactions (F-8 step 3d-1,
 * DAN-37; contract: #178 `issuecomment-6265571198`).
 *
 * Pure: no DOM, no journal, no network. The caller hands over each change
 * the editor applied (a transaction and the ones appended to it) with the
 * source already decided, and asks for a segment when the drain needs one.
 *
 * - Every step is the ProseMirror step's own JSON plus `removedSha256` where
 *   the format asks for it (BACKEND 4.1, B-12), and must pass `parseEditSteps`;
 *   the parser's canonical copy is what goes into the segment.
 * - One event is every change of one source until 400 ms pass without one,
 *   and never spans 30 s or more, so no segment does (D-24).
 * - The segment carries no time finer than a minute (D-24). The time of each
 *   step goes into a separate timing record bound to the segment by its hash
 *   (D-56 condition 3, D-143), which this module returns and never sends.
 * - A change that does not start from the document the last one ended in is
 *   a gap: the recorder stops and builds nothing more, never a segment with a
 *   hole in it. An event that cannot be built stops it the same way. The
 *   events closed before the failure still come out (F-104 t. 1).
 * - How each step is written, ids included, is `capture-rewrite.ts` (F-8
 *   step 3d-1b, DAN-282; contract #476 `issuecomment-6383232090`).
 */

import type { Node as PmNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import { Step } from "@tiptap/pm/transform";

import { EDIT_STEP_FORMAT_V1, parseEditSteps } from "@/domain/document/edit-step";
import { exceedsEvidenceSegmentLimit } from "@/domain/forensics/evidence-chain-v2";
import { digestCanonicalDocumentV2 } from "@/domain/forensics/evidence-replay-v2";
import {
  canonicalEvidenceSegment,
  EVIDENCE_CANONICALIZATION_V2,
  EVIDENCE_HASH_ALGORITHM_V2,
  evidenceSchemaForEvents,
  type EvidenceEventV3,
  type EvidenceSegment,
  type EvidenceSource,
} from "@/domain/forensics/evidence-segment-v2";
import { canonicalizeJcs, type JcsJsonValue } from "@/domain/forensics/jcs";
import { sha256WebCrypto } from "@/domain/forensics/crypto";

import { writtenSteps } from "./capture-rewrite";
import { nodeIdFixesOf } from "./identity";
import { tiptapToCanonical } from "./interop";

/** Quiet time that closes an event, the same as the local save debounce. */
export const EVENT_QUIET_MS = 400;
/** Most events in one segment (the validator's limit). */
export const MAX_SEGMENT_EVENTS = 5000;
/** Every segment, from its first change to its last, spans less than this (D-24: at most 30 s). */
export const MAX_SEGMENT_SPAN_MS = 30_000;

/** One change the editor applied: a transaction and those appended to it. */
export type CapturedChange = {
  steps: readonly Step[];
  /** The document before each step (`tr.docs` of every transaction, in order). */
  docs: readonly PmNode[];
  /** The document after the last step. */
  after: PmNode;
  source: EvidenceSource;
  /** Epoch milliseconds when the change entered the editor. */
  at: number;
};

/** The time of every step, apart from the segment (D-56 condition 3, D-143). */
export type SegmentTiming = {
  segmentHash: string;
  sequenceFrom: number;
  /** Per event, milliseconds from `observedStartedAt` for each step; never falling. */
  events: { sequence: number; stepOffsetsMs: number[] }[];
};

export type BuiltSegment = {
  segment: EvidenceSegment;
  /** Exact JCS bytes of the segment and their hash. */
  bytes: Uint8Array;
  sha256: string;
  /** Exact JCS bytes of the document after the last event (`finalDocumentHash`). */
  document: Uint8Array;
  timing: SegmentTiming;
  /** How many closed events went into this segment. */
  eventCount: number;
};

export type SegmentContext = {
  documentId: string;
  sessionId: string;
  segmentId: string;
  evidenceProfileId: string;
  sequenceFrom: number;
  predecessorSegmentHash: string | null;
};

export type CaptureFailure = "gap" | "unsupported_step" | "block_identity" | "too_large";

export class CaptureError extends Error {
  constructor(readonly code: CaptureFailure) {
    super(`evidence capture: ${code}`);
    this.name = "CaptureError";
  }
}

/**
 * The change of a transaction and those appended to it (the `transaction`
 * event of the editor), with the source of the transaction that started it:
 * an appended step (a block id, storable text) is a consequence of that one.
 */
export function changeOf(
  transactions: readonly Transaction[],
  source: EvidenceSource,
  at: number,
): CapturedChange {
  const steps: Step[] = [];
  const docs: PmNode[] = [];
  for (const tr of transactions) {
    steps.push(...tr.steps);
    docs.push(...tr.docs);
  }
  return { steps, docs, after: transactions[transactions.length - 1]!.doc, source, at };
}

type RawEvent = { source: EvidenceSource; changes: CapturedChange[] };

const MINUTE_MS = 60_000;
const encoder = new TextEncoder();
const minute = (at: number) => new Date(Math.floor(at / MINUTE_MS) * MINUTE_MS).toISOString();
const firstAt = (event: RawEvent) => event.changes[0]!.at;
const lastAt = (event: RawEvent) => event.changes[event.changes.length - 1]!.at;

/**
 * `removedSha256` of BACKEND 4.1: SHA-256 of the JCS form of
 * `document.slice(from, to).toJSON()` on the document right before the step.
 */
export async function removedSliceSha256(document: PmNode, from: number, to: number): Promise<string> {
  return sha256WebCrypto(canonicalizeJcs(document.slice(from, to).toJSON() as JcsJsonValue));
}

/**
 * Whether `from..to` of `document` holds a character or a whole block: then
 * the step carries `removedSha256`, otherwise `structure` (BACKEND 4.1; the
 * same test as the replayer's `removesContent`).
 */
function removesContent(document: PmNode, from: number, to: number): boolean {
  if (document.textBetween(from, to).length > 0) return true;
  let wholeBlock = false;
  document.forEach((block, offset) => {
    wholeBlock ||= offset >= from && offset + block.nodeSize <= to;
  });
  return wholeBlock;
}

/**
 * Every step of one change as the format writes it (`writtenSteps`), applied
 * as written to the document the server's replayer will hold, which must end
 * as the editor's: otherwise the change is refused here, never sent as a
 * segment the server would refuse.
 *
 * - The identity plugin's steps are not written as they are. At the end of
 *   the change every block still without an id gets the one the plugin
 *   decided, by an `attr` step (owner decision 3), and a block whose id is
 *   another than the plugin's refuses the change: an id is never guessed or
 *   taken from another block.
 * - `removedSha256` and `structure` follow BACKEND 4.1 on that document; a
 *   range whose hash cannot be computed (half of a surrogate pair) refuses
 *   the change.
 */
async function changeSteps(change: CapturedChange): Promise<JcsJsonValue[]> {
  const steps: JcsJsonValue[] = [];
  let doc = change.docs[0]!;
  const apply = (json: Record<string, unknown>) => {
    let next: PmNode | null;
    try {
      next = Step.fromJSON(doc.type.schema, json).apply(doc).doc;
    } catch {
      throw new CaptureError("unsupported_step");
    }
    if (!next) throw new CaptureError("unsupported_step");
    // A step that changes nothing (a selection replaced by the same content,
    // a block given the type it has) is refused by the replayer
    // (`step_changes_nothing`, `replace_around_unchanged`): not written.
    if (next.eq(doc)) return;
    doc = next;
    steps.push(json as JcsJsonValue);
  };
  for (const step of change.steps) {
    if (nodeIdFixesOf(step) !== null) continue;
    let written: Record<string, unknown>[];
    try {
      written = writtenSteps(doc, step.toJSON() as Record<string, unknown>);
    } catch {
      throw new CaptureError("unsupported_step");
    }
    for (const json of written) {
      const { stepType, from, to, structure } = json;
      if (stepType === "replace" && typeof from === "number" && typeof to === "number" && from < to && structure !== true) {
        if (removesContent(doc, from, to)) json.removedSha256 = await removedSliceSha256(doc, from, to);
        else json.structure = true;
      }
      apply(json);
    }
  }
  if (doc.childCount !== change.after.childCount) throw new CaptureError("unsupported_step");
  change.after.forEach((block, pos) => {
    const id: unknown = block.attrs.nodeId;
    const held: unknown = doc.nodeAt(pos)?.attrs.nodeId;
    if (held === id) return;
    if (held !== null || typeof id !== "string") throw new CaptureError("unsupported_step");
    apply({ stepType: "attr", pos, attr: "nodeId", value: id });
  });
  if (!doc.eq(change.after)) throw new CaptureError("unsupported_step");
  return steps;
}

/** Hash of the canonical form of a document; a block without its own id is refused, never given one. */
async function documentDigest(document: PmNode): Promise<{ canonical: string; sha256: string }> {
  const candidate = tiptapToCanonical(document.toJSON(), () => {
    throw new CaptureError("block_identity");
  });
  if (!candidate.ok) throw new CaptureError("block_identity");
  return digestCanonicalDocumentV2(candidate.doc as unknown as JcsJsonValue);
}

/**
 * Collects changes into events and builds segments from the closed ones.
 * Not safe to call `takeSegment` twice at once; the caller serialises it.
 */
export class EvidenceRecorder {
  private closed: RawEvent[] = [];
  private open: RawEvent | null = null;
  private last: CapturedChange | null = null;
  private failure: CaptureFailure | null = null;

  constructor(private readonly quietMs = EVENT_QUIET_MS) {}

  /**
   * False once a gap was seen or an event could not be built: nothing after
   * it can be chained, so `record` throws that failure again, and so does
   * `takeSegment` once it has given the events closed before it.
   */
  get intact(): boolean {
    return this.failure === null;
  }

  /**
   * Stops at a failure: the first `keep` closed events, all closed before
   * it, stay for `takeSegment`; the event it arose in and every later one go.
   */
  private stop(code: CaptureFailure, keep: number): void {
    this.failure ??= code;
    this.closed = this.closed.slice(0, keep);
    this.open = null;
  }

  /**
   * Records one change; a change that leaves the document as it was is
   * ignored. Its time never goes back: a clock that does is held at the last
   * time (F-104 t. 2).
   */
  record(change: CapturedChange): void {
    if (this.failure !== null) throw new CaptureError(this.failure);
    if (change.steps.length === 0) return;
    if (change.docs.length !== change.steps.length || (this.last !== null && change.docs[0] !== this.last.after)) {
      // The open event may be the one the gap arose in: it goes too.
      this.stop("gap", this.closed.length);
      throw new CaptureError("gap");
    }
    const at = this.last === null ? change.at : Math.max(change.at, this.last.at);
    const timed = at === change.at ? change : { ...change, at };
    this.last = timed;
    // The change left the document as it was: nothing to write. Its steps
    // could replay only as steps that change nothing, or as a pair that
    // undoes itself (`setParagraph` on a paragraph gives a block without an
    // id, then its id back), which the replayer refuses. It does not keep the
    // open event open either: the quiet time counts from the last change
    // that wrote something.
    if (change.docs[0]!.eq(change.after)) return;
    if (
      this.open &&
      (this.open.source !== change.source ||
        at - lastAt(this.open) > this.quietMs ||
        at - firstAt(this.open) >= MAX_SEGMENT_SPAN_MS)
    ) {
      this.close();
    }
    if (this.open) this.open.changes.push(timed);
    else this.open = { source: change.source, changes: [timed] };
  }

  /** Closes the open event, e.g. when the drain is about to send. */
  close(): void {
    if (this.open) this.closed.push(this.open);
    this.open = null;
  }

  /** Closed events not yet in a segment. */
  get pendingEvents(): number {
    return this.closed.length;
  }

  /**
   * The next segment from the oldest closed events, or null if none is closed.
   * It holds as many events as fit the event limit, the 30 s span from its
   * first change to its last and D-96; the rest stay for the next call.
   * Events leave the recorder once a segment was built from them. When the
   * recorder stops (a gap, or an event that cannot be built or is over D-96
   * alone), the events closed before the failure still come out, in one or
   * more segments, and only then does this throw it; the event the failure
   * arose in and every later one never do (F-104 t. 1).
   */
  async takeSegment(context: SegmentContext): Promise<BuiltSegment | null> {
    if (this.closed.length === 0) {
      if (this.failure !== null) throw new CaptureError(this.failure);
      return null;
    }
    const startedAt = firstAt(this.closed[0]!);
    // `record` keeps every event under 30 s, so the first one always fits.
    let count = 1;
    while (
      count < this.closed.length &&
      count < MAX_SEGMENT_EVENTS &&
      lastAt(this.closed[count]!) - startedAt < MAX_SEGMENT_SPAN_MS
    ) {
      count += 1;
    }
    for (;;) {
      let built: BuiltSegment;
      try {
        built = await buildSegment(this.closed.slice(0, count), context);
      } catch (error) {
        const failed = error instanceof EventFailure ? error : new EventFailure(0, "unsupported_step");
        this.stop(failed.code, failed.index);
        if (failed.index === 0) throw new CaptureError(this.failure!);
        count = failed.index;
        continue;
      }
      if (!exceedsEvidenceSegmentLimit(built.bytes.byteLength)) {
        this.closed.splice(0, count);
        return built;
      }
      if (count === 1) {
        this.stop("too_large", 0);
        throw new CaptureError(this.failure!);
      }
      count = Math.ceil(count / 2);
    }
  }
}

/** The failure of the event at `index` of a segment being built. */
class EventFailure extends Error {
  constructor(readonly index: number, readonly code: CaptureFailure) {
    super(`evidence capture: event ${index}: ${code}`);
  }
}

async function buildSegment(raw: readonly RawEvent[], context: SegmentContext): Promise<BuiltSegment> {
  const startedMs = Math.floor(raw[0]!.changes[0]!.at / MINUTE_MS) * MINUTE_MS;
  const lastEvent = raw[raw.length - 1]!;
  const events: EvidenceEventV3[] = [];
  const timing: SegmentTiming["events"] = [];
  let initial: string | null = null;
  let previousAfter: { canonical: string; sha256: string } | null = null;
  for (const [index, event] of raw.entries()) {
    try {
      const sequence = context.sequenceFrom + index;
      const steps: JcsJsonValue[] = [];
      const offsets: number[] = [];
      for (const change of event.changes) {
        for (const json of await changeSteps(change)) {
          steps.push(json);
          offsets.push(change.at - startedMs);
        }
      }
      const parsed = parseEditSteps(EDIT_STEP_FORMAT_V1, steps);
      if (!parsed.ok) throw new CaptureError(parsed.code === "too_large" ? "too_large" : "unsupported_step");
      const before = previousAfter ?? (await documentDigest(event.changes[0]!.docs[0]!));
      const after = await documentDigest(event.changes[event.changes.length - 1]!.after);
      initial ??= before.sha256;
      events.push({
        sequence,
        source: event.source,
        steps: parsed.steps as unknown as EvidenceEventV3["steps"],
        beforeDocumentHash: before.sha256,
        afterDocumentHash: after.sha256,
      });
      timing.push({ sequence, stepOffsetsMs: offsets });
      previousAfter = after;
    } catch (error) {
      // Any failure of the event, a hash of half a surrogate pair included
      // (qa494h MANJE 1), is the failure of that event, never of the ones before.
      throw new EventFailure(index, error instanceof CaptureError ? error.code : "unsupported_step");
    }
  }
  // v3 only when an event is citation-form, so every other segment keeps its
  // v2 bytes (contract #896, P1); the canonical form below checks the pair.
  const segment = {
    evidenceSchema: evidenceSchemaForEvents(events),
    canonicalization: EVIDENCE_CANONICALIZATION_V2,
    hashAlgorithm: EVIDENCE_HASH_ALGORITHM_V2,
    documentId: context.documentId,
    sessionId: context.sessionId,
    segmentId: context.segmentId,
    sequenceFrom: context.sequenceFrom,
    sequenceTo: context.sequenceFrom + raw.length - 1,
    observedStartedAt: minute(raw[0]!.changes[0]!.at),
    observedEndedAt: minute(lastEvent.changes[lastEvent.changes.length - 1]!.at),
    initialDocumentHash: initial!,
    finalDocumentHash: previousAfter!.sha256,
    predecessorSegmentHash: context.predecessorSegmentHash,
    events,
    captureContext: { editorModel: "prosemirror", transactionFormat: EDIT_STEP_FORMAT_V1 },
    evidenceProfileId: context.evidenceProfileId,
  } as EvidenceSegment;
  let canonical: string;
  try {
    canonical = canonicalEvidenceSegment(segment);
  } catch {
    throw new CaptureError("unsupported_step");
  }
  const sha256 = await sha256WebCrypto(canonical);
  return {
    segment,
    bytes: encoder.encode(canonical),
    sha256,
    document: encoder.encode(previousAfter!.canonical),
    timing: { segmentHash: sha256, sequenceFrom: context.sequenceFrom, events: timing },
    eventCount: raw.length,
  };
}
