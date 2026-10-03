/**
 * Draining the pending queue to the server, as pure decisions (F1-4b).
 *
 * Three questions, three functions, no IO between them:
 *   1. `planDrain`            — what, if anything, is sent next?
 *   2. `nextAttemptDelayMs`   — how long to wait before trying again?
 *   3. `outcomeToEvents`      — what does the answer mean to the state machine?
 *
 * The state machine itself is untouched: this module never invents a state,
 * it only emits the four events `SYNCING` already understands (SYNC_STARTED,
 * SYNC_ACK, SYNC_STALE_BASE, SYNC_FAILED). Everything that talks to a clock,
 * to IndexedDB or to the network lives in `src/lib/sync/drainRunner.ts`.
 *
 * Constitution rules this file encodes:
 *   - No silent last-write-wins. `stale_base` maps to SYNC_STALE_BASE, which
 *     the reducer turns into CONFLICT; it is never retried as an overwrite
 *     and never downgraded to an ordinary, retryable failure.
 *   - Local durable state is not canonical server state. Nothing here mints a
 *     revision; the only revisions that exist are the ones the server named.
 *   - A replayed commit is an ACK, not a second write. The server's
 *     `duplicate` (same idempotency key, same bytes) means the original
 *     commit landed and only its response was lost, so it is treated exactly
 *     like `committed`.
 */

import type { DocumentTransaction } from "../document";
import type {
  CommitOutcome,
  InvalidCommitOutcome,
  ServerSyncErrorCode,
} from "../serverSync/contract";
import type { PendingTransaction, SyncMeta } from "./journal-types";
import type { SyncEvent } from "./states";

/**
 * The round trip failed before any server answer could be read: offline, DNS,
 * a dropped socket, a 5xx from something in between. It is deliberately NOT a
 * `CommitStatus`: the server never says this, the caller infers it.
 */
export type TransportError = { status: "transport_error" };

/** Everything one drain attempt can come back with. */
export type DrainOutcome = CommitOutcome | InvalidCommitOutcome | TransportError;

/**
 * What to do with the queue right now.
 *
 * `send` is the single transaction to hand to the server — at most one is in
 * flight at a time, because the server's compare-and-set is serial by
 * construction and pipelining two would make the second one's base stale by
 * definition.
 *
 * `supersededUpTo` names the newest queue entry that `send` makes redundant
 * (every row strictly older than it). It is reported rather than acted on
 * here: dropping rows is a write, and writes do not belong in this file.
 */
export type DrainPlan = {
  send: PendingTransaction | null;
  supersededUpTo: number | null;
};

const NOTHING_TO_SEND: DrainPlan = { send: null, supersededUpTo: null };

/**
 * States in which the queue must not be drained at all.
 *
 * CONFLICT and RECOVERY_REQUIRED are the two sticky states, and each may only
 * be left by an explicit decision (`CONFLICT_RESOLVED`, `RECOVERED`). A drain
 * that kept pushing while the document sat in CONFLICT would be resolving it
 * by force — the silent last-write-wins the constitution forbids — and one
 * that pushed out of RECOVERY_REQUIRED would be publishing bytes the local
 * store has already admitted it cannot vouch for.
 */
const UNDRAINABLE_STATES = new Set(["CONFLICT", "RECOVERY_REQUIRED"]);

