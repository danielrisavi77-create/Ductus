/**
 * Draining the pending queue to the server, as pure decisions (F1-4b).
 *
 * Three decisions, isolated from IndexedDB, network calls, and clocks:
 *   1. `planDrain`            — what, if anything, is sent next?
 *   2. `nextAttemptDelayMs`   — how long to wait before trying again?
 *   3. `outcomeToEvents`      — what does the answer mean to the state machine?
 *
 * The state machine itself is untouched: this module never invents a state.
 * It emits the four existing events (SYNC_STARTED, SYNC_ACK, SYNC_STALE_BASE,
 * SYNC_FAILED); a pending receipt emits no event so SYNCING remains honest.
 * Network, IndexedDB, clock, and trusted-key verification adapters are supplied
 * outside this module.
 *
 * Constitution rules this file encodes:
 *   - No silent last-write-wins. `stale_base` maps to SYNC_STALE_BASE, which
 *     the reducer turns into CONFLICT; it is never retried as an overwrite
 *     and never downgraded to an ordinary, retryable failure.
 *   - Local durable state is not canonical server state. Nothing here mints a
 *     revision; the only revisions that exist are the ones the server named.
 *   - `committed` and `duplicate` report the CAS result, not a user-visible
 *     sync ACK. The queue remains owed until a signed receipt for that exact
 *     document, transaction and revision is received and verified.
 *   - A commit whose receipt is still owed holds the queue: only that same
 *     idempotency key is replayed, never a newer row on the un-advanced base
 *     (that would be answered `stale_base` — a conflict with ourselves).
 *   - A send whose answer was lost holds the queue the same way. The CAS may
 *     have landed without the client hearing of it, so the row stays held
 *     until the server gives a verified answer for that idempotency key.
 */

import type { DocumentTransaction } from "../document";
import { commitRequestFromTransaction } from "../serverSync/contract";
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

/** Server-side state of the receipt for a committed revision. */
export type CommitReceiptState =
  | { status: "pending_signature" }
  | { status: "signed"; signedReceipt: unknown };

/** Fields a verifier must bind to the exact commit being acknowledged. */
export type CommitReceiptExpectation = {
  documentId: string;
  clientTransactionId: string;
  revision: number;
};

/**
 * The adapter verifies receipt schema, canonical payload/digest, signature
 * against the trusted public key, and all expected commit fields. It must fail
 * closed if the key or receipt is unavailable or malformed.
 */
export type SignedCommitReceiptVerifier = (
  signedReceipt: unknown,
  expected: CommitReceiptExpectation,
) => Promise<boolean>;

export type CommitReceiptVerification = {
  expected: CommitReceiptExpectation;
  verify: SignedCommitReceiptVerifier;
};

type CommitSuccess = Extract<CommitOutcome, { status: "committed" | "duplicate" }>;
type CommitFailure = Exclude<CommitOutcome, CommitSuccess>;

/**
 * A successful CAS is not a sync acknowledgement until a signed receipt is
 * present and verified. Receipt state is therefore required on both success
 * variants; bare committed/duplicate responses cannot pass this boundary.
 */
export type DrainOutcome =
  | (CommitSuccess & { receipt: CommitReceiptState })
  | CommitFailure
  | InvalidCommitOutcome
  | TransportError;

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
 * The queue row whose compare-and-set the server has accepted, or MAY have
 * accepted, but whose signed receipt has not been verified yet
 * (`nextAwaitingReceipt`). "May have" is a send whose answer never arrived:
 * the commit can exist on the server without the client knowing.
 *
 * While this is set the local base has NOT been fast-forwarded (only a
 * verified receipt may do that), so every newer row still names the old base.
 * The caller keeps it for as long as the row is owed and hands it back to
 * `planDrain`.
 *
 * Persisting it is the journal's job, not this module's, and it has to happen
 * BEFORE the request leaves (`awaitingReceiptFor`): a tab closed mid-flight
 * learns no outcome at all, and a reload that finds no marker would send the
 * newest row on the old base — the same self-inflicted CONFLICT.
 */
export type AwaitingReceipt = {
  localSeq: number;
  clientTransactionId: string;
};

function isAwaitingReceipt(value: unknown): value is AwaitingReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const marker = value as Partial<AwaitingReceipt>;
  return (
    isLocalSeq(marker.localSeq) &&
    typeof marker.clientTransactionId === "string" &&
    marker.clientTransactionId.trim() !== ""
  );
}

