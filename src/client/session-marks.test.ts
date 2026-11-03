import { describe, expect, it } from "vitest";

import {
  browserCookieJar, CURRENT_COOKIE, currentSessionInCookie, type CookieJar, CURRENT_KEY, ENDED_COOKIE, ENDED_KEY, endAfterLogout, endSessions,
  endSessionsInCookie, hasEnded, observeSession, type MarkStore,
} from "./session-marks";

// F-5, D-118: which tabs of one browser belong to a session that has ended.
// `at` is the server's render time; tags are made-up digests.

function memoryStore(): MarkStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

const A = "a".repeat(64);
const B = "b".repeat(64);

describe("session marks", () => {
  it("a signed-out session stays ended whatever time its pages carry", () => {
    const store = memoryStore();
    observeSession(store, A, 1_000);
    expect(endAfterLogout(store, A)).toEqual([A]);
    // A page of that session rendered later by the server's clock, or
    // stamped with any time at all, is still ended: no clock decides it.
    for (const at of [0, 999, 1_000, 5_000, Number.MAX_SAFE_INTEGER]) {
      expect(hasEnded(store, { tag: A, at })).toBe(true);
    }
    // The page of the ended session that mounts late does not revive it.
    expect(observeSession(store, A, 9_000)).toBeNull();
    expect(hasEnded(store, { tag: A, at: 9_000 })).toBe(true);
    // A new sign-in is a new cookie: never ended, even with an early time.
    expect(hasEnded(store, { tag: B, at: 0 })).toBe(false);
    expect(observeSession(store, B, 0)).toBeNull();
    expect(hasEnded(store, { tag: B, at: 0 })).toBe(false);
  });

  it("a sign-in that replaced the cookie ends the earlier session", () => {
    const store = memoryStore();
    expect(observeSession(store, A, 100)).toBeNull();
    expect(observeSession(store, B, 200)).toBe(A);
    expect(hasEnded(store, { tag: A, at: 100 })).toBe(true);
    expect(hasEnded(store, { tag: B, at: 200 })).toBe(false);
  });

  it("a page of the earlier session that mounts last changes nothing and is ended", () => {
    const store = memoryStore();
    observeSession(store, B, 200);
    expect(observeSession(store, A, 100)).toBeNull();
    expect(hasEnded(store, { tag: A, at: 100 })).toBe(true);
    expect(hasEnded(store, { tag: B, at: 200 })).toBe(false);
    expect(JSON.parse(store.getItem(CURRENT_KEY)!)).toEqual({ tag: B, at: 200 });
  });

  it("a page without a cookie ends the recorded session only if it was rendered later", () => {
    const store = memoryStore();
    observeSession(store, B, 200);
    expect(observeSession(store, null, 150)).toBeNull();
    expect(hasEnded(store, { tag: B, at: 200 })).toBe(false);
    expect(observeSession(store, null, 300)).toBe(B);
    expect(hasEnded(store, { tag: B, at: 200 })).toBe(true);
  });

  it("sign-out from a stale tab also ends the session the browser holds now", () => {
    const store = memoryStore();
    observeSession(store, A, 100);
    observeSession(store, B, 200);
    expect(endAfterLogout(store, A).sort()).toEqual([A, B]);
    expect(hasEnded(store, { tag: B, at: 200 })).toBe(true);
    expect(store.getItem(CURRENT_KEY)).toBeNull();
  });

  it("keeps the ended list short and survives damaged or refused storage", () => {
    const store = memoryStore();
    endSessions(store, Array.from({ length: 40 }, (_, i) => String(i)));
    expect(JSON.parse(store.getItem(ENDED_KEY)!)).toHaveLength(16);

    store.setItem(ENDED_KEY, "{not json");
    store.setItem(CURRENT_KEY, "[1,2]");
    expect(hasEnded(store, { tag: A, at: 1 })).toBe(false);
    expect(observeSession(store, A, 1)).toBeNull();
    expect(hasEnded(store, { tag: A, at: 1 })).toBe(false);

    const refusing: MarkStore = {
      getItem: () => { throw new DOMException("refused", "SecurityError"); },
      setItem: () => { throw new DOMException("refused", "SecurityError"); },
      removeItem: () => { throw new DOMException("refused", "SecurityError"); },
    };
    expect(hasEnded(refusing, { tag: A, at: 1 })).toBe(false);
    expect(observeSession(refusing, A, 1)).toBeNull();
    expect(endAfterLogout(refusing, A)).toEqual([A]);
    expect(hasEnded(null, { tag: A, at: 1 })).toBe(false);
  });
});

