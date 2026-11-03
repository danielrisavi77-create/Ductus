import { describe, expect, it, vi, type Mock } from "vitest";

import {
  completePendingLogout, completePendingLogoutOnce, endSignOut, holdServerLogout, pendingLogout, pendingLogoutStep,
  PENDING_LOGOUT_KEY, PENDING_LOGOUT_LOCK, postLogout, resumePendingLogout, type PendingLogoutEnv,
} from "./pending-logout";
import {
  type CookieJar, CURRENT_KEY, currentSession, ENDED_COOKIE, endAfterLogout, hasEnded, observeSession, type MarkStore,
} from "./session-marks";

// #1330 (D-118): a sign-out the logout route did not answer still ends the
// session on this device; the route is called again later, and never once a
// newer session is current here. Tags are made-up digests.

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

function answer(type: ResponseType, status = 0): typeof fetch {
  return vi.fn(async () => ({ type, status }) as Response);
}

/** A store after a sign-out of A that ended on the device only. */
function signedOutOnDevice(): ReturnType<typeof memoryStore> {
  const store = memoryStore();
  observeSession(store, A, 1_000);
  holdServerLogout(store, endAfterLogout(store, A));
  return store;
}

function env(store: MarkStore, ok: boolean): PendingLogoutEnv & { post: Mock<() => Promise<boolean>>; follow: Mock<() => void> } {
  return { pageTag: A, store, post: vi.fn(async () => ok), follow: vi.fn<() => void>() };
}

describe("what the logout route's answer means", () => {
  it.each([
    ["row 1: the route redirected (signed out)", answer("opaqueredirect"), true],
    ["row 3: the server failed (5xx)", answer("basic", 503), false],
    ["row 3: the request was refused (403)", answer("basic", 403), false],
  ])("%s", async (_row, fetcher, reached) => {
    await expect(postLogout(fetcher)).resolves.toBe(reached);
  });

  it("row 2: no network (the request throws) is not reached", async () => {
    await expect(postLogout(vi.fn(async () => { throw new TypeError("Failed to fetch"); }))).resolves.toBe(false);
  });

  it("row 4: no answer in time is not reached, and the request is aborted", async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      const hanging = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        signal = init?.signal ?? undefined;
        signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })) as unknown as typeof fetch;
      const result = postLogout(hanging, 50);
      await vi.advanceTimersByTimeAsync(50);
      await expect(result).resolves.toBe(false);
      expect(signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the server part of a sign-out that ended on the device", () => {
  it("row 5: once the route answers, the record goes and the page follows on to the provider", async () => {
    const store = signedOutOnDevice();
    expect(pendingLogout(store)).toEqual([A]);
    // The browser holds A's cookie or none; nobody else's session is current.
    expect(pendingLogoutStep(store, A)).toBe("retry");
    const run = env(store, true);
    await expect(completePendingLogout(run)).resolves.toBe(true);
    expect(run.post).toHaveBeenCalledTimes(1);
    expect(run.follow).toHaveBeenCalledTimes(1);
    expect(store.data.has(PENDING_LOGOUT_KEY)).toBe(false);
  });

  it("row 5: a call that fails again keeps the record and leaves the page", async () => {
    const store = signedOutOnDevice();
    const run = env(store, false);
    await expect(completePendingLogout(run)).resolves.toBe(false);
    expect(run.follow).not.toHaveBeenCalled();
    expect(pendingLogout(store)).toEqual([A]);
  });

  it("a page loaded under the old cookie or without one still calls the route", async () => {
    for (const tag of [A, null]) {
      const store = signedOutOnDevice();
      // The ended session's page does not become current again (session-marks).
      observeSession(store, tag, 2_000);
      expect(pendingLogoutStep(store, tag)).toBe("retry");
      const run = { ...env(store, true), pageTag: tag };
      await expect(completePendingLogout(run)).resolves.toBe(true);
      expect(run.post).toHaveBeenCalledTimes(1);
    }
  });

  it("row 9 (negative): a newer session seen here drops the record, and the route is not called", async () => {
    const store = signedOutOnDevice();
    // Another person signed in: their first page records B as current.
    observeSession(store, B, 2_000);
    const run = env(store, true);
    await expect(completePendingLogout(run)).resolves.toBe(false);
    expect(run.post).not.toHaveBeenCalled();
    expect(run.follow).not.toHaveBeenCalled();
    expect(pendingLogout(store)).toEqual([]);
    // And it stays dropped: a later chance does nothing.
    expect(pendingLogoutStep(store, A)).toBe("none");
  });

  it("nothing recorded: no call", async () => {
    const store = memoryStore();
    observeSession(store, A, 1_000);
    const run = env(store, true);
    await expect(completePendingLogout(run)).resolves.toBe(false);
    expect(run.post).not.toHaveBeenCalled();
  });

  it("without storage nothing is recorded, and nothing is called later", async () => {
    expect(holdServerLogout(null, [A])).toBe(false);
    expect(pendingLogoutStep(null)).toBe("none");
  });

  it("a broken record reads as none", () => {
    const store = memoryStore();
    store.setItem(PENDING_LOGOUT_KEY, "{not json");
    expect(pendingLogout(store)).toEqual([]);
    store.setItem(PENDING_LOGOUT_KEY, JSON.stringify([A, 7, null]));
    expect(pendingLogout(store)).toEqual([A]);
  });
});

