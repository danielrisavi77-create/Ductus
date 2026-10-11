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

import {
  documentsEqual, emptyDocument, validateDocument, type CanonicalDocument,
} from "../../domain/document";
import type { JournalContents } from "../../domain/sync/journal-types";
import { restoreSyncState } from "../../domain/sync/restore";
import {
  SYNC_STATES, syncReducer, type LocalSaveFailureReason, type SyncEvent, type SyncState,
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
 * Why `load()` did not return `ready` (#206 review, contract for step 1b):
 * - `corrupt`: the store is unreadable or incomplete; `document` is null.
 * - `sticky`: the journal records CONFLICT or RECOVERY_REQUIRED; `document` is
 *   its text.
 * For both the journal is authoritative: show it, never write over it.
 * - `unsaved`: a write of this saver failed and none succeeded since, so the
 *   editor holds text the journal lacks; `document` is the journal's older
 *   text.
 * - `stale`: another writer moved the journal; `document` is its text.
 * For both the editor's text is the author's newest: never replace it with
 * `document`; offer both, and continue with `resume(chosen)`.
 */
export type RecoveryReason = "corrupt" | "sticky" | "unsaved" | "stale";

/**
 * On a reload with edits not yet proposed, `ready` carries the journal's
 * document, not the editor's, and the state stays EDITING; the next
 * `propose()` saves the editor's text. A new saver over the same journal
 * also reads `ready` with the journal's text, so step 1b leaves a recovery
 * through `resume()`, never by filling the editor from a new instance.
 */
export type LoadResult =
  | { kind: "ready"; document: CanonicalDocument }
  | { kind: "recovery"; reason: RecoveryReason; document: CanonicalDocument | null }
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

/**
 * What one `resume()` may write over: the journal sequence whose text the
 * recovery showed when the author chose (#206 r6 finding 1), and that
 * choice's gen. Only this saver's own writes advance `at`.
 */
type Basis = { at: number; readonly gen: number };

export class LocalDocumentSaver {
  private state: SyncState = "EDITING";
  private failure: SaverFailure | null = null;
  private loaded = false;
  private halted = false;
  private seq = 0;
  /**
   * The newest journal sequence any read of this saver saw. Own writes need
   * not move it: none starts while a read runs (`reading`).
   */
  private seen = 0;
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
  /** Why the last `load()` returned `recovery`; null after a `ready` one. */
  private recovery: RecoveryReason | null = null;
  /**
   * The journal sequence whose text the last recovery showed; this saver's
   * own writes advance it (#206 C1). `resume()` copies it when called, as
   * the text the author saw, so a later load cannot move it (#206 r6).
   */
  private shown = 0;
  /** The bases of the `resume()` calls still running; own writes advance them. */
  private readonly bases = new Set<Basis>();
  private resuming = 0;
  /** The newest gen ever queued, so `resume()` never queues behind a newer text. */
  private queuedGen = 0;
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
   * A failure that does not halt (quota, limit, unknown) stays a retryable
   * ERROR across the reload, so the next `propose()` tries again exactly as
   * without it; only a halting one stays halted until `resume()`.
   */
  load(): Promise<LoadResult> {
    return this.loadFor(null);
  }

  private async loadFor(basis: Basis | null): Promise<LoadResult> {
    if (this.readers++ === 0) {
      this.reading = new Promise<void>((resolve) => { this.release = resolve; });
    }
    try {
      await this.settled();
      return await this.read(basis);
    } finally {
      if (--this.readers === 0) {
        this.reading = null;
        this.release();
        if (this.next && !this.halted) this.flight ??= this.drain();
      }
    }
  }

  private async read(basis: Basis | null, retry = true): Promise<LoadResult> {
    try {
      const contents = await this.journal.read(this.documentId);
      const { snapshot, meta, pending } = contents;
      // The journal only grows, so a read behind what this saver already saw
      // was overtaken by a newer read of its own while it was held:
      // it would report a false `stale`, or a `ready` that lifts a newer
      // `stale` and shows older text, so read again (#206 r6 model). Once
      // only: a fresh read still behind means the journal itself went back.
      if (retry && (meta?.localSeq ?? 0) < this.seen) return await this.read(basis, false);
      this.seen = Math.max(this.seen, meta?.localSeq ?? 0);
      const stored = snapshot ? validateDocument(snapshot.document) : null;
      // Measured before any field changes, so a malformed row is `corrupt`
      // and never a half-applied read (#206 qa206c MANJE 2).
      let chars = 0;
      for (const row of pending) {
        const json: unknown = JSON.stringify(row?.tx);
        if (typeof json !== "string") return this.haltWith("corrupt", this.recover("corrupt", null));
        chars += json.length;
      }
      if ((meta && !snapshot) || (snapshot && !meta) || (stored && !stored.ok) ||
          !consistent(this.documentId, contents, stored?.ok ? stored.doc : null)) {
        return this.haltWith("corrupt", this.recover("corrupt", null));
      }
      const restored = restoreSyncState(contents);
      if (restored === "CONFLICT" || restored === "RECOVERY_REQUIRED") {
        this.halted = true;
        this.state = restored;
        this.emit();
        return this.recover("sticky", stored?.ok ? stored.doc : null);
      }
      const document = stored?.ok ? stored.doc : null;
      const at = meta?.localSeq ?? 0;
      // Read after `settled()`: a write of this saver that was in flight
      // when `resume()` was called has advanced the basis by now (#206 C1).
      const expected = basis ? basis.at : this.loaded ? this.seq : at;
      if (at !== expected) {
        return this.haltWith("stale", this.recover("stale", document, at));
      }
      // A halting failure already halted this saver in `fail()` and only a
      // ready read lifts that, so the recovery itself changes no state.
      if (this.unsaved && !basis) return this.recover("unsaved", document, at);
      // A ready read after an `unavailable` one is a deliberate retry: the
      // sequence below is re-read, so saving may resume from it.
      this.loaded = true;
      this.unsaved = false;
      this.recovery = null;
      this.halted = false;
      this.failure = null;
      this.seq = meta?.localSeq ?? 0;
      this.baseRevision = snapshot?.revision ?? 0;
      this.durable = document;
      this.rows = pending.length;
      this.chars = chars;
      // A candidate left from before a `resume()` choice is dropped: the
      // chosen text supersedes it (#206 MANJE 3). One proposed while this read
      // ran is newer than the choice and stays (#206 r6 finding 2).
      if (basis && this.next && this.next.gen < basis.gen) this.next = null;
      // Step 1 has no server: whatever meta says, the most this tab can claim
      // is that the bytes are on this device, and only for the text it shows.
      // Text typed before or during the read is not what the journal holds;
      // nor is a chosen text not written yet, as `resume()` bumped `gen`
      // (#206 A1). Written already at that gen, it is (#206 qa206d M-1).
      this.state = this.durable && this.gen === this.cleanGen && !this.next ? "LOCAL_DURABLE" : "EDITING";
      this.emit();
      return { kind: "ready", document: this.durable ?? emptyDocument() };
    } catch (error) {
      const failure = failureOf(error);
      return this.haltWith(failure, failure === "corrupt"
        ? this.recover("corrupt", null) : { kind: "unavailable" });
    }
  }

  private recover(reason: RecoveryReason, document: CanonicalDocument | null, at = 0): LoadResult {
    this.recovery = reason;
    this.shown = at;
    return { kind: "recovery", reason, document };
  }

  /**
   * Leaves an `unsaved` or `stale` recovery with the text the author chose
   * (usually the editor's) and writes `doc` over the journal's text, which
   * stays in its rows. Only over the text the recovery showed: if another
   * writer moved the journal since, the result is a new `stale` recovery with
   * its text and nothing is written; the write itself is a compare-and-set on
   * that sequence. The result is that of the re-read; the write's outcome is
   * in the snapshot. A `corrupt` or `sticky` journal is never written over,
   * so `resume()` throws there.
   *
   * The text the recovery showed is fixed when `resume()` is called, not when
   * it reads: a `load()` overlapping it may show newer text, which the author
   * did not see (#206 r6 finding 1). A candidate proposed while it reads is
   * newer than `doc`, so it is kept and written instead (#206 r6 finding 2);
   * if the read is stale, it waits like `doc` and the next `resume()` drops it.
   */
  async resume(doc: CanonicalDocument): Promise<LoadResult> {
    if (this.recovery !== "unsaved" && this.recovery !== "stale") {
      throw new Error("LocalDocumentSaver.resume() without an unsaved or stale recovery");
    }
    // `doc` is the editor's text now: typing during the read must not let
    // the write claim the newer text as saved (#206 qa206c model).
    const gen = (this.gen += 1);
    const basis: Basis = { at: this.shown, gen };
    this.bases.add(basis);
    this.resuming += 1;
    try {
      const result = await this.loadFor(basis);
      // Queued even if an overlapping load halted this saver after the ready
      // read: the chosen text then waits like any candidate proposed while
      // halted, and the next ready reload writes it (#206 qa206d V-1).
      if (result.kind === "ready") {
        if (this.queuedGen < gen) await this.queue({ doc, gen });
        else await this.settled();
      }
      return result;
    } finally {
      this.bases.delete(basis);
      this.resuming -= 1;
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
   * halted saver keeps it unwritten (its state already says so): a ready
   * reload after an `unavailable` read writes it, and a `resume()` writes it
   * if it is newer than the chosen text, so text proposed meanwhile is not
   * lost (#206 r6 finding 2). Proposing before a `ready` load is a caller
   * bug and throws instead of dropping text silently; after a first load
   * that halted, the text is dropped, as there is nothing to write it over.
   */
  propose(doc: CanonicalDocument): Promise<void> {
    if (!this.loaded && !this.resuming) {
      if (this.halted) return Promise.resolve();
      throw new Error("LocalDocumentSaver.propose() before a ready load()");
    }
    return this.queue({ doc, gen: this.gen });
  }

  private queue(candidate: Candidate): Promise<void> {
    this.next = candidate;
    this.queuedGen = Math.max(this.queuedGen, candidate.gen);
    // During a reload the candidate waits; `load()` starts it once read.
    if (this.reading) return this.reading.then(() => this.settled());
    // A halted saver holds it; `drain()` would end at once and never clear `flight`.
    if (!this.halted) this.flight ??= this.drain();
    return this.flight ?? Promise.resolve();
  }

  /**
   * Resolves once nothing is in flight (`pagehide`, tests). A halted saver
   * keeps its candidate queued past this, and its state meanwhile never says
   * LOCAL_DURABLE.
   */
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
      // This saver's own write moves the journal past nothing the author lacks.
      if (this.shown === this.seq) this.shown = result.localSeq;
      for (const basis of this.bases) if (basis.at === this.seq) basis.at = result.localSeq;
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

  /**
   * A listener that throws never interrupts saving: the error is thrown again
   * outside this call, so it is still reported, while the candidate already
   * taken from `next` is written (#206 Codex r4240240768).
   */
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

/**
 * Whether the journal's rows agree with each other, so that what `read()`
 * shows is the newest text this device holds (#206 qa206e V-1). `saveLocal`
 * writes snapshot, pending row and meta in one transaction, so a row of an
 * unknown kind, a sequence out of order, or a snapshot that is not the newest
 * pending text can only come from damage, and loading it would show older or
 * empty text as saved. Pending rows are never cleared in step 1; once an ACK
 * clears a prefix (F-8), the newest row still left is still the snapshot.
 */
function consistent(
  documentId: string, { snapshot, pending, meta }: JournalContents,
  stored: CanonicalDocument | null,
): boolean {
  if (!meta) return pending.length === 0;
  if (meta.documentId !== documentId || !Number.isSafeInteger(meta.localSeq) ||
      meta.localSeq < 0 || !(SYNC_STATES as readonly string[]).includes(meta.state) ||
      snapshot?.documentId !== documentId) return false;
  let previous = 0;
  for (const row of pending) {
    const tx = row?.tx;
    if (!row || row.documentId !== documentId || !Number.isSafeInteger(row.localSeq) ||
        row.localSeq <= previous || row.localSeq > meta.localSeq ||
        tx?.kind !== "REPLACE_DOCUMENT" || typeof tx.clientTransactionId !== "string" ||
        !validateDocument(tx.document).ok) return false;
    previous = row.localSeq;
  }
  const last = pending.at(-1);
  if (!last) return true;
  const newest = validateDocument(last.tx.document);
  return last.localSeq === meta.localSeq && newest.ok && stored !== null &&
    documentsEqual(newest.doc, stored);
}
