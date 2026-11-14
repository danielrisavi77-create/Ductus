import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";

import type { OpsAlarmKind } from "@/domain/ops/alarm";

import { createAlarmTracker, REFRESH_MS, type AlarmStore } from "./readiness-alarms";

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
      return true;
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

  // Review c.6854584001: the COMMIT can succeed and its reply be lost, so a
  // write that rejects may still be in the store.
  function lostReplyStore(lose: (call: Call) => boolean) {
    const calls: Call[] = [];
    const write = (op: Call[0]) => async (kind: OpsAlarmKind) => {
      calls.push([op, kind]);
      if (lose([op, kind])) throw new Error("connection lost after commit");
      return true;
    };
    const store: AlarmStore = { raise: async (kind) => void (await write("raise")(kind)), resolve: write("resolve") };
    return { calls, store };
  }

  it("(9) a fault after an end whose reply was lost is raised again", async () => {
    let lose = false;
    const { calls, store } = lostReplyStore(([op]) => lose && op === "resolve");
    const tracker = createAlarmTracker(store);
    await tracker.observe({ database: "ok", storage: "nedostupno" });
    lose = true;
    await tracker.observe({ database: "ok", storage: "ok" });
    lose = false;
    await tracker.observe({ database: "ok", storage: "nedostupno" });
    // The end is written again before the raise: whether or not the lost one
    // was applied, the raise opens a new episode.
    expect(calls.filter(([, kind]) => kind === "ready_storage")).toEqual([
      ["raise", "ready_storage"],
      ["resolve", "ready_storage"],
      ["resolve", "ready_storage"],
      ["raise", "ready_storage"],
    ]);
  });

  it("(9) an end after a raise whose reply was lost is written", async () => {
    let lose = false;
    const { calls, store } = lostReplyStore(([op]) => lose && op === "raise");
    const tracker = createAlarmTracker(store);
    await tracker.observe({ queue: "ok" });
    lose = true;
    await tracker.observe({ queue: "nedostupno" });
    lose = false;
    await tracker.observe({ queue: "ok" });
    expect(calls).toEqual([
      ["resolve", "ready_queue"],
      ["raise", "ready_queue"],
      ["raise", "ready_queue"],
      ["resolve", "ready_queue"],
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
      resolve: async (kind) => (calls.push(["resolve", kind]), true),
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
      if (calls.length > 1) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => (release = () => resolve(true)));
    };
    const tracker = createAlarmTracker(
      { raise: async (kind) => void (await record("raise")(kind)), resolve: record("resolve") },
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

  it("keeps a fault that comes and goes while its kind is being resolved", async () => {
    let release: (() => void) | undefined;
    const calls: Call[] = [];
    const tracker = createAlarmTracker({
      raise: async (kind) => void calls.push(["raise", kind]),
      resolve: (kind) => {
        calls.push(["resolve", kind]);
        // The first resolve hangs until released; later ones settle at once.
        if (calls.filter(([op]) => op === "resolve").length > 1) return Promise.resolve(true);
        return new Promise<boolean>((resolve) => (release = () => resolve(true)));
      },
    });
    await tracker.observe({ database: "nedostupno" });
    const closing = tracker.observe({ database: "ok" });
    await Promise.resolve();
    expect(calls).toEqual([
      ["raise", "ready_database"],
      ["resolve", "ready_database"],
    ]);
    const fault = tracker.observe({ database: "nedostupno" });
    const recovery = tracker.observe({ database: "ok" });
    release!();
    await Promise.all([closing, fault, recovery]);
    // The short fault is its own episode: written, then closed.
    expect(calls.slice(2)).toEqual([
      ["raise", "ready_database"],
      ["resolve", "ready_database"],
    ]);
  });

  // Orchestrator note 2 (#1836, c.6821821693): flapping against a hanging
  // store holds one write and a fixed state, however many reports arrive.
  it("bounds what is pending under endless flapping against a hanging store", async () => {
    const releases: Array<() => void> = [];
    const calls: Call[] = [];
    const hang = (op: "raise" | "resolve") => (kind: OpsAlarmKind) => {
      calls.push([op, kind]);
      return new Promise<boolean>((resolve) => releases.push(() => resolve(true)));
    };
    const tracker = createAlarmTracker({
      raise: async (kind) => void (await hang("raise")(kind)),
      resolve: hang("resolve"),
    });
    const pending: Array<Promise<void>> = [];
    for (let i = 0; i < 10_000; i++) {
      const status = i % 2 === 0 ? "nedostupno" : "ok";
      pending.push(tracker.observe({ database: status, storage: status, queue: status, signing: status }));
    }
    await Promise.resolve();
    expect(calls).toHaveLength(1);
    expect(releases).toHaveLength(1);
    // Every report joined the one run in progress, and only the report that
    // started it waits on it: one pending promise, not 10 000 (review
    // c.6853469400).
    expect(await unsettled(pending)).toBe(1);
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

// Round 3 (review c.6864883871, contract #1836 c.6867544247): replicas share
// the channel. A model of identity.ops_alarm and ops_alarm_fault as the
// migration writes them: a fault record per reporter, fresh for 120 s.
const FRESH_MS = 120_000;

function sharedChannel() {
  let clock = 1_000_000;
  const faults = new Map<OpsAlarmKind, Map<string, number>>();
  const episodes: Array<{ kind: OpsAlarmKind; open: boolean; count: number }> = [];
  const openOf = (kind: OpsAlarmKind) => episodes.find((e) => e.kind === kind && e.open);
  const recordsOf = (kind: OpsAlarmKind) => {
    const records = faults.get(kind) ?? new Map<string, number>();
    faults.set(kind, records);
    for (const [reporter, at] of records) if (at < clock - FRESH_MS) records.delete(reporter);
    return records;
  };
  const storeFor = (reporter: string): AlarmStore => ({
    raise: async (kind) => {
      recordsOf(kind).set(reporter, clock);
      const open = openOf(kind);
      if (open) open.count += 1;
      else episodes.push({ kind, open: true, count: 1 });
    },
    resolve: async (kind) => {
      const records = recordsOf(kind);
      records.delete(reporter);
      if (records.size > 0) return false;
      const open = openOf(kind);
      if (open) open.open = false;
      return true;
    },
  });
  return {
    now: () => clock,
    advance: (ms: number) => void (clock += ms),
    isOpen: (kind: OpsAlarmKind) => openOf(kind) !== undefined,
    episodes: (kind: OpsAlarmKind) => episodes.filter((e) => e.kind === kind).length,
    tracker: (reporter: string) => createAlarmTracker(storeFor(reporter), undefined, undefined, () => clock),
  };
}

describe("createAlarmTracker with replicas sharing the channel", () => {
  it("A sees the fault, B sees ok: the alarm stays open, also after B's retries", async () => {
    const channel = sharedChannel();
    const a = channel.tracker("a");
    const b = channel.tracker("b");
    await a.observe({ storage: "nedostupno" });
    await b.observe({ storage: "ok" });
    expect(channel.isOpen("ready_storage")).toBe(true);
    // Probes go on every 10 s for five minutes: A keeps its record fresh and
    // B's retries are refused each time.
    for (let i = 0; i < 30; i++) {
      channel.advance(10_000);
      await a.observe({ storage: "nedostupno" });
      await b.observe({ storage: "ok" });
      expect(channel.isOpen("ready_storage")).toBe(true);
    }
    expect(channel.episodes("ready_storage")).toBe(1);
  });

  it("A recovers: the alarm closes; a repeated fault after that opens a new episode", async () => {
    const channel = sharedChannel();
    const a = channel.tracker("a");
    const b = channel.tracker("b");
    await a.observe({ queue: "nedostupno" });
    await b.observe({ queue: "ok" });
    channel.advance(5_000);
    await a.observe({ queue: "ok" });
    expect(channel.isOpen("ready_queue")).toBe(false);
    channel.advance(5_000);
    await a.observe({ queue: "nedostupno" });
    expect(channel.isOpen("ready_queue")).toBe(true);
    expect(channel.episodes("ready_queue")).toBe(2);
    // B still says ok and is not due to retry: the new episode stays open.
    await b.observe({ queue: "ok" });
    expect(channel.isOpen("ready_queue")).toBe(true);
  });

  it("A falls silent during the fault: once its record is stale, B's retry closes the alarm", async () => {
    const channel = sharedChannel();
    const a = channel.tracker("a");
    const b = channel.tracker("b");
    await a.observe({ signing: "nedostupno" });
    await b.observe({ signing: "ok" });
    channel.advance(FRESH_MS - REFRESH_MS);
    await b.observe({ signing: "ok" });
    expect(channel.isOpen("ready_signing")).toBe(true);
    channel.advance(REFRESH_MS + 1);
    await b.observe({ signing: "ok" });
    expect(channel.isOpen("ready_signing")).toBe(false);
  });

  it("B's close is confirmed, then A opens the alarm and dies: B's repeated close ends it", async () => {
    const channel = sharedChannel();
    const a = channel.tracker("a");
    const b = channel.tracker("b");
    await b.observe({ signing: "ok" });
    expect(channel.isOpen("ready_signing")).toBe(false);
    channel.advance(1_000);
    await a.observe({ signing: "nedostupno" });
    const raisedAt = channel.now();
    expect(channel.isOpen("ready_signing")).toBe(true);
    // A is gone. B keeps reporting ok every 10 s for ten minutes.
    let closedAt: number | undefined;
    for (let i = 0; i < 60; i++) {
      channel.advance(10_000);
      await b.observe({ signing: "ok" });
      if (closedAt === undefined && !channel.isOpen("ready_signing")) closedAt = channel.now();
    }
    expect(channel.isOpen("ready_signing")).toBe(false);
    // Closed within one refresh of A's record going stale, in one episode.
    expect(closedAt).toBeDefined();
    expect(closedAt! - raisedAt).toBeLessThanOrEqual(FRESH_MS + REFRESH_MS + 10_000);
    expect(channel.episodes("ready_signing")).toBe(1);
  });

  it("both replicas see the fault: one recovering does not close it", async () => {
    const channel = sharedChannel();
    const a = channel.tracker("a");
    const b = channel.tracker("b");
    await a.observe({ database: "nedostupno" });
    await b.observe({ database: "nedostupno" });
    await a.observe({ database: "ok" });
    expect(channel.isOpen("ready_database")).toBe(true);
    await b.observe({ database: "ok" });
    expect(channel.isOpen("ready_database")).toBe(false);
    expect(channel.episodes("ready_database")).toBe(1);
  });
});

// Any interleaving of two replicas' reports, at most 60 s apart: while a
// replica's latest report is a fault less than FRESH_MS - REFRESH_MS old, the
// alarm is open; once every replica has reported ok again after REFRESH_MS,
// it is closed.
test.prop([
  fc.array(
    fc.record({ replica: fc.constantFrom("a", "b"), fault: fc.boolean(), after: fc.integer({ min: 0, max: 60_000 }) }),
    { maxLength: 60 },
  ),
])("two replicas: the alarm is open exactly while one of them sees the fault", async (steps) => {
  const channel = sharedChannel();
  const trackers = { a: channel.tracker("a"), b: channel.tracker("b") };
  const latest = new Map<string, { fault: boolean; at: number }>();
  for (const { replica, fault, after } of steps) {
    channel.advance(after);
    await trackers[replica].observe({ storage: fault ? "nedostupno" : "ok" });
    latest.set(replica, { fault, at: channel.now() });
    const held = [...latest.values()].some((r) => r.fault && channel.now() - r.at < FRESH_MS - REFRESH_MS);
    if (held) expect(channel.isOpen("ready_storage")).toBe(true);
    if (fault) expect(channel.isOpen("ready_storage")).toBe(true);
  }
  channel.advance(REFRESH_MS);
  await trackers.a.observe({ storage: "ok" });
  await trackers.b.observe({ storage: "ok" });
  expect(channel.isOpen("ready_storage")).toBe(false);
});

describe("createAlarmTracker refresh and held resolve", () => {
  function clockedStore(answer: () => unknown) {
    const calls: Call[] = [];
    const store: AlarmStore = {
      raise: async (kind) => void calls.push(["raise", kind]),
      resolve: async (kind) => (calls.push(["resolve", kind]), answer() as boolean),
    };
    return { calls, store };
  }

  it.each([
    ["false", false],
    ["undefined", undefined],
    ["a truthy non-boolean", "yes"],
  ])("a resolve answered %s is held and tried again only after REFRESH_MS, and so is a confirmed one", async (_label, answer) => {
    let t = 5_000_000;
    let reply: unknown = answer;
    const { calls, store } = clockedStore(() => reply);
    const tracker = createAlarmTracker(store, undefined, undefined, () => t);
    await tracker.observe({ queue: "ok" });
    t += REFRESH_MS - 1;
    await tracker.observe({ queue: "ok" });
    expect(calls).toEqual([["resolve", "ready_queue"]]);
    t += 1;
    reply = true;
    await tracker.observe({ queue: "ok" });
    t += REFRESH_MS - 1;
    await tracker.observe({ queue: "ok" });
    // Closed: not repeated before REFRESH_MS has passed since the close ...
    expect(calls).toEqual([
      ["resolve", "ready_queue"],
      ["resolve", "ready_queue"],
    ]);
    t += 1;
    await tracker.observe({ queue: "ok" });
    // ... and then repeated, since another replica may have opened it since.
    expect(calls).toEqual([
      ["resolve", "ready_queue"],
      ["resolve", "ready_queue"],
      ["resolve", "ready_queue"],
    ]);
  });

  it("a held kind raises at once on a new fault", async () => {
    const t = 5_000_000;
    const { calls, store } = clockedStore(() => false);
    const tracker = createAlarmTracker(store, undefined, undefined, () => t);
    await tracker.observe({ storage: "ok" });
    await tracker.observe({ storage: "nedostupno" });
    expect(calls).toEqual([
      ["resolve", "ready_storage"],
      ["raise", "ready_storage"],
    ]);
  });

  it("refreshes a lasting fault at most every REFRESH_MS", async () => {
    let t = 5_000_000;
    const { calls, store } = clockedStore(() => true);
    const tracker = createAlarmTracker(store, undefined, undefined, () => t);
    for (let i = 0; i <= 12; i++) {
      await tracker.observe({ database: "nedostupno" });
      t += 10_000;
    }
    // Reports at 0 s, 10 s ... 120 s: written at 0, 30, 60, 90 and 120 s.
    expect(calls).toEqual(Array.from({ length: 5 }, () => ["raise", "ready_database"]));
  });

  it("a refresh the store throws on is retried on the next report", async () => {
    let t = 5_000_000;
    let down = false;
    const calls: Call[] = [];
    const tracker = createAlarmTracker(
      {
        raise: async (kind) => {
          calls.push(["raise", kind]);
          if (down) throw new Error("store down");
        },
        resolve: async () => true,
      },
      undefined,
      undefined,
      () => t,
    );
    await tracker.observe({ queue: "nedostupno" });
    t += REFRESH_MS;
    down = true;
    await tracker.observe({ queue: "nedostupno" });
    down = false;
    t += 1;
    await tracker.observe({ queue: "nedostupno" });
    expect(calls).toHaveLength(3);
  });
});

/** How many of the promises have not settled once queued callbacks have run. */
async function unsettled(promises: Array<Promise<unknown>>): Promise<number> {
  let done = 0;
  for (const promise of promises) void promise.then(() => (done += 1), () => (done += 1));
  await new Promise((resolve) => setTimeout(resolve, 0));
  return promises.length - done;
}
