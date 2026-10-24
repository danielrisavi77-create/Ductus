/**
 * F-3 step 3b (DAN-49): the drain runner. One step hands at most one owed row
 * of one document to the server and records the answer.
 *
 * Every decision is made in `src/domain/sync/drain.ts`; this file only orders
 * the calls and does the I/O:
 *
 *   read journal → mayAttempt → planDrain → beginSend (the hold is durable
 *   before the request leaves) → transport → read journal again →
 *   outcomeToEvents over the queue of now (#181) → recordAnswer →
 *   scheduleAfterOutcome.
 *
 * SYNCED is never derived here. It comes only from a SYNC_ACK that
 * `outcomeToEvents` emitted after verifying the signed receipt, and the
 * journal refuses it unless the same transaction leaves the queue empty.
 *
 * One runner per document: steps of one runner never overlap, and across
 * tabs the editor's Web Lock (3c) keeps a second runner out.
 */

import {
  fastForwardBase,
  isRetryable,
  mayAttempt,
  outcomeToEvents,
  planDrain,
  scheduleAfterOutcome,
  type DrainOutcome,
  type QueuedRow,
  type RetrySchedules,
  type SignedCommitReceiptVerifier,
} from "../../domain/sync/drain";
import type { DocumentTransaction } from "../../domain/document";
import type { JournalContents, QueuedTransaction } from "../../domain/sync/journal-types";
import { syncReducer, type SyncState } from "../../domain/sync/states";
import {
  JournalError, type AnswerResult, type AtomicDexieJournal,
} from "../journal/atomic-dexie-journal";

/**
 * Sends one transaction. A throw is read as a lost answer (`transport_error`).
 * `T` is the kind of row the runner's documents queue: the journal keeps one
 * kind per document and `planDrain` sends nothing from a mixed queue, and the
 * evidence transport checks the kind again (`createEvidenceTransport`).
 */
export type CommitTransport<T extends QueuedTransaction = DocumentTransaction> =
  (documentId: string, tx: T) => Promise<DrainOutcome>;

/** The journal as the runner uses it, over rows of either kind. */
export type DrainJournal = Pick<AtomicDexieJournal, "beginSend"> & {
  read(documentId: string): Promise<JournalContents<QueuedTransaction>>;
  recordAnswer(
    documentId: string, sent: QueuedRow, outcome: DrainOutcome, state: SyncState | null,
  ): Promise<AnswerResult<QueuedTransaction>>;
};

export type DrainRunnerDeps<T extends QueuedTransaction = DocumentTransaction> = {
  journal: DrainJournal;
  transport: CommitTransport<T>;
  now?: () => number;
  jitter?: () => number;
} & (
  | { verify: SignedCommitReceiptVerifier; verifyFor?: never }
  /** A verifier bound to the row as the journal stored it (F-8 3d-2a: its segment hash). */
  | { verifyFor: (sent: QueuedRow) => SignedCommitReceiptVerifier; verify?: never }
);

export type DrainStepResult =
  /** Nothing is owed. */
  | { kind: "idle" }
  /** Another step of this runner is in flight for the document. */
  | { kind: "busy" }
  /** A send is owed but must wait for the retry schedule. */
  | { kind: "waiting"; notBefore: number }
  /** Rows are owed but none may go out without an author decision. */
  | { kind: "stalled"; state: SyncState | null }
  /** The last answer was a failure that only a manual retry repeats. */
  | { kind: "needs_retry"; state: SyncState }
  /** One row was sent and its answer recorded. */
  | { kind: "sent"; state: SyncState; ackedRevision: number | null };

export type DrainRunner = {
  step(documentId: string, options?: { manual?: boolean }): Promise<DrainStepResult>;
};

const EDITOR_STATES: ReadonlySet<SyncState> = new Set(["EDITING", "SAVING_LOCAL"]);

export function createDrainRunner<T extends QueuedTransaction = DocumentTransaction>(
  deps: DrainRunnerDeps<T>,
): DrainRunner {
  const now = deps.now ?? Date.now;
  const jitter = deps.jitter ?? Math.random;
  let schedules: RetrySchedules = new Map();
  // Per document, the key of the row whose last answer was a failure
  // `isRetryable` refuses. Tied to the row, not to the stored state: a local
  // save turns ERROR into LOCAL_DURABLE but leaves the same row held. Held in
  // memory only: after a reload an ERROR gets one automatic replay of the same
  // key, which is idempotent and earns the same deterministic answer.
  const manualOnly = new Map<string, string>();
  const inFlight = new Set<string>();

  async function sendOnce(documentId: string, manual: boolean): Promise<DrainStepResult> {
    const before = await deps.journal.read(documentId);
    const stored = before.meta?.state ?? null;
    if (before.pending.length === 0) return { kind: "idle" };
    if (!mayAttempt(schedules, documentId, now())) {
      return { kind: "waiting", notBefore: schedules.get(documentId)!.notBefore };
    }
    const plan = planDrain(before.pending, before.meta, before.meta?.awaitingReceipt ?? null);
    const row = plan.send;
    if (row === null) return { kind: "stalled", state: stored };
    if (manualOnly.get(documentId) === row.tx.clientTransactionId && !manual) {
      return { kind: "needs_retry", state: stored ?? "ERROR" };
    }

    await deps.journal.beginSend(documentId, row);
    let outcome: DrainOutcome;
    try {
      outcome = await deps.transport(documentId, fastForwardBase(row.tx, before.snapshot?.revision ?? null) as T);
    } catch {
      outcome = { status: "transport_error" };
    }

    const after = await deps.journal.read(documentId);
    const revision = (outcome as { revision?: unknown })?.revision;
    const events = await outcomeToEvents(outcome, {
      expected: {
        documentId,
        clientTransactionId: row.tx.clientTransactionId,
        revision: typeof revision === "number" ? revision : 0,
      },
      verify: deps.verifyFor ? deps.verifyFor(row) : deps.verify!,
    }, { sent: row, pending: after.pending });

    const current = after.meta?.state ?? "SYNCING";
    const reduced = events.reduce(syncReducer, syncReducer(current, { type: "SYNC_STARTED" }));
    const state = EDITOR_STATES.has(reduced) ? null : reduced;
    let result;
    try {
      result = await deps.journal.recordAnswer(documentId, row, outcome, state);
    } catch (error) {
      // A local save landed between the read and the write: the verified
      // prefix still goes, but SYNCED would describe older text.
      if (!(error instanceof JournalError && error.code === "unconfirmed_sync")) throw error;
      result = await deps.journal.recordAnswer(documentId, row, outcome, null);
    }

    schedules = scheduleAfterOutcome(schedules, documentId, result.meta.awaitingReceipt ?? null, now(), jitter);
    if (result.meta.state === "ERROR" && !isRetryable(outcome)) manualOnly.set(documentId, row.tx.clientTransactionId);
    else manualOnly.delete(documentId);
    return { kind: "sent", state: result.meta.state, ackedRevision: result.ackedRevision };
  }

  return {
    async step(documentId, options = {}) {
      if (inFlight.has(documentId)) return { kind: "busy" };
      inFlight.add(documentId);
      try {
        return await sendOnce(documentId, options.manual === true);
      } finally {
        inFlight.delete(documentId);
      }
    },
  };
}
