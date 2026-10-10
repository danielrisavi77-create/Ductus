/**
 * Local-only saving of one document into the journal (F-3 step 1a, #197).
 *
 * The editor calls `edit()` on every change and `propose(doc)` with the
 * debounced canonical candidate. Saves run one at a time per document and the
 * newest candidate wins, so this tab never races its own `expectedLocalSeq`
 * and the snapshot never falls back to older text. State changes go through
 * `syncReducer`, and LOCAL_DURABLE ("Spremljeno na uređaju") is reached only
 * after `saveLocal` resolved for exactly the text the editor holds.
 *
 * No network, no ACK, no logout: journal meta only ever records LOCAL_DURABLE
 * (written by `saveLocal`); transient states live in memory only.
 */

import { emptyDocument, validateDocument, type CanonicalDocument } from "../../domain/document";
import { restoreSyncState } from "../../domain/sync/restore";
import {
  syncReducer, type LocalSaveFailureReason, type SyncEvent, type SyncState,
} from "../../domain/sync/states";
import { storableDocument } from "../../editor/storable-text";
import type { AtomicDexieJournal } from "./atomic-dexie-journal";

/**
 * Why saving stopped. `limit` is this module's own bound on the queue (no
 * compaction before step 2); `stale` means another writer moved the journal.
 */
export type SaverFailure = LocalSaveFailureReason | "limit" | "stale";

export type QueueCapacity = "ok" | "near" | "full";

export type SaverSnapshot = {
  readonly state: SyncState;
  /** Sticky until a save succeeds, so the next keystroke cannot hide it. */
  readonly failure: SaverFailure | null;
  readonly capacity: QueueCapacity;
};

export type SaverLimits = { readonly maxPendingRows: number; readonly maxPendingChars: number };

/** Rows and JSON characters; `near` from 80 %. Measured in the PR. */
export const DEFAULT_SAVER_LIMITS: SaverLimits = {
  maxPendingRows: 5_000, maxPendingChars: 64 * 1024 * 1024,
};

/**
 * On a reload with edits not yet proposed, `ready` carries the journal's
 * document, not the editor's, and the state stays EDITING; the next
 * `propose()` saves the editor's text.
 */
export type LoadResult =
  | { kind: "ready"; document: CanonicalDocument }
  /** Sticky or unreadable store: show it, never overwrite it. */
  | { kind: "recovery"; document: CanonicalDocument | null }
  | { kind: "unavailable" };

export type SaverDeps = {
  readonly now?: () => Date;
  readonly newTransactionId?: () => string;
  readonly limits?: SaverLimits;
};

/** Failures after which writing again could overwrite or hide work. */
const HALTING: ReadonlySet<SaverFailure> = new Set(["corrupt", "stale", "unavailable"]);

export function failureOf(error: unknown): SaverFailure {
  const code = (error as { code?: unknown } | null)?.code;
  switch (code) {
    case "incomplete_store": case "sticky_state": return "corrupt";
    case "stale_local_sequence": return "stale";
    case "logout_in_progress": case "logout_blocked": return "unavailable";
  }
  const names = [error, (error as { inner?: unknown } | null)?.inner]
    .map((e) => (e as { name?: unknown } | null)?.name);
  if (names.includes("QuotaExceededError")) return "quota";
  if (names.some((n) => typeof n === "string" &&
    /^(MissingAPI|OpenFailed|DatabaseClosed|InvalidState|Security)Error$/.test(n))) {
    return "unavailable";
  }
  return "unknown";
}

export function reasonOf(failure: SaverFailure): LocalSaveFailureReason {
  return failure === "limit" ? "quota" : failure === "stale" ? "unknown" : failure;
}

type Candidate = { doc: CanonicalDocument; gen: number };

export class LocalDocumentSaver {
  private state: SyncState = "EDITING";
  private failure: SaverFailure | null = null;
  private loaded = false;
  private halted = false;
  private seq = 0;
  private baseRevision = 0;
  private durable: CanonicalDocument | null = null;
  private rows = 0;
  private chars = 0;
  /** Bumped by every `edit()`; a save may claim the text only at its own gen. */
  private gen = 0;
  /** The gen whose text the journal holds, as far as this saver wrote it. */
  private cleanGen = 0;
  /** A candidate failed and no later write succeeded: the journal lacks the editor's text. */
  private unsaved = false;
  private next: Candidate | null = null;
  private flight: Promise<void> | null = null;
  /** Set while any `load()` reads; no write starts until the last one resolves. */
  private reading: Promise<void> | null = null;
  private readers = 0;
  private release: () => void = () => {};
  private readonly listeners = new Set<(snapshot: SaverSnapshot) => void>();
  private readonly now: () => Date;
  private readonly newId: () => string;
  private readonly limits: SaverLimits;

