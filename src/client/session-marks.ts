/**
 * Which session cookie a page of this browser was rendered under, and which
 * of those have ended (F-5, D-118). A tab whose session has ended, by a
 * sign-out or by another person signing in, stops showing and saving the
 * text, so the next person at the browser cannot read or write it.
 *
 * Ordering never uses this computer's clock: `at` is the server's time of the
 * render. One browser holds one session cookie at a time and a new sign-in is
 * always a new token, so of two pages with different tags the later render is
 * the live one.
 *
 * Nothing here is a secret: a tag is a digest of the cookie, not the cookie.
 */
export type SessionMark = { tag: string; at: number };

/** The storage calls used here; `localStorage` in the browser. */
export type MarkStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const SESSION_END_CHANNEL = "ductus-session-end";
export const CURRENT_KEY = "ductus-session-current";
export const ENDED_KEY = "ductus-session-ended";
/** Older entries are dropped; a later page outranks those tabs anyway. */
const ENDED_LIMIT = 16;

function readCurrent(store: MarkStore): SessionMark | null {
  try {
    const raw: unknown = JSON.parse(store.getItem(CURRENT_KEY) ?? "null");
    if (typeof raw !== "object" || raw === null) return null;
    const { tag, at } = raw as Record<string, unknown>;
    return typeof tag === "string" && typeof at === "number" && Number.isFinite(at) ? { tag, at } : null;
  } catch {
    return null;
  }
}

function readEnded(store: MarkStore): string[] {
  try {
    const raw: unknown = JSON.parse(store.getItem(ENDED_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((tag): tag is string => typeof tag === "string") : [];
  } catch {
    return [];
  }
}

/** The session the browser recorded last, or null when none is current. */
export function currentSession(store: MarkStore | null): SessionMark | null {
  if (!store) return null;
  try {
    return readCurrent(store);
  } catch {
    return null;
  }
}

/**
 * The ended sessions also go to cookies, read by this page's script, for
 * where localStorage refuses the record (#1444). The server reads them only to
 * show a session signed out here as the public home, not as expired (#1929;
 * src/server/auth/ended-mark.ts). Each ended session has its own
 * cookie, `ductus-ended-<tag>`, so a write never reads or replaces another
 * tab's mark. It outlives a session. SameSite=Lax, not Strict: the way back
 * from the provider's sign-out is a navigation from another site, and "/"
 * must still see the mark (#1929).
 */
export const ENDED_COOKIE = "ductus-ended";
const ENDED_COOKIE_PREFIX = `${ENDED_COOKIE}-`;
const ENDED_COOKIE_MAX_AGE_S = 86_400;
const COOKIE_TAG = /^[0-9A-Za-z_-]{1,128}$/;

/** `document.cookie`: a read lists the cookies, a write sets one. */
export type CookieJar = { read(): string; write(cookie: string): void; secure: boolean };

/** `document.cookie`, or null outside a browser. */
export function browserCookieJar(): CookieJar | null {
  try {
    if (typeof document === "undefined") return null;
    return {
      read: () => document.cookie,
      write: (cookie) => { document.cookie = cookie; },
      secure: location.protocol === "https:",
    };
  } catch {
    return null;
  }
}

/**
 * Every ended tag the cookies hold: one `ductus-ended-<tag>` per session, and
 * the older shared `ductus-ended=<tag>.<tag>` list, read only for the change-over.
 */
function readEndedCookie(jar: CookieJar | null): string[] {
  if (!jar) return [];
  const tags: string[] = [];
  try {
    for (const part of jar.read().split(";")) {
      const pair = part.trim();
      const at = pair.indexOf("=");
      if (at < 0) continue;
      const name = pair.slice(0, at);
      if (name === ENDED_COOKIE) {
        tags.push(...pair.slice(at + 1).split(".").filter((tag) => COOKIE_TAG.test(tag)));
      } else if (name.startsWith(ENDED_COOKIE_PREFIX)) {
        const tag = name.slice(ENDED_COOKIE_PREFIX.length);
        if (COOKIE_TAG.test(tag)) tags.push(tag);
      }
    }
  } catch {
    // An unreadable cookie ends nobody.
  }
  return tags;
}

/** Records the ended sessions, one cookie each; true once a read finds them all. */
export function endSessionsInCookie(jar: CookieJar | null, tags: readonly string[]): boolean {
  if (!jar) return false;
  try {
    for (const tag of tags) {
      if (!COOKIE_TAG.test(tag)) continue;
      jar.write(`${ENDED_COOKIE_PREFIX}${tag}=1; Path=/; Max-Age=${ENDED_COOKIE_MAX_AGE_S}; SameSite=Lax${jar.secure ? "; Secure" : ""}`);
    }
    const written = readEndedCookie(jar);
    return tags.every((tag) => written.includes(tag));
  } catch {
    return false;
  }
}

/** Whether a page rendered under `mark` belongs to a session that has ended. */
export function hasEnded(store: MarkStore | null, mark: SessionMark, jar: CookieJar | null = browserCookieJar()): boolean {
  if (readEndedCookie(jar).includes(mark.tag)) return true;
  if (!store) return false;
  try {
    if (readEnded(store).includes(mark.tag)) return true;
    const current = readCurrent(store);
    return current !== null && current.tag !== mark.tag && current.at > mark.at;
  } catch {
    return false;
  }
}

/** Records that these sessions ended in this browser; returns false without storage. */
export function endSessions(store: MarkStore | null, tags: readonly string[]): boolean {
  if (!store) return false;
  try {
    const ended = readEnded(store).filter((tag) => !tags.includes(tag));
    store.setItem(ENDED_KEY, JSON.stringify([...ended, ...tags].slice(-ENDED_LIMIT)));
    const current = readCurrent(store);
    if (current && tags.includes(current.tag)) store.removeItem(CURRENT_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * Sign-out, answered or not (#1444): ends only the session `tag` taken at the
 * click, in localStorage and in the cookie, each whatever the other did.
 */
export function endAfterLogout(
  store: MarkStore | null, tag: string | null, jar: CookieJar | null = browserCookieJar(),
): string[] {
  if (tag === null) return [];
  endSessions(store, [tag]);
  endSessionsInCookie(jar, [tag]);
  return [tag];
}

/**
 * Called by every page that knows the cookie it was rendered under (`tag`
 * null: no cookie). A page newer than the recorded one makes the recorded
 * session ended and becomes current; an older page changes nothing.
 * Returns the tag that ended here, for the other tabs.
 */
export function observeSession(store: MarkStore | null, tag: string | null, at: number): string | null {
  if (!store) return null;
  try {
    const current = readCurrent(store);
    if (current && current.at > at) return null;
    if (tag !== null && readEnded(store).includes(tag)) return null;
    if (current?.tag === tag) {
      store.setItem(CURRENT_KEY, JSON.stringify({ tag, at }));
      return null;
    }
    if (current) endSessions(store, [current.tag]);
    if (tag !== null) store.setItem(CURRENT_KEY, JSON.stringify({ tag, at }));
    return current?.tag ?? null;
  } catch {
    return null;
  }
}

/** `localStorage`, or null where the browser refuses it. */
export function browserMarkStore(): MarkStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
