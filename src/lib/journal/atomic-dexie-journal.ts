/**
 * Atomic IndexedDB groundwork for Ductus F-3 (DAN-90).
 * Stores canonical snapshots, owed transactions, sequence and sync state in
 * ONE readwrite transaction. Local durability never means server SYNCED.
 *
 * The caller supplies a stable SHA-256 hex digest of the authenticated
 * principal (not an email, access token or other identifying raw value).
 * No editor, network, receipt verifier or recovery integration here: the
 * send bookkeeping (`beginSend`, `recordAnswer`) trusts only what
 * `outcomeToEvents` has already verified (`ackedRevision`).
 *
 * Contract for the auth flow (F-5); nothing here calls it yet:
 * - Sign-in, before anything reads or saves: construct the journal for the
 *   authenticated principal and call hasPendingLogout(). If true, an earlier
 *   logout was interrupted: call destroyForLogout() to finish it, then
 *   construct a NEW instance, which is an empty journal. No work is lost by
 *   this: the fence is only written when nothing is unsynced, and nothing
 *   can be saved behind it.
 * - Sign-out: call destroyForLogout() and end the session only once it has
 *   resolved. `unsynced_work` blocks the logout; `logout_blocked` and other
 *   failures leave the fence in place and the call may be repeated.
 * - Account switch: sign-out of the previous principal as above, then
 *   sign-in of the next one as above.
 * An instance is spent once a logout was started on it or its database was
 * deleted under it: every call then rejects with `logout_in_progress` (which
 * therefore also covers site data cleared or evicted under an open journal).
 * Not detectable here, so F-5 must coordinate tabs: an instance that never
 * opened the database creates it on first use, even right after a logout.
 */
import Dexie, { type DexieOptions, type Table } from "dexie";
import { validateDocument, type DocumentTransaction } from "../../domain/document";
import { commitRequestFromTransaction } from "../../domain/serverSync/contract";
import type {
  JournalContents, JournalSnapshot, PendingTransaction, SyncMeta,
} from "../../domain/sync/journal-types";
import {
  ackedRevision, awaitingReceiptFor, isDiverged, nextAwaitingReceipt,
  type AwaitingReceipt, type DrainOutcome,
} from "../../domain/sync/drain";
import { SYNC_STATES, type SyncState } from "../../domain/sync/states";

export type JournalErrorCode =
  | "invalid_input" | "incomplete_store" | "sticky_state"
  | "duplicate_transaction" | "sequence_exhausted" | "stale_local_sequence"
  | "unsynced_work" | "logout_in_progress" | "logout_blocked"
  | "not_queued" | "held_elsewhere" | "unconfirmed_sync";

export class JournalError extends Error {
  constructor(readonly code: JournalErrorCode) {
    super(`Journal operation rejected: ${code}`);
    this.name = "JournalError";
  }
}

export type LocalSaveResult = {
  localSeq: number;
  snapshot: JournalSnapshot;
  pending: PendingTransaction;
  meta: SyncMeta;
};

/** What `recordAnswer` left in the journal. */
export type AnswerResult = {
  meta: SyncMeta;
  /** Rows still owed after the answer, ascending by `localSeq`. */
  pending: PendingTransaction[];
  /** The verified revision the answer acknowledged, or null. */
  ackedRevision: number | null;
};

/** States an answer may record; EDITING and SAVING_LOCAL belong to the editor. */
const ANSWER_STATES: ReadonlySet<SyncState> = new Set<SyncState>([
  "LOCAL_DURABLE", "SYNCING", "SYNCED", "CONFLICT", "ERROR", "RECOVERY_REQUIRED",
]);

type JournalControl = { key: "logout"; state: "closing" };

class JournalDatabase extends Dexie {
  snapshots!: Table<JournalSnapshot, string>;
  pending!: Table<PendingTransaction, [string, number]>;
  meta!: Table<SyncMeta, string>;
  control!: Table<JournalControl, string>;
  /** Set once ANOTHER connection deletes this database (logout elsewhere). */
  deletedElsewhere = false;
  private everOpened = false;

