import { describe, expect, it } from "vitest";

import {
  browserCookieJar, type CookieJar, CURRENT_KEY, currentSession, ENDED_COOKIE, ENDED_KEY, endAfterLogout, endSessions,
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

  it("sign-out from a stale tab ends only its own session, never the one current now", () => {
    const store = memoryStore();
    observeSession(store, A, 100);
    observeSession(store, B, 200);
    expect(endAfterLogout(store, A, null)).toEqual([A]);
    expect(hasEnded(store, { tag: A, at: 100 }, null)).toBe(true);
    expect(hasEnded(store, { tag: B, at: 200 }, null)).toBe(false);
    expect(JSON.parse(store.getItem(CURRENT_KEY)!)).toEqual({ tag: B, at: 200 });
    expect(endAfterLogout(store, null, null)).toEqual([]);
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

/** Holds the cookies as `document.cookie` lists them: one per name, a write replaces its own name only. */
function jar(listed = "", secure = false): CookieJar & { writes: string[] } {
  const cookies = new Map<string, string>();
  const set = (pair: string) => {
    const at = pair.indexOf("=");
    if (at > 0) cookies.set(pair.slice(0, at), pair.slice(at + 1));
  };
  for (const pair of listed.split("; ")) set(pair);
  const writes: string[] = [];
  return {
    writes, secure, read: () => [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
    write: (cookie) => {
      writes.push(cookie);
      set(cookie.split(";")[0]!);
    },
  };
}

/** A tab's view of the shared cookies whose first write waits until `other` has run to the end. */
function tabOf(shared: CookieJar, other: () => void): CookieJar {
  let waiting = true;
  return {
    secure: shared.secure, read: () => shared.read(),
    write: (cookie) => {
      if (waiting) { waiting = false; other(); }
      shared.write(cookie);
    },
  };
}

// #1444: the ended sessions also go to a cookie only this page's script writes; the server reads it (DAN-99).
describe("the ended-session cookie", () => {
  it("is one cookie per session for the whole site, sent like the session cookie (Lax), and leaves the others alone", () => {
    const one = jar(`other=1; ${ENDED_COOKIE}-${B}=1`, true);
    expect(endSessionsInCookie(one, [A])).toBe(true);
    expect(one.writes).toEqual([`${ENDED_COOKIE}-${A}=1; Path=/; Max-Age=86400; SameSite=Lax; Secure`]);
    expect(one.read()).toBe(`other=1; ${ENDED_COOKIE}-${B}=1; ${ENDED_COOKIE}-${A}=1`);
    expect(hasEnded(null, { tag: B, at: 0 }, one)).toBe(true);
    expect(endSessionsInCookie(jar(), ["<x>"])).toBe(false);
  });

  it("still reads the older shared list, and never writes it again", () => {
    const old = jar(`${ENDED_COOKIE}=${B}.${A}`);
    expect(hasEnded(null, { tag: A, at: 0 }, old)).toBe(true);
    expect(hasEnded(null, { tag: B, at: 0 }, old)).toBe(true);
    const C = "c".repeat(64);
    expect(endSessionsInCookie(old, [C])).toBe(true);
    expect(old.writes).toEqual([`${ENDED_COOKIE}-${C}=1; Path=/; Max-Age=86400; SameSite=Lax`]);
    for (const tag of [A, B, C]) expect(hasEnded(null, { tag, at: 0 }, old)).toBe(true);
  });

  it("a damaged value ends nobody, and there is none outside a browser", () => {
    const damaged = [
      `${ENDED_COOKIE}=`, `${ENDED_COOKIE}=%3Cx%3E.${"a".repeat(200)}`, `x${ENDED_COOKIE}=${A}`,
      `${ENDED_COOKIE}-=1`, `${ENDED_COOKIE}-%3C${A}=1`, `x${ENDED_COOKIE}-${A}=1`, `${ENDED_COOKIE}-${"a".repeat(200)}=1`,
    ];
    for (const listed of damaged) {
      expect(hasEnded(null, { tag: A, at: 0 }, jar(listed))).toBe(false);
    }
    expect(browserCookieJar()).toBeNull();
  });
});

// #1444 krug 3 (review c.6631169868, QA c.6631283361): two tabs sign out A and
// B at once while localStorage refuses; one tab's write never removes the other's mark.
describe("two tabs ending different sessions at once", () => {
  const refused = () => { throw new DOMException("refused", "SecurityError"); };
  const refusing: MarkStore = { getItem: refused, setItem: refused, removeItem: refused };
  const orders: [string, string, string][] = [["B then A", B, A], ["A then B", A, B]];
  for (const [name, first, last] of orders) {
    it(`both read the same start, ${name} write and check, both stay ended`, () => {
      const shared = jar();
      const lastTab = tabOf(shared, () => {
        expect(endAfterLogout(refusing, first, shared)).toEqual([first]);
        expect(endSessionsInCookie(shared, [first])).toBe(true);
        expect(hasEnded(refusing, { tag: first, at: 0 }, shared)).toBe(true);
      });
      // Both tabs read the same start: nobody ended yet.
      expect(hasEnded(refusing, { tag: first, at: 0 }, shared)).toBe(false);
      expect(hasEnded(refusing, { tag: last, at: 0 }, lastTab)).toBe(false);
      expect(endAfterLogout(refusing, last, lastTab)).toEqual([last]);
      expect(endSessionsInCookie(shared, [last])).toBe(true);
      // A reload under either session's cookie, rendered later by any clock.
      expect(hasEnded(refusing, { tag: first, at: 9_000 }, shared)).toBe(true);
      expect(hasEnded(refusing, { tag: last, at: 9_000 }, shared)).toBe(true);
      expect(hasEnded(null, { tag: first, at: 0 }, jar(shared.read()))).toBe(true);
    });
  }
});

// #1444 t.2, t.3: the sign-out mark goes to localStorage and to the cookie,
// each whatever the other did; the session current at that time is untouched.
describe("the sign-out fence", () => {
  const fail = () => { throw new DOMException("full", "QuotaExceededError"); };
  const stores: [string, () => MarkStore | null, boolean][] = [
    ["works", () => memoryStore(), true],
    ["setItem throws", () => ({ ...memoryStore(), setItem: fail }), false],
    ["everything throws", () => ({ getItem: fail, setItem: fail, removeItem: fail }), false],
    ["absent", () => null, false],
  ];
  const jars: [string, () => CookieJar | null, boolean][] = [
    ["works", () => jar(), true],
    ["not kept", () => ({ secure: false, read: () => "", write: () => {} }), false],
    ["read throws", () => ({ secure: false, read: fail, write: () => {} }), false],
    ["absent", () => null, false],
  ];
  for (const [storeName, makeStore, storeKeeps] of stores) {
    for (const [jarName, makeJar, jarKeeps] of jars) {
      it(`storage ${storeName}, cookie ${jarName}`, () => {
        const store = makeStore();
        const cookies = makeJar();
        expect(endAfterLogout(store, A, cookies)).toEqual([A]);
        expect(endSessionsInCookie(cookies, [A])).toBe(jarKeeps);
        if (storeKeeps) expect(JSON.parse(store!.getItem(ENDED_KEY)!)).toEqual([A]);
        expect(hasEnded(null, { tag: A, at: 0 }, cookies)).toBe(jarKeeps);
        // A reload under the cookie that stays, rendered later by any clock.
        expect(hasEnded(store, { tag: A, at: 9_000 }, cookies)).toBe(storeKeeps || jarKeeps);
        expect(hasEnded(store, { tag: B, at: 0 }, cookies)).toBe(false);
      });
    }
  }

  it("B signing in while A's sign-out waits stays current; refused storage after it keeps B open (N1, N3)", () => {
    const store = memoryStore();
    const cookies = jar();
    observeSession(store, A, 100);
    const own = currentSession(store)!.tag; // taken at the click
    expect(observeSession(store, B, 200)).toBe(A); // the other tab's sign-in
    expect(endAfterLogout(store, own, cookies)).toEqual([A]); // the timeout
    expect(currentSession(store)).toEqual({ tag: B, at: 200 });
    expect(hasEnded(store, { tag: B, at: 200 }, cookies)).toBe(false);
    expect(hasEnded(store, { tag: A, at: 300 }, cookies)).toBe(true);
    // N3: storage works at A's sign-out and refuses at the next sign-in.
    const later = memoryStore();
    observeSession(later, A, 100);
    endAfterLogout(later, A, jar());
    const refusing = { ...later, setItem: fail };
    expect(observeSession(refusing, B, 200)).toBeNull();
    expect(hasEnded(refusing, { tag: B, at: 200 }, jar())).toBe(false);
  });
});
