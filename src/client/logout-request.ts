/**
 * The sign-out request itself (F-5, D-118), shared by the editor and the
 * shell: one POST to the logout route. The shell ends the session on this
 * device only once the route confirmed it (F-285); without that answer it
 * changes nothing and the person can try again (DAN-99, #1444).
 */

import { LOGOUT_TIMEOUT_MS } from "./logout-hold";
import {
  browserCookieJar, browserMarkStore, currentSession, endAfterLogout, SESSION_END_CHANNEL,
  type CookieJar, type MarkStore, type SessionMark,
} from "./session-marks";

/**
 * POST to the logout route; true only for its redirect, which comes after
 * the session was closed and the cookie cleared. A lost request, an error
 * status and no answer within the time limit are false, and so is an answer
 * that comes after the limit: by then the page may have said it is
 * unconfirmed (F-285).
 */
export async function postLogout(fetchImpl: typeof fetch = fetch, timeoutMs = LOGOUT_TIMEOUT_MS): Promise<boolean> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const response = await fetchImpl("/api/auth/logout", {
      method: "POST", redirect: "manual", cache: "no-store", signal: abort.signal,
    });
    return !abort.signal.aborted && response.type === "opaqueredirect";
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * After a successful `postLogout`: the same POST once more, natively, so the
 * browser follows the route's redirect on to the provider's logout (DAN-212);
 * the fetch cannot follow it. It arrives without the cookie, so it closes
 * nothing twice. A form of its own, so it holds while the page re-renders.
 */
export function followLogoutNatively(): void {
  const form = document.createElement("form");
  form.method = "post";
  form.action = "/api/auth/logout";
  form.hidden = true;
  document.body.append(form);
  form.submit();
}

export type SignOutDeps = {
  post: () => Promise<boolean>;
  store: MarkStore | null;
  jar: CookieJar | null;
  /** Tells the other tabs that `tag` ended. */
  announce: (tag: string) => void;
};

/** Tells the other pages of this browser that `tag` ended. */
export function announceEnded(tag: string): void {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(SESSION_END_CHANNEL);
  channel.postMessage(tag);
  channel.close();
}

export function browserSignOutDeps(): SignOutDeps {
  return { post: () => postLogout(), store: browserMarkStore(), jar: browserCookieJar(), announce: announceEnded };
}

/**
 * Sign-out from a page rendered under `session` (null: the session the
 * browser records at the click). The tag is taken before the POST, so a
 * session that becomes current meanwhile stays (#1444). Ended here only when
 * the route confirmed it, and then true; without that nothing changes and
 * the result is false (F-285).
 */
export async function signOutHere(session: SessionMark | null, deps: SignOutDeps): Promise<boolean> {
  const own = (session ?? currentSession(deps.store))?.tag ?? null;
  const reached = await deps.post().catch(() => false);
  if (!reached) return false;
  for (const tag of endAfterLogout(deps.store, own, deps.jar)) {
    try {
      deps.announce(tag);
    } catch {
      // The record above already ends it for every tab that checks.
    }
  }
  return reached;
}