  constructor(name: string, options?: DexieOptions) {
    super(name, options);
    // Dexie's default `versionchange` handler closes a stale connection but
    // leaves auto-open on, so the next write in that tab would silently
    // RE-CREATE the database another tab just deleted for logout: empty,
    // without the fence. For a deletion this handler closes with auto-open
    // disabled and returns false, which stops Dexie's default from running
    // (the newest subscriber runs first). An upgrade keeps the default.
    this.on("versionchange", (event) => {
      if ((event.newVersion ?? 0) > 0) return undefined; // newVersion is null on delete
      this.deletedElsewhere = true;
      this.close();
      return false;
    });
    // Dexie also closes a connection WITHOUT `versionchange` and with
    // auto-open left on: on a persisted `pagehide` (bfcache) and when the
    // browser closes the connection. If the database is deleted meanwhile,
    // the next call would re-create it. `populate` runs only inside the
    // transaction that creates the database, so an instance that has opened
    // it before aborts that transaction: nothing is created.
    this.on("ready", () => { this.everOpened = true; }, true);
    this.on("populate", () => {
      if (!this.everOpened) return;
      this.deletedElsewhere = true;
      throw new JournalError("logout_in_progress");
    });
    this.version(1).stores({
      snapshots: "documentId",
      pending: "[documentId+localSeq],documentId",
      meta: "documentId",
    });
    // Non-destructive upgrade: version 1 documents and their owed transactions
    // survive. A logout fence is durable until deletion completes.
    this.version(2).stores({ control: "key" });
  }
}

function validDocumentId(raw: unknown): raw is string {
  return typeof raw === "string" && raw.length > 0 &&
    raw.length <= 128 && raw.trim() !== "";
}

function validSeq(raw: unknown, min = 0): raw is number {
  return typeof raw === "number" && Number.isSafeInteger(raw) && raw >= min;
}

function validSent(documentId: string, sent: PendingTransaction): boolean {
  return sent?.documentId === documentId && validSeq(sent.localSeq, 1) &&
    typeof sent.tx?.clientTransactionId === "string" && sent.tx.clientTransactionId.trim() !== "";
}

function sameRow(a: PendingTransaction | AwaitingReceipt, sent: PendingTransaction): boolean {
  const txid = "tx" in a ? a.tx?.clientTransactionId : a.clientTransactionId;
  return a.documentId === sent.documentId && a.localSeq === sent.localSeq &&
    txid === sent.tx.clientTransactionId;
}

function sticky(state: SyncState | undefined): boolean {
  return state === "CONFLICT" || state === "RECOVERY_REQUIRED";
}

/**
 * The store holds a document consistently: meta and snapshot together, a
 * known state, and rows of this document within the sequence high-water mark.
 */
function assertConsistent(
  documentId: string, prior: SyncMeta | undefined, snapshot: JournalSnapshot | undefined,
  rows: readonly PendingTransaction[],
): void {
  if ((!prior && (snapshot || rows.length > 0)) ||
      (prior && (!snapshot ||
        !validSeq(prior.localSeq) ||
        !(SYNC_STATES as readonly string[]).includes(prior.state)))) {
    throw new JournalError("incomplete_store");
  }
  const high = prior?.localSeq ?? 0;
  if (rows.some((row) =>
    row.documentId !== documentId || !validSeq(row.localSeq, 1) ||
    row.localSeq > high || typeof row.tx?.clientTransactionId !== "string"
  )) {
    throw new JournalError("incomplete_store");
  }
}

function canonicalUtc(raw: unknown): raw is string {
  if (typeof raw !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(raw)) return false;
  const n = Date.parse(raw);
  return Number.isFinite(n) && new Date(n).toISOString() === raw;
}

function canonicalTx(documentId: string, input: DocumentTransaction): DocumentTransaction {
  try {
    const request = commitRequestFromTransaction(documentId, input);
    const checked = validateDocument(input?.document);
    if (!request || !checked.ok || !canonicalUtc(input.createdAt)) {
      throw new JournalError("invalid_input");
    }
    // Only persist fields known by the canonical transaction model.
    return {
      kind: "REPLACE_DOCUMENT",
      clientTransactionId: input.clientTransactionId,
      baseRevision: input.baseRevision,
      document: checked.doc,
      createdAt: input.createdAt,
    };
  } catch {
    throw new JournalError("invalid_input");
  }
}

export type JournalOptions = {
  /** How long a blocked deletion may stay blocked before `logout_blocked`. */
  logoutBlockedTimeoutMs?: number;
};

export class AtomicDexieJournal {
  private readonly db: JournalDatabase;
  private readonly blockedTimeoutMs: number;
  /** This instance's own logout: fence written, then database deleted. */
  private logout: "none" | "fenced" | "destroyed" = "none";
  /** The one fence-and-delete run in flight, shared by concurrent callers. */
  private deletion: Promise<void> | null = null;
  private deletionBlocked = false;
  private readonly blockedListeners = new Set<() => void>();

