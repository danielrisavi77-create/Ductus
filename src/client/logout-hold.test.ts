// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Dexie from "dexie";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";

import { nothingHeld, type LogoutPlan } from "@/components/editor/logout-plan";

import {
  editorPlan, editorSignOutPlan, LOGOUT_HOLD_LIMIT_MS, LOGOUT_LOAD_LIMIT_MS, readLogoutHold, shellLogoutStep, untilLoaded,
} from "./logout-hold";
import { CURRENT_KEY, ENDED_KEY } from "./session-marks";

// D-118 sign-out dialog (#476 c.6396619831 §6 U3, amendment c.6396707923).
const SCOPE = "a".repeat(64);
const NONE = { pending: 0, copies: 0, kept: false };

describe("readLogoutHold (U3)", () => {
  beforeEach(() => vi.stubGlobal("indexedDB", indexedDB));
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("without IndexedDB the device holds nothing, and the sign-out goes straight on", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const peek = vi.fn();
    const read = await readLogoutHold(SCOPE, { peek });
    expect(read).toBe("noStorage");
    expect(peek).not.toHaveBeenCalled();
    expect(shellLogoutStep(read)).toEqual({ kind: "plain" });
  });

  it.each([null, ""])("without a scope (%j) the outcome is unknown, never none", async (scope) => {
    const peek = vi.fn();
    const read = await readLogoutHold(scope, { peek });
    expect(read).toBe("unknown");
    expect(peek).not.toHaveBeenCalled();
    expect(shellLogoutStep(read)).toEqual({ kind: "dialogUnknown", plan: { unsaved: false, pending: null } });
  });

  describe("the page's session", () => {
    const PAGE = { tag: "made-up-tag-a", at: 100 };
    const HELD = { pending: 3, copies: 1, kept: true };
    function marks(entries: Record<string, unknown>) {
      const data = new Map(Object.entries(entries).map(([k, v]) => [k, JSON.stringify(v)]));
      return { getItem: (k: string) => data.get(k) ?? null, setItem: vi.fn(), removeItem: vi.fn() };
    }

    it.each([
      ["another person signed in later", { [CURRENT_KEY]: { tag: "made-up-tag-b", at: 200 } }],
      ["signed out in another tab", { [ENDED_KEY]: [PAGE.tag] }],
    ])("ended (%s): no read, the page leaves without a post", async (_name, entries) => {
      const peek = vi.fn(async () => HELD);
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      const read = await readLogoutHold(SCOPE, { peek, session: PAGE, store: marks(entries) });
      expect(peek).not.toHaveBeenCalled();
      expect(shellLogoutStep(read)).toEqual({ kind: "leave" });
      expect(fetch).not.toHaveBeenCalled();
    });

    it("still current: reads and shows what is held", async () => {
      const peek = vi.fn(async () => HELD);
      const read = await readLogoutHold(SCOPE, { peek, session: PAGE, store: marks({ [CURRENT_KEY]: PAGE }) });
      expect(peek).toHaveBeenCalledWith(SCOPE);
      expect(shellLogoutStep(read)).toEqual({ kind: "dialog", plan: { unsaved: false, pending: 3, copies: 1, kept: true } });
    });
  });

  it("reads the scope it was given", async () => {
    const peek = vi.fn(async () => ({ pending: 3, copies: 0, kept: true }));
    expect(await readLogoutHold(SCOPE, { peek })).toEqual({ pending: 3, copies: 0, kept: true });
    expect(peek).toHaveBeenCalledWith(SCOPE);
  });

  it.each([
    ["a rejected read", () => Promise.reject(new DOMException("Made-up", "SecurityError"))],
    ["a read that throws", () => { throw new Error("made-up open failure"); }],
  ])("%s is unknown", async (_name, peek) => {
    expect(await readLogoutHold(SCOPE, { peek: peek as never })).toBe("unknown");
  });

  it("a read that never ends is unknown after the limit, not before", async () => {
    vi.useFakeTimers();
    const pending = readLogoutHold(SCOPE, { peek: () => new Promise(() => {}) });
    let settled: unknown = "open";
    void pending.then((value) => { settled = value; });
    await vi.advanceTimersByTimeAsync(LOGOUT_HOLD_LIMIT_MS - 1);
    expect(settled).toBe("open");
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe("unknown");
    expect(LOGOUT_HOLD_LIMIT_MS).toBe(2_000);
  });

  it("uses the real journal read by default and creates no database", async () => {
    // Dexie took the browser's IndexedDB when it loaded; node has none.
    const saved = { ...Dexie.dependencies };
    Object.assign(Dexie.dependencies, { indexedDB, IDBKeyRange });
    try {
      const scope = "b".repeat(64);
      expect(await readLogoutHold(scope)).toEqual(NONE);
      expect((await indexedDB.databases()).some((d) => d.name === `ductus-journal-v1-${scope}`)).toBe(false);
    } finally {
      Object.assign(Dexie.dependencies, saved);
    }
  });
});

