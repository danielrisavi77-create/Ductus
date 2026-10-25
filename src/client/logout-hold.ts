import type { LogoutPlan } from "@/components/editor/logout-plan";
import { AtomicDexieJournal, type LogoutHold } from "@/lib/journal/atomic-dexie-journal";

import { browserMarkStore, hasEnded, type MarkStore, type SessionMark } from "./session-marks";

/** A read blocked by another tab's deletion must not hold the sign-out (D-118). */
export const LOGOUT_HOLD_LIMIT_MS = 2_000;

export type HoldRead = LogoutHold | "noStorage" | "unknown" | "ended";

export type HoldReadOptions = {
  timeoutMs?: number;
  peek?: (scope: string) => Promise<LogoutHold>;
  /** The session the page was rendered under; once it has ended nothing is read. */
  session?: SessionMark | null;
  store?: MarkStore | null;
};

/**
 * What this person's journal holds back from a sign-out (D-118), read per
 * click under the page's own scope. No scope, a failure or the limit: unknown.
 * A page whose session is no longer the browser's reads nothing: ended.
 */
export async function readLogoutHold(scope: string | null, options: HoldReadOptions = {}): Promise<HoldRead> {
  const { session = null, store = browserMarkStore() } = options;
  if (session !== null && hasEnded(store, session)) return "ended";
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

/** Without the editor: no dialog when nothing stays; a number only when read. */
export function shellLogoutStep(read: HoldRead): ShellLogoutStep {
  if (read === "noStorage" || read === "ended") return { kind: "plain" };
  if (read === "unknown") return { kind: "dialogUnknown", plan: { unsaved: false, pending: null } };
  if (read.pending === 0 && read.copies === 0 && !read.kept) return { kind: "plain" };
  return { kind: "dialog", plan: { unsaved: false, pending: read.pending, copies: read.copies, kept: true } };
}

/** The editor's plan after writing stopped, with the count of the whole scope (O2). */
export function editorPlan(unsaved: boolean, read: HoldRead): LogoutPlan {
  if (typeof read === "string") return { unsaved, pending: null };
  return { unsaved, pending: read.pending, copies: read.copies, kept: read.kept };
}