  /** Requires an opaque 64-character lower-case SHA-256 hex principal scope. */
  constructor(scopeHash: string, options?: DexieOptions, journalOptions?: JournalOptions) {
    if (!/^[a-f0-9]{64}$/.test(scopeHash)) throw new JournalError("invalid_input");
    this.db = new JournalDatabase(`ductus-journal-v1-${scopeHash}`, options);
    const timeout = journalOptions?.logoutBlockedTimeoutMs;
    this.blockedTimeoutMs =
      typeof timeout === "number" && Number.isFinite(timeout) && timeout >= 0 ? timeout : 3_000;
    this.db.on("blocked", () => {
      if (this.deletion) {
        this.deletionBlocked = true;
        for (const notify of this.blockedListeners) notify();
      }
    });
  }

  private loggedOut(): boolean {
    return this.logout !== "none" || this.db.deletedElsewhere;
  }

  /**
   * Runs a store operation. Once logout has started here or the database was
   * deleted under this instance, the instance is spent and fails closed. An
   * instance that has opened the database never re-creates it; one that has
   * not opened it yet cannot tell and creates it (see the contract above).
   */
  private async whileUsable<T>(operation: () => Promise<T>): Promise<T> {
    if (this.loggedOut()) throw new JournalError("logout_in_progress");
    try {
      return await operation();
    } catch (error) {
      throw this.failure(error, this.loggedOut());
    }
  }

  /**
   * A deletion can close the connection under a running call, and a refused
   * re-creation surfaces as Dexie's open failure: both mean `spent`.
   */
  private failure(error: unknown, spent: boolean): unknown {
    if (this.db.deletedElsewhere) this.db.close(); // no further auto-open
    return spent && !(error instanceof JournalError)
      ? new JournalError("logout_in_progress") : error;
  }

  /**
   * True when a logout fenced this principal's journal but its deletion has
   * not completed (crash, closed browser, blocked or failed deletion). Saving
   * is refused in that state; see the sign-in contract above. Opens the
   * journal, so call it only for the currently authenticated principal.
   */
  async hasPendingLogout(): Promise<boolean> {
    if (this.logout === "fenced") return true;
    return this.whileUsable(async () => (await this.db.control.get("logout")) !== undefined);
  }

  async read(documentId: string): Promise<JournalContents> {
    if (!validDocumentId(documentId)) throw new JournalError("invalid_input");
    return this.whileUsable(() =>
      this.db.transaction("r", this.db.snapshots, this.db.pending, this.db.meta, async () => {
        const [snapshot, pending, meta] = await Promise.all([
          this.db.snapshots.get(documentId),
          this.db.pending.where("documentId").equals(documentId).sortBy("localSeq"),
          this.db.meta.get(documentId),
        ]);
        return { snapshot: snapshot ?? null, pending, meta: meta ?? null };
      }));
  }

  /** No network, ACK, pending-row deletion, or silent conflict resolution. */
  async saveLocal(
    documentId: string, input: DocumentTransaction, savedAt: string, expectedLocalSeq: number,
  ): Promise<LocalSaveResult> {
    if (!validDocumentId(documentId) || !canonicalUtc(savedAt) || !validSeq(expectedLocalSeq)) {
      throw new JournalError("invalid_input");
    }
    const tx = canonicalTx(documentId, input);
    // IndexedDB serializes overlapping readwrite transactions over these
    // stores, including transactions from multiple tabs/instances.
    return this.whileUsable(() => this.db.transaction(
      "rw", this.db.snapshots, this.db.pending, this.db.meta, this.db.control,
      async () => {
        const [logoutFence, prior, snapshotBefore, rows] = await Promise.all([
          this.db.control.get("logout"),
          this.db.meta.get(documentId),
          this.db.snapshots.get(documentId),
          this.db.pending.where("documentId").equals(documentId).toArray(),
        ]);
        // The logout precondition is serialized with every local write over
        // this same object store. A stale tab cannot save between the
        // pre-delete check and deletion of the previous principal's journal.
        if (logoutFence) throw new JournalError("logout_in_progress");
        assertConsistent(documentId, prior, snapshotBefore, rows);
        if (sticky(prior?.state)) throw new JournalError("sticky_state");
        const high = prior?.localSeq ?? 0;
        // Cross-tab optimistic CAS: a stale tab must not overwrite a newer
        // local snapshot even though IndexedDB serializes the actual writes.
        if (expectedLocalSeq !== high) {
          throw new JournalError("stale_local_sequence");
        }
        if (rows.some((row) => row.tx.clientTransactionId === tx.clientTransactionId)) {
          throw new JournalError("duplicate_transaction");
        }
        if (high === Number.MAX_SAFE_INTEGER) {
          throw new JournalError("sequence_exhausted");
        }
        const localSeq = high + 1;
        // The base never moves back: the editor keeps the base it loaded,
        // while `recordAnswer` may have moved it onto this client's own ACK,
        // which the new candidate was written on top of.
        const snapshot: JournalSnapshot = {
          documentId, revision: Math.max(snapshotBefore?.revision ?? 0, tx.baseRevision),
          document: tx.document, savedAt,
        };
        const pending: PendingTransaction = {
          documentId, localSeq, tx, queuedAt: savedAt,
        };
        // A send in flight stays owed: the marker survives the save, or a
        // reload would send the new row on a base that may already be gone.
        const meta: SyncMeta = {
          documentId, localSeq, state: "LOCAL_DURABLE",
          ...(prior?.awaitingReceipt ? { awaitingReceipt: prior.awaitingReceipt } : {}),
        };

        // A failure in any later put MUST roll back every earlier put.
        await this.db.snapshots.put(snapshot);
        await this.db.pending.put(pending);
        await this.db.meta.put(meta);
        return { localSeq, snapshot, pending, meta };
      },
    ));
  }

