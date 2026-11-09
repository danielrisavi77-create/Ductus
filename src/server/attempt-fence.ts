// DAN-517 (attack plan #1826, W-3 and W-4): the hard end of a job attempt.
// A stop signal only asks a handler to stop. The fence ends the whole process
// when an attempt is still armed at its time, so an attempt that ignores the
// signal, or blocks the thread, is gone before the queue hands its job out
// again. The watch runs in its own thread and writes nothing before the kill.
//
// Erasable TypeScript only: the process test runs this file in plain node.
import { Worker } from "node:worker_threads";

const WATCH = `
const cell = new BigInt64Array(require("node:worker_threads").workerData);
for (;;) {
  const at = Atomics.load(cell, 0);
  if (at === 0n) { Atomics.wait(cell, 0, 0n); continue; }
  const left = Number((at - process.hrtime.bigint()) / 1000000n);
  if (left <= 0) process.kill(process.pid, "SIGKILL");
  else Atomics.wait(cell, 0, at, left);
}`;

export type AttemptFence = {
  /** Ends this process unless the returned release is called within `ms`. Throws once closed. */
  arm(ms: number): () => void;
  /** No new attempt is armed after this; one that is armed stays fenced until it is released. */
  close(): Promise<void>;
};

export function startAttemptFence(): AttemptFence {
  // The earliest armed time on the monotonic clock, or 0 when nothing is armed.
  const cell = new BigInt64Array(new SharedArrayBuffer(8));
  const thread = new Worker(WATCH, { eval: true, workerData: cell.buffer });
  thread.unref();
  const armed = new Map<symbol, bigint>();
  let closed = false;
  function publish(): void {
    let earliest = 0n;
    for (const at of armed.values()) if (earliest === 0n || at < earliest) earliest = at;
    Atomics.store(cell, 0, earliest);
    Atomics.notify(cell, 0);
  }
  return {
    arm(ms) {
      if (closed || !Number.isInteger(ms) || ms < 1) throw new Error("fence_refused");
      const key = Symbol("attempt");
      armed.set(key, process.hrtime.bigint() + BigInt(ms) * 1_000_000n);
      publish();
      return () => {
        if (!armed.delete(key)) return;
        publish();
        if (closed && armed.size === 0) void thread.terminate();
      };
    },
    async close() {
      closed = true;
      if (armed.size === 0) await thread.terminate();
    },
  };
}
