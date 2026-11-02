import { describe, expect, it, vi, type Mock } from "vitest";

import {
  completePendingLogout, completePendingLogoutOnce, holdServerLogout, pendingLogout, pendingLogoutStep,
  PENDING_LOGOUT_KEY, PENDING_LOGOUT_LOCK, postLogout, type PendingLogoutEnv,
} from "./pending-logout";
import { endAfterLogout, observeSession, type MarkStore } from "./session-marks";

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
  return { store, post: vi.fn(async () => ok), follow: vi.fn<() => void>() };
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
    expect(pendingLogoutStep(store)).toBe("retry");
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
      expect(pendingLogoutStep(store)).toBe("retry");
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
    expect(pendingLogoutStep(store)).toBe("none");
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
    const first: PendingLogoutEnv = { store, post: () => new Promise((resolve) => { finish = resolve; }), follow: vi.fn() };
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
    expect(pendingLogoutStep(store)).toBe("none");
    holdServerLogout(store, endAfterLogout(store, A));
    const run = env(store, true);
    await completePendingLogoutOnce(run, null);
    await completePendingLogoutOnce(run, null);
    expect(run.post).toHaveBeenCalledTimes(1);
  });
});