describe("Istodobnost", () => {
  it("sign-out in two tabs at once: both records join, and one call ends them", async () => {
    const store = memoryStore();
    observeSession(store, A, 1_000);
    // Two tabs of A, both without an answer: each records what it ended.
    holdServerLogout(store, endAfterLogout(store, A));
    holdServerLogout(store, endAfterLogout(store, A));
    expect(pendingLogout(store)).toEqual([A]);
    const first = env(store, true);
    const second = env(store, true);
    await completePendingLogout(first);
    // The other tab comes second: the record is gone, it calls nothing.
    await expect(completePendingLogout(second)).resolves.toBe(false);
    expect(first.post).toHaveBeenCalledTimes(1);
    expect(second.post).not.toHaveBeenCalled();
  });

  it("the connection returns in every tab at once: only the tab holding the lock calls the route", async () => {
    const store = signedOutOnDevice();
    let held = false;
    const locks = {
      request: vi.fn(async (_name: string, _options: LockOptions, run: (lock: Lock | null) => Promise<boolean>) => {
        if (held) return run(null);
        held = true;
        try {
          return await run({ name: PENDING_LOGOUT_LOCK, mode: "exclusive" });
        } finally {
          held = false;
        }
      }),
    } as unknown as Pick<LockManager, "request">;
    let finish: (ok: boolean) => void = () => {};
    const first: PendingLogoutEnv = { pageTag: A, store, post: () => new Promise((resolve) => { finish = resolve; }), follow: vi.fn() };
    const second = env(store, true);
    const running = completePendingLogoutOnce(first, locks);
    // While the first call is on its way, the second tab finds the lock held.
    await expect(completePendingLogoutOnce(second, locks)).resolves.toBe(false);
    expect(second.post).not.toHaveBeenCalled();
    finish(true);
    await expect(running).resolves.toBe(true);
    expect(pendingLogout(store)).toEqual([]);
  });

  it("the connection returns during the sign-out: the record written after the answer is still completed once", async () => {
    const store = memoryStore();
    observeSession(store, A, 1_000);
    // "online" fired before the record existed: nothing to do yet.
    expect(pendingLogoutStep(store, A)).toBe("none");
    holdServerLogout(store, endAfterLogout(store, A));
    const run = env(store, true);
    await completePendingLogoutOnce(run, null);
    await completePendingLogoutOnce(run, null);
    expect(run.post).toHaveBeenCalledTimes(1);
  });
});

describe("a sign-in in another tab while the sign-out waits for the route", () => {
  it("unanswered: the newer session stays current, and the later call is dropped, not made", async () => {
    const store = memoryStore();
    observeSession(store, A, 1_000);
    const before = currentSession(store)?.tag ?? null;
    // The request for A is on its way; another tab signs in as B.
    observeSession(store, B, 2_000);
    const ended = endSignOut(store, A, before, false);
    expect(ended).toEqual([A]);
    expect(currentSession(store)?.tag).toBe(B);
    expect(hasEnded(store, { tag: B, at: 2_000 })).toBe(false);
    expect(pendingLogoutStep(store, A)).toBe("drop");
    const run = env(store, true);
    await expect(completePendingLogout(run)).resolves.toBe(false);
    expect(run.post).not.toHaveBeenCalled();
  });

  it("unanswered, nobody signed in meanwhile: the page's session and the one recorded before end and wait", () => {
    const store = memoryStore();
    observeSession(store, A, 1_000);
    expect(endSignOut(store, A, currentSession(store)?.tag ?? null, false)).toEqual([A]);
    expect(currentSession(store)).toBeNull();
    expect(pendingLogout(store)).toEqual([A]);
    expect(pendingLogoutStep(store, A)).toBe("retry");
  });

  it("answered: the route cleared the cookie the browser held, so the session recorded last ends too", () => {
    const store = memoryStore();
    observeSession(store, A, 1_000);
    observeSession(store, B, 2_000);
    expect(endSignOut(store, A, A, true).sort()).toEqual([A, B]);
    expect(currentSession(store)).toBeNull();
    expect(pendingLogout(store)).toEqual([]);
  });
});