/**
 * The marker for `sent`: what the runner stores durably before sending it, and
 * what a send with an unknown or unacknowledged outcome leaves behind.
 */
export function awaitingReceiptFor(sent: PendingTransaction): AwaitingReceipt {
  return { localSeq: sent.localSeq, clientTransactionId: sent.tx.clientTransactionId };
}

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
  if (!isLocalSeq(row?.localSeq)) {
    return false;
  }
  try {
    // The existing wire builder owns the kind, ids, revision and byte limit
    // rules. A rejected row must also bound every removable queue prefix.
    return commitRequestFromTransaction(row.documentId, row.tx) !== null;
  } catch {
    // Plain damaged data can still fail JSON serialization (cycles, BigInt)
    // or omit the transaction. Retain it as an unsendable recovery boundary.
    return false;
  }
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
 * since an unknown kind stops the removable prefix rather than being
 * silently treated as a replacement.
 *
 * Conservative ordering: send only strictly before the earliest unsendable
 * row or duplicate sequence. Even a finite damaged sequence (fractional,
 * nonpositive or unsafe) is a boundary: an acknowledged prefix must not
 * remove it. An unorderable sequence blocks the whole plan because no safe
 * prefix can be proved. Equal sequences are ambiguous even for replacements;
 * choosing one could clear an unacknowledged sibling. No row is rewritten.
 *
 * The input is not assumed to be sorted, and `meta` may be `null` (a journal
 * written before meta existed, or a partial store).
 *
 * Holding for a receipt: when `awaitingReceipt` names a row, that row's CAS
 * already landed but its receipt is unverified, so the base of every newer
 * row is still the one that commit replaced. Sending a newer row now would be
 * answered `stale_base` and put the author in CONFLICT with their own commit.
 * The plan therefore replays exactly the awaited row (same idempotency key,
 * which the server answers as `duplicate`) and leaves newer rows queued. The
 * same holds for a row whose answer was lost: if its CAS landed the replay is
 * a `duplicate`, and if it never arrived the replay is the commit itself. If
 * the awaited row cannot be proved safe to replay — gone, a different key,
 * at or past an unsafe boundary, or the marker itself is malformed — nothing
 * is sent: a visible stall is recoverable, a self-inflicted CONFLICT is sticky.
 */
