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
import { validateDocument, type CanonicalDocument, type DocumentTransaction } from "../../domain/document";
import { verifyDocumentSnapshot } from "../../domain/document/snapshot";
import { verifyCanonicalEvidencePayloadV2 } from "../../domain/forensics/evidence-chain-v2";
import { commitRequestFromTransaction } from "../../domain/serverSync/contract";
import type {
  EvidenceOpening, EvidenceSegmentInput, EvidenceSegmentTransaction, EvidenceStop, EvidenceTiming,
  JournalContents, JournalSnapshot, PendingTransaction, QueuedTransaction, SalvageCopy, SyncMeta,
} from "../../domain/sync/journal-types";
import {
  ackedRevision, adoptDiscardsNewerRows, awaitingReceiptFor, isDiverged, nextAwaitingReceipt,
  type AwaitingReceipt, type DrainOutcome, type QueuedRow,
} from "../../domain/sync/drain";
import { SYNC_STATES, syncReducer, type SyncState } from "../../domain/sync/states";

export type JournalErrorCode =
  | "invalid_input" | "incomplete_store" | "sticky_state"
  | "duplicate_transaction" | "sequence_exhausted" | "stale_local_sequence"
  | "unsynced_work" | "logout_in_progress" | "logout_blocked"
  | "not_queued" | "held_elsewhere" | "unconfirmed_sync"
  | "queue_not_empty" | "chain_broken" | "mixed_queue" | "evidence_stopped"
  | "not_in_recovery" | "confirmation_required";

export class JournalError extends Error {
  constructor(readonly code: JournalErrorCode) {
    super(`Journal operation rejected: ${code}`);
    this.name = "JournalError";
  }
}

export type LocalSaveResult<T extends QueuedTransaction = DocumentTransaction> = {
  localSeq: number;
  snapshot: JournalSnapshot;
  pending: PendingTransaction<T>;
  meta: SyncMeta;
};

/** What `recordAnswer` left in the journal. */
export type AnswerResult<T extends QueuedTransaction = DocumentTransaction> = {
  meta: SyncMeta;
  /** Rows still owed after the answer, ascending by `localSeq`. */
  pending: PendingTransaction<T>[];
  /** The verified revision the answer acknowledged, or null. */
  ackedRevision: number | null;
};

/** States an answer may record; EDITING and SAVING_LOCAL belong to the editor. */
const ANSWER_STATES: ReadonlySet<SyncState> = new Set<SyncState>([
  "LOCAL_DURABLE", "SYNCING", "SYNCED", "CONFLICT", "ERROR", "RECOVERY_REQUIRED",
]);
/** Answers in which the server read the row and refused it for good. */
const FINAL_REFUSALS: ReadonlySet<unknown> = new Set([
  "too_large", "not_found", "invalid_document", "invalid_client_transaction_id",
]);

type JournalControl = { key: "logout"; state: "closing" };

class JournalDatabase extends Dexie {
  snapshots!: Table<JournalSnapshot, string>;
  pending!: Table<QueuedRow, [string, number]>;
  meta!: Table<SyncMeta, string>;
  control!: Table<JournalControl, string>;
  timings!: Table<EvidenceTiming, string>;
  salvage!: Table<Omit<SalvageCopy, "id"> & { id?: number }, number>;
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
    // F-8 3d-2a: the time of each step, local only, deleted with the database.
    this.version(3).stores({ timings: "segmentHash,documentId" });
    // F-8 3d-2b: local text kept when the author took the server's version.
    this.version(4).stores({ salvage: "++id,documentId" });
  }
}

function validDocumentId(raw: unknown): raw is string {
  return typeof raw === "string" && raw.length > 0 &&
    raw.length <= 128 && raw.trim() !== "";
}

function validSeq(raw: unknown, min = 0): raw is number {
  return typeof raw === "number" && Number.isSafeInteger(raw) && raw >= min;
}

