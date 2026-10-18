import { describe, expect, it } from "vitest";

import { readOnline, subscribeOnline, type OnlineSource } from "./online-status";

/** A made-up window whose network a test switches. */
function fakeWindow(onLine: boolean) {
  const listeners = new Map<string, Set<() => void>>();
  const source = {
    navigator: { onLine },
    addEventListener(type: string, listener: () => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener(type: string, listener: () => void) {
      listeners.get(type)?.delete(listener);
    },
  };
  const set = (next: boolean) => {
    source.navigator.onLine = next;
    for (const listener of listeners.get(next ? "online" : "offline") ?? []) listener();
  };
  const count = () => [...listeners.values()].reduce((sum, group) => sum + group.size, 0);
  return { source: source as OnlineSource, set, count };
}

describe("online status (F-8, DAN-211)", () => {
  it("reads offline only when the browser says so", () => {
    expect(readOnline(fakeWindow(true).source)).toBe(true);
    expect(readOnline(fakeWindow(false).source)).toBe(false);
  });

  it("reports going offline and coming back", () => {
    const win = fakeWindow(true);
    const seen: boolean[] = [];
    subscribeOnline(win.source, () => seen.push(readOnline(win.source)));
    win.set(false);
    win.set(true);
    expect(seen).toEqual([false, true]);
  });

  it("stops listening once unsubscribed", () => {
    const win = fakeWindow(true);
    let calls = 0;
    const stop = subscribeOnline(win.source, () => calls++);
    expect(win.count()).toBe(2);
    stop();
    win.set(false);
    expect(calls).toBe(0);
    expect(win.count()).toBe(0);
  });
});
