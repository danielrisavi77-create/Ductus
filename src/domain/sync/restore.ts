/**
 * Restoring the sync state on reload (F1-3a, F-8).
 *
 * Pure: takes what the journal holds and says which state the session must
 * resume in. Kept out of the React layer so the rule is testable on its own.
 *
 * Why this exists: CONFLICT and RECOVERY_REQUIRED are the two states the
 * constitution makes sticky — they may only be left by an explicit decision.
 * A reload is not a decision. If a fresh session started in EDITING and then
 * synthesised LOCAL_DURABLE from the snapshot, closing the tab would silently
 * clear a conflict, which is exactly the silent last-write-wins the
 * constitution forbids. A persisted settled `meta.state` therefore wins.
 *
 * The opposite holds for the two states that describe an operation in flight.
 * A reload ends every local write and every request this tab had started, so
 * a recorded SAVING_LOCAL or SYNCING is a claim about work nobody is doing
 * any more. Resuming in it would show "in progress" for ever: the machine has
 * no way to start a save from SAVING_LOCAL or a send from SYNCING, because
 * both wait for the answer of an operation that died with the old session.
 */

import type { JournalContents } from "./journal-types";
import { INITIAL_SYNC_STATE, SYNC_STATES, type SyncState } from "./states";

/**
 * States that only mean "an operation of this session is in flight". They are
 * never resumed: see `restoreSyncState`.
 */
export const TRANSIENT_SYNC_STATES = [
  "SAVING_LOCAL",
  "SYNCING",
] as const satisfies readonly SyncState[];

function isSyncState(value: unknown): value is SyncState {
  return (
    typeof value === "string" && (SYNC_STATES as readonly string[]).includes(value)
  );
}

function isTransient(state: SyncState): boolean {
  return (TRANSIENT_SYNC_STATES as readonly SyncState[]).includes(state);
}

/**
 * The state a session must resume in:
 *   - a recorded settled `meta.state` wins, so sticky states survive a reload;
 *   - a recorded in-flight state (SAVING_LOCAL, SYNCING) is not resumed and
 *     says nothing about what is on disk, so it is read as if no state had
 *     been recorded;
 *   - without a usable recorded state, a snapshot (a journal written by an
 *     older build, a partial store, or a tab closed mid-operation) is locally
 *     durable, since the bytes are there;
 *   - otherwise nothing has been saved and the session starts in EDITING.
 *
 * Normalising to LOCAL_DURABLE claims only what the journal holds: after a
 * reload the editor shows the stored snapshot, not the candidate that was in
 * memory. It is also the state a drain starts from (`SYNC_STARTED`), so a row
 * that was mid-send is sent again under its own idempotency key and the
 * server's answer, not this function, decides what happens next. It never
 * yields SYNCED: a request that was in flight proves nothing about a receipt.
 *
 * A `meta.state` that is not one of the eight states is ignored rather than
 * trusted: stored data is data, not a promise about what the machine allows.
 */
export function restoreSyncState(contents: JournalContents): SyncState {
  const recorded = contents.meta?.state;
  if (isSyncState(recorded) && !isTransient(recorded)) {
    return recorded;
  }
  if (contents.snapshot) {
    return "LOCAL_DURABLE";
  }
  return INITIAL_SYNC_STATE;
}