function validSent(documentId: string, sent: QueuedRow): boolean {
  return sent?.documentId === documentId && validSeq(sent.localSeq, 1) &&
    typeof sent.tx?.clientTransactionId === "string" && sent.tx.clientTransactionId.trim() !== "";
}

function sameRow(a: QueuedRow | AwaitingReceipt, sent: QueuedRow): boolean {
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
  rows: readonly QueuedRow[],
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

const SHA256_HEX = /^[0-9a-f]{64}$/;
const isSegmentRow = (row: QueuedRow) => row.tx?.kind === "EVIDENCE_SEGMENT";

/** A segment row as verified before the write; the write adds the base. */
type VerifiedSegment = {
  tx: Omit<EvidenceSegmentTransaction, "baseRevision">;
  predecessor: string | null;
  document: CanonicalDocument;
  timing: EvidenceTiming;
};

/**
 * Verifies a recorder segment against its own bytes, BEFORE any transaction:
 * awaiting Web Crypto inside a Dexie transaction would end it (I6). The bytes
 * are copied first, so what is checked is what is stored and sent.
 */
async function verifySegment(
  documentId: string, input: EvidenceSegmentInput, savedAt: string,
): Promise<VerifiedSegment> {
  if (!(input?.bytes instanceof Uint8Array) || !(input.document instanceof Uint8Array)) {
    throw new JournalError("invalid_input");
  }
  const segmentBytes = new Uint8Array(input.bytes);
  const documentBytes = new Uint8Array(input.document);
  const [payload, snapshot] = await Promise.all([
    verifyCanonicalEvidencePayloadV2(segmentBytes), verifyDocumentSnapshot(documentBytes),
  ]);
  if (!payload.ok || !snapshot.ok || payload.sha256 !== input.sha256 ||
      payload.segment.documentId !== documentId ||
      payload.segment.finalDocumentHash !== snapshot.sha256) {
    throw new JournalError("invalid_input");
  }
  const { sequenceFrom, sequenceTo, events, predecessorSegmentHash } = payload.segment;
  const timing = input.timing;
  if (timing?.segmentHash !== payload.sha256 || timing.sequenceFrom !== sequenceFrom ||
      !Array.isArray(timing.events) || timing.events.length !== events.length) {
    throw new JournalError("invalid_input");
  }
  const timed = timing.events.map((event, index) => {
    const offsets = event?.stepOffsetsMs;
    if (event?.sequence !== sequenceFrom + index || !Array.isArray(offsets) ||
        offsets.length !== events[index]!.steps.length ||
        !offsets.every((ms) => Number.isSafeInteger(ms))) {
      throw new JournalError("invalid_input");
    }
    return { sequence: event.sequence, stepOffsetsMs: [...offsets] };
  });
  return {
    tx: {
      kind: "EVIDENCE_SEGMENT",
      // Derived from the bytes: a replay of this segment is the same key.
      clientTransactionId: `seg-${payload.sha256}`,
      segment: segmentBytes, segmentHash: payload.sha256, document: documentBytes,
      sequenceFrom, sequenceTo, createdAt: savedAt,
    },
    predecessor: predecessorSegmentHash,
    document: snapshot.document,
    timing: { segmentHash: payload.sha256, documentId, sequenceFrom, events: timed },
  };
}

/**
 * The open route's answer for `documentId`, its snapshot verified as exact JCS
 * of a valid document with `documentHash`, before any transaction.
 */
async function verifyOpening(documentId: string, opened: EvidenceOpening): Promise<CanonicalDocument> {
  const head = opened?.headSegmentHash;
  if (opened?.documentId !== documentId || !validSeq(opened.currentRevision) ||
      !validSeq(opened.lastSequenceTo) ||
      !(head === null || (typeof head === "string" && SHA256_HEX.test(head))) ||
      !(opened.document instanceof Uint8Array)) {
    throw new JournalError("invalid_input");
  }
  const verified = await verifyDocumentSnapshot(new Uint8Array(opened.document));
  if (!verified.ok || verified.sha256 !== opened.documentHash) throw new JournalError("invalid_input");
  return verified.document;
}

/** Nothing on this document is owed to, or missing from, the server. */
function settledForLogout(meta: SyncMeta): boolean {
  if (meta.evidenceStopped !== undefined) return false;
  // A document opened from the server and never saved over holds only the
  // server's own text (`startEvidence`), so nothing local would be lost.
  return meta.state === "SYNCED" || (meta.localSeq === 0 && meta.evidenceHead !== undefined);
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

  /**
   * The rows are typed as replacements, which every document without evidence
   * holds. A document with evidence holds segments only: read it with
   * `readEvidence`, or as `DrainJournal` does, over rows of either kind.
   */
  async read(documentId: string): Promise<JournalContents> {
    return this.readAny(documentId) as Promise<JournalContents>;
  }

  /** `read` for a document with evidence; rows of another kind are `mixed_queue`. */
  async readEvidence(documentId: string): Promise<JournalContents<EvidenceSegmentTransaction>> {
    const contents = await this.readAny(documentId);
    if (contents.pending.some((row) => !isSegmentRow(row))) throw new JournalError("mixed_queue");
    return contents as JournalContents<EvidenceSegmentTransaction>;
  }

  private async readAny(documentId: string): Promise<JournalContents<QueuedTransaction>> {
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
        const { prior, snapshotBefore, localSeq } =
          await this.readForWrite(documentId, expectedLocalSeq, tx.clientTransactionId, false);
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
   * The checks every local write shares, in one order: logout fence, a
   * consistent store, no sticky state, the cross-tab sequence CAS, no reused
   * key, a sequence left. A document has one kind of row (F-8 3d-2a): a
   * document with evidence takes segments only, any other one `saveLocal`.
   */
  private async readForWrite(
    documentId: string, expectedLocalSeq: number, clientTransactionId: string | null, evidence: boolean,
  ): Promise<{
    prior: SyncMeta | undefined; snapshotBefore: JournalSnapshot | undefined;
    rows: QueuedRow[]; localSeq: number;
  }> {
    const [logoutFence, prior, snapshotBefore, rows] = await Promise.all([
      this.db.control.get("logout"),
      this.db.meta.get(documentId),
      this.db.snapshots.get(documentId),
      this.db.pending.where("documentId").equals(documentId).sortBy("localSeq"),
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
    if (rows.some((row) => row.tx.clientTransactionId === clientTransactionId)) {
      throw new JournalError("duplicate_transaction");
    }
    if (high === Number.MAX_SAFE_INTEGER) {
      throw new JournalError("sequence_exhausted");
    }
    if ((prior?.evidenceHead !== undefined) !== evidence || rows.some((row) => isSegmentRow(row) !== evidence)) {
      throw new JournalError("mixed_queue");
    }
    return { prior, snapshotBefore, rows, localSeq: high + 1 };
  }

  /**
   * F-8 3d-2a: makes `documentId` a document with evidence, from the open
   * route's answer: the snapshot is the server's bytes (verified as exact JCS
   * of a valid document with `documentHash`), its revision the server's, and
   * the chain head the server's. Only while nothing is owed: with a queue the
   * local chain is the only way on (`queue_not_empty`), and after the recorder
   * stopped the device holds text the server lacks (`evidence_stopped`).
   */
  async startEvidence(documentId: string, opened: EvidenceOpening, openedAt: string): Promise<SyncMeta> {
    if (!validDocumentId(documentId) || !canonicalUtc(openedAt)) throw new JournalError("invalid_input");
    const document = await verifyOpening(documentId, opened);
    const head = opened.headSegmentHash;
    return this.whileUsable(() => this.db.transaction(
      "rw", this.db.snapshots, this.db.pending, this.db.meta, this.db.control,
      async () => {
        const [logoutFence, prior, snapshotBefore, rows] = await Promise.all([
          this.db.control.get("logout"),
          this.db.meta.get(documentId),
          this.db.snapshots.get(documentId),
          this.db.pending.where("documentId").equals(documentId).toArray(),
        ]);
        if (logoutFence) throw new JournalError("logout_in_progress");
        assertConsistent(documentId, prior, snapshotBefore, rows);
        if (sticky(prior?.state)) throw new JournalError("sticky_state");
        if (prior?.evidenceStopped !== undefined) throw new JournalError("evidence_stopped");
        if (rows.length > 0) throw new JournalError("queue_not_empty");
        // An answer the server gave before this device's last receipt, read
        // late (a stale tab), never moves the revision or the head back.
        if (opened.currentRevision < (snapshotBefore?.revision ?? 0) ||
            opened.lastSequenceTo < (prior?.evidenceHead?.lastSequenceTo ?? 0)) {
          throw new JournalError("invalid_input");
        }
        const meta: SyncMeta = {
          ...(prior ?? { documentId, localSeq: 0, state: "LOCAL_DURABLE" }),
          evidenceHead: { segmentHash: head, lastSequenceTo: opened.lastSequenceTo },
        };
        await this.db.snapshots.put({ documentId, revision: opened.currentRevision, document, savedAt: openedAt });
        await this.db.meta.put(meta);
        return meta;
      },
    ));
  }

  /**
   * F-8 3d-2a: queues one recorder segment and makes the document after it
   * the snapshot, in ONE transaction with the sequence, the state and the
   * timing record (I6): no snapshot without its segment, and no segment
   * without its snapshot. The segment must continue the chain (I1): the last
   * queued row, or the head when nothing is queued. Every hash is taken before
   * the transaction; inside it only comparisons remain. The key is derived
   * from the segment's hash and the base is the snapshot's revision; the drain
   * fast-forwards it onto this client's own receipts.
   */
  async saveSegment(
    documentId: string, input: EvidenceSegmentInput, savedAt: string, expectedLocalSeq: number,
  ): Promise<LocalSaveResult<EvidenceSegmentTransaction>> {
    if (!validDocumentId(documentId) || !canonicalUtc(savedAt) || !validSeq(expectedLocalSeq)) {
      throw new JournalError("invalid_input");
    }
    const verified = await verifySegment(documentId, input, savedAt);
    return this.whileUsable(() => this.db.transaction(
      "rw", [this.db.snapshots, this.db.pending, this.db.meta, this.db.control, this.db.timings],
      async () => {
        const { prior, snapshotBefore, rows, localSeq } =
          await this.readForWrite(documentId, expectedLocalSeq, verified.tx.clientTransactionId, true);
        if (prior!.evidenceStopped !== undefined) throw new JournalError("evidence_stopped");
        const last = rows.at(-1)?.tx as EvidenceSegmentTransaction | undefined;
        const head = last
          ? { segmentHash: last.segmentHash, lastSequenceTo: last.sequenceTo }
          : prior!.evidenceHead!;
        if (verified.tx.sequenceFrom !== head.lastSequenceTo + 1 || verified.predecessor !== head.segmentHash) {
          throw new JournalError("chain_broken");
        }
        const tx: EvidenceSegmentTransaction = { ...verified.tx, baseRevision: snapshotBefore!.revision };
        const snapshot: JournalSnapshot = {
          documentId, revision: snapshotBefore!.revision, document: verified.document, savedAt,
        };
        const pending: PendingTransaction<EvidenceSegmentTransaction> = {
          documentId, localSeq, tx, queuedAt: savedAt,
        };
        const meta: SyncMeta = { ...prior!, localSeq, state: "LOCAL_DURABLE" };
        delete meta.lastError;
        await this.db.pending.put(pending);
        await this.db.snapshots.put(snapshot);
        await this.db.timings.put(verified.timing);
        await this.db.meta.put(meta);
        return { localSeq, snapshot, pending, meta };
      },
    ));
  }

  /**
   * F-8 3d-2a: the recorder stopped (`CaptureError`), so the author's text is
   * saved without evidence: the snapshot moves, no row is queued, and the
   * document is marked `evidenceStopped` for good (I2). Rows queued before the
   * stop still drain; the document is never SYNCED again and blocks logout.
   */
  async saveUncovered(
    documentId: string, document: CanonicalDocument, reason: EvidenceStop,
    savedAt: string, expectedLocalSeq: number,
  ): Promise<SyncMeta> {
    const checked = validateDocument(document);
    if (!validDocumentId(documentId) || !canonicalUtc(savedAt) || !validSeq(expectedLocalSeq) ||
        !checked.ok || !["gap", "unsupported_step", "block_identity", "too_large"].includes(reason)) {
      throw new JournalError("invalid_input");
    }
    return this.whileUsable(() => this.db.transaction(
      "rw", this.db.snapshots, this.db.pending, this.db.meta, this.db.control,
      async () => {
        const { prior, snapshotBefore, localSeq } =
          await this.readForWrite(documentId, expectedLocalSeq, null, true);
        const meta: SyncMeta = {
          ...prior!, localSeq, state: "LOCAL_DURABLE",
          evidenceStopped: prior!.evidenceStopped ?? reason,
        };
        delete meta.lastError;
        await this.db.snapshots.put({ ...snapshotBefore!, document: checked.doc, savedAt });
        await this.db.meta.put(meta);
        return meta;
      },
    ));
  }

  /**
   * Records that `sent` is about to leave, BEFORE the request does: the
   * marker (`awaitingReceiptFor`) and SYNCING in one transaction. A hold
   * already on `sent` is kept as it is; a hold on another row, or a diverged
   * one, refuses (`held_elsewhere`), since `planDrain` would never send it.
   */
  async beginSend(documentId: string, sent: QueuedRow): Promise<SyncMeta> {
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
  async recordAnswer<T extends QueuedTransaction = DocumentTransaction>(
    documentId: string, sent: PendingTransaction<T>, outcome: DrainOutcome, state: SyncState | null,
  ): Promise<AnswerResult<T>> {
    if (!validDocumentId(documentId) || !validSent(documentId, sent) ||
        (state !== null && !ANSWER_STATES.has(state))) {
      throw new JournalError("invalid_input");
    }
    return this.whileUsable(() => this.db.transaction(
      "rw", this.db.snapshots, this.db.pending, this.db.meta, this.db.control,
      async () => {
        const { prior, snapshot, rows } = await this.readForAnswer(documentId);
        const stored = rows.find((row) => sameRow(row, sent));
        // With evidence a row leaves only with its receipt or with the take of
        // the server's version: an answer for it, from any tab, is late.
        if (prior.evidenceHead !== undefined && stored === undefined) {
          return { meta: prior, pending: rows as PendingTransaction<T>[], ackedRevision: null };
        }
        if (sticky(prior.state) && state !== null && state !== prior.state) {
          throw new JournalError("sticky_state");
        }
        const after = nextAwaitingReceipt(sent, outcome, prior.awaitingReceipt ?? null);
        const acked = ackedRevision(outcome);
        const settles = acked !== null && after === null && stored !== undefined;
        const remaining = settles ? rows.filter((row) => row.localSeq > sent.localSeq) : rows;
        if (state === "SYNCED" && (!settles || remaining.length > 0)) {
          throw new JournalError("unconfirmed_sync");
        }
        // After the recorder stopped, the text on the device is not covered by
        // evidence on the server (I5): it stays saved on the device.
        const recorded = state === "SYNCED" && prior.evidenceStopped !== undefined ? "LOCAL_DURABLE" : state;
        const meta: SyncMeta = { ...prior, state: recorded ?? prior.state };
        if (after) meta.awaitingReceipt = after;
        else delete meta.awaitingReceipt;
        if (prior.evidenceHead !== undefined && meta.state === "CONFLICT" && outcome?.status === "stale_base") {
          meta.conflictRevision = Math.max(prior.conflictRevision ?? 0, outcome.currentRevision);
        }
        delete meta.refusedLocalSeq;
        if (prior.evidenceHead !== undefined && meta.state === "ERROR" && !after &&
            FINAL_REFUSALS.has(outcome?.status)) {
          meta.refusedLocalSeq = sent.localSeq;
        }
        // The head moves only with the verified receipt of the stored row, in
        // the transaction that deletes it.
        if (settles && stored.tx.kind === "EVIDENCE_SEGMENT") {
          meta.evidenceHead = { segmentHash: stored.tx.segmentHash, lastSequenceTo: stored.tx.sequenceTo };
        }
        if (settles) {
          await this.db.pending.bulkDelete(
            rows.filter((row) => row.localSeq <= sent.localSeq)
              .map((row): [string, number] => [documentId, row.localSeq]),
          );
          if (acked > snapshot.revision) await this.db.snapshots.put({ ...snapshot, revision: acked });
        }
        await this.db.meta.put(meta);
        return { meta, pending: remaining as PendingTransaction<T>[], ackedRevision: settles ? acked : null };
      },
    ));
  }

  /** Fence and consistency checks shared by the send bookkeeping. */
  private async readForAnswer(documentId: string): Promise<{
    prior: SyncMeta; snapshot: JournalSnapshot; rows: QueuedRow[];
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

  /**
   * F-8 3d-2b: the one way out for a document with evidence that is in
   * CONFLICT or RECOVERY_REQUIRED, or whose recorder stopped once every
   * queued row has drained or was refused (ERROR). In CONFLICT the server's
   * version must reach the revision the refusal named. Its local text cannot be committed on top of the
   * server's version (there is no evidence for it there), so the author takes
   * the server's version and the local text is kept as a copy until the
   * author lets it go (owner decision #476 c.6385940910). In ONE transaction:
   * the copy, every row of the document dropped, the snapshot, revision and
   * head of the server, no hold, no stop, a new `localSeq` (a stale tab's
   * write fails) and the state the decision reaches (`states.ts`).
   * `confirmed` must be true whenever a row other than the held one is
   * dropped (#166), and for a stopped document, whose text is replaced.
   */
  async adoptServerEvidence(
    documentId: string, opened: EvidenceOpening, confirmed: boolean, decidedAt: string, expectedLocalSeq: number,
  ): Promise<SyncMeta> {
    if (!validDocumentId(documentId) || !canonicalUtc(decidedAt) || !validSeq(expectedLocalSeq)) {
      throw new JournalError("invalid_input");
    }
    const server = await verifyOpening(documentId, opened);
    return this.whileUsable(() => this.db.transaction(
      "rw", [this.db.snapshots, this.db.pending, this.db.meta, this.db.control, this.db.salvage],
      async () => {
        const { prior, snapshot, rows } = await this.readForAnswer(documentId);
        if (prior.evidenceHead === undefined || rows.some((row) => !isSegmentRow(row))) {
          throw new JournalError("mixed_queue");
        }
        // A stopped document owes nothing, or the server refused its oldest
        // owed row for good and nothing is held.
        const refused = prior.state === "ERROR" && prior.awaitingReceipt === undefined &&
          prior.refusedLocalSeq !== undefined && prior.refusedLocalSeq === rows[0]?.localSeq;
        const stopped = prior.evidenceStopped !== undefined && (rows.length === 0 || refused);
        if (!sticky(prior.state) && !stopped) throw new JournalError("not_in_recovery");
        if (expectedLocalSeq !== prior.localSeq) throw new JournalError("stale_local_sequence");
        if (prior.localSeq === Number.MAX_SAFE_INTEGER) throw new JournalError("sequence_exhausted");
        if (opened.currentRevision < Math.max(snapshot.revision, prior.conflictRevision ?? 0) ||
            opened.lastSequenceTo < prior.evidenceHead.lastSequenceTo) {
          throw new JournalError("invalid_input");
        }
        const held = prior.awaitingReceipt ?? null;
        if (confirmed !== true && (stopped || adoptDiscardsNewerRows(rows, documentId, held))) {
          throw new JournalError("confirmation_required");
        }
        const reached = prior.state === "CONFLICT"
          ? syncReducer(prior.state, { type: "CONFLICT_RESOLVED", via: "discard" })
          : prior.state === "RECOVERY_REQUIRED"
            ? syncReducer(prior.state, { type: "RECOVERED", via: "adopt-server" })
            // Every row was acknowledged with a verified receipt; what is left
            // is the server's version.
            : "SYNCED";
        await this.db.salvage.add({
          documentId, document: snapshot.document,
          cause: sticky(prior.state) ? prior.state as SalvageCopy["cause"] : "EVIDENCE_STOPPED",
          ...(prior.evidenceStopped ? { evidenceStopped: prior.evidenceStopped } : {}),
          localSeq: prior.localSeq, decidedAt,
        });
        await this.db.pending.bulkDelete(rows.map((row): [string, number] => [documentId, row.localSeq]));
        await this.db.snapshots.put({
          documentId, revision: opened.currentRevision, document: server, savedAt: decidedAt,
        });
        const meta: SyncMeta = {
          documentId, localSeq: prior.localSeq + 1, state: reached,
          evidenceHead: { segmentHash: opened.headSegmentHash, lastSequenceTo: opened.lastSequenceTo },
        };
        await this.db.meta.put(meta);
        return meta;
      },
    ));
  }

  /** The copies kept for `documentId`, newest first. */
  async readSalvage(documentId: string): Promise<SalvageCopy[]> {
    if (!validDocumentId(documentId)) throw new JournalError("invalid_input");
    return this.whileUsable(async () => {
      const copies = await this.db.salvage.where("documentId").equals(documentId).toArray();
      return (copies as SalvageCopy[]).sort((a, b) => b.id - a.id);
    });
  }

  /**
   * Deletes one copy, only on the author's explicit action: the text went
   * back into the work through the editor, or the author discarded it.
   */
  async releaseSalvage(documentId: string, id: number): Promise<void> {
    if (!validDocumentId(documentId) || !validSeq(id, 1)) throw new JournalError("invalid_input");
    return this.whileUsable(() => this.db.transaction("rw", this.db.salvage, this.db.control, async () => {
      if (await this.db.control.get("logout")) throw new JournalError("logout_in_progress");
      const copy = await this.db.salvage.get(id);
      if (copy?.documentId !== documentId) throw new JournalError("not_queued");
      await this.db.salvage.delete(id);
    }));
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
      "rw", [this.db.pending, this.db.snapshots, this.db.meta, this.db.control, this.db.salvage],
      async () => {
        const [pending, snapshots, metas, copies] = await Promise.all([
          this.db.pending.count(), this.db.snapshots.toArray(), this.db.meta.toArray(), this.db.salvage.count(),
        ]);
        const settled = new Set(metas.filter(settledForLogout).map((meta) => meta.documentId));
        const snapshotIds = new Set(snapshots.map((snapshot) => snapshot.documentId));
        // A kept copy is the author's text, gone only when the author lets it go.
        if (pending !== 0 || copies !== 0 ||
            snapshots.some((snapshot) => !settled.has(snapshot.documentId)) ||
            metas.some((meta) => !settled.has(meta.documentId) || !snapshotIds.has(meta.documentId))) {
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
