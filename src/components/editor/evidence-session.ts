/**
 * F-8 3d-2c2 (DAN-37, contract #476 c.6391714810): the saving of a document
 * with evidence in `/rad?zadatak=`, with the surface `LocalDocument` already
 * uses from `LocalDocumentSaver` (`load`, `edit`, `propose`, `settled`,
 * `snapshot`, `subscribe`) and `record`, `pause`, `resume`, `close`.
 *
 * - Every change the editor applies is recorded with its source; each local
 *   save turns the closed events into segments, replays each over the
 *   journal's snapshot (W2) and saves it (`saveSegment`). A stop of the
 *   recorder or a failed replay saves the text without evidence
 *   (`saveUncovered`), and nothing is recorded or chained after it (W3).
 * - The head of the chain and the sequence always come from the journal,
 *   never from this object (D4); the `localSeq` it expects is its own, so a
 *   write of another instance is `stale`.
 * - The drain runs only while the browser reports a network (G2,
 *   c.6393716541) and at most one step at a time. SYNCED is shown only from
 *   the journal's meta after a receipt verified in this page session (W1,
 *   G3): a reload starts at LOCAL_DURABLE.
 *
 * React-free; the adapters come in through `EvidenceSessionDeps`
 * (`src/client/evidence-session-deps.ts` in the browser).
 */

