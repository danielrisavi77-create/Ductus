import { describe, expect, it } from "vitest";

import {
  CURRENT_KEY, ENDED_KEY, endAfterLogout, endSessions, hasEnded, observeSession, type MarkStore,
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
