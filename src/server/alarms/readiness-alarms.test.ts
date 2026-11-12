import { describe, expect, it } from "vitest";

import type { OpsAlarmKind } from "@/domain/ops/alarm";

import { createAlarmTracker, type AlarmStore } from "./readiness-alarms";

type Call = [op: "raise" | "resolve", kind: OpsAlarmKind];

function recordingStore(fail: (call: Call) => boolean = () => false) {
  const calls: Call[] = [];
  const store: AlarmStore = {
    raise: async (kind) => {
      if (fail(["raise", kind])) throw new Error("store down");
      calls.push(["raise", kind]);
    },
    resolve: async (kind) => {
      if (fail(["resolve", kind])) throw new Error("store down");
      calls.push(["resolve", kind]);
    },
  };
  return { calls, store };
}

// DAN-184 contract (#1836, c.6821517800), input classes (6) to (10).
describe("createAlarmTracker", () => {
  it("a fault is written once and its end once", async () => {
    const { calls, store } = recordingStore();
    const tracker = createAlarmTracker(store);
    await tracker.observe({ database: "nedostupno" });
    await tracker.observe({ database: "nedostupno" }); // (7) same state: no write
    await tracker.observe({ database: "ok" });
    await tracker.observe({ database: "ok" });
    expect(calls).toEqual([
      ["raise", "ready_database"],
      ["resolve", "ready_database"],
    ]);
  });

  it("(8) flapping opens a new episode each time", async () => {
    const { calls, store } = recordingStore();
    const tracker = createAlarmTracker(store);
    for (const status of ["nedostupno", "ok", "nedostupno", "ok"]) await tracker.observe({ queue: status });
    expect(calls).toEqual([
      ["raise", "ready_queue"],
      ["resolve", "ready_queue"],
      ["raise", "ready_queue"],
      ["resolve", "ready_queue"],
    ]);
  });

  it("the first ok after start closes an alarm a previous process left open", async () => {
    const { calls, store } = recordingStore();
    await createAlarmTracker(store).observe({ signing: "ok" });
    expect(calls).toEqual([["resolve", "ready_signing"]]);
  });

  it("(6) codes or any other text never reach the store or the error hook", async () => {
    const { calls, store } = recordingStore(() => true);
    const seen: unknown[] = [];
    const tracker = createAlarmTracker(store, (...args) => seen.push(args));
    await tracker.observe({
      database: "nedostupno",
      codes: { database: "ana.horvat@example.invalid 12345678903 sk-live-secret" },
    } as Record<string, unknown>);
    expect(calls).toEqual([]);
    expect(JSON.stringify(seen)).not.toMatch(/example|1234|secret/);
    expect(seen).toEqual([["raise", "ready_database"]]);
  });

  it("(9) a raise the store refused is written later, before its end", async () => {
    let down = true;
    const { calls, store } = recordingStore(() => down);
    const tracker = createAlarmTracker(store);
    await expect(tracker.observe({ database: "nedostupno" })).resolves.toBeUndefined();
    await tracker.observe({ database: "ok" });
    expect(calls).toEqual([]);
    down = false;
    await tracker.observe({ database: "ok" });
    expect(calls).toEqual([
      ["raise", "ready_database"],
      ["resolve", "ready_database"],
    ]);
  });

  it("(9) a refused end is retried", async () => {
    let refuse = false;
    const { calls, store } = recordingStore(([op]) => refuse && op === "resolve");
    const tracker = createAlarmTracker(store);
    await tracker.observe({ storage: "nedostupno" });
    refuse = true;
    await tracker.observe({ storage: "ok" });
    refuse = false;
    await tracker.observe({});
    expect(calls).toEqual([
      ["raise", "ready_storage"],
      ["resolve", "ready_storage"],
    ]);
  });

  it("(9) a store that never settles holds no second write and loses no transition", async () => {
    let release!: () => void;
    const calls: Call[] = [];
    const store: AlarmStore = {
      raise: (kind) => {
        calls.push(["raise", kind]);
        return new Promise<void>((resolve) => (release = resolve));
      },
      resolve: async (kind) => void calls.push(["resolve", kind]),
    };
    const tracker = createAlarmTracker(store);
    const first = tracker.observe({ database: "nedostupno" });
    const second = tracker.observe({ database: "ok" });
    await Promise.resolve();
    expect(calls).toEqual([["raise", "ready_database"]]);
    release();
    await Promise.all([first, second]);
    expect(calls).toEqual([
      ["raise", "ready_database"],
      ["resolve", "ready_database"],
    ]);
  });

  it("(10) concurrent calls in one process write each transition once", async () => {
    const { calls, store } = recordingStore();
    const tracker = createAlarmTracker(store);
    await Promise.all(Array.from({ length: 20 }, () => tracker.observe({ signing: "nedostupno", queue: "ok" })));
    expect(calls).toEqual([
      ["resolve", "ready_queue"],
      ["raise", "ready_signing"],
    ]);
  });

  it("an error hook that throws does not break the tracker", async () => {
    let down = true;
    const { calls, store } = recordingStore(() => down);
    const tracker = createAlarmTracker(store, () => {
      throw new Error("hook");
    });
    await expect(tracker.observe({ database: "nedostupno" })).resolves.toBeUndefined();
    down = false;
    await tracker.observe({});
    expect(calls).toEqual([["raise", "ready_database"]]);
  });
});
