import { describe, expect, it, vi } from "vitest";

import { watchSessionEnd, type SessionEndEnv } from "./session-end";
import { CURRENT_KEY, ENDED_KEY, type MarkStore } from "./session-marks";

const MARK = { tag: "tag-a", at: 1_000 };

function memoryStore(): MarkStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

function fakeEnv() {
  const store = memoryStore();
  const target = new EventTarget();
  const channel = { onmessage: null as ((event: MessageEvent) => void) | null, close: vi.fn() };
  const env: SessionEndEnv = {
    store,
    target: target as unknown as SessionEndEnv["target"],
    openChannel: () => channel,
  };
  const message = (data: unknown) => channel.onmessage?.({ data } as MessageEvent);
  return { env, store, target, channel, message };
}

describe("watchSessionEnd (F-093)", () => {
  it("hears a sign-out in another tab over the channel, once", () => {
    const { env, message } = fakeEnv();
    const onEnd = vi.fn();
    const watch = watchSessionEnd(MARK, onEnd, env);
    message("tag-other");
    expect(onEnd).not.toHaveBeenCalled();
    message("tag-a");
    message("tag-a");
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(watch.ended()).toBe(true);
  });

  it("hears another person signing in through storage and a restored page through pageshow", () => {
    for (const event of ["storage", "pageshow"]) {
      const { env, store, target } = fakeEnv();
      const onEnd = vi.fn();
      watchSessionEnd(MARK, onEnd, env);
      store.setItem(CURRENT_KEY, JSON.stringify({ tag: "tag-b", at: 2_000 }));
      expect(onEnd).not.toHaveBeenCalled();
      target.dispatchEvent(new Event(event));
      expect(onEnd).toHaveBeenCalledTimes(1);
    }
  });

  it("checks the record right away and on every ended() call", () => {
    const { env, store } = fakeEnv();
    store.setItem(ENDED_KEY, JSON.stringify(["tag-a"]));
    const early = vi.fn();
    watchSessionEnd(MARK, early, env);
    expect(early).toHaveBeenCalledTimes(1);

    const late = fakeEnv();
    const onEnd = vi.fn();
    const watch = watchSessionEnd(MARK, onEnd, late.env);
    expect(watch.ended()).toBe(false);
    // Another person's page recorded itself; no event reached this one yet.
    late.store.setItem(CURRENT_KEY, JSON.stringify({ tag: "tag-b", at: 2_000 }));
    expect(watch.ended()).toBe(true);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("stops listening when closed, and watches nothing without a mark", () => {
    const { env, target, channel, message } = fakeEnv();
    const onEnd = vi.fn();
    watchSessionEnd(MARK, onEnd, env).close();
    message("tag-a");
    target.dispatchEvent(new Event("storage"));
    expect(onEnd).not.toHaveBeenCalled();
    expect(channel.close).toHaveBeenCalled();

    const open = vi.fn();
    const none = watchSessionEnd(null, onEnd, { ...env, openChannel: open });
    expect(none.ended()).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});
