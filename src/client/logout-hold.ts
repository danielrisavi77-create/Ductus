import type { LogoutPlan } from "@/components/editor/logout-plan";
import { AtomicDexieJournal, type LogoutHold } from "@/lib/journal/atomic-dexie-journal";

import { browserMarkStore, hasEnded, type MarkStore, type SessionMark } from "./session-marks";

/** A read blocked by another tab's deletion must not hold the sign-out (D-118). */
export const LOGOUT_HOLD_LIMIT_MS = 2_000;

/**
 * How long "Odjava" waits for this tab to finish loading its journal (#874).
 * Past it the count stays unknown and the dialog still offers "Odjavi se",
 * so a load that never ends cannot hold the sign-out (D-118, I1).
 */
export const LOGOUT_LOAD_LIMIT_MS = 10_000;

/**
 * Resolves once `loading()` is false, checked again on every `wake` the
 * subscription gives, or once the limit has passed. A click made while the
 * journal is still being read is decided on what the journal holds, not on
 * an unread journal (#874).
 */
export function untilLoaded(
  loading: () => boolean,
  subscribe: (wake: () => void) => () => void,
  limitMs = LOGOUT_LOAD_LIMIT_MS,
): Promise<void> {
  if (!loading()) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let unsubscribe: (() => void) | null = null;
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe?.();
      resolve();
    };
    const timer = setTimeout(done, limitMs);
    const stop = subscribe(() => {
      if (!loading()) done();
    });
    if (settled) stop();
    else unsubscribe = stop;
    // Loading may have ended between the first check and the subscription.
    if (!loading()) done();
  });
}

export type HoldRead =LogoutHold | "noStorage" | "unknown" | "ended";

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
  | { kind: "leave" }
  | { kind: "dialog"; plan: LogoutPlan }
  | { kind: "dialogUnknown"; plan: LogoutPlan };

/**
 * Without the editor: no dialog when nothing stays; a number only when read.
 * A page whose session has ended posts nothing and goes to `/` (leave).
 */
export function shellLogoutStep(read: HoldRead): ShellLogoutStep {
  if (read === "ended") return { kind: "leave" };
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

/**
 * The editor's sign-out plan: writing stops first, then the whole scope is
 * read (O2). A page whose session has ended stops nothing, reads nothing and
 * posts nothing: it goes to `/` (leave).
 */
export async function editorSignOutPlan(
  quiesce: (() => Promise<boolean>) | null,
  scope: string | null,
  options: HoldReadOptions = {},
): Promise<LogoutPlan | "leave"> {
  const { session = null, store = browserMarkStore() } = options;
  if (session !== null && hasEnded(store, session)) return "leave";
  if (!quiesce) return { unsaved: false, pending: null };
  const unsaved = await quiesce();
  const read = await readLogoutHold(scope, { ...options, session, store });
  return read === "ended" ? "leave" : editorPlan(unsaved, read);
}
