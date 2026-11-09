import { describe, expect, it } from "vitest";

import { JobQueueError, type JobOutcome, type JobQueue, type JobQueueSettings } from "@/server/db/job-queue";
import type { LogLevel } from "@/server/log/logger";

import type { WorkerSettings } from "./environment";
import type { WorkerKind } from "./jobs";
import { startWorker, type WorkerProcess } from "./worker";

// DAN-517, plan #1826 W-12, W-13: the process around the loop, with a queue and
// a process that are scripts. Every value is invented.
const MARKER = "synthetic essay sentence that must stay out of the log";
const SETTINGS: WorkerSettings = {
  pollMs: 5,
  queue: {
    connectionString: "postgres://synthetic_worker:synthetic-pass@db.example:5432/ductus",
    retryLimit: 3,
    retryDelaySeconds: 30,
    expireSeconds: 120,
    deadlineMs: 60_000,
    deleteAfterSeconds: 600,
    sweepSeconds: 10,
  },
};
const KINDS: readonly WorkerKind[] = [
  { definition: { name: "kind_a", fields: ["checkId"], subject: "checkId" }, handler: async () => ({ ok: true }) },
  { definition: { name: "kind_b", fields: ["checkId"], subject: "checkId" } },
];

type Events = "SIGTERM" | "SIGINT" | "uncaughtException" | "unhandledRejection";

function harness(options: { open?: Error; runOnce?: () => Promise<JobOutcome>; stop?: () => Promise<void>; graceMs?: number; closeMs?: number } = {}) {
  const listeners = new Map<string, Array<() => void>>();
  const exits: number[] = [];
  const order: string[] = [];
  const logs: Array<{ level: LogLevel; event: string; fields?: Record<string, unknown> }> = [];
  const opened: JobQueueSettings[] = [];
  let exited: (() => void) | undefined;
  const firstExit = new Promise<void>((resolve) => (exited = resolve));
  const proc: WorkerProcess = {
    on(event: string, listener: () => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    },
    off() {},
    exit(code: number) {
      exits.push(code);
      order.push(`exit ${code}`);
      exited?.();
    },
  };
  const queue = {
    sweep: async () => {},
    runOnce: options.runOnce ?? (async () => ({ status: "idle" as const })),
    stop: async () => {
      order.push("stop");
      await options.stop?.();
    },
  } as unknown as JobQueue;
  const done = startWorker(SETTINGS, KINDS, {
    proc,
    graceMs: options.graceMs,
    closeMs: options.closeMs,
    log: (level, event, fields) => logs.push({ level, event, fields }),
    open: async (settings) => {
      opened.push(settings);
      if (options.open) throw options.open;
      return queue;
    },
  });
  const emit = (event: Events) => listeners.get(event)?.forEach((listener) => listener());
  return { done, emit, exits, order, logs, opened, firstExit };
}

const events = (h: ReturnType<typeof harness>) => h.logs.map((entry) => entry.event);
const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

describe("worker process: start", () => {
  it("opens the queue with the settings of the environment and the definitions of every kind", async () => {
    const h = harness();
    await tick();
    expect(h.opened).toHaveLength(1);
    const { definitions, onError, ...rest } = h.opened[0];
    expect(rest).toEqual(SETTINGS.queue);
    expect(definitions).toEqual(KINDS.map((kind) => kind.definition));
    expect(h.logs).toEqual([{ level: "info", event: "worker_started", fields: { jobs: ["kind_a", "kind_b"] } }]);
    onError?.("queue_error");
    expect(h.logs.at(-1)).toEqual({ level: "warn", event: "worker_queue_error", fields: { code: "queue_error" } });
    h.emit("SIGTERM");
    await h.done;
  });

  it.each<[string, Error, string]>([
    ["the queue's refusal", new JobQueueError("role_not_worker"), "role_not_worker"],
    ["an address nobody answers at", new JobQueueError("queue_unreachable"), "queue_unreachable"],
    ["an error that is not the queue's", Object.assign(new Error(MARKER), { code: MARKER }), "unexpected"],
  ])("%s ends the process with 1 and the closed code only", async (_label, error, code) => {
    const h = harness({ open: error });
    await h.done;
    expect(h.exits).toEqual([1]);
    expect(h.logs).toEqual([{ level: "error", event: "worker_start_failed", fields: { code } }]);
    expect(JSON.stringify(h.logs)).not.toContain(MARKER);
  });
});