import type { Node as PmNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";

import type { OpenedWork, OpenOutcome } from "@/client/evidence-ingest";
import { validateDocument, type CanonicalDocument } from "@/domain/document";
import type { AsyncEvidenceStepReplayerV2 } from "@/domain/forensics/evidence-replay-v2";
import { replayEvidenceSegmentsV2 } from "@/domain/forensics/evidence-replay-v2";
import { canonicalizeJcs, type JcsJsonValue } from "@/domain/forensics/jcs";
import { MAX_DOCUMENT_SNAPSHOT_BYTES } from "@/domain/document/snapshot";
import type {
  EvidenceSegmentTransaction, EvidenceStop, JournalContents, SyncMeta,
} from "@/domain/sync/journal-types";
import { restoreSyncState } from "@/domain/sync/restore";
import type { SyncState } from "@/domain/sync/states";
import { CaptureError, EvidenceRecorder, type BuiltSegment } from "@/editor/capture";
import { NO_OBSERVATION, recordWithSource, type SourceObservation } from "@/editor/source";
import type { AtomicDexieJournal } from "@/lib/journal/atomic-dexie-journal";
import {
  failureOf, type LoadResult, type SaverFailure, type SaverSnapshot,
} from "@/lib/journal/local-document-saver";
import type { DrainRunner } from "@/lib/sync/drain-runner";

export type EvidenceJournal = Pick<AtomicDexieJournal, "readEvidence" | "startEvidence" | "saveSegment" | "saveUncovered">;

/** Whether the browser reports a network, and a call on each `online` event. */
export type NetworkSignal = { online(): boolean; onOnline(listener: () => void): () => void };

export type EvidenceSessionDeps = {
  journal: EvidenceJournal;
  documentId: string;
  /** `openWork(assignmentId)`; a throw counts as `unavailable`. */
  open: () => Promise<OpenOutcome>;
  replayer: () => AsyncEvidenceStepReplayerV2<PmNode>;
  /** The drain runner over this journal, verifying receipts with `work`'s keys only. */
  createRunner: (work: OpenedWork) => DrainRunner;
  network: NetworkSignal;
  /**
   * Calls back when the commit route answers 409 `not_accepting`: a
   * submission closed the package (3d-2c2a §4, DAN-289 A1). Without it the
   * session never closes by submission.
   */
  watchSubmission?: (onClosed: () => void) => () => void;
  /**
   * The evidence profile the journal keeps for the document, for building
   * segments while the open route cannot be reached (O3 b, c.6392622568).
   * The browser adapter reads `meta.evidenceProfileId`, which `startEvidence`
   * stores; without one (an older record) segments wait for a successful
   * `open` (O3 a).
   */
  storedProfile?: (meta: SyncMeta | null) => string | null;
  now?: () => Date;
  /** The drain runner's clock, for its `notBefore`. */
  clock?: () => number;
  newId?: () => string;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

/** The session's snapshot; `closedBy` tells the editor to turn read-only (3d-2c2b). */
export type EvidenceSnapshot = SaverSnapshot & {
  closedBy: "submission" | null;
  /**
   * The server refused the last row and nothing sends it again by itself
   * (3d-2c2 §3): a refusal for good (`meta.refusedLocalSeq`), or a 426 or an
   * unreadable answer the drain holds for a manual retry. Only a reload sends
   * it again.
   */
  refused: boolean;
};

type Candidate = { doc: CanonicalDocument; gen: number; marks: number };
type Contents = JournalContents<EvidenceSegmentTransaction>;

const STICKY: ReadonlySet<SyncState> = new Set(["CONFLICT", "RECOVERY_REQUIRED"]);
const HALTING: ReadonlySet<SaverFailure> = new Set(["corrupt", "stale", "unavailable"]);
const decoder = new TextDecoder();

export class EvidenceSession {
  private loaded = false;
  private halted = false;
  private closed = false;
  private paused = false;
  private failure: SaverFailure | null = null;
  /** The journal's meta state as last read or written; SYNCED is shown only with `syncedHere`. */
  private stored: SyncState | null = null;
  private syncedHere = false;
  /** Rows owed as last read or written; SYNCING is shown only while a step runs for them (P2). */
  private owed = 0;
  private syncing = false;
  private seq = 0;
  private gen = 0;
  private cleanGen = 0;
  private recorded = 0;
  private stopped: EvidenceStop | null = null;
  /** §4: a submission closed the package; nothing is written or sent from here. */
  private closedBy: "submission" | null = null;
  private refused = false;
  /** The drain's last step held the front row for a manual retry (426, unreadable answer). */
  private manualOnly = false;
  private profile: string | null = null;
  private work: OpenedWork | null = null;
  private runner: DrainRunner | null = null;
  private recorder: EvidenceRecorder | null = null;
  private sessionId = "";
  private next: Candidate | null = null;
  /**
   * A segment taken from the recorder whose journal write has not succeeded.
   * Its events are no longer in the recorder, so the next save writes this
   * segment first instead of losing them; a failed write leaves the journal
   * as it was, so the segment still fits its head.
   */
  private unsaved: BuiltSegment | null = null;
  private saving = false;
  private flight: Promise<void> | null = null;
  private stepping: Promise<void> | null = null;
  private stepAgain = false;
  private opening: Promise<void> | null = null;
  private timer: unknown = null;
  private unlisten: () => void = () => {};
  private unwatch: () => void = () => {};
  private readonly listeners = new Set<(snapshot: EvidenceSnapshot) => void>();
  private readonly id: string;
  private readonly now: () => Date;
  private readonly clock: () => number;
  private readonly newId: () => string;

  constructor(private readonly deps: EvidenceSessionDeps) {
    this.id = deps.documentId;
    this.now = deps.now ?? (() => new Date());
    this.clock = deps.clock ?? Date.now;
    this.newId = deps.newId ?? (() => crypto.randomUUID());
  }

  snapshot(): EvidenceSnapshot {
    // §4: the refused row stays on the device; that is no failure of this device.
    const failure = this.closedBy ? null : this.failure;
    // Tied to the held row, not to ERROR: a later local save writes
    // LOCAL_DURABLE while the same row is still refused (review #811 c.6419592134).
    const refused = !this.closedBy && this.owed > 0 && (this.refused || this.manualOnly);
    return { state: this.state(), failure, capacity: "ok", closedBy: this.closedBy, refused };
  }

  subscribe(listener: (snapshot: EvidenceSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /**
   * Reads the journal and opens the work at once (§2 Otvaranje). Writes only
   * `startEvidence`, and only for the provider's own document with nothing
   * owed, not stopped and not sticky; otherwise the journal's chain goes on.
   */
  async load(): Promise<LoadResult> {
    if (this.loaded || this.halted) throw new Error("EvidenceSession.load() runs once");
    const { journal } = this.deps;
    let contents: Contents;
    let opened: OpenOutcome;
    try {
      [contents, opened] = await Promise.all([journal.readEvidence(this.id), this.openSafely()]);
    } catch (error) {
      return this.haltLoad(failureOf(error));
    }
    // close() during the read or the open: nothing is written and nothing listens.
    if (this.closed) return { kind: "unavailable" };
    if (opened.status === "opened") {
      if (opened.work.documentId !== this.id) return this.haltLoad("unavailable");
      this.work = opened.work;
      const meta = contents.meta;
      if (contents.pending.length === 0 && meta?.evidenceStopped === undefined && !STICKY.has(meta?.state as SyncState)) {
        try {
          await journal.startEvidence(this.id, opened.work, this.now().toISOString());
          contents = await journal.readEvidence(this.id);
        } catch (error) {
          // A journal ahead of a late answer keeps its own chain.
          if (!contents.meta?.evidenceHead) return this.haltLoad(failureOf(error));
        }
      }
    }
    if (this.closed) return { kind: "unavailable" };
    const { meta, snapshot } = contents;
    if (!meta?.evidenceHead || !snapshot) return this.haltLoad("unavailable");
    const document = validateDocument(snapshot.document);
    if (!document.ok) return this.haltLoad("corrupt", { kind: "recovery", reason: "corrupt", document: null });
    const restored = restoreSyncState(contents as unknown as JournalContents);
    if (STICKY.has(restored)) {
      this.halted = true;
      this.stored = restored;
      this.emit();
      return { kind: "recovery", reason: "sticky", document: document.doc };
    }
    this.seq = meta.localSeq;
    this.stored = restored;
    this.owed = contents.pending.length;
    // A reload before the work opens still says the stored refusal.
    this.refused = meta.refusedLocalSeq !== undefined;
    this.stopped = meta.evidenceStopped ?? null;
    this.profile = this.work?.evidenceProfileId ?? this.deps.storedProfile?.(meta) ?? null;
    this.loaded = true;
    if (this.work?.submitted) {
      // O2 (DAN-289, #756 c.6399602745): a submitted work opens closed, the
      // same as after a 409 `not_accepting`. No recorder, runner, watch or
      // `online` listener starts, so nothing more goes to `/api/evidence/*`;
      // the rows the journal holds stay there, neither sent nor deleted.
      this.closedBy = "submission";
      this.emit();
      return { kind: "ready", document: document.doc };
    }
    if (this.work) this.runner = this.deps.createRunner(this.work);
    this.recorder = new EvidenceRecorder();
    this.sessionId = this.newId();
    this.unwatch = this.deps.watchSubmission?.(() => this.closeBySubmission()) ?? (() => {});
    this.unlisten = this.deps.network.onOnline(() => {
      this.retryOpen();
      this.kick();
    });
    this.emit();
    this.kick();
    return { kind: "ready", document: document.doc };
  }

  /** One editor change (`transaction` event); the caller gates it on its ready flag. */
  record(transactions: readonly Transaction[], observation: SourceObservation = NO_OBSERVATION, at = Date.now()): void {
    if (!this.recorder || this.stopped || this.halted || this.closedBy) return;
    if (!transactions.some((tr) => tr.docChanged)) return;
    this.recorded += 1;
    try {
      recordWithSource(this.recorder, transactions, observation, at);
    } catch (error) {
      if (!(error instanceof CaptureError)) throw error;
      this.stopped = error.code;
    }
  }

  edit(): void {
    this.gen += 1;
    this.emit();
  }

  propose(doc: CanonicalDocument): Promise<void> {
    if (!this.loaded) {
      if (this.halted) return Promise.resolve();
      throw new Error("EvidenceSession.propose() before a ready load()");
    }
    if (this.closedBy) return Promise.resolve();
    this.next = { doc, gen: this.gen, marks: this.recorded };
    this.startWrites();
    return this.flight ?? Promise.resolve();
  }

  /** No save, open or drain step in flight; a paused drain starts none. */
  async settled(): Promise<void> {
    while (this.flight || this.stepping || this.opening) {
      await (this.flight ?? this.stepping ?? this.opening);
    }
  }

  /** Stops starting drain steps (sign-out dialog); saves still run. */
  pause(): void {
    this.paused = true;
    this.clearTimer();
  }

  resume(): void {
    this.paused = false;
    this.startWrites();
    this.kick();
  }

  /** The session ended: no timer, listener, recording, save or step from here. */
  close(): void {
    this.closed = true;
    this.halted = true;
    this.clearTimer();
    this.unlisten();
    this.unwatch();
  }

  /** Closed by `close()` or by a submission: nothing more is written. */
  private get ended(): boolean {
    return this.closed || this.closedBy !== null;
  }

  /** §4: terminal and not an error; the refused row stays in the journal untouched. */
  private closeBySubmission(): void {
    if (this.closedBy || this.closed) return;
    this.closedBy = "submission";
    this.next = null;
    this.clearTimer();
    this.emit();
  }

  private state(): SyncState {
    if (this.stored && STICKY.has(this.stored)) return this.stored;
    if (this.closedBy) return "LOCAL_DURABLE";
    if (this.failure) return "ERROR";
    if (this.gen !== this.cleanGen || this.next) return this.saving ? "SAVING_LOCAL" : "EDITING";
    if (this.stored === null) return "EDITING";
    // P2 (#476 c.6395903987): shown in memory only, never written to the journal.
    if (this.syncing) return "SYNCING";
    // G3: SYNCED only from a receipt verified in this page session; a SYNCING
    // left in meta outside a step of this session is a send that never ended.
    if (this.stored === "SYNCING") return "LOCAL_DURABLE";
    return this.stored === "SYNCED" && !this.syncedHere ? "LOCAL_DURABLE" : this.stored;
  }

  private startWrites(): void {
    if (this.flight || this.halted || this.closedBy || !this.next) return;
    if (!this.stopped && this.profile === null) return; // O3 a: wait for a successful open
    let settle!: (written: Promise<void>) => void;
    this.flight = new Promise<void>((resolve) => { settle = resolve; });
    settle(this.writeQueued());
  }

  private async writeQueued(): Promise<void> {
    try {
      while (this.next && !this.halted && !this.closedBy && (this.stopped || this.profile !== null)) {
        const candidate = this.next;
        this.next = null;
        await this.save(candidate);
      }
    } finally {
      this.flight = null;
      this.emit();
    }
  }

  private async save(candidate: Candidate): Promise<void> {
    this.saving = true;
    this.emit();
    try {
      const covers = this.stopped
        ? await this.saveUncovered(candidate.doc, this.stopped)
        : await this.saveCovered(candidate);
      if (covers && candidate.gen === this.gen && !this.next) this.cleanGen = candidate.gen;
      this.failure = null;
    } catch (error) {
      this.failure = failureOf(error);
      if (HALTING.has(this.failure)) this.halted = true;
      await this.refresh();
    } finally {
      this.saving = false;
      this.emit();
    }
  }

  /** True when the journal now holds exactly `candidate`'s text. */
  private async saveCovered(candidate: Candidate): Promise<boolean> {
    const { journal } = this.deps;
    const recorder = this.recorder!;
    recorder.close();
    let lastDocument: string | null = null;
    for (;;) {
      if (this.ended) return false;
      const contents = await journal.readEvidence(this.id);
      const { meta, snapshot } = contents;
      if (!meta?.evidenceHead || !snapshot || meta.localSeq !== this.seq) {
        throw Object.assign(new Error("journal moved"), { code: "stale_local_sequence" });
      }
      // P1 (#476 c.6395903987): a capture failure during this save takes nothing more.
      if (this.stopped) {
        this.unsaved = null;
        return this.saveUncovered(candidate.doc, this.stopped);
      }
      const tail = contents.pending.at(-1)?.tx;
      const head = tail ? { segmentHash: tail.segmentHash, lastSequenceTo: tail.sequenceTo } : meta.evidenceHead;
      let built = this.unsaved;
      if (built !== null && (built.segment.sequenceFrom !== head.lastSequenceTo + 1
        || built.segment.predecessorSegmentHash !== head.segmentHash)) {
        throw Object.assign(new Error("journal moved"), { code: "stale_local_sequence" });
      }
      if (built === null) {
        try {
          built = await recorder.takeSegment({
            documentId: this.id, sessionId: this.sessionId, segmentId: this.newId(),
            evidenceProfileId: this.profile!, sequenceFrom: head.lastSequenceTo + 1,
            predecessorSegmentHash: head.segmentHash,
          });
        } catch (error) {
          if (!(error instanceof CaptureError)) throw error;
          return this.saveUncovered(candidate.doc, error.code);
        }
      }
      if (built === null) {
        lastDocument ??= canonicalizeJcs(snapshot.document);
        break;
      }
      const replay = await replayEvidenceSegmentsV2(
        snapshot.document as unknown as JcsJsonValue, [built.segment], this.deps.replayer());
      if (!replay.ok || replay.documentSha256 !== built.segment.finalDocumentHash) {
        this.unsaved = null;
        return this.saveUncovered(candidate.doc, "unsupported_step");
      }
      // §4: the session may have closed (submission or close()) during the build or replay.
      if (this.ended) return false;
      // P1: a capture failure during the build or replay keeps the segment out of the chain.
      if (this.stopped) {
        this.unsaved = null;
        return this.saveUncovered(candidate.doc, this.stopped);
      }
      // The journal never takes a snapshot over the limit: stop evidence here
      // instead of keeping a segment that no retry can write.
      if (built.document.byteLength > MAX_DOCUMENT_SNAPSHOT_BYTES) {
        this.unsaved = null;
        return this.saveUncovered(candidate.doc, "too_large");
      }
      this.unsaved = built;
      const result = await journal.saveSegment(this.id, built, this.now().toISOString(), this.seq);
      this.unsaved = null;
      this.seq = result.localSeq;
      this.stored = result.meta.state;
      this.syncedHere = false;
      this.owed += 1;
      lastDocument = decoder.decode(built.document);
      this.retryOpen();
      this.kick();
    }
    // Nothing recorded since the proposal: the journal must now hold its exact
    // bytes, else a change escaped the recorder and the chain cannot cover it.
    if (candidate.marks !== this.recorded) return false;
    if (lastDocument !== canonicalizeJcs(candidate.doc)) return this.saveUncovered(candidate.doc, "gap");
    return true;
  }

  private async saveUncovered(doc: CanonicalDocument, reason: EvidenceStop): Promise<boolean> {
    // §4: nothing is written once the session closed.
    if (this.ended) return false;
    this.stopped = reason;
    const meta = await this.deps.journal.saveUncovered(this.id, doc, reason, this.now().toISOString(), this.seq);
    this.seq = meta.localSeq;
    this.stored = meta.state;
    this.syncedHere = false;
    return true;
  }

  private kick(): void {
    if (this.stepping) {
      this.stepAgain = true;
      return;
    }
    if (!this.runner || this.halted || this.closedBy || this.paused || !this.deps.network.online()) return;
    this.clearTimer();
    this.stepAgain = false;
    this.stepping = this.stepLoop().finally(() => {
      this.stepping = null;
      if (this.stepAgain) this.kick();
    });
  }

  private async stepLoop(): Promise<void> {
    while (this.runner && !this.halted && !this.closedBy && !this.paused && this.deps.network.online()) {
      let result;
      this.syncing = this.owed > 0;
      if (this.syncing) this.emit();
      try {
        result = await this.runner.step(this.id);
      } catch {
        this.syncing = false;
        await this.refresh();
        return;
      }
      this.syncing = false;
      this.manualOnly = result.kind === "needs_retry";
      if (result.kind === "sent" && result.state === "SYNCED") this.syncedHere = true;
      const contents = await this.refresh();
      if (result.kind === "sent" && contents && contents.pending.length > 0) continue;
      if (result.kind === "waiting" && !this.closed && !this.closedBy) {
        const set = this.deps.setTimer ?? ((run, ms) => setTimeout(run, ms));
        this.timer = set(() => { this.timer = null; this.kick(); }, Math.max(0, result.notBefore - this.clock()));
      }
      return;
    }
  }

  private async refresh(): Promise<Contents | null> {
    try {
      const contents = await this.deps.journal.readEvidence(this.id);
      if (contents.meta) {
        this.stored = contents.meta.state;
        this.refused = contents.meta.refusedLocalSeq !== undefined;
        this.owed = contents.pending.length;
        if (STICKY.has(contents.meta.state)) this.halted = true;
      }
      this.emit();
      return contents;
    } catch {
      return null;
    }
  }

  /** Opens again while the work is unknown (§2 t. 4): on `online` and after each saved segment. */
  private retryOpen(): void {
    if (this.work || this.opening || this.closed || !this.deps.network.online()) return;
    this.opening = this.openSafely().then((opened) => {
      if (opened.status !== "opened" || this.closed) return;
      if (opened.work.documentId !== this.id) {
        this.failure = "unavailable";
        this.halted = true;
        return;
      }
      this.work = opened.work;
      if (opened.work.submitted) {
        // O2 also when the first open could not be reached (Codex #818
        // r4380722769): close as `load()` does, before any runner exists.
        this.closeBySubmission();
        return;
      }
      this.profile = opened.work.evidenceProfileId;
      this.runner = this.deps.createRunner(opened.work);
      this.startWrites();
      this.kick();
    }).finally(() => {
      this.opening = null;
      this.emit();
    });
  }

  private async openSafely(): Promise<OpenOutcome> {
    try {
      return await this.deps.open();
    } catch {
      return { status: "unavailable" };
    }
  }

  private haltLoad(failure: SaverFailure, result: LoadResult = { kind: "unavailable" }): LoadResult {
    this.halted = true;
    this.failure = failure;
    this.emit();
    return result;
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    (this.deps.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)))(this.timer);
    this.timer = null;
  }

  private emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        queueMicrotask(() => { throw error; });
      }
    }
  }
}