// c.6590579384: where localStorage refuses the record, the ended sessions go
// to a cookie that only this page's script reads. Tags are made-up digests.
describe("the ended-session cookie", () => {
  /** Holds what was last written, as `document.cookie` would list it. */
  function jar(listed = "", secure = false): CookieJar & { writes: string[] } {
    let cookies = listed;
    const writes: string[] = [];
    return {
      writes, secure,
      read: () => cookies,
      write: (cookie) => {
        writes.push(cookie);
        const pair = cookie.split(";")[0]!;
        cookies = [...cookies.split("; ").filter((one) => one && !one.startsWith(`${ENDED_COOKIE}=`)), pair].join("; ");
      },
    };
  }

  it("is written for the whole site, outlives a session, and is never sent cross-site", () => {
    const plain = jar();
    expect(endSessionsInCookie(plain, [A])).toBe(true);
    expect(plain.writes).toEqual([`${ENDED_COOKIE}=${A}; Path=/; Max-Age=86400; SameSite=Strict`]);
    const secure = jar("", true);
    expect(endSessionsInCookie(secure, [A])).toBe(true);
    expect(secure.writes[0]).toMatch(/; Secure$/);
  });

  it("joins the sessions already there, keeps other cookies, and stays short", () => {
    const one = jar(`other=1; ${ENDED_COOKIE}=${B}`);
    expect(endSessionsInCookie(one, [A])).toBe(true);
    expect(one.read()).toBe(`other=1; ${ENDED_COOKIE}=${B}.${A}`);
    expect(hasEnded(null, { tag: B, at: 0 }, one)).toBe(true);
    const many = jar();
    const tags = Array.from({ length: 12 }, (_, i) => i.toString(16).repeat(64));
    for (const tag of tags) endSessionsInCookie(many, [tag]);
    expect(many.read().split("=")[1]!.split(".")).toEqual(tags.slice(-8));
  });

  it("is false when the browser does not keep it, and a damaged value ends nobody", () => {
    const refusing: CookieJar = { read: () => "", write: () => {}, secure: false };
    expect(endSessionsInCookie(refusing, [A])).toBe(false);
    expect(endSessionsInCookie(null, [A])).toBe(false);
    const throwing: CookieJar = { read: () => { throw new Error("denied"); }, write: () => {}, secure: false };
    expect(endSessionsInCookie(throwing, [A])).toBe(false);
    expect(hasEnded(null, { tag: A, at: 0 }, throwing)).toBe(false);
    for (const listed of [`${ENDED_COOKIE}=`, `${ENDED_COOKIE}=%3Cx%3E.${"a".repeat(200)}`, `x${ENDED_COOKIE}=${A}`]) {
      expect(hasEnded(null, { tag: A, at: 0 }, jar(listed))).toBe(false);
    }
  });

  it("is not reachable outside a browser", () => {
    expect(browserCookieJar()).toBeNull();
  });
});

// The cookie is an independent observation when localStorage is unavailable.
describe("the current-session cookie", () => {
  function jar(secure = false): CookieJar & { writes: string[] } {
    let value = "other=1";
    const writes: string[] = [];
    return {
      secure, writes, read: () => value,
      write: (cookie) => {
        writes.push(cookie);
        value = `other=1; ${cookie.split(";")[0]}`;
      },
    };
  }

  it("records a newer page without storage and an older page cannot overwrite it", () => {
    const cookies = jar(true);
    observeSession(null, B, 200, cookies);
    observeSession(null, A, 100, cookies);
    expect(currentSessionInCookie(cookies)).toEqual({ tag: B, at: 200 });
    expect(cookies.writes).toEqual([`${CURRENT_COOKIE}=${B}.200; Path=/; Max-Age=86400; SameSite=Strict; Secure`]);
    observeSession(null, null, 300, cookies);
    expect(currentSessionInCookie(cookies)).toEqual({ tag: null, at: 300 });
    expect(cookies.read()).toContain("other=1");
  });

  it("does not throw for refused cookies or accept malformed values", () => {
    const denied: CookieJar = {
      secure: false, read: () => { throw new Error("denied"); }, write: () => { throw new Error("denied"); },
    };
    expect(observeSession(null, B, 200, denied)).toBeNull();
    expect(currentSessionInCookie(denied)).toBeNull();
    expect(currentSessionInCookie(null)).toBeNull();
    for (const value of ["", "b", "b.NaN", "b.", "b.200.extra", `${"a".repeat(129)}.200`]) {
      expect(currentSessionInCookie({ secure: false, read: () => `${CURRENT_COOKIE}=${value}`, write: () => {} })).toBeNull();
    }
  });
});