  /**
   * Records that `sent` is about to leave, BEFORE the request does: the
   * marker (`awaitingReceiptFor`) and SYNCING in one transaction. A hold
   * already on `sent` is kept as it is; a hold on another row, or a diverged
   * one, refuses (`held_elsewhere`), since `planDrain` would never send it.
   */
  async beginSend(documentId: string, sent: PendingTransaction): Promise<SyncMeta> {
    if (!validDocumentId(documentId) || !validSent(documentId, sent)) {
      throw new JournalError("invalid_input");
    }
    return this.whileUsable(() => this.db.transaction(
      "rw", this.db.snapshots, this.db.pending, this.db.meta, this.db.control,
      async () => {
        const { prior, rows } = await this.readForAnswer(documentId);
        if (sticky(prior.state)) throw new JournalError("sticky_state");
        if (!rows.some((row) => sameRow(row, sent))) throw new JournalError("not_queued");
        const held = prior.awaitingReceipt;
        if (held && (isDiverged(held) || !sameRow(held, sent))) {
          throw new JournalError("held_elsewhere");
        }
        const meta: SyncMeta = {
          ...prior, state: "SYNCING", awaitingReceipt: held ?? awaitingReceiptFor(sent),
        };
        await this.db.meta.put(meta);
        return meta;
      },
    ));
  }

  /**
   * Records the server's answer to `sent`. Call `outcomeToEvents` first: only
   * an outcome it verified has an `ackedRevision`, and one it found settled
   * changes nothing here (`nextAwaitingReceipt`).
   *
   * Rows up to `sent.localSeq` are deleted only when the answer is a verified
   * receipt for `sent`, `sent` is still queued and the hold is released; the
   * snapshot's base revision then moves forward, never back. `state` (null
   * keeps the stored one) may be SYNCED only when that deletion happened and
   * left the queue empty (`unconfirmed_sync`), in the same transaction.
   * A CONFLICT or RECOVERY_REQUIRED stays until a recovery decision.
   */
  async recordAnswer(
    documentId: string, sent: PendingTransaction, outcome: DrainOutcome, state: SyncState | null,
  ): Promise<AnswerResult> {
    if (!validDocumentId(documentId) || !validSent(documentId, sent) ||
        (state !== null && !ANSWER_STATES.has(state))) {
      throw new JournalError("invalid_input");
    }
    return this.whileUsable(() => this.db.transaction(
      "rw", this.db.snapshots, this.db.pending, this.db.meta, this.db.control,
      async () => {
        const { prior, snapshot, rows } = await this.readForAnswer(documentId);
        if (sticky(prior.state) && state !== null && state !== prior.state) {
          throw new JournalError("sticky_state");
        }
        const after = nextAwaitingReceipt(sent, outcome, prior.awaitingReceipt ?? null);
        const acked = ackedRevision(outcome);
        const settles = acked !== null && after === null && rows.some((row) => sameRow(row, sent));
        const remaining = settles ? rows.filter((row) => row.localSeq > sent.localSeq) : rows;
        if (state === "SYNCED" && (!settles || remaining.length > 0)) {
          throw new JournalError("unconfirmed_sync");
        }
        const meta: SyncMeta = { ...prior, state: state ?? prior.state };
        if (after) meta.awaitingReceipt = after;
        else delete meta.awaitingReceipt;
        if (settles) {
          await this.db.pending.bulkDelete(
            rows.filter((row) => row.localSeq <= sent.localSeq)
              .map((row): [string, number] => [documentId, row.localSeq]),
          );
          if (acked > snapshot.revision) await this.db.snapshots.put({ ...snapshot, revision: acked });
        }
        await this.db.meta.put(meta);
        return { meta, pending: remaining, ackedRevision: settles ? acked : null };
      },
    ));
  }

