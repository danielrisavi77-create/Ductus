/**
 * The server's part of a sign-out that ended on this device only (#1330,
 * D-118). Sign-out always closes the session here: the tabs stop and the
 * sheet is emptied whether or not the logout route answered. When it did
 * not (no network, an error, no answer in time), the sessions that ended
 * here are recorded, and the route is called again once a page of this
 * browser can reach it: when the connection comes back, or when the next
 * page loads.
 *
 * The later call clears whatever cookie the browser then holds. So it is
 * made only while no newer session has been seen in this browser; a page
 * rendered under another cookie drops the record instead.
 *
 * Nothing here is a secret: a tag is a digest of the cookie, not the cookie.
 */

import {
  browserCookieJar, browserMarkStore, type CookieJar, currentSession, currentSessionInCookie, endAfterLogout, endSessions, endSessionsInCookie,
  type MarkStore,
} from "./session-marks";

export const PENDING_LOGOUT_KEY = "ductus-logout-pending";
/** The Web Lock under which one tab of the browser makes the later call. */
export const PENDING_LOGOUT_LOCK = "ductus-logout-pending";
/** How long a sign-out waits for the logout route before it ends on the device. */
export const LOGOUT_TIMEOUT_MS = 8_000;
const PENDING_LIMIT = 16;

/** The sessions whose server part of the sign-out has not been done. */
export function pendingLogout(store: MarkStore | null): string[] {
  if (!store) return [];
  try {
    const raw: unknown = JSON.parse(store.getItem(PENDING_LOGOUT_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((tag): tag is string => typeof tag === "string") : [];
  } catch {
    return [];
  }
}

/** Records these sessions as ended here only; a second tab's record joins the first. */
export function holdServerLogout(store: MarkStore | null, tags: readonly string[]): boolean {
  if (!store) return false;
  try {
    const held = pendingLogout(store).filter((tag) => !tags.includes(tag));
    store.setItem(PENDING_LOGOUT_KEY, JSON.stringify([...held, ...tags].slice(-PENDING_LIMIT)));
    return true;
  } catch {
    return false;
  }
}

/**
 * Ends a sign-out on this device and returns the sessions that ended, for the
 * other tabs. `before` is the session the browser recorded when the request
 * was sent. An answered route cleared the cookie the browser held, so the
 * session recorded last ended too. Without an answer only the page's own
 * session and `before` end and wait for the route: a session that became
 * current while the request was on its way (another tab signed in) stays
 * current, so the later call is dropped instead of ending it.
 */
export function endSignOut(
  store: MarkStore | null, tag: string | null, before: string | null, reached: boolean,
  jar: CookieJar | null = browserCookieJar(),
): string[] {
  if (reached) return endAfterLogout(store, tag, jar);
  const tags = [...new Set([tag, before].filter((one): one is string => one !== null))];
  if (endSessions(store, tags)) {
    holdServerLogout(store, tags);
  } else {
    // localStorage refused the record: the cookie fences a reload instead
    // (#1444). No later call is recorded, since a newer session could not be
    // recorded here either and the call would end it; the next sign-in
    // closes this session on the server.
    endSessionsInCookie(jar, tags);
  }
  return tags;
}

export function dropPendingLogout(store: MarkStore | null): void {
  try {
    store?.removeItem(PENDING_LOGOUT_KEY);
  } catch {
    // Nothing recorded can be read either.
  }
}

/**
 * What to do about a recorded sign-out: nothing ("none"), drop it because a
 * newer session became current here ("drop"), or call the route ("retry").
 * The server-rendered page must also belong to a pending session (or have
 * no session). A missing storage mark alone cannot establish that: recording
 * a newer page may have failed even though the pending record is readable.
 */
export function pendingLogoutStep(
  store: MarkStore | null, pageTag: string | null | undefined = undefined, jar: CookieJar | null = browserCookieJar(),
): "none" | "drop" | "retry" {
  const pending = pendingLogout(store);
  if (pending.length === 0) return "none";
  if (pageTag === undefined) return "none";
  if (pageTag !== null && !pending.includes(pageTag)) return "drop";
  const cookieSession = currentSessionInCookie(jar);
  if (cookieSession?.tag != null && !pending.includes(cookieSession.tag)) return "drop";
  const current = currentSession(store);
  return current !== null && !pending.includes(current.tag) ? "drop" : "retry";
}

/**
 * POST to the logout route; true only for its redirect, which comes after
 * the session was closed and the cookie cleared. A lost request, an error
 * status and no answer within `timeoutMs` are false.
 */
export async function postLogout(
  fetcher: typeof fetch = fetch, timeoutMs: number = LOGOUT_TIMEOUT_MS,
): Promise<boolean> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const response = await fetcher("/api/auth/logout", {
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
 * After the route answered: the same POST once more, natively, so the browser
 * follows the route's redirect on to the provider's logout (DAN-212); the
 * fetch cannot follow it. It arrives without the cookie, so it closes nothing
 * twice. A form of its own, so it holds while the page re-renders.
 */
export function followLogoutNatively(): void {
  const form = document.createElement("form");
  form.method = "post";
  form.action = "/api/auth/logout";
  form.hidden = true;
  document.body.append(form);
  form.submit();
}

export type PendingLogoutEnv = {
  /** Server-rendered session; undefined means it has not been observed yet. */
  pageTag: string | null | undefined;
  jar?: CookieJar | null;
  store: MarkStore | null;
  post: () => Promise<boolean>;
  /** Goes on to the provider's logout; leaves the page. */
  follow: () => void;
};

/**
 * Makes the recorded server part of a sign-out, if any. Resolves true once the
 * route answered and the page goes on to the provider's logout; a call that
 * fails keeps the record for the next chance.
 */
export async function completePendingLogout(env: PendingLogoutEnv): Promise<boolean> {
  const step = pendingLogoutStep(env.store, env.pageTag, env.jar);
  if (step === "drop") dropPendingLogout(env.store);
  if (step !== "retry") return false;
  if (!(await env.post())) return false;
  dropPendingLogout(env.store);
  env.follow();
  return true;
}

type Locks = Pick<LockManager, "request">;

/**
 * Runs `completePendingLogout` in one tab at a time: a tab that finds the lock
 * held leaves it to that one, which drops the record once the route answered.
 */
export async function completePendingLogoutOnce(env: PendingLogoutEnv, locks: Locks | null | undefined): Promise<boolean> {
  if (pendingLogoutStep(env.store, env.pageTag, env.jar) === "none") return false;
  if (!locks) return completePendingLogout(env);
  try {
    return await locks.request(PENDING_LOGOUT_LOCK, { ifAvailable: true }, async (lock) =>
      lock ? completePendingLogout(env) : false);
  } catch {
    return false;
  }
}

// The observer supplies this page's server-rendered tag before any retry.
// Retain it for the immediate retry from LocalDocument after local sign-out.
let renderedPageTag: string | null | undefined;

/** In the browser: calls the logout route for a sign-out that ended on this device only. */
export function resumePendingLogout(pageTag?: string | null): void {
  if (pageTag !== undefined) renderedPageTag = pageTag;
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  void completePendingLogoutOnce({ pageTag: renderedPageTag, store: browserMarkStore(), post: () => postLogout(), follow: followLogoutNatively }, locks);
}
