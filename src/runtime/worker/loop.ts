// DAN-517 (plan #1826 W-7, W-13, W-15): the worker's loop. One job at a time,
// each attempt and each sweep under a shutdown ticket, so a stop waits for the
// attempt in flight and nothing new is taken after it. A log line carries the
// kind of the job, its status and a closed code: never a body, never an error.
import { JobQueueError, type JobHandler, type JobQueue } from "@/server/db/job-queue";
import type { LogEvent } from "@/server/log/logger";
import { SHUTTING_DOWN, type ShutdownCoordinator } from "@/server/shutdown";

/** A kind with no handler is still taken, and every attempt fails as `handler_missing`. */
export type WorkerJob = { readonly name: string; readonly handler?: JobHandler };

export type WorkerLoopOptions = {
  readonly queue: Pick<JobQueue, "runOnce" | "sweep">;
  readonly jobs: readonly WorkerJob[];
  readonly shutdown: Pick<ShutdownCoordinator, "state" | "runJob">;
  /** Wait after a round in which every queue was empty. */
  readonly pollMs: number;
  /** Least time between two rounds of sweeps. */
  readonly sweepMs: number;
  readonly log: LogEvent;
  readonly wait?: (ms: number) => Promise<void>;
  readonly now?: () => number;
};

/** This many rounds in a row that the queue refused end the loop: the process exits and its supervisor decides. */
export const MAX_QUEUE_FAILURES = 5;
export const MAX_BACKOFF_MS = 60_000;

const missing: JobHandler = async () => ({ ok: false, code: "handler_missing" });
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function refusedByShutdown(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === SHUTTING_DOWN;
}

/** Runs until the shutdown starts (`stopped`) or the queue keeps failing (`queue_failed`). */
export async function runWorkerLoop(options: WorkerLoopOptions): Promise<"stopped" | "queue_failed"> {
  const { queue, jobs, shutdown, log } = options;
  const wait = options.wait ?? sleep;
  const now = options.now ?? Date.now;
  let failures = 0;
  let sweptAt = Number.NEGATIVE_INFINITY;

  while (shutdown.state() === "running") {
    let busy = false;
    try {
      if (now() - sweptAt >= options.sweepMs) {
        for (const job of jobs) await shutdown.runJob(() => queue.sweep(job.name));
        sweptAt = now();
      }
      for (const job of jobs) {
        const outcome = await shutdown.runJob(() => queue.runOnce(job.name, job.handler ?? missing));
        if (outcome.status === "idle") continue;
        busy = true;
        if (outcome.status === "completed") log("info", "worker_job", { job: job.name, status: outcome.status });
        else log("warn", "worker_job", { job: job.name, status: outcome.status, ...(outcome.status === "failed" ? { code: outcome.code } : {}) });
      }
      failures = 0;
    } catch (error) {
      if (refusedByShutdown(error)) break;
      failures += 1;
      // The queue throws closed codes only; anything else is not repeated here.
      log("error", "worker_queue_failed", { code: error instanceof JobQueueError ? error.code : "unexpected", failures });
      if (failures >= MAX_QUEUE_FAILURES) return "queue_failed";
      await wait(Math.min(options.pollMs * 2 ** failures, MAX_BACKOFF_MS));
      continue;
    }
    if (!busy) await wait(options.pollMs);
  }
  return "stopped";
}
