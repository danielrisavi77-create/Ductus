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

/** Whether a page rendered under `mark` belongs to a session that has ended. */
export function hasEnded(store: MarkStore | null, mark: SessionMark): boolean {
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
 * After the logout route answered: the page's own session and the one the
 * browser recorded last both ended, since the route cleared whatever cookie
 * the browser held. Returns the tags for the other tabs.
 */
export function endAfterLogout(store: MarkStore | null, tag: string | null): string[] {
  const tags = new Set<string>(tag === null ? [] : [tag]);
  const current = store ? readCurrent(store) : null;
  if (current) tags.add(current.tag);
  endSessions(store, [...tags]);
  return [...tags];
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
