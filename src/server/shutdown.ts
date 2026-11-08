// Graceful shutdown of the web and the worker (DAN-587, M11.3-P03).
//
// The coordinator holds no I/O: work in flight takes a ticket, stop() waits for
// every ticket issued before it until the deadline, and after stop() no new
// ticket is issued. The check and the count happen in one synchronous step, so
// on the single JS thread there is no gap between them.
//
// Erasable TypeScript only: the process test runs this file in plain node.

export const SHUTDOWN_GRACE_MS = 8_000;

/** Closed code of the refusal and of the deadline log; never a message. */
export const SHUTTING_DOWN = "SHUTTING_DOWN";
export const SHUTDOWN_DEADLINE = "SHUTDOWN_DEADLINE";

export type WorkKind = "request" | "job";
export type ShutdownState = "running" | "draining" | "stopped";
export type WorkCounts = Record<WorkKind, number>;
export type StopResult = { outcome: "drained" } | { outcome: "deadline"; unfinished: WorkCounts };
export type Ticket = { release(): void };
export type Clock = { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(handle: unknown): void };

export type ShutdownCoordinator = {
  readonly graceMs: number;
  state(): ShutdownState;
  active(): WorkCounts;
  /** A ticket for work that starts now, or null once stop() was called. */
  begin(kind: WorkKind): Ticket | null;
  /** Runs fn under a job ticket; refuses with SHUTTING_DOWN without calling fn. */
  runJob<T>(fn: () => Promise<T>): Promise<T>;
  /** Idempotent: every call returns the same promise. */
  stop(): Promise<StopResult>;
};

const realClock: Clock = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function shuttingDown(): Error & { code: string } {
  return Object.assign(new Error(SHUTTING_DOWN), { code: SHUTTING_DOWN });
}

export function createShutdownCoordinator(options: { graceMs?: number; clock?: Clock } = {}): ShutdownCoordinator {
  const graceMs = options.graceMs ?? SHUTDOWN_GRACE_MS;
  const clock = options.clock ?? realClock;
  const counts: WorkCounts = { request: 0, job: 0 };
  let current: ShutdownState = "running";
  let stopping: Promise<StopResult> | undefined;
  let settle: ((result: StopResult) => void) | undefined;
  let deadline: unknown;

  const finish = (result: StopResult) => {
    const resolve = settle;
    if (!resolve) return;
    settle = undefined;
    clock.clearTimeout(deadline);
    current = "stopped";
    resolve(result);
  };
  const drainedIfIdle = () => {
    if (counts.request === 0 && counts.job === 0) finish({ outcome: "drained" });
  };

  const coordinator: ShutdownCoordinator = {
    graceMs,
    state: () => current,
    active: () => ({ ...counts }),
    begin(kind) {
      if (current !== "running") return null;
      counts[kind] += 1;
      let open = true;
      return {
        release() {
          if (!open) return;
          open = false;
          counts[kind] -= 1;
          drainedIfIdle();
        },
      };
    },
    async runJob(fn) {
      const ticket = coordinator.begin("job");
      if (!ticket) throw shuttingDown();
      try {
        return await fn();
      } finally {
        ticket.release();
      }
    },
    stop() {
      if (stopping) return stopping;
      current = "draining";
      stopping = new Promise<StopResult>((resolve) => (settle = resolve));
      deadline = clock.setTimeout(() => finish({ outcome: "deadline", unfinished: { ...counts } }), graceMs);
      drainedIfIdle();
      return stopping;
    },
  };
  return coordinator;
}

export type SignalTarget = {
  on(signal: "SIGTERM" | "SIGINT", listener: () => void): unknown;
  off(signal: "SIGTERM" | "SIGINT", listener: () => void): unknown;
};

const SIGNALS = ["SIGTERM", "SIGINT"] as const;

/**
 * The first SIGTERM or SIGINT calls stop(); later signals start nothing new.
 * With exitWhenDrained (the worker) the process exits 0 once drained. Without
 * it (the web) the server owner exits once its server is closed, and this only
 * bounds it: a process still alive at the deadline exits 1. The log carries a
 * closed code and counts only, never a message or anything from a request.
 */
export function installShutdownSignals(
  target: SignalTarget,
  coordinator: ShutdownCoordinator,
  options: {
    exit: (code: number) => unknown;
    exitWhenDrained: boolean;
    clock?: Clock;
    log?: (label: string, fields: Record<string, unknown>) => void;
  },
): () => void {
  const clock = options.clock ?? realClock;
  const log = options.log ?? ((label, fields) => console.error(label, fields));
  let signalled = false;
  let ended = false;
  const end = (code: 0 | 1, unfinished?: WorkCounts) => {
    if (ended) return;
    ended = true;
    if (code === 1) log("shutdown", { code: SHUTDOWN_DEADLINE, ...(unfinished ?? coordinator.active()) });
    options.exit(code);
  };
  const onSignal = () => {
    if (signalled) return;
    signalled = true;
    const stopping = coordinator.stop();
    if (!options.exitWhenDrained) clock.setTimeout(() => end(1), coordinator.graceMs);
    void stopping.then((result) => {
      if (result.outcome === "deadline") end(1, result.unfinished);
      else if (options.exitWhenDrained) end(0);
    });
  };
  for (const signal of SIGNALS) target.on(signal, onSignal);
  return () => {
    for (const signal of SIGNALS) target.off(signal, onSignal);
  };
}

type ProcessShutdown = { coordinator: ShutdownCoordinator; targets: WeakSet<object> };
const KEY = Symbol.for("ductus.shutdown");

// One coordinator per process: instrumentation and the route handlers are
// separate webpack module instances, so a module-level value would not be shared.
function processShutdownRecord(): ProcessShutdown {
  const holder = globalThis as typeof globalThis & { [KEY]?: ProcessShutdown };
  holder[KEY] ??= { coordinator: createShutdownCoordinator(), targets: new WeakSet() };
  return holder[KEY];
}

export function processShutdown(): ShutdownCoordinator {
  return processShutdownRecord().coordinator;
}

/** Installs the web's signals once per target, however often it is called. */
export function installProcessShutdownSignals(target: SignalTarget, exit: (code: number) => unknown): void {
  const record = processShutdownRecord();
  if (record.targets.has(target)) return;
  record.targets.add(target);
  installShutdownSignals(target, record.coordinator, { exit, exitWhenDrained: false });
}
