// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Dexie from "dexie";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";

import { editorPlan, LOGOUT_HOLD_LIMIT_MS, readLogoutHold, shellLogoutStep } from "./logout-hold";

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