/** A local sequence as `saveLocal` mints them: whole, positive, safe. */
function isLocalSeq(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

/**
 * Rows this build knows how to send.
 *
 * F1 has exactly one transaction kind (dossier §5), and a row of any other
 * kind — written by a newer build, or damaged in the store — is left in the
 * queue rather than guessed at. `REPLACE_DOCUMENT` carries the whole document,
 * which is what makes the supersession rule below sound.
 */
function isSendable(row: PendingTransaction): boolean {
  return (
    row?.tx?.kind === "REPLACE_DOCUMENT" &&
    isLocalSeq(row.localSeq) &&
    typeof row.tx.clientTransactionId === "string" &&
    row.tx.clientTransactionId !== ""
  );
}

/**
 * Decides what the next drain attempt sends.
 *
 * F1 semantics: every pending row is a `REPLACE_DOCUMENT` holding the entire
 * document, so the NEWEST row already contains everything the older ones say.
 * Sending the whole queue in order would be a stack of round trips whose only
 * lasting effect is the last one — and each of the earlier ones would have to
 * be rebased against the revision its predecessor just created. The newest row
 * is therefore the only one sent, and the rest are superseded.
 *
 * This is safe only because the rows are full replacements. The day a
 * transaction kind arrives that is a *delta*, this rule stops holding and the
 * queue has to be sent in order; `isSendable` is what will make that visible,
 * since an unknown kind is skipped rather than silently treated as a
 * replacement.
 *
 * The input is not assumed to be sorted, and `meta` may be `null` (a journal
 * written before meta existed, or a partial store).
 */
export function planDrain(
  pending: readonly PendingTransaction[],
  meta: SyncMeta | null,
): DrainPlan {
  if (!Array.isArray(pending) || pending.length === 0) {
    return NOTHING_TO_SEND;
  }
  if (typeof meta?.state === "string" && UNDRAINABLE_STATES.has(meta.state)) {
    return NOTHING_TO_SEND;
  }

  let newest: PendingTransaction | null = null;
  for (const row of pending) {
    if (!isSendable(row)) {
      continue;
    }
    if (newest === null || row.localSeq > newest.localSeq) {
      newest = row;
    }
  }

  if (newest === null) {
    return NOTHING_TO_SEND;
  }

  // The newest row strictly older than the one being sent. Rows the send does
  // not supersede (a newer unknown kind, say) are deliberately not named.
  let superseded: number | null = null;
  for (const row of pending) {
    if (!isLocalSeq(row?.localSeq) || row.localSeq >= newest.localSeq) {
      continue;
    }
    if (superseded === null || row.localSeq > superseded) {
      superseded = row.localSeq;
    }
  }

  return { send: newest, supersededUpTo: superseded };
}

/** First retry waits this long; each further attempt doubles it. */
export const BASE_BACKOFF_MS = 1_000;

/**
 * The exponential term never grows past this. Half a minute is long enough
 * that a server in trouble is not hammered, and short enough that an author
 * who regains connectivity does not sit there watching an un-synced document.
 */
export const MAX_BACKOFF_MS = 30_000;

/** How far the jitter may pull a delay either way, as a fraction. */
export const BACKOFF_JITTER = 0.2;

/**
 * The un-jittered delay for `attempt`: 1s, 2s, 4s, 8s, 16s, then 30s forever.
 *
 * Attempts are 1-based. Anything below 1, fractional or non-finite is treated
 * as the first attempt rather than throwing: a retry path that can crash is a
 * retry path that loses the author's queue.
 */
export function backoffBaseMs(attempt: number): number {
  const n =
    typeof attempt === "number" && Number.isFinite(attempt) && attempt > 1
      ? Math.floor(attempt)
      : 1;
  // Cheap guard against `2 ** huge` before the cap is applied.
  if (n > 40) {
    return MAX_BACKOFF_MS;
  }
  return Math.min(BASE_BACKOFF_MS * 2 ** (n - 1), MAX_BACKOFF_MS);
}

/**
 * How long to wait before attempt `attempt`, with ±20% jitter.
 *
 * The jitter exists so that a fleet of tabs knocked offline together does not
 * come back in lockstep and re-create the outage on the server's side. It is
 * injectable (`jitterFn` returns a number in [0, 1), like `Math.random`) so
 * tests can pin the exact delay instead of asserting on a range.
 *
 * The cap is on the exponential term, so the jittered result at the ceiling
 * lies in [24s, 36s]. A value outside [0, 1) from a caller's generator is
 * clamped rather than trusted — an out-of-range factor could otherwise turn
 * into a negative delay (a hot retry loop) or an hour-long one.
 */
export function nextAttemptDelayMs(
  attempt: number,
  jitterFn: () => number = Math.random,
): number {
  const base = backoffBaseMs(attempt);

  let raw: number;
  try {
    raw = jitterFn();
  } catch {
    raw = 0.5;
  }
  const unit =
    typeof raw === "number" && Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 1) : 0.5;

  // unit 0 → -20%, unit 0.5 → exact, unit 1 → +20%.
  const factor = 1 - BACKOFF_JITTER + 2 * BACKOFF_JITTER * unit;
  return Math.round(base * factor);
}

const ACK: SyncEvent[] = [{ type: "SYNC_ACK" }];
const STALE: SyncEvent[] = [{ type: "SYNC_STALE_BASE" }];
const FATAL: SyncEvent[] = [{ type: "SYNC_FAILED", retryable: false }];
const RETRYABLE: SyncEvent[] = [{ type: "SYNC_FAILED", retryable: true }];

