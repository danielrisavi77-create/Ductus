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
  type RetrySchedules,
  type SignedCommitReceiptVerifier,
} from "../../domain/sync/drain";
import type { DocumentTransaction } from "../../domain/document";
import { syncReducer, type SyncState } from "../../domain/sync/states";
import { JournalError, type AtomicDexieJournal } from "../journal/atomic-dexie-journal";

/** Sends one transaction. A throw is read as a lost answer (`transport_error`). */
export type CommitTransport = (documentId: string, tx: DocumentTransaction) => Promise<DrainOutcome>;

export type DrainJournal = Pick<AtomicDexieJournal, "read" | "beginSend" | "recordAnswer">;

export type DrainRunnerDeps = {
  journal: DrainJournal;
  transport: CommitTransport;
  verify: SignedCommitReceiptVerifier;
  now?: () => number;
  jitter?: () => number;
};

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

export function createDrainRunner(deps: DrainRunnerDeps): DrainRunner {
  const now = deps.now ?? Date.now;
  const jitter = deps.jitter ?? Math.random;
  let schedules: RetrySchedules = new Map();
  // Documents whose last answer was a failure `isRetryable` refuses. Held in
  // memory only: after a reload an ERROR gets one automatic replay of the same
  // key, which is idempotent and earns the same deterministic answer.
  const manualOnly = new Set<string>();
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
    if (stored === "ERROR" && manualOnly.has(documentId) && !manual) {
      return { kind: "needs_retry", state: stored };
    }

    await deps.journal.beginSend(documentId, row);
    let outcome: DrainOutcome;
    try {
      outcome = await deps.transport(documentId, fastForwardBase(row.tx, before.snapshot?.revision ?? null));
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
      verify: deps.verify,
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
    if (result.meta.state === "ERROR" && !isRetryable(outcome)) manualOnly.add(documentId);
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
