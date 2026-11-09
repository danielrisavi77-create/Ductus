import { describe, expect, it } from "vitest";

import { JobQueueError, type JobHandler, type JobOutcome } from "@/server/db/job-queue";
import type { LogLevel } from "@/server/log/logger";
import { createShutdownCoordinator } from "@/server/shutdown";

import { MAX_BACKOFF_MS, MAX_QUEUE_FAILURES, runWorkerLoop, type WorkerJob } from "./loop";

// DAN-517, plan #1826 W-7, W-12, W-13, W-15: the loop against a queue that is
// a script. The shutdown coordinator is the real one. Every value is invented.
const BODY = { checkId: "00000000-0000-4000-8000-000000000001" };
const MARKER = "synthetic essay sentence that must stay out of the log";

type Step = JobOutcome | Error | ((handler: JobHandler) => Promise<JobOutcome>);

function harness(script: readonly Step[], extra: { sweep?: () => Promise<void>; jobs?: readonly WorkerJob[]; sweepMs?: number } = {}) {
  const shutdown = createShutdownCoordinator({ graceMs: 1000 });
  const calls: string[] = [];
  const logs: Array<{ level: LogLevel; event: string; fields?: Record<string, unknown> }> = [];
  const waits: number[] = [];
  const steps = [...script];
  let clock = 0;
  const jobs = extra.jobs ?? [{ name: "kind_a", handler: async () => ({ ok: true as const }) }];
  const result = runWorkerLoop({
    jobs,
    shutdown,
    pollMs: 100,
    sweepMs: extra.sweepMs ?? 1000,
    now: () => clock,
    log: (level, event, fields) => logs.push({ level, event, fields }),
    wait: async (ms) => {
      waits.push(ms);
      clock += ms;
    },
    queue: {
      sweep: async (name) => {
        calls.push(`sweep ${name}`);
        await extra.sweep?.();
      },
      runOnce: async (name, handler) => {
        calls.push(`run ${name}`);
        const step = steps.shift();
        // The script is over: the test ends the loop the way a signal would.
        if (step === undefined) {
          void shutdown.stop();
          return { status: "idle" };
        }
        if (step instanceof Error) throw step;
        return typeof step === "function" ? step(handler) : step;
      },
    },
  });
  return { result, shutdown, calls, logs, waits };
}

/** What the adapter does with a handler's answer, as far as the loop can see. */
const asAdapter = async (handler: JobHandler): Promise<JobOutcome> => {
  const answer = await handler(BODY, new AbortController().signal);
  return answer.ok ? { status: "completed" } : { status: "failed", code: answer.code };
};

describe("worker loop: taking jobs", () => {
  it("sweeps every kind, then takes from every kind, and waits only after an empty round", async () => {
    const jobs = [{ name: "kind_a" }, { name: "kind_b" }];
    const h = harness([{ status: "completed" }, { status: "idle" }, { status: "idle" }, { status: "idle" }], { jobs });
    expect(await h.result).toBe("stopped");
    expect(h.calls).toEqual(["sweep kind_a", "sweep kind_b", "run kind_a", "run kind_b", "run kind_a", "run kind_b", "run kind_a"]);
    // The busy first round is followed at once by the second; the empty second round waits.
    expect(h.waits).toEqual([100]);
  });

  it("sweeps again only once the sweep interval has passed", async () => {
    const idle = Array.from({ length: 12 }, (): Step => ({ status: "idle" }));
    const h = harness(idle, { sweepMs: 500 });
    await h.result;
    const sweeps = h.calls.flatMap((call, index) => (call.startsWith("sweep") ? [index] : []));
    // Rounds wait 100 ms each: sweeps before round 1, 6 and 11.
    expect(sweeps).toEqual([0, 6, 12]);
  });

  it.each<[string, JobOutcome, LogLevel, Record<string, unknown>]>([
    ["completed", { status: "completed" }, "info", { job: "kind_a", status: "completed" }],
    ["failed", { status: "failed", code: "timeout" }, "warn", { job: "kind_a", status: "failed", code: "timeout" }],
    ["lost", { status: "lost" }, "warn", { job: "kind_a", status: "lost" }],
  ])("a %s attempt is one log line of closed fields", async (_label, outcome, level, fields) => {
    const h = harness([outcome]);
    await h.result;
    expect(h.logs).toEqual([{ level, event: "worker_job", fields }]);
  });

  it("an empty queue logs nothing", async () => {
    const h = harness([{ status: "idle" }, { status: "idle" }]);
    await h.result;
    expect(h.logs).toEqual([]);
  });

  it("a kind with no handler is never completed: every attempt fails as handler_missing (W-15)", async () => {
    const h = harness([asAdapter, asAdapter], { jobs: [{ name: "kind_a" }] });
    await h.result;
    expect(h.logs.map((entry) => entry.fields)).toEqual([
      { job: "kind_a", status: "failed", code: "handler_missing" },
      { job: "kind_a", status: "failed", code: "handler_missing" },
    ]);
  });

  it("a handler that is there is the one the queue runs", async () => {
    let ran = 0;
    const handler: JobHandler = async () => {
      ran += 1;
      return { ok: true };
    };
    const h = harness([asAdapter], { jobs: [{ name: "kind_a", handler }] });
    await h.result;
    expect(ran).toBe(1);
    expect(h.logs.map((entry) => entry.fields)).toEqual([{ job: "kind_a", status: "completed" }]);
  });
});

