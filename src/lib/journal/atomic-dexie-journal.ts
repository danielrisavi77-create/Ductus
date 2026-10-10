/**
 * Atomic IndexedDB groundwork for Ductus F-3 (DAN-90).
 * Stores canonical snapshots, owed transactions, sequence and sync state in
 * ONE readwrite transaction. Local durability never means server SYNCED.
 *
 * The caller supplies a stable SHA-256 hex digest of the authenticated
 * principal (not an email, access token or other identifying raw value).
 * The auth flow MUST call destroyForLogout on sign-out/account switch.
 * No editor, network, receipt verifier or recovery integration here.
 */
import Dexie, { type DexieOptions, type Table } from "dexie";
import { validateDocument, type DocumentTransaction } from "../../domain/document";
import { commitRequestFromTransaction } from "../../domain/serverSync/contract";
import type {
  JournalContents, JournalSnapshot, PendingTransaction, SyncMeta,
} from "../../domain/sync/journal-types";
import { SYNC_STATES } from "../../domain/sync/states";

export type JournalErrorCode =
  | "invalid_input" | "incomplete_store" | "sticky_state"
  | "duplicate_transaction" | "sequence_exhausted" | "stale_local_sequence"
  | "unsynced_work" | "logout_in_progress" | "logout_blocked";

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

type JournalControl = { key: "logout"; state: "closing" };

class JournalDatabase extends Dexie {
  snapshots!: Table<JournalSnapshot, string>;
  pending!: Table<PendingTransaction, [string, number]>;
  meta!: Table<SyncMeta, string>;
  control!: Table<JournalControl, string>;
  /** Set once ANOTHER connection deletes this database (logout elsewhere). */
  deletedElsewhere = false;

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
  private deletion: Promise<void> | null = null;
  private deletionBlocked = false;
  private onDeletionBlocked: (() => void) | null = null;

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
        this.onDeletionBlocked?.();
      }
    });
  }

  private loggedOut(): boolean {
    return this.logout !== "none" || this.db.deletedElsewhere;
  }

  /**
   * Runs a store operation. Once logout has started here or the database was
   * deleted by another tab, this instance is finished: it fails closed and
   * never re-creates the database.
   */
  private async whileUsable<T>(operation: () => Promise<T>): Promise<T> {
    if (this.loggedOut()) throw new JournalError("logout_in_progress");
    try {
      return await operation();
    } catch (error) {
      // The connection can be closed under a running call by a deletion.
      if (!(error instanceof JournalError) && this.loggedOut()) {
        throw new JournalError("logout_in_progress");
      }
      throw error;
    }
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
        if ((!prior && (snapshotBefore || rows.length > 0)) ||
            (prior && (!snapshotBefore ||
              !validSeq(prior.localSeq) ||
              !(SYNC_STATES as readonly string[]).includes(prior.state)))) {
          throw new JournalError("incomplete_store");
        }
        if (prior?.state === "CONFLICT" || prior?.state === "RECOVERY_REQUIRED") {
          throw new JournalError("sticky_state");
        }
        const high = prior?.localSeq ?? 0;
        // Cross-tab optimistic CAS: a stale tab must not overwrite a newer
        // local snapshot even though IndexedDB serializes the actual writes.
        if (expectedLocalSeq !== high) {
          throw new JournalError("stale_local_sequence");
        }
        if (rows.some((row) =>
          row.documentId !== documentId || !validSeq(row.localSeq, 1) ||
          row.localSeq > high || typeof row.tx?.clientTransactionId !== "string"
        )) {
          throw new JournalError("incomplete_store");
        }
        if (rows.some((row) => row.tx.clientTransactionId === tx.clientTransactionId)) {
          throw new JournalError("duplicate_transaction");
        }
        if (high === Number.MAX_SAFE_INTEGER) {
          throw new JournalError("sequence_exhausted");
        }
        const localSeq = high + 1;
        const snapshot: JournalSnapshot = {
          documentId, revision: tx.baseRevision, document: tx.document, savedAt,
        };
        const pending: PendingTransaction = {
          documentId, localSeq, tx, queuedAt: savedAt,
        };
        const meta: SyncMeta = { documentId, localSeq, state: "LOCAL_DURABLE" };

        // A failure in any later put MUST roll back every earlier put.
        await this.db.snapshots.put(snapshot);
        await this.db.pending.put(pending);
        await this.db.meta.put(meta);
        return { localSeq, snapshot, pending, meta };
      },
    ));
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
    // A deletion that was reported blocked is still queued in the browser.
    if (this.deletion) return this.settleDeletion(this.deletion);
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
    this.deletionBlocked = false;
    const deletion = Promise.resolve(this.db.delete()).then(
      () => { this.logout = "destroyed"; this.deletion = null; },
      (error: unknown) => { this.deletion = null; throw error; },
    );
    deletion.catch(() => {}); // Observed through settleDeletion below.
    this.deletion = deletion;
    return this.settleDeletion(deletion);
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
    const blocked = new Promise<never>((_, reject) => {
      const arm = () => {
        timer ??= setTimeout(
          () => reject(new JournalError("logout_blocked")), this.blockedTimeoutMs,
        );
      };
      this.onDeletionBlocked = arm;
      if (this.deletionBlocked) arm();
    });
    try {
      await Promise.race([deletion, blocked]);
    } finally {
      clearTimeout(timer);
      this.onDeletionBlocked = null;
    }
  }
}