describe("editorSignOutPlan", () => {
  const PAGE = { tag: "made-up-tag-a", at: 100 };
  const HELD = { pending: 3, copies: 1, kept: true };
  function marks(entries: Record<string, unknown>) {
    const data = new Map(Object.entries(entries).map(([k, v]) => [k, JSON.stringify(v)]));
    return { getItem: (k: string) => data.get(k) ?? null, setItem: vi.fn(), removeItem: vi.fn() };
  }
  beforeEach(() => vi.stubGlobal("indexedDB", indexedDB));
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["another person signed in later", { [CURRENT_KEY]: { tag: "made-up-tag-b", at: 200 } }],
    ["signed out in another tab", { [ENDED_KEY]: [PAGE.tag] }],
  ])("ended (%s): nothing stops, nothing is read, the page leaves", async (_name, entries) => {
    const peek = vi.fn(async () => HELD);
    const quiesce = vi.fn(async () => true);
    const plan = await editorSignOutPlan(quiesce, SCOPE, { peek, session: PAGE, store: marks(entries) });
    expect(plan).toBe("leave");
    expect(quiesce).not.toHaveBeenCalled();
    expect(peek).not.toHaveBeenCalled();
  });

  it("still current: stops writing, then reads the scope", async () => {
    const order: string[] = [];
    const quiesce = vi.fn(async () => { order.push("quiesce"); return false; });
    const peek = vi.fn(async () => { order.push("peek"); return HELD; });
    const plan = await editorSignOutPlan(quiesce, SCOPE, { peek, session: PAGE, store: marks({ [CURRENT_KEY]: PAGE }) });
    expect(order).toEqual(["quiesce", "peek"]);
    expect(peek).toHaveBeenCalledWith(SCOPE);
    expect(plan).toEqual({ unsaved: false, pending: 3, copies: 1, kept: true });
  });

  it("without a held journal: no number and no read", async () => {
    const peek = vi.fn(async () => HELD);
    expect(await editorSignOutPlan(null, SCOPE, { peek, session: PAGE, store: marks({ [CURRENT_KEY]: PAGE }) }))
      .toEqual({ unsaved: false, pending: null });
    expect(peek).not.toHaveBeenCalled();
  });
});

describe("shellLogoutStep", () => {
  it("nothing held: no dialog", () => {
    expect(shellLogoutStep(NONE)).toEqual({ kind: "plain" });
  });

  it.each([
    [{ pending: 4, copies: 0, kept: true }],
    [{ pending: 0, copies: 2, kept: true }],
    [{ pending: 0, copies: 0, kept: true }],
  ])("anything held opens the dialog with what was read: %j", (hold) => {
    expect(shellLogoutStep(hold)).toEqual({
      kind: "dialog", plan: { unsaved: false, pending: hold.pending, copies: hold.copies, kept: true },
    });
  });
});