  constructor(
    private readonly journal: AtomicDexieJournal,
    private readonly documentId: string,
    deps: SaverDeps = {},
  ) {
    this.now = deps.now ?? (() => new Date());
    this.newId = deps.newTransactionId ?? (() => crypto.randomUUID());
    this.limits = deps.limits ?? DEFAULT_SAVER_LIMITS;
  }

  snapshot(): SaverSnapshot {
    const { maxPendingRows: rows, maxPendingChars: chars } = this.limits;
    const capacity: QueueCapacity = this.rows >= rows || this.chars >= chars ? "full"
      : this.rows >= rows * 0.8 || this.chars >= chars * 0.8 ? "near" : "ok";
    return { state: this.state, failure: this.failure, capacity };
  }

  subscribe(listener: (snapshot: SaverSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /**
   * Reads the journal once. A store that cannot be trusted yields `recovery`
   * and leaves the saver halted: an empty editor must never be journalled
   * over text that merely failed to load (#197 attack 17).
   *
   * A write still in flight is awaited first, and none starts during the
   * read: otherwise the read could return the sequence before that write and
   * the next save would fail as stale in a tab that is the only writer.
   * Overlapping loads share the block until the last one has read (#206 V1).
   * A write that never settles (a blocked IndexedDB) holds the load with it;
   * step 1b bounds that wait in the UI (#206 M-a).
   *
   * A reload never lifts a halt or a failure of this saver's own writes, and
   * never claims text another writer put in the journal: the editor then
   * holds text the journal lacks, so the result is `recovery` (#206 B1).
   */
  async load(): Promise<LoadResult> {
    if (this.readers++ === 0) {
      this.reading = new Promise<void>((resolve) => { this.release = resolve; });
    }
    try {
      await this.settled();
      return await this.read();
    } finally {
      if (--this.readers === 0) {
        this.reading = null;
        this.release();
        if (this.next && !this.halted) this.flight ??= this.drain();
      }
    }
  }

  private async read(): Promise<LoadResult> {
    try {
      const contents = await this.journal.read(this.documentId);
      const { snapshot, meta, pending } = contents;
      const stored = snapshot ? validateDocument(snapshot.document) : null;
      if ((meta && !snapshot) || (snapshot && !meta) || (stored && !stored.ok)) {
        return this.haltWith("corrupt", { kind: "recovery", document: null });
      }
      const restored = restoreSyncState(contents);
      if (restored === "CONFLICT" || restored === "RECOVERY_REQUIRED") {
        this.halted = true;
        this.state = restored;
        this.emit();
        return { kind: "recovery", document: stored?.ok ? stored.doc : null };
      }
      const document = stored?.ok ? stored.doc : null;
      if (this.unsaved) {
        return this.haltWith(this.failure ?? "unknown", { kind: "recovery", document });
      }
      if (this.loaded && (meta?.localSeq ?? 0) !== this.seq) {
        return this.haltWith("stale", { kind: "recovery", document });
      }
      // A ready read after an `unavailable` one is a deliberate retry: the
      // sequence below is re-read, so saving may resume from it.
      this.loaded = true;
      this.halted = false;
      this.failure = null;
      this.seq = meta?.localSeq ?? 0;
      this.baseRevision = snapshot?.revision ?? 0;
      this.durable = document;
      this.rows = pending.length;
      this.chars = pending.reduce((sum, row) => sum + JSON.stringify(row.tx).length, 0);
      // Step 1 has no server: whatever meta says, the most this tab can
      // claim is that the bytes are on this device.
      // Text typed before or during the read is not what the journal holds.
      this.state = this.durable && this.gen === this.cleanGen && !this.next ? "LOCAL_DURABLE" : "EDITING";
      this.emit();
      return { kind: "ready", document: this.durable ?? emptyDocument() };
    } catch (error) {
      const failure = failureOf(error);
      return this.haltWith(failure, failure === "corrupt"
        ? { kind: "recovery", document: null } : { kind: "unavailable" });
    }
  }

  /**
   * The editor changed: nothing it now shows is claimed as saved. A halted
   * saver keeps ERROR or RECOVERY_REQUIRED: typing on must never turn the
   * chip back to "Uređivanje" while nothing is being saved (#197 attack 4).
   */
  edit(): void {
    this.gen += 1;
    if (this.halted) return;
    this.dispatch({ type: "EDIT" });
  }

  /**
   * The debounced candidate for the current text; the newest one wins. A
   * halted saver drops it (its state already says so); proposing before a
   * `ready` load is a caller bug and throws instead of dropping text silently.
   */
  propose(doc: CanonicalDocument): Promise<void> {
    if (this.halted) return Promise.resolve();
    if (!this.loaded) throw new Error("LocalDocumentSaver.propose() before a ready load()");
    this.next = { doc, gen: this.gen };
    // During a reload the candidate waits; `load()` starts it once read.
    if (this.reading) return this.reading.then(() => this.settled());
    this.flight ??= this.drain();
    return this.flight;
  }

  /** Resolves once nothing is queued or in flight (`pagehide`, tests). */
  async settled(): Promise<void> {
    while (this.flight) await this.flight;
  }

  private async drain(): Promise<void> {
    try {
      while (this.next && !this.halted) {
        const candidate = this.next;
        this.next = null;
        await this.save(candidate);
      }
    } finally {
      this.flight = null;
    }
  }

  private async save({ doc, gen }: Candidate): Promise<void> {
    const current = () => gen === this.gen && this.next === null;
    if (current()) this.dispatch({ type: "LOCAL_SAVE_STARTED" });
    // No shortcut for text equal to `durable`: another tab may have moved the
    // journal since, and only `saveLocal`'s sequence check can tell (#206 F2).
    try {
      const document = storableDocument(doc);
      const tx = {
        kind: "REPLACE_DOCUMENT" as const, clientTransactionId: this.newId(),
        baseRevision: this.baseRevision, document, createdAt: this.now().toISOString(),
      };
      const size = JSON.stringify(tx).length;
      if (this.rows + 1 > this.limits.maxPendingRows ||
          this.chars + size > this.limits.maxPendingChars) {
        this.fail("limit");
        return;
      }
      const result = await this.journal.saveLocal(this.documentId, tx, tx.createdAt, this.seq);
      this.seq = result.localSeq;
      this.durable = result.snapshot.document;
      this.rows += 1;
      this.chars += size;
      this.cleanGen = gen;
      this.unsaved = false;
    } catch (error) {
      this.fail(failureOf(error));
      return;
    }
    if (current()) this.succeed();
  }

  private succeed(): void {
    this.failure = null;
    this.dispatch({ type: "LOCAL_SAVE_OK" });
  }

  /**
   * A failure is shown even when the author typed on meanwhile (the state is
   * then EDITING, which has no failure transition): the attempt is replayed
   * as edited-started-failed so ERROR or RECOVERY_REQUIRED is never skipped,
   * also from LOCAL_DURABLE, which has no LOCAL_SAVE_STARTED (#206 Q2).
   */
  private fail(failure: SaverFailure): void {
    this.failure = failure;
    this.unsaved = true;
    if (HALTING.has(failure)) this.halted = true;
    if (this.state !== "SAVING_LOCAL") {
      this.state = syncReducer(syncReducer(this.state, { type: "EDIT" }), { type: "LOCAL_SAVE_STARTED" });
    }
    this.dispatch({ type: "LOCAL_SAVE_FAILED", reason: reasonOf(failure) });
  }

  private haltWith<T>(failure: SaverFailure, result: T): T {
    this.halted = true;
    this.failure = failure;
    this.state = failure === "corrupt" ? "RECOVERY_REQUIRED" : "ERROR";
    this.emit();
    return result;
  }

  private dispatch(event: SyncEvent): void {
    const next = syncReducer(this.state, event);
    if (next === this.state && event.type !== "LOCAL_SAVE_FAILED") return;
    this.state = next;
    this.emit();
  }

  private emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}
