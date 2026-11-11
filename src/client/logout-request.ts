/**
 * The sign-out request itself (F-5, D-118), shared by the editor and the
 * shell: one POST to the logout route, and the end of the session on this
 * device whatever the route answers, so a lost network or a failing server
 * never holds a sign-out back (Z-02, DAN-99).
 */

import { LOGOUT_TIMEOUT_MS } from "./logout-hold";
import {
  browserCookieJar, browserMarkStore, currentSession, endAfterLogout, SESSION_END_CHANNEL,
  type CookieJar, type MarkStore, type SessionMark,
} from "./session-marks";

/**
 * POST to the logout route; true only for its redirect, which comes after
 * the session was closed on the server. The answer never touches the session
 * cookie (#1929). A lost request, an error status (503 when the database
 * could not close it) and no answer within the time limit are false.
 */
export async function postLogout(fetchImpl: typeof fetch = fetch, timeoutMs = LOGOUT_TIMEOUT_MS): Promise<boolean> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const response = await fetchImpl("/api/auth/logout", {
      method: "POST", redirect: "manual", cache: "no-store", signal: abort.signal,
    });
    return response.type === "opaqueredirect";
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * After a successful `postLogout`: the same POST once more, natively, so the
 * browser follows the route's redirect on to the provider's logout (DAN-212);
 * the fetch cannot follow it. It carries `tag`, the session of the click
 * ("" without one), so the route ends nothing else: a session signed in from
 * another tab between the two POSTs keeps its cookie (#1929). A form of its
 * own, so it holds while the page re-renders.
 */
export function followLogoutNatively(tag: string | null): void {
  const form = document.createElement("form");
  form.method = "post";
  form.action = "/api/auth/logout";
  form.hidden = true;
  const field = document.createElement("input");
  field.type = "hidden";
  field.name = "session";
  field.value = tag ?? "";
  form.append(field);
  document.body.append(form);
  form.submit();
}

export type SignOutDeps = {
  post: () => Promise<boolean>;
  store: MarkStore | null;
  jar: CookieJar | null;
  /** Tells the other tabs, and the parts of this page, that `tag` ended. */
  announce: (tag: string) => void;
};

/** Tells every page of this browser, this one included, that `tag` ended. */
export function announceEnded(tag: string): void {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(SESSION_END_CHANNEL);
  channel.postMessage(tag);
  channel.close();
}

/** The session a click signs out: the page's own, else the one the browser records at the click. */
export function sessionAtClick(session: SessionMark | null, store: MarkStore | null): SessionMark | null {
  return session ?? currentSession(store);
}

export function browserSignOutDeps(): SignOutDeps {
  return { post: () => postLogout(), store: browserMarkStore(), jar: browserCookieJar(), announce: announceEnded };
}

/**
 * Sign-out from a page rendered under `session` (null: the session the
 * browser records now). The tag is taken before the POST, so a session that
 * becomes current meanwhile stays (#1444). Ended here either way; true only
 * when the route answered. Nothing calls the route again.
 */
export async function signOutHere(session: SessionMark | null, deps: SignOutDeps): Promise<boolean> {
  const own = sessionAtClick(session, deps.store)?.tag ?? null;
  const reached = await deps.post().catch(() => false);
  for (const tag of endAfterLogout(deps.store, own, deps.jar)) {
    try {
      deps.announce(tag);
    } catch {
      // The record above already ends it for every tab that checks.
    }
  }
  return reached;
}