describe("worker loop: a queue that fails", () => {
  it("backs off longer each time and gives up after the limit, with the closed code only", async () => {
    const failing = Array.from({ length: MAX_QUEUE_FAILURES }, () => new JobQueueError("queue_failed"));
    const h = harness(failing);
    expect(await h.result).toBe("queue_failed");
    expect(h.waits).toEqual([200, 400, 800, 1600]);
    expect(h.logs).toEqual(
      failing.map((_error, index) => ({ level: "error", event: "worker_queue_failed", fields: { code: "queue_failed", failures: index + 1 } })),
    );
    expect(h.shutdown.state()).toBe("running");
  });

  it("a round that works starts the count again", async () => {
    const error = () => new JobQueueError("queue_failed");
    const h = harness([error(), error(), error(), error(), { status: "completed" }, error(), error(), error(), error()]);
    expect(await h.result).toBe("stopped");
    expect(h.logs.filter((entry) => entry.event === "worker_queue_failed").map((entry) => entry.fields?.failures)).toEqual([1, 2, 3, 4, 1, 2, 3, 4]);
  });

  it("the back-off never passes its ceiling", async () => {
    const shutdown = createShutdownCoordinator();
    const waits: number[] = [];
    const result = await runWorkerLoop({
      jobs: [{ name: "kind_a" }],
      shutdown,
      pollMs: 60_000,
      sweepMs: 1000,
      log: () => {},
      wait: async (ms) => void waits.push(ms),
      queue: { sweep: async () => {}, runOnce: async () => Promise.reject(new JobQueueError("queue_failed")) },
    });
    expect(result).toBe("queue_failed");
    expect(waits).toEqual([MAX_BACKOFF_MS, MAX_BACKOFF_MS, MAX_BACKOFF_MS, MAX_BACKOFF_MS]);
  });

  it("a failing sweep counts the same way", async () => {
    const h = harness([], { sweep: () => Promise.reject(new JobQueueError("queue_failed")) });
    expect(await h.result).toBe("queue_failed");
    expect(h.calls).toEqual(Array.from({ length: MAX_QUEUE_FAILURES }, () => "sweep kind_a"));
  });

  it("what is thrown is never repeated: an error that is not the queue's is logged as unexpected (W-12)", async () => {
    const h = harness([new Error(MARKER), Object.assign(new Error(MARKER), { code: MARKER })]);
    await h.result;
    expect(h.logs.map((entry) => entry.fields)).toEqual([
      { code: "unexpected", failures: 1 },
      { code: "unexpected", failures: 2 },
    ]);
    expect(JSON.stringify(h.logs)).not.toContain(MARKER);
  });
});

describe("worker loop: shutdown (W-13)", () => {
  it("a stop during an attempt waits for it, and nothing new is taken after it", async () => {
    let finish: (() => void) | undefined;
    let started: (() => void) | undefined;
    const running = new Promise<void>((resolve) => (started = resolve));
    const slow: Step = () =>
      new Promise<JobOutcome>((resolve) => {
        finish = () => resolve({ status: "completed" });
        started?.();
      });
    const h = harness([slow, { status: "completed" }]);
    await running;

    let drained = false;
    const stopping = h.shutdown.stop().then((result) => {
      drained = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(drained).toBe(false);
    expect(h.shutdown.active().job).toBe(1);

    finish?.();
    expect(await stopping).toEqual({ outcome: "drained" });
    expect(await h.result).toBe("stopped");
    // One attempt only: the second job of the script was never asked for.
    expect(h.calls).toEqual(["sweep kind_a", "run kind_a"]);
    expect(h.logs.map((entry) => entry.fields)).toEqual([{ job: "kind_a", status: "completed" }]);
  });

  it("a stop between two kinds takes nothing from the second and is not a queue failure", async () => {
    const jobs = [{ name: "kind_a" }, { name: "kind_b" }];
    const h = harness(
      [
        async () => {
          void h.shutdown.stop();
          return { status: "completed" };
        },
      ],
      { jobs },
    );
    expect(await h.result).toBe("stopped");
    expect(h.calls).toEqual(["sweep kind_a", "sweep kind_b", "run kind_a"]);
    expect(h.logs.map((entry) => entry.event)).toEqual(["worker_job"]);
  });

  it("a loop started after the stop takes nothing at all", async () => {
    const shutdown = createShutdownCoordinator();
    await shutdown.stop();
    const calls: string[] = [];
    const result = await runWorkerLoop({
      jobs: [{ name: "kind_a" }],
      shutdown,
      pollMs: 100,
      sweepMs: 1000,
      log: () => {},
      queue: { sweep: async () => void calls.push("sweep"), runOnce: async () => (calls.push("run"), { status: "idle" }) },
    });
    expect(result).toBe("stopped");
    expect(calls).toEqual([]);
  });
});