describe("worker process: the ways it ends", () => {
  it("a signal on an empty queue closes the queue first and exits 0; later signals start nothing", async () => {
    const h = harness();
    await tick();
    h.emit("SIGTERM");
    h.emit("SIGTERM");
    h.emit("SIGINT");
    await h.done;
    await h.firstExit;
    await tick();
    expect(h.order).toEqual(["stop", "exit 0"]);
    expect(events(h)).toEqual(["worker_started"]);
  });

  it("a signal during an attempt waits for the attempt, then closes and exits 0 (W-13)", async () => {
    let finish: ((outcome: JobOutcome) => void) | undefined;
    let taken = 0;
    const runOnce = () => {
      taken += 1;
      return new Promise<JobOutcome>((resolve) => (finish = resolve));
    };
    const h = harness({ runOnce });
    await tick();
    h.emit("SIGINT");
    await tick();
    expect(h.order).toEqual([]);
    finish?.({ status: "completed" });
    await h.done;
    await h.firstExit;
    expect(h.order).toEqual(["stop", "exit 0"]);
    expect(taken).toBe(1);
    expect(h.logs.at(-1)).toEqual({ level: "info", event: "worker_job", fields: { job: "kind_a", status: "completed" } });
  });

  it("an attempt that outlives the grace period ends the process with 1 and a closed code", async () => {
    const h = harness({ runOnce: () => new Promise<JobOutcome>(() => {}), graceMs: 30 });
    await tick();
    h.emit("SIGTERM");
    await h.firstExit;
    expect(h.order).toEqual(["stop", "exit 1"]);
    expect(h.logs.at(-1)).toEqual({ level: "error", event: "shutdown", fields: { code: "SHUTDOWN_DEADLINE", request: 0, job: 1 } });
  });

  it("a queue that keeps failing closes the queue and exits 1", async () => {
    const h = harness({ runOnce: () => Promise.reject(new JobQueueError("queue_failed")) });
    await h.done;
    await h.firstExit;
    expect(h.order).toEqual(["stop", "exit 1"]);
    expect(events(h).filter((event) => event === "worker_queue_failed")).toHaveLength(5);
  });

  it("a queue that fails to close does not keep the process: the exit follows anyway", async () => {
    const h = harness({ stop: () => Promise.reject(new Error(MARKER)) });
    await tick();
    h.emit("SIGTERM");
    await h.firstExit;
    expect(h.order).toEqual(["stop", "exit 0"]);
    expect(JSON.stringify(h.logs)).not.toContain(MARKER);
  });

  it("a queue that never finishes closing is given the close time and no more", async () => {
    const h = harness({ stop: () => new Promise<void>(() => {}), closeMs: 30 });
    await tick();
    h.emit("SIGTERM");
    await tick(10);
    expect(h.exits).toEqual([]);
    await h.firstExit;
    expect(h.order).toEqual(["stop", "exit 0"]);
  });

  it.each<[Events, string]>([
    ["uncaughtException", "uncaught"],
    ["unhandledRejection", "unhandled"],
  ])("%s ends the process with 1 and says only that it happened (W-12)", async (event, code) => {
    const h = harness();
    await tick();
    h.emit(event);
    expect(h.exits).toEqual([1]);
    expect(h.logs.at(-1)).toEqual({ level: "error", event: "worker_crashed", fields: { code } });
    h.emit("SIGTERM");
    await h.done;
  });
});