  /** Fence and consistency checks shared by the send bookkeeping. */
  private async readForAnswer(documentId: string): Promise<{
    prior: SyncMeta; snapshot: JournalSnapshot; rows: PendingTransaction[];
  }> {
    const [logoutFence, prior, snapshot, rows] = await Promise.all([
      this.db.control.get("logout"),
      this.db.meta.get(documentId),
      this.db.snapshots.get(documentId),
      this.db.pending.where("documentId").equals(documentId).sortBy("localSeq"),
    ]);
    if (logoutFence) throw new JournalError("logout_in_progress");
    assertConsistent(documentId, prior, snapshot, rows);
    if (!prior || !snapshot) throw new JournalError("not_queued");
    return { prior, snapshot, rows };
  }

  close(): void {
    this.db.close();
  }

  /**
   * Refuse destructive logout whenever this scope holds work not proven SYNCED.
   * F-5 still must coordinate across tabs and only invoke deletion after a
   * verified signed receipt and explicit user flow; this check alone is not
   * a cross-tab session lock or a server-ACK implementation.
   */
  async destroyForLogout(): Promise<void> {
    if (this.logout === "destroyed") return;
    // Another tab owns that logout; re-opening here would re-create the store.
    if (this.db.deletedElsewhere) throw new JournalError("logout_in_progress");
    // Concurrent calls, and calls made while a deletion is still queued in the
    // browser, join the run in flight instead of starting a second one.
    if (!this.deletion) {
      const run = this.fenceAndDelete();
      const done = () => {
        if (this.deletion === run) { this.deletion = null; this.deletionBlocked = false; }
      };
      run.then(done, done);
      this.deletion = run;
    }
    try {
      return await this.settleDeletion(this.deletion);
    } catch (error) {
      throw this.failure(error, this.db.deletedElsewhere);
    }
  }

  private async fenceAndDelete(): Promise<void> {
    // Dexie closes the connection before deleting, so a retry after a failed
    // deletion starts from a closed connection and must open it again.
    if (this.logout === "fenced" && !this.db.isOpen()) await this.db.open();
    // One readwrite transaction checks pending work and permanently fences
    // concurrent writers BEFORE async database deletion. If deletion fails,
    // the fence remains and retrying this operation is safe, on this instance
    // or a new one.
    await this.db.transaction(
      "rw", this.db.pending, this.db.snapshots, this.db.meta, this.db.control,
      async () => {
        const [pending, snapshots, metas] = await Promise.all([
          this.db.pending.count(), this.db.snapshots.toArray(), this.db.meta.toArray(),
        ]);
        const states = new Map(metas.map((meta) => [meta.documentId, meta.state]));
        const snapshotIds = new Set(snapshots.map((snapshot) => snapshot.documentId));
        if (pending !== 0 ||
            snapshots.some((snapshot) => states.get(snapshot.documentId) !== "SYNCED") ||
            metas.some((meta) => meta.state !== "SYNCED" || !snapshotIds.has(meta.documentId))) {
          throw new JournalError("unsynced_work");
        }
        await this.db.control.put({ key: "logout", state: "closing" });
      },
    );
    this.logout = "fenced";
    await this.db.delete();
    this.logout = "destroyed";
  }

  /**
   * Waits for the deletion, but not forever: if another connection ignores
   * `versionchange` (a suspended tab, another module) the browser reports the
   * request as blocked and never settles it. After the grace period this
   * rejects with `logout_blocked`. The fence stays, the request stays queued
   * and completes when the blocker goes away; calling again re-attaches.
   */
  private async settleDeletion(deletion: Promise<void>): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      timer ??= setTimeout(() => rejectBlocked(new JournalError("logout_blocked")), this.blockedTimeoutMs);
    };
    let rejectBlocked!: (error: JournalError) => void;
    const blocked = new Promise<never>((_, reject) => { rejectBlocked = reject; });
    // Every concurrent caller waits with its own timer.
    this.blockedListeners.add(arm);
    if (this.deletionBlocked) arm();
    try {
      await Promise.race([deletion, blocked]);
    } finally {
      clearTimeout(timer);
      this.blockedListeners.delete(arm);
    }
  }
}