/**
 * Turns one server answer into the events the reducer should see.
 *
 * The mapping, and why each line is what it is:
 *
 *   committed  → SYNC_ACK       the CAS landed and named a revision.
 *   duplicate  → SYNC_ACK       the CAS landed earlier and the response was
 *                               lost; replaying it is how that is discovered,
 *                               and the revision it carries is the same one.
 *   stale_base → SYNC_STALE_BASE someone else moved the document. CONFLICT,
 *                               resolved explicitly in F1-5a — never retried,
 *                               because a retry here is an overwrite.
 *   too_large  → SYNC_FAILED(false)  the document will not fit; the same bytes
 *                               will not fit on the tenth try either.
 *   txid_reused → SYNC_FAILED(false) the same idempotency key was used for
 *                               different content. That is a client bug, and
 *                               retrying it cannot fix it.
 *   not_found / unauthenticated / invalid_document /
 *   invalid_client_transaction_id / invalid
 *              → SYNC_FAILED(false)  nothing about the request improves by
 *                               being sent again: the session is gone, the
 *                               row is gone, or the payload is not sendable.
 *   transport_error → SYNC_FAILED(true)  the only retryable failure. Nothing
 *                               was learned about the server, so the queue is
 *                               still owed and backoff applies.
 *
 * `SYNC_FAILED` lands in ERROR either way (retryable is carried for the retry
 * policy, not for the state): an unreachable server has not damaged anything
 * local, so it must never be dressed up as RECOVERY_REQUIRED.
 *
 * Returns an array because a single outcome may one day need two events; today
 * every arm returns exactly one. An unrecognised status is treated as fatal
 * rather than retryable: retrying something we cannot name is a loop.
 */
export function outcomeToEvents(outcome: DrainOutcome): SyncEvent[] {
  switch (outcome?.status) {
    case "committed":
    case "duplicate":
      return ACK;
    case "stale_base":
      return STALE;
    case "transport_error":
      return RETRYABLE;
    case "too_large":
    case "txid_reused":
    case "not_found":
    case "unauthenticated":
    case "invalid_document":
    case "invalid_client_transaction_id":
    case "invalid":
      return FATAL;
    default:
      return FATAL;
  }
}

/** True when the queue should be handed to the server again after a wait. */
export function isRetryable(outcome: DrainOutcome): boolean {
  return outcome?.status === "transport_error";
}

/** True when the outcome means the commit is on the server, at `revision`. */
export function ackedRevision(outcome: DrainOutcome): number | null {
  if (outcome?.status === "committed" || outcome?.status === "duplicate") {
    return outcome.revision;
  }
  return null;
}

/**
 * Fast-forwards a queued transaction onto a revision THIS client produced.
 *
 * The problem it solves: the author keeps typing while a commit is in flight,
 * so `saveLocal` queues a row whose `baseRevision` is the one that was current
 * when it was written. By the time that row is sent, our own ACK has moved the
 * document on, and the server would answer `stale_base` — a conflict with
 * nobody, raised against our own commit.
 *
 * The rule that keeps this honest: `acked` may only ever be a revision the
 * caller received as the ACK of its OWN commit. Fast-forwarding over our own
 * write loses nothing, because the row being sent was derived from exactly
 * that content. If any other writer has committed in the meantime, `acked` is
 * behind the server and the CAS still fails — so a real conflict is still a
 * conflict, and this is not last-write-wins by a side door.
 *
 * Never moves a base backwards, and returns the transaction untouched when
 * there is nothing to fast-forward onto — including the `clientTransactionId`,
 * so the idempotency key of a replayed row survives (the server's digest is
 * taken over the document alone, not the base).
 */
export function fastForwardBase(
  tx: DocumentTransaction,
  acked: number | null,
): DocumentTransaction {
  if (acked === null || !Number.isSafeInteger(acked)) {
    return tx;
  }
  if (typeof tx.baseRevision !== "number" || tx.baseRevision >= acked) {
    return tx;
  }
  return { ...tx, baseRevision: acked };
}

/**
 * Maps a `ServerSyncError` code from the commit server action onto a drain
 * outcome, so the runner sees one vocabulary.
 *
 * `slanje` and `citanje` are the two codes that mean "the round trip did not
 * complete" — Postgres unreachable, the RPC erroring out — and they are the
 * only retryable ones. The rest describe the payload or the row, and repeating
 * them changes nothing.
 */
export function serverSyncErrorToOutcome(code: ServerSyncErrorCode): DrainOutcome {
  switch (code) {
    case "slanje":
    case "citanje":
      return { status: "transport_error" };
    case "prevelik":
      return { status: "too_large" };
    case "rad-nepoznat":
      return { status: "not_found" };
    case "zapis-neispravan":
      return { status: "invalid_document" };
    case "odgovor-neispravan":
      return { status: "invalid" };
    default:
      return { status: "invalid" };
  }
}