export function planDrain(
  pending: readonly PendingTransaction[],
  meta: SyncMeta | null,
  awaitingReceipt: AwaitingReceipt | null = null,
): DrainPlan {
  if (!Array.isArray(pending) || pending.length === 0) {
    return NOTHING_TO_SEND;
  }
  if (typeof meta?.state === "string" && UNDRAINABLE_STATES.has(meta.state)) {
    return NOTHING_TO_SEND;
  }

  let barrier = Number.POSITIVE_INFINITY;
  const seen = new Set<number>();
  for (const row of pending) {
    const sequence = row?.localSeq;
    if (typeof sequence !== "number" || !Number.isFinite(sequence)) {
      return NOTHING_TO_SEND;
    }
    if (!isSendable(row) || seen.has(sequence)) {
      barrier = Math.min(barrier, sequence);
    }
    seen.add(sequence);
  }

  const held = awaitingReceipt ?? null;
  if (held !== null && !isAwaitingReceipt(held)) {
    return NOTHING_TO_SEND;
  }

  let newest: PendingTransaction | null = null;
  for (const row of pending) {
    if (!isSendable(row) || row.localSeq >= barrier) {
      continue;
    }
    if (held !== null) {
      // Below the barrier sequences are unique, so at most one row matches.
      if (
        row.localSeq === held.localSeq &&
        row.tx.clientTransactionId === held.clientTransactionId
      ) {
        newest = row;
      }
      continue;
    }
    if (newest === null || row.localSeq > newest.localSeq) {
      newest = row;
    }
  }

  if (newest === null) {
    return NOTHING_TO_SEND;
  }

  // Every row through the send is now a unique, sendable replacement.
  // Both this superseded prefix and an ACK prefix through the sent row stop
  // strictly before any unsafe boundary.
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
 *   committed / duplicate + pending_signature → no event; remain SYNCING and
 *                               retry until the signer publishes.
 *   committed / duplicate + signed receipt → SYNC_ACK only after the injected
 *                               verifier validates its signature and exact
 *                               document, transaction id, and revision.
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
 *   transport_error → SYNC_FAILED(true)  no server answer was learned;
 *                               the queue remains owed and backoff applies.
 *                               The retry is the SAME row, as below: the
 *                               commit may have landed unheard.
 *   pending_signature → no event and a retry; the CAS landed, but its receipt
 *                               is not ready for acknowledgement. The retry is
 *                               the SAME row (`nextAwaitingReceipt`, then
 *                               `planDrain`), never a newer one.
 *
 * `SYNC_FAILED` lands in ERROR either way (retryable is carried for the retry
 * policy, not for the state): an unreachable server has not damaged anything
 * local, so it must never be dressed up as RECOVERY_REQUIRED.
 *
 * Returns an array because a single outcome may one day need two events.
 * Pending signatures return an empty array to preserve SYNCING. An unrecognised
 * status is treated as fatal rather than retryable: retrying something we
 * cannot name is a loop.
 */
const VERIFIED_COMMIT_REVISIONS = new WeakMap<object, number>();

export async function outcomeToEvents(
  outcome: DrainOutcome,
  verification: CommitReceiptVerification,
): Promise<SyncEvent[]> {
  switch (outcome?.status) {
    case "committed":
    case "duplicate": {
      const receipt = (outcome as { receipt?: unknown }).receipt;
      if (
        !receipt ||
        typeof receipt !== "object" ||
        Array.isArray(receipt) ||
        !Object.prototype.hasOwnProperty.call(receipt, "status")
      ) {
        return FATAL;
      }
      const receiptState = (receipt as { status?: unknown }).status;
      if (receiptState === "pending_signature") {
        return [];
      }
      if (
        receiptState !== "signed" ||
        !Object.prototype.hasOwnProperty.call(receipt, "signedReceipt") ||
        !verification ||
        typeof verification.verify !== "function" ||
        !verification.expected ||
        typeof verification.expected.documentId !== "string" ||
        verification.expected.documentId.trim() === "" ||
        typeof verification.expected.clientTransactionId !== "string" ||
        verification.expected.clientTransactionId.trim() === "" ||
        !Number.isSafeInteger(outcome.revision) ||
        outcome.revision < 1 ||
        verification.expected.revision !== outcome.revision
      ) {
        return FATAL;
      }
      try {
        const verified = await verification.verify(
          (receipt as { signedReceipt: unknown }).signedReceipt,
          verification.expected,
        );
        if (verified !== true) {
          return FATAL;
        }
        VERIFIED_COMMIT_REVISIONS.set(outcome, outcome.revision);
        return ACK;
      } catch {
        return FATAL;
      }
    }
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
  if (outcome?.status === "transport_error") {
    return true;
  }
  return (
    (outcome?.status === "committed" || outcome?.status === "duplicate") &&
    outcome.receipt?.status === "pending_signature"
  );
}

/** Returns a revision only after outcomeToEvents has verified its signed receipt. */
export function ackedRevision(outcome: DrainOutcome): number | null {
  if (!outcome || typeof outcome !== "object") {
    return null;
  }
  return VERIFIED_COMMIT_REVISIONS.get(outcome) ?? null;
}

/**
 * What the queue is waiting on after `sent` was answered with `outcome`.
 *
 *   committed / duplicate, receipt verified → null: the base may move on.
 *   committed / duplicate, anything else    → `sent`: the CAS landed, so newer
 *                               rows are stale until this exact commit is
 *                               acknowledged. That includes a pending
 *                               signature, a missing or malformed receipt and
 *                               a receipt that failed verification.
 *   transport_error             → `previous`, or `sent` when nothing was
 *                               held: the answer was lost, not necessarily the
 *                               request, so the CAS may have landed. A newer
 *                               row sent on the old base would then be
 *                               `stale_base` against the author's own commit.
 *                               Replaying `sent` is safe either way:
 *                               `duplicate` if it landed, the commit itself if
 *                               it did not.
 *   every other answer          → `previous`, unchanged: the server said this
 *                               commit did not land, so whatever was owed is
 *                               still owed and nothing new is.
 *
 * "Verified" is `ackedRevision`, i.e. only an outcome that `outcomeToEvents`
 * itself vouched for can release the hold.
 */
export function nextAwaitingReceipt(
  sent: PendingTransaction,
  outcome: DrainOutcome,
  previous: AwaitingReceipt | null,
): AwaitingReceipt | null {
  if (outcome?.status === "transport_error") {
    return previous ?? awaitingReceiptFor(sent);
  }
  if (outcome?.status !== "committed" && outcome?.status !== "duplicate") {
    return previous ?? null;
  }
  if (ackedRevision(outcome) !== null) {
    return null;
  }
  return awaitingReceiptFor(sent);
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
