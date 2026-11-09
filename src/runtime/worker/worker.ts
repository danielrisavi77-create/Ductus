// DAN-517 (plan #1826 W-12, W-13): the worker as a process. It opens the queue,
// runs the loop and ends in one of three ways: a signal (0 once the attempt in
// flight is settled, 1 when it outlives the grace period), a queue that keeps
// failing (1) or an error nobody caught (1). Every line it writes is an event
// with closed codes; what was thrown is never written.
import { JobQueueError, openJobQueue, type JobQueue } from "@/server/db/job-queue";
import { logEvent, type LogEvent } from "@/server/log/logger";
import { createShutdownCoordinator, installShutdownSignals, type SignalTarget } from "@/server/shutdown";

import type { WorkerSettings } from "./environment";
import type { WorkerKind } from "./jobs";
import { runWorkerLoop } from "./loop";

/** Closing the queue may take this long; then the process exits anyway. */
export const CLOSE_MS = 6_000;

export type WorkerProcess = SignalTarget & {
  on(event: "uncaughtException" | "unhandledRejection", listener: () => void): unknown;
  exit(code: number): unknown;
};

export type WorkerDeps = {
  readonly open?: typeof openJobQueue;
  readonly proc?: WorkerProcess;
  readonly log?: LogEvent;
  readonly graceMs?: number;
  readonly closeMs?: number;
};

/** Resolves when the loop has ended; the exit itself goes through `proc.exit`. */
export async function startWorker(settings: WorkerSettings, kinds: readonly WorkerKind[], deps: WorkerDeps = {}): Promise<void> {
  const log = deps.log ?? logEvent;
  const proc: WorkerProcess = deps.proc ?? process;
  proc.on("uncaughtException", () => (log("error", "worker_crashed", { code: "uncaught" }), void proc.exit(1)));
  proc.on("unhandledRejection", () => (log("error", "worker_crashed", { code: "unhandled" }), void proc.exit(1)));

  let queue: JobQueue;
  try {
    queue = await (deps.open ?? openJobQueue)({
      ...settings.queue,
      definitions: kinds.map((kind) => kind.definition),
      onError: (code) => log("warn", "worker_queue_error", { code }),
    });
  } catch (error) {
    log("error", "worker_start_failed", { code: error instanceof JobQueueError ? error.code : "unexpected" });
    proc.exit(1);
    return;
  }

  let closing = false;
  const close = (code: number) => {
    if (closing) return;
    closing = true;
    const late = setTimeout(() => proc.exit(code), deps.closeMs ?? CLOSE_MS);
    void queue
      .stop()
      .catch(() => {})
      .then(() => (clearTimeout(late), proc.exit(code)));
  };
  const shutdown = createShutdownCoordinator(deps.graceMs === undefined ? {} : { graceMs: deps.graceMs });
  installShutdownSignals(proc, shutdown, { exit: close, exitWhenDrained: true, log: (label, fields) => log("error", label, fields) });

  log("info", "worker_started", { jobs: kinds.map((kind) => kind.definition.name) });
  const ended = await runWorkerLoop({
    queue,
    jobs: kinds.map((kind) => ({ name: kind.definition.name, handler: kind.handler })),
    shutdown,
    pollMs: settings.pollMs,
    sweepMs: settings.queue.sweepSeconds * 1000,
    log,
  });
  if (ended === "queue_failed") close(1);
}
