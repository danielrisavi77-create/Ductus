/**
 * Restoring the sync state on reload (F1-3a).
 *
 * Pure: takes what the journal holds and says which state the session must
 * resume in. Kept out of the React layer so the rule is testable on its own.
 *
 * Why this exists: CONFLICT and RECOVERY_REQUIRED are the two states the
 * constitution makes sticky — they may only be left by an explicit decision.
 * A reload is not a decision. If a fresh session started in EDITING and then
 * synthesised LOCAL_DURABLE from the snapshot, closing the tab would silently
 * clear a conflict, which is exactly the silent last-write-wins the
 * constitution forbids. The persisted `meta.state` therefore wins.
 */

import type { JournalContents } from "./journal-types";
import { INITIAL_SYNC_STATE, SYNC_STATES, type SyncState } from "./states";

function isSyncState(value: unknown): value is SyncState {
  return (
    typeof value === "string" && (SYNC_STATES as readonly string[]).includes(value)
  );
}

/**
 * The state a session must resume in:
 *   - a recorded `meta.state` wins, so sticky states survive a reload;
 *   - otherwise a snapshot without meta (a journal written by an older build,
 *     or a partial store) is locally durable, since the bytes are there;
 *   - otherwise nothing has been saved and the session starts in EDITING.
 *
 * A `meta.state` that is not one of the eight states is ignored rather than
 * trusted: stored data is data, not a promise about what the machine allows.
 */
export function restoreSyncState(contents: JournalContents): SyncState {
  const recorded = contents.meta?.state;
  if (isSyncState(recorded)) {
    return recorded;
  }
  if (contents.snapshot) {
    return "LOCAL_DURABLE";
  }
  return INITIAL_SYNC_STATE;
}
