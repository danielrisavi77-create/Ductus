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