// c.6590579384, c.6590647037: the sign-out ends on the device even when
// localStorage refuses the record. After a reload under the same cookie the
// sheet must stay closed; the journal itself is kept (no rows are deleted
// here, only the fence is written).

/** `document.cookie` of one origin: a write sets one cookie, a read lists them. */
function memoryJar(): CookieJar & { cookies: Map<string, string>; writes: string[] } {
  const cookies = new Map<string, string>();
  const writes: string[] = [];
  return {
    cookies, writes, secure: false,
    read: () => [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
    write: (cookie) => {
      writes.push(cookie);
      const [pair = "", ...attributes] = cookie.split(";").map((part) => part.trim());
      const at = pair.indexOf("=");
      const name = pair.slice(0, at);
      if (attributes.some((one) => /^max-age=(0|-)/i.test(one))) cookies.delete(name);
      else cookies.set(name, pair.slice(at + 1));
    },
  };
}

function quota(): DOMException {
  return new DOMException("The quota has been exceeded.", "QuotaExceededError");
}

/** localStorage of a browser where A is current, then writes start failing (class 2) or everything does (class 3). */
const storeClasses: [string, () => MarkStore | null, boolean][] = [
  ["1: the write succeeds", () => { const s = memoryStore(); observeSession(s, A, 1_000); return s; }, true],
  ["2: the write throws QuotaExceededError, reads work", () => {
    const s = memoryStore();
    observeSession(s, A, 1_000);
    return { ...s, setItem: () => { throw quota(); } };
  }, false],
  ["3: neither reads nor writes work", () => ({
    getItem: () => { throw new DOMException("denied", "SecurityError"); },
    setItem: () => { throw new DOMException("denied", "SecurityError"); },
    removeItem: () => { throw new DOMException("denied", "SecurityError"); },
  }), false],
  ["3: no storage at all", () => null, false],
];

describe("a sign-out whose end cannot be written to localStorage (reload after logout)", () => {
  it.each(storeClasses)("class %s: a reload under the same cookie finds the session ended", (_name, makeStore, writable) => {
    const store = makeStore();
    const jar = memoryJar();
    expect(endSignOut(store, A, currentSession(store)?.tag ?? null, false, jar)).toEqual([A]);
    // The reload: a page of A, rendered later by the server, asks again.
    for (const at of [1_000, 5_000]) expect(hasEnded(store, { tag: A, at }, jar)).toBe(true);
    if (writable) {
      // localStorage holds the fence; no cookie is needed.
      expect(jar.writes).toEqual([]);
      expect(pendingLogout(store)).toEqual([A]);
    } else {
      expect(jar.cookies.has(ENDED_COOKIE)).toBe(true);
      // Without a working localStorage no later call is recorded: it could
      // not tell a newer session from A's (see Istodobnost below).
      expect(pendingLogoutStep(store, A)).toBe("none");
    }
  });

  it("class 2 without the cookie fallback would reopen the sheet: the fence is the cookie", () => {
    const store = storeClasses[1]![1]();
    endSignOut(store, A, A, false, memoryJar());
    expect(hasEnded(store, { tag: A, at: 1_000 }, null)).toBe(false);
  });

  it.each(storeClasses.slice(1))(
    "Istodobnost (negative), class %s: B signing in after A's sign-out is not ended, and no call is made under B's cookie",
    async (_name, makeStore) => {
      const store = makeStore();
      const jar = memoryJar();
      endSignOut(store, A, currentSession(store)?.tag ?? null, false, jar);
      // Another person signs in; the browser now holds B's cookie.
      observeSession(store, B, 2_000);
      expect(hasEnded(store, { tag: B, at: 2_000 }, jar)).toBe(false);
      expect(hasEnded(store, { tag: A, at: 1_000 }, jar)).toBe(true);
      expect(pendingLogoutStep(store, A)).toBe("none");
      const run = { ...env(memoryStore(), true), store };
      await expect(completePendingLogout(run)).resolves.toBe(false);
      expect(run.post).not.toHaveBeenCalled();
    },
  );

  it.each(storeClasses)("class %s, the route answered: a page of A that loads later finds the session ended", (_name, makeStore, writable) => {
    const store = makeStore();
    const jar = memoryJar();
    expect(endSignOut(store, A, currentSession(store)?.tag ?? null, true, jar)).toEqual([A]);
    for (const at of [1_000, 5_000]) expect(hasEnded(store, { tag: A, at }, jar)).toBe(true);
    // The route answered: nothing waits for a later call, in any class.
    expect(pendingLogoutStep(store, A)).toBe("none");
    if (writable) expect(jar.writes).toEqual([]);
    else expect(jar.cookies.has(ENDED_COOKIE)).toBe(true);
  });

  it.each(storeClasses.slice(1))(
    "Istodobnost (negative), class %s: a second tab of A reads before and after an answered sign-out, then B signs in and the connection returns",
    async (_name, makeStore) => {
      const store = makeStore();
      const jar = memoryJar();
      const late = { tag: A, at: 1_000 };
      // The second tab's first read (mount), before the sign-out: still A's.
      expect(hasEnded(store, late, jar)).toBe(false);
      endSignOut(store, A, currentSession(store)?.tag ?? null, true, jar);
      // It missed the channel; its second read (under the journal lock) must stop it.
      expect(hasEnded(store, late, jar)).toBe(true);
      // Another person signs in, and this store cannot record it either.
      observeSession(store, B, 2_000);
      expect(hasEnded(store, { tag: B, at: 2_000 }, jar)).toBe(false);
      // The connection comes back: no call is made under B's cookie.
      const run = { ...env(memoryStore(), true), store };
      await expect(completePendingLogoutOnce(run, null)).resolves.toBe(false);
      expect(run.post).not.toHaveBeenCalled();
      expect(run.follow).not.toHaveBeenCalled();
    },
  );

  it("a store that ends the session but cannot hold the later call still fences A", () => {
    const s = memoryStore();
    observeSession(s, A, 1_000);
    const store: MarkStore = {
      ...s,
      setItem: (key, value) => { if (key === PENDING_LOGOUT_KEY) throw quota(); s.setItem(key, value); },
    };
    const jar = memoryJar();
    endSignOut(store, A, A, false, jar);
    expect(hasEnded(store, { tag: A, at: 1_000 }, null)).toBe(true);
    expect(jar.writes).toEqual([]);
  });
});

// c.6592365510 / c.6592412800: the record predates the storage failure.
describe("Istodobnost: storage fails after the pending sign-out was recorded", () => {
  const failures: [string, (backing: ReturnType<typeof memoryStore>) => MarkStore | null][] = [
    ["class 1: healthy storage", (s) => s],
    ["class 2: quota on writes", (s) => ({ ...s, setItem: () => { throw quota(); } })],
    ["class 2: only the current-session write fails", (s) => ({
      ...s, setItem: (key, value) => { if (key === CURRENT_KEY) throw quota(); s.setItem(key, value); },
    })],
    ["class 3: all access denied", () => ({
      getItem: () => { throw new DOMException("denied", "SecurityError"); },
      setItem: () => { throw new DOMException("denied", "SecurityError"); },
      removeItem: () => { throw new DOMException("denied", "SecurityError"); },
    })],
    ["class 3: current-session read denied", (s) => ({
      ...s, getItem: (key) => { if (key === CURRENT_KEY) throw quota(); return s.getItem(key); },
      setItem: () => { throw quota(); },
    })],
    ["class 3: reads work, writes and removal denied", (s) => ({
      ...s, setItem: () => { throw quota(); }, removeItem: () => { throw quota(); },
    })],
    ["class 3: no storage", () => null],
  ];

  it.each(failures)("%s: the newly rendered page never posts the earlier logout", async (_name, fail) => {
    const backing = memoryStore();
    observeSession(backing, A, 1_000);
    endSignOut(backing, A, A, false, memoryJar());
    expect(pendingLogout(backing)).toEqual([A]);
    expect(currentSession(backing)).toBeNull();
    const store = fail(backing);
    // The cookie has changed. This is the actual SessionObserver ordering.
    observeSession(store, B, 2_000);
    const run = { ...env(backing, true), store, pageTag: B };
    await expect(completePendingLogoutOnce(run, null)).resolves.toBe(false);
    await expect(completePendingLogoutOnce(run, null)).resolves.toBe(false);
    expect(run.post).not.toHaveBeenCalled();
    expect(run.follow).not.toHaveBeenCalled();
  });

  it("rechecks the rendered page after acquiring the lock even when removing the record fails", async () => {
    const backing = signedOutOnDevice();
    const store: MarkStore = {
      ...backing, setItem: () => { throw quota(); }, removeItem: () => { throw quota(); },
    };
    const run = { ...env(store, true), pageTag: B };
    const locks = {
      request: vi.fn(async (_name: string, _options: LockOptions, call: (lock: Lock | null) => Promise<boolean>) => {
        observeSession(store, B, 2_000);
        return call({ name: PENDING_LOGOUT_LOCK, mode: "exclusive" });
      }),
    } as unknown as Pick<LockManager, "request">;
    await expect(completePendingLogoutOnce(run, locks)).resolves.toBe(false);
    expect(run.post).not.toHaveBeenCalled();
    expect(run.follow).not.toHaveBeenCalled();
    expect(pendingLogout(backing)).toEqual([A]);
  });
});


describe("a pending sign-out without a server-rendered session context", () => {
  it("leaves the record and never calls the route until the page is known", async () => {
    const store = signedOutOnDevice();
    const run = { ...env(store, true), pageTag: undefined };
    expect(pendingLogoutStep(store)).toBe("none");
    await expect(completePendingLogoutOnce(run, null)).resolves.toBe(false);
    expect(run.post).not.toHaveBeenCalled();
    expect(pendingLogout(store)).toEqual([A]);
    await expect(completePendingLogoutOnce({ ...run, pageTag: A }, null)).resolves.toBe(true);
    expect(run.post).toHaveBeenCalledTimes(1);
  });
});


describe("the browser retry entry point", () => {
  it("keeps the observer's page context for immediate retries when storage writes and removal fail", async () => {
    const backing = signedOutOnDevice();
    const store: MarkStore = {
      ...backing, setItem: () => { throw quota(); }, removeItem: () => { throw quota(); },
    };
    const fetcher = answer("opaqueredirect");
    vi.stubGlobal("localStorage", store);
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("fetch", fetcher);
    try {
      observeSession(store, B, 2_000);
      resumePendingLogout(B);
      await Promise.resolve();
      resumePendingLogout();
      await Promise.resolve();
      expect(fetcher).not.toHaveBeenCalled();
      expect(pendingLogout(backing)).toEqual([A]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});


describe("Istodobnost: an older tab after storage recovers", () => {
  it.each(["quota", "denied", "missing"])("%s: a newer observation survives the storage failure and an older page cannot retry", async (failure) => {
    const backing = signedOutOnDevice();
    const jar = memoryJar();
    const broken: MarkStore | null = failure === "missing" ? null : {
      ...backing,
      getItem: (key) => { if (failure === "denied") throw quota(); return backing.getItem(key); },
      setItem: () => { throw quota(); },
      removeItem: () => { throw quota(); },
    };
    observeSession(broken, B, 2_000, jar);
    // A missed B's channel. Storage later recovers before A's online event.
    // Re-observing the older page must not erase the newer cookie mark.
    observeSession(backing, A, 1_000, jar);
    const run = { ...env(backing, true), pageTag: A, jar };
    await expect(completePendingLogoutOnce(run, null)).resolves.toBe(false);
    expect(run.post).not.toHaveBeenCalled();
    expect(run.follow).not.toHaveBeenCalled();
    expect(pendingLogout(backing)).toEqual([]);
  });
});

it.each([A, null])("keeps ordinary retries on a page with cookie observation %s", async (pageTag) => {
  const backing = signedOutOnDevice();
  const jar = memoryJar();
  observeSession(backing, pageTag, 2_000, jar);
  const run = { ...env(backing, true), pageTag, jar };
  await expect(completePendingLogoutOnce(run, null)).resolves.toBe(true);
  expect(run.post).toHaveBeenCalledTimes(1);
  expect(run.follow).toHaveBeenCalledTimes(1);
});
