import type { LogoutPlan } from "@/components/editor/logout-plan";
import { AtomicDexieJournal, type LogoutHold } from "@/lib/journal/atomic-dexie-journal";

/**
 * How long a sign-out waits for the journal read. An open that another tab's
 * deletion blocks must not hold the sign-out (D-118): past this the outcome
 * is unknown, and the dialog says so without a number.
 */
export const LOGOUT_HOLD_LIMIT_MS = 2_000;

/** What the read found: a hold, a browser that keeps no journal, or nothing known. */
export type HoldRead = LogoutHold | "noStorage" | "unknown";

export type HoldReadOptions = {
  timeoutMs?: number;
  peek?: (scope: string) => Promise<LogoutHold>;
};

/**
 * Reads, once per click and remembering nothing, what this person's journal
 * on this device holds back from a sign-out (D-118). Only the scope the
 * server gave the page is read, never another person's journal. Without a
 * scope, on a failure or past the limit the outcome is unknown, never "none".
 */
export async function readLogoutHold(scope: string | null, options: HoldReadOptions = {}): Promise<HoldRead> {
  if (typeof indexedDB === "undefined" || !indexedDB) return "noStorage";
  if (!scope) return "unknown";
  const { timeoutMs = LOGOUT_HOLD_LIMIT_MS, peek = (s: string) => AtomicDexieJournal.peekLogoutHold(s) } = options;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"unknown">((resolve) => { timer = setTimeout(() => resolve("unknown"), timeoutMs); });
  try {
    const read = Promise.resolve().then(() => peek(scope)).catch((): "unknown" => "unknown");
    return await Promise.race([read, late]);
  } finally {
    clearTimeout(timer);
  }
}

export type ShellLogoutStep =
  | { kind: "plain" }
  | { kind: "dialog"; plan: LogoutPlan }
  | { kind: "dialogUnknown"; plan: LogoutPlan };

/**
 * The step of a sign-out from a page without the editor: straight to the
 * logout route when nothing stays, else the dialog, with a number only when
 * the read gave one. A page without the editor holds no unstored text.
 */
export function shellLogoutStep(read: HoldRead): ShellLogoutStep {
  if (read === "noStorage") return { kind: "plain" };
  if (read === "unknown") return { kind: "dialogUnknown", plan: { unsaved: false, pending: null } };
  if (read.pending === 0 && read.copies === 0 && !read.kept) return { kind: "plain" };
  return { kind: "dialog", plan: { unsaved: false, pending: read.pending, copies: read.copies, kept: true } };
}

/** The editor's plan after writing stopped, with the count of the whole scope (O2). */
export function editorPlan(unsaved: boolean, read: HoldRead): LogoutPlan {
  if (typeof read === "string") return { unsaved, pending: null };
  return { unsaved, pending: read.pending, copies: read.copies, kept: read.kept };
}
