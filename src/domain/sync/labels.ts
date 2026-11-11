/**
 * UI vocabulary for the eight sync states (F1-3b): Croatian, the source and
 * default, and English (M11.5-P01b).
 *
 * Pure data + pure functions: no React, no DOM, no clock. The chip component
 * is a thin renderer over this file, so the wording and the blocked-precedence
 * rule can be tested in a node environment without a DOM.
 *
 * Constitution rules this file encodes:
 *   - There is never a generic "Saved"/"Spremljeno". Each of the eight states
 *     carries its own label, and the map is a `Record` over `SyncState` so a
 *     ninth state cannot compile without its own wording. The two labels that
 *     say "spremljeno" use the forms docs/PRODUCT.md §5 ("Rječnik sučelja")
 *     prescribes; docs/PLAN-DEMO.md F-8 names the same two states.
 *   - Local durable state is not canonical server state. LOCAL_DURABLE says
 *     "Spremljeno na uređaju" — the words "na uređaju" are the whole point
 *     (the form docs/PRODUCT.md §5 prescribes instead of a bare "spremljeno") — and it
 *     does NOT share the reassuring tone that only SYNCED earns. Painting
 *     "durable on this machine" the same colour as "the server has it" would
 *     re-introduce the generic "saved" through the palette after the label
 *     had carefully avoided it.
 *
 * Tone is urgency, not identity: with five tones and eight states some tones
 * are necessarily shared (CONFLICT/ERROR/RECOVERY_REQUIRED all read as
 * trouble). What distinguishes the states to the reader is always the label.
 */

import { DEFAULT_INTERFACE_LOCALE, type InterfaceLocale } from "@/lib/i18n/locale";

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
 * THE label table, and the one home of the save-state wording, so the UI
 * cannot quietly drift into friendlier but less accurate words. Where
 * docs/PRODUCT.md §5 ("Rječnik sučelja") prescribes a form, the label is that
 * form: "spremljeno na uređaju" and "spremljeno na poslužitelju".
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
  LOCAL_DURABLE: { label: "Spremljeno na uređaju", tone: "neutral" },
  SYNCING: { label: "Sinkroniziram", tone: "progress" },
  /*
   * The one state that has earned the all-clear. The words "na poslužitelju"
   * are a claim, and the reducer reaches the state only with a signed receipt
   * (docs/ARCHITECTURE.md §5 t. 5) or an explicit decision to take the
   * server's document. A third way in is a reload: `restoreSyncState` resumes
   * a recorded SYNCED, and only while the journal holds a snapshot and an
   * empty queue.
   */
  SYNCED: { label: "Spremljeno na poslužitelju", tone: "ok" },
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

/**
 * The same eight states in English (M11.5-P01b, D-70), under the same rules:
 * no bare "Saved", the device named only while the work is local and the
 * server named only in SYNCED (docs/PRODUCT.md §5, English column). Tones are
 * not repeated: urgency does not depend on the language.
 */
const SYNC_STATE_LABELS_EN: Readonly<Record<SyncState, string>> = {
  EDITING: "Editing",
  SAVING_LOCAL: "Saving on this device",
  LOCAL_DURABLE: "Saved on this device",
  SYNCING: "Syncing",
  SYNCED: "Saved on the server",
  CONFLICT: "Conflict",
  ERROR: "Error",
  RECOVERY_REQUIRED: "Recovery needed",
};

/**
 * Chip text by interface language. A `Record` over `InterfaceLocale`, so a
 * third catalogue cannot be registered without its own save-state wording.
 */
export const SYNC_STATE_TEXT: Readonly<Record<InterfaceLocale, Readonly<Record<SyncState, string>>>> = {
  hr: {
    EDITING: SYNC_STATE_LABELS.EDITING.label,
    SAVING_LOCAL: SYNC_STATE_LABELS.SAVING_LOCAL.label,
    LOCAL_DURABLE: SYNC_STATE_LABELS.LOCAL_DURABLE.label,
    SYNCING: SYNC_STATE_LABELS.SYNCING.label,
    SYNCED: SYNC_STATE_LABELS.SYNCED.label,
    CONFLICT: SYNC_STATE_LABELS.CONFLICT.label,
    ERROR: SYNC_STATE_LABELS.ERROR.label,
    RECOVERY_REQUIRED: SYNC_STATE_LABELS.RECOVERY_REQUIRED.label,
  },
  en: SYNC_STATE_LABELS_EN,
};

/** The blocked notice by interface language. */
export const MULTI_TAB_BLOCKED_TEXT: Readonly<Record<InterfaceLocale, string>> = {
  hr: MULTI_TAB_BLOCKED_MESSAGE,
  en: "The document is open in another tab.",
};

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
 * tested for all eight states without a DOM. `locale` picks only the words;
 * Croatian is the default until the profile setting (M11.5-P02) passes one.
 */
export function chipContent(
  state: SyncState,
  blocked = false,
  locale: InterfaceLocale = DEFAULT_INTERFACE_LOCALE,
): ChipContent {
  if (blocked) {
    return { text: MULTI_TAB_BLOCKED_TEXT[locale], tone: MULTI_TAB_BLOCKED_TONE };
  }
  return { text: SYNC_STATE_TEXT[locale][state], tone: SYNC_STATE_LABELS[state].tone };
}

/** What a local-only editor knows when it picks the chip (F-3, plan #197). */
export type LocalChipInput = {
  /** Another tab holds the document's writer lock. */
  readonly blocked: boolean;
  /** The stored document was refused or the journal is corrupt. */
  readonly recoveryRequired: boolean;
  /** Saving has stopped for any other reason (quota, a stale write, ...). */
  readonly failed: boolean;
  /** The saver's own state; null while the journal is still being read. */
  readonly saverState: SyncState | null;
};

export type LocalChip = ChipContent & { readonly state: SyncState | "blocked" };

/**
 * The chip of the local editor, or null while there is nothing to say yet.
 *
 * Order matters: a blocked tab journals nothing, and a refused document or
 * any failure outranks whatever the saver last reported, so the chip never
 * says "Spremljeno na uređaju" while a notice says saving has stopped (#197
 * attacks 5 and 9). Only the saver's own state can say it.
 */
export function localChip(
  input: LocalChipInput,
  locale: InterfaceLocale = DEFAULT_INTERFACE_LOCALE,
): LocalChip | null {
  if (input.blocked) return { ...chipContent("EDITING", true, locale), state: "blocked" };
  const state: SyncState | null = input.recoveryRequired ? "RECOVERY_REQUIRED"
    : input.failed ? "ERROR"
    : input.saverState;
  return state ? { ...chipContent(state, false, locale), state } : null;
}
