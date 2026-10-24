import { pluralHr } from "@/lib/i18n/hr";
import { messagesHr } from "@/lib/i18n/messages.hr";

const t = messagesHr.auth;

/**
 * What the sign-out dialog knows once writing has stopped (FE-D7, D-118):
 * whether the sheet holds text the device did not store, and how many saved
 * steps of this document the journal still owes, or null when this tab holds
 * no journal (blocked, unavailable, recovery) and the number is not known.
 */
export type LogoutPlan = { unsaved: boolean; pending: number | null };

export type LogoutText = {
  /** The main sentence of the dialog. */
  text: string;
  /** The note under it, when work stays on this device. */
  note: string | null;
  /** Whether the dialog offers the export (text would be lost). */
  offerExport: boolean;
};

/**
 * The dialog's text for a plan. It speaks only of this device and never of
 * the server: nothing is sent yet, so nothing is promised (#476, I4). An
 * unknown count shows no number rather than an invented zero.
 */
export function logoutText(plan: LogoutPlan): LogoutText {
  const n = plan.pending;
  if (plan.unsaved) {
    // What the journal does hold stays; only the unstored part is at stake.
    return { text: t.logoutUnsaved, note: n !== null && n > 0 ? t.logoutKept : null, offerExport: true };
  }
  if (n === null || n <= 0) return { text: t.logoutPlain, note: null, offerExport: false };
  const form = pluralHr(n, t.logoutPending.one, t.logoutPending.few, t.logoutPending.many);
  return { text: form.replace("{n}", String(n)), note: t.logoutKept, offerExport: false };
}

/**
 * The copy part of the dialog (3d-2c, P3 and P4 a, #476 c.6388266201): text
 * the device keeps outside the work after a conflict or a stopped record.
 * Sign-out never deletes it (D-118): it stays tied to this student on this
 * device. Restoring and discarding act on the newest copy only.
 */
export type CopyText = {
  /** How many copies this device keeps outside the work. */
  text: string;
  /** What sign-out does with them. */
  note: string;
  /** Said only when there is more than one copy. */
  newestOnly: string | null;
};

export function copyText(copies: number): CopyText | null {
  if (!Number.isSafeInteger(copies) || copies <= 0) return null;
  const form = pluralHr(copies, t.logoutCopy.one, t.logoutCopy.few, t.logoutCopy.many);
  return { text: form.replace("{n}", String(copies)), note: t.logoutCopyKept, newestOnly: copies > 1 ? t.copyNewestOnly : null };
}

/**
 * Discarding a copy takes two explicit clicks in the dialog (P3): "Odbaci
 * kopiju" asks, and only the second click discards. Anything that is not
 * that second click, Escape included, leaves the copy as it is.
 */
export type DiscardStep = "idle" | "confirm" | "working" | "failed";
export type DiscardEvent = "ask" | "keep" | "confirm" | "done" | "error";

export function nextDiscardStep(step: DiscardStep, event: DiscardEvent): DiscardStep {
  switch (event) {
    case "ask":
      return step === "idle" || step === "failed" ? "confirm" : step;
    case "keep":
      return step === "confirm" ? "idle" : step;
    case "confirm":
      return step === "confirm" ? "working" : step;
    case "done":
      return step === "working" ? "idle" : step;
    case "error":
      return step === "working" ? "failed" : step;
  }
}
