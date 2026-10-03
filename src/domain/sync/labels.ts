/**
 * Croatian UI vocabulary for the eight sync states (F1-3b).
 *
 * Pure data + pure functions: no React, no DOM, no clock. The chip component
 * is a thin renderer over this file, so the wording and the blocked-precedence
 * rule can be tested in a node environment without a DOM.
 *
 * Constitution rules this file encodes:
 *   - There is never a generic "Saved"/"Spremljeno". Each of the eight states
 *     carries its own label, taken verbatim from docs/F1_PLAN.md §3, and the
 *     map is a `Record` over `SyncState` so a ninth state cannot compile
 *     without its own wording.
 *   - Local durable state is not canonical server state. LOCAL_DURABLE says
 *     "Spremljeno lokalno" — the word "lokalno" is the whole point — and it
 *     does NOT share the reassuring tone that only SYNCED earns. Painting
 *     "durable on this machine" the same colour as "the server has it" would
 *     re-introduce the generic "saved" through the palette after the label
 *     had carefully avoided it.
 *
 * Tone is urgency, not identity: with five tones and eight states some tones
 * are necessarily shared (CONFLICT/ERROR/RECOVERY_REQUIRED all read as
 * trouble). What distinguishes the states to the reader is always the label.
 */

import type { SyncState } from "./states";

/**
 * Visual urgency of a chip. Deliberately abstract: the component maps these
 * to CSS custom properties, so the domain never names a colour.
 */
export const SYNC_TONES = ["neutral", "progress", "ok", "warn", "error"] as const;

export type SyncTone = (typeof SYNC_TONES)[number];

export type SyncStateLabel = {
  /** The Croatian text the author reads. */
  readonly label: string;
  readonly tone: SyncTone;
};

/**
 * THE label table. Wording is verbatim from docs/F1_PLAN.md §3 ("Croatian UI
 * label" column) — the plan is the source of truth for user-facing strings,
 * so the UI cannot quietly drift into friendlier but less accurate words.
 *
 * `Record<SyncState, …>` gives compile-time exhaustiveness in both
 * directions: a new state fails to build until it is given a label, and a
 * label for a state that does not exist fails to build too.
 */
export const SYNC_STATE_LABELS: Record<SyncState, SyncStateLabel> = {
  /* Nothing is claimed yet: there is a candidate the journal has not seen. */
  EDITING: { label: "Uređivanje", tone: "neutral" },
  /* In flight. The pulse on `progress` is the only animated tone. */
  SAVING_LOCAL: { label: "Spremam lokalno", tone: "progress" },
  /*
   * Durable on this device, and nowhere else. `neutral` rather than `ok` on
   * purpose: the work is safe from a reload, not from losing the machine, and
   * only a server ACK may look like an all-clear.
   */
  LOCAL_DURABLE: { label: "Spremljeno lokalno", tone: "neutral" },
  SYNCING: { label: "Sinkroniziram", tone: "progress" },
  /* The one state that has earned the all-clear: the server holds it. */
  SYNCED: { label: "Sinkronizirano", tone: "ok" },
  /*
   * Not an error — nothing is broken and nothing is lost — but it needs an
   * explicit decision from the author (F1-5a), hence `warn`.
   */
  CONFLICT: { label: "Sukob", tone: "warn" },
  ERROR: { label: "Greška", tone: "error" },
  RECOVERY_REQUIRED: { label: "Potreban oporavak", tone: "error" },
};

/**
 * Shown when this tab is not the writer for the document, i.e. another tab
 * holds the Web Lock. It replaces the state entirely rather than sitting next
 * to it: whatever the reducer in *this* tab says, this tab is not journalling,
 * so reporting its state would be a claim about work that is not happening.
 */
export const MULTI_TAB_BLOCKED_MESSAGE = "Dokument je otvoren u drugoj kartici.";

/** Tone of the blocked notice: an explanation the author must act on, not a fault. */
export const MULTI_TAB_BLOCKED_TONE: SyncTone = "warn";

export type ChipContent = {
  readonly text: string;
  readonly tone: SyncTone;
};

/**
 * What the chip renders, as pure data.
 *
 * `blocked` wins over every state — see `MULTI_TAB_BLOCKED_MESSAGE`. Kept
 * here, rather than inside the component, so the precedence rule is unit
 * tested for all eight states without a DOM.
 */
export function chipContent(state: SyncState, blocked = false): ChipContent {
  if (blocked) {
    return { text: MULTI_TAB_BLOCKED_MESSAGE, tone: MULTI_TAB_BLOCKED_TONE };
  }
  const entry = SYNC_STATE_LABELS[state];
  return { text: entry.label, tone: entry.tone };
}