describe("editorPlan (O2)", () => {
  it("carries the whole scope's count, copies and kept", () => {
    expect(editorPlan(false, { pending: 5, copies: 1, kept: true })).toEqual({ unsaved: false, pending: 5, copies: 1, kept: true });
    expect(editorPlan(true, NONE)).toEqual({ unsaved: true, pending: 0, copies: 0, kept: false });
  });

  it.each(["unknown", "noStorage"] as const)("%s gives no number", (read) => {
    expect(editorPlan(false, read)).toEqual({ unsaved: false, pending: null });
  });
});

describe("untilLoaded (#874)", () => {
  const NONE_HELD = { pending: 0, copies: 0, kept: false };
  /** A tab like the provider's: a phase, the journal it holds once loaded, and wakes on change. */
  function tab() {
    const wakes = new Set<() => void>();
    const state = { loading: true, quiesce: null as (() => Promise<boolean>) | null };
    return {
      state,
      subscribe: (wake: () => void) => { wakes.add(wake); return () => { wakes.delete(wake); }; },
      wakes,
      load(quiesce: () => Promise<boolean>) {
        state.loading = false;
        state.quiesce = quiesce;
        for (const wake of [...wakes]) wake();
      },
      /** The provider's `prepareSignOut`, with the plan read only after the load. */
      prepare(peek: (s: string) => Promise<typeof NONE_HELD>, limitMs?: number) {
        return untilLoaded(() => state.loading, this.subscribe, limitMs)
          .then(() => editorSignOutPlan(state.quiesce, SCOPE, { peek, session: null, store: null }));
      },
    };
  }
  beforeEach(() => vi.stubGlobal("indexedDB", indexedDB));
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("while the journal is still read, no plan is decided: neither a dialog nor a sign-out", async () => {
    const t = tab();
    const peek = vi.fn(async () => NONE_HELD);
    let decided = false;
    void t.prepare(peek).then(() => { decided = true; });
    await new Promise((r) => setTimeout(r, 20));
    expect(decided).toBe(false);
    expect(peek).not.toHaveBeenCalled();
    t.load(async () => false);
  });

  it("once loaded, the plan is read from the journal: nothing held means no dialog (O1)", async () => {
    const t = tab();
    const peek = vi.fn(async () => NONE_HELD);
    const quiesce = vi.fn(async () => false);
    const plan = t.prepare(peek);
    t.load(quiesce);
    const next = await plan;
    expect(quiesce).toHaveBeenCalledTimes(1);
    expect(peek).toHaveBeenCalledWith(SCOPE);
    expect(next).not.toBe("leave");
    expect(nothingHeld(next as LogoutPlan)).toBe(true);
    expect(t.wakes.size).toBe(0);
  });

  it("a load that never ends stops holding at the limit: the count is unknown and the dialog offers sign-out (D-118 I1)", async () => {
    vi.useFakeTimers();
    const t = tab();
    const peek = vi.fn(async () => NONE_HELD);
    const plan = t.prepare(peek);
    await vi.advanceTimersByTimeAsync(LOGOUT_LOAD_LIMIT_MS - 1);
    expect(peek).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await plan).toEqual({ unsaved: false, pending: null });
    expect(t.wakes.size).toBe(0);
  });

  it("a wake while still loading keeps waiting", async () => {
    const t = tab();
    let decided = false;
    const wait = untilLoaded(() => t.state.loading, t.subscribe).then(() => { decided = true; });
    for (const wake of [...t.wakes]) wake();
    await Promise.resolve();
    expect(decided).toBe(false);
    t.load(async () => false);
    await wait;
    expect(decided).toBe(true);
  });

  it("not loading: no wait and no subscription", async () => {
    const subscribe = vi.fn(() => () => undefined);
    await untilLoaded(() => false, subscribe);
    expect(subscribe).not.toHaveBeenCalled();
  });
});
