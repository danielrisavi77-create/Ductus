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

  it("writes nothing while the store is unreachable and owes the writes until it is", async () => {
    const { calls, store } = recordingStore();
    const tracker = createAlarmTracker(store, undefined, (r) => (r as Record<string, unknown>).database === "ok");
    await tracker.observe({ database: "nedostupno", queue: "nedostupno" });
    await tracker.observe({ database: "nedostupno", queue: "ok" });
    expect(calls).toEqual([]);
    await tracker.observe({ database: "ok", queue: "ok" });
    expect(calls).toEqual([
      ["raise", "ready_database"],
      ["resolve", "ready_database"],
      ["raise", "ready_queue"],
      ["resolve", "ready_queue"],
    ]);
  });

  it("stops the writes of a run in progress once a report says the store is unreachable", async () => {
    let release: (() => void) | undefined;
    const calls: Call[] = [];
    const record = (op: "raise" | "resolve") => (kind: OpsAlarmKind) => {
      calls.push([op, kind]);
      // The first write hangs until released; every later one settles at once.
      if (calls.length > 1) return Promise.resolve();
      return new Promise<void>((resolve) => (release = resolve));
    };
    const tracker = createAlarmTracker(
      { raise: record("raise"), resolve: record("resolve") },
      undefined,
      (r) => (r as Record<string, unknown>).database === "ok",
    );
    const fault = { database: "ok", storage: "nedostupno", queue: "nedostupno", signing: "nedostupno" };
    const first = tracker.observe(fault);
    await Promise.resolve();
    expect(calls).toEqual([["resolve", "ready_database"]]);
    const outage = tracker.observe({ ...fault, database: "nedostupno" });
    release!();
    await Promise.all([first, outage]);
    // The write already in the store finishes; none after it starts.
    expect(calls).toEqual([["resolve", "ready_database"]]);
    // The rest stays owed and goes out once the store answers.
    await tracker.observe({ database: "ok", storage: "ok", queue: "ok", signing: "ok" });
    expect(calls.slice(1)).toEqual([
      ["raise", "ready_database"],
      ["resolve", "ready_database"],
      ["raise", "ready_storage"],
      ["resolve", "ready_storage"],
      ["raise", "ready_queue"],
      ["resolve", "ready_queue"],
      ["raise", "ready_signing"],
      ["resolve", "ready_signing"],
    ]);
  });

  // Orchestrator note 2 (#1836, c.6821821693): flapping against a hanging
  // store holds one write and a fixed state, however many reports arrive.
  it("bounds what is pending under endless flapping against a hanging store", async () => {
    const releases: Array<() => void> = [];
    const calls: Call[] = [];
    const hang = (op: "raise" | "resolve") => (kind: OpsAlarmKind) => {
      calls.push([op, kind]);
      return new Promise<void>((resolve) => releases.push(resolve));
    };
    const tracker = createAlarmTracker({ raise: hang("raise"), resolve: hang("resolve") });
    const pending = new Set<Promise<void>>();
    for (let i = 0; i < 10_000; i++) {
      const status = i % 2 === 0 ? "nedostupno" : "ok";
      pending.add(tracker.observe({ database: status, storage: status, queue: status, signing: status }));
    }
    await Promise.resolve();
    expect(calls).toHaveLength(1);
    expect(releases).toHaveLength(1);
    // Every report joined the one run in progress: one promise, not 10 000.
    expect(pending.size).toBe(1);
    for (let round = 0; round < 50 && releases.length > 0; round++) {
      releases.splice(0).forEach((release) => release());
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await Promise.all(pending);
    // The last report was "ok": each kind's owed fault is written, then its end.
    expect(calls).toHaveLength(8);
    for (const [kind] of [["ready_database"], ["ready_storage"], ["ready_queue"], ["ready_signing"]]) {
      expect(calls.filter(([, k]) => k === kind).map(([op]) => op)).toEqual(["raise", "resolve"]);
    }
  });
});
