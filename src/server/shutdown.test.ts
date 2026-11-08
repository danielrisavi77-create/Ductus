import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SHUTDOWN_GRACE_MS,
  createShutdownCoordinator,
  installShutdownSignals,
  type Clock,
  type StopResult,
} from "./shutdown";

// DAN-587: graceful shutdown. Each case is one input class from the contract
// (K1 to K8); the clock is a manual one so the deadline is exact.
function manualClock(): Clock & { advance(ms: number): void; pending(): number } {
  let now = 0;
  let next = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    setTimeout(fn, ms) {
      next += 1;
      timers.set(next, { at: now + ms, fn });
      return next;
    },
    clearTimeout(handle) {
      timers.delete(handle as number);
    },
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (timer.at > now || !timers.has(id)) continue;
        timers.delete(id);
        timer.fn();
      }
    },
    pending: () => timers.size,
  };
}

async function settled(promise: Promise<StopResult>): Promise<StopResult | "pending"> {
  return Promise.race([promise, new Promise<"pending">((resolve) => setImmediate(() => resolve("pending")))]);
}

afterEach(() => vi.restoreAllMocks());

describe("shutdown coordinator", () => {
  it("stays under the default 10 s grace of a container stop", () => {
    expect(SHUTDOWN_GRACE_MS).toBe(8_000);
  });

  it.each(["request", "job"] as const)("K1/K2: a %s in flight holds stop() until it is released", async (kind) => {
    const clock = manualClock();
    const shutdown = createShutdownCoordinator({ clock });
    const ticket = shutdown.begin(kind);
    expect(ticket).not.toBeNull();
    const stopping = shutdown.stop();
    expect(shutdown.state()).toBe("draining");
    clock.advance(SHUTDOWN_GRACE_MS - 1);
    expect(await settled(stopping)).toBe("pending");
    ticket!.release();
    expect(await stopping).toEqual({ outcome: "drained" });
    expect(shutdown.state()).toBe("stopped");
    expect(clock.pending()).toBe(0);
  });

  it.each(["draining", "stopped"] as const)("K3: no new work is accepted once %s", async (state) => {
    const clock = manualClock();
    const shutdown = createShutdownCoordinator({ clock });
    const held = shutdown.begin("job");
    const stopping = shutdown.stop();
    if (state === "stopped") {
      held!.release();
      await stopping;
    }
    expect(shutdown.state()).toBe(state);
    expect(shutdown.begin("job")).toBeNull();
    expect(shutdown.begin("request")).toBeNull();
    const fn = vi.fn(async () => "done");
    await expect(shutdown.runJob(fn)).rejects.toMatchObject({ code: "SHUTTING_DOWN", message: "SHUTTING_DOWN" });
    expect(fn).not.toHaveBeenCalled();
    expect(shutdown.active()).toEqual({ request: 0, job: state === "draining" ? 1 : 0 });
  });

  it("runJob holds a job ticket for the whole job and releases it on a throw", async () => {
    const shutdown = createShutdownCoordinator({ clock: manualClock() });
    let finish!: () => void;
    const running = shutdown.runJob(() => new Promise<void>((resolve) => (finish = resolve)));
    expect(shutdown.active()).toEqual({ request: 0, job: 1 });
    const stopping = shutdown.stop();
    expect(await settled(stopping)).toBe("pending");
    finish();
    await running;
    expect(await stopping).toEqual({ outcome: "drained" });

    const other = createShutdownCoordinator({ clock: manualClock() });
    await expect(other.runJob(async () => Promise.reject(new Error("job")))).rejects.toThrow("job");
    expect(other.active()).toEqual({ request: 0, job: 0 });
  });

  it("K5: at the deadline it reports exactly what is unfinished, and a late release changes nothing", async () => {
    const clock = manualClock();
    const shutdown = createShutdownCoordinator({ clock });
    const request = shutdown.begin("request");
    shutdown.begin("job");
    shutdown.begin("job");
    const stopping = shutdown.stop();
    clock.advance(SHUTDOWN_GRACE_MS);
    expect(await stopping).toEqual({ outcome: "deadline", unfinished: { request: 1, job: 2 } });
    expect(shutdown.state()).toBe("stopped");
    request!.release();
    expect(await shutdown.stop()).toEqual({ outcome: "deadline", unfinished: { request: 1, job: 2 } });
    expect(shutdown.active()).toEqual({ request: 0, job: 2 });
  });

  it("K6: stop() is idempotent and arms one deadline", async () => {
    const clock = manualClock();
    const shutdown = createShutdownCoordinator({ clock });
    shutdown.begin("job");
    const first = shutdown.stop();
    expect(shutdown.stop()).toBe(first);
    expect(clock.pending()).toBe(1);
  });

  it("K7: releasing the same ticket twice counts once and does not free another job", async () => {
    const clock = manualClock();
    const shutdown = createShutdownCoordinator({ clock });
    const a = shutdown.begin("job")!;
    shutdown.begin("job");
    a.release();
    a.release();
    expect(shutdown.active()).toEqual({ request: 0, job: 1 });
    const stopping = shutdown.stop();
    expect(await settled(stopping)).toBe("pending");
    clock.advance(SHUTDOWN_GRACE_MS);
    expect(await stopping).toEqual({ outcome: "deadline", unfinished: { request: 0, job: 1 } });
  });

  it("K8: stop() with nothing in flight is drained at once and leaves no timer", async () => {
    const clock = manualClock();
    const shutdown = createShutdownCoordinator({ clock });
    shutdown.begin("request")!.release();
    expect(await shutdown.stop()).toEqual({ outcome: "drained" });
    expect(shutdown.state()).toBe("stopped");
    expect(clock.pending()).toBe(0);
  });

  it("Istodobnost: a ticket taken in the same step before stop() holds it, one taken after is refused", async () => {
    const clock = manualClock();
    const shutdown = createShutdownCoordinator({ clock });
    const before = shutdown.begin("job");
    const stopping = shutdown.stop();
    const after = shutdown.begin("job");
    expect(before).not.toBeNull();
    expect(after).toBeNull();
    expect(await settled(stopping)).toBe("pending");
    before!.release();
    expect(await stopping).toEqual({ outcome: "drained" });
  });
});

describe("shutdown signals", () => {
  function setup(exitWhenDrained: boolean) {
    const clock = manualClock();
    const shutdown = createShutdownCoordinator({ clock });
    const target = new EventEmitter();
    const exit = vi.fn();
    const log = vi.fn();
    const remove = installShutdownSignals(target, shutdown, { exit, exitWhenDrained, clock, log });
    return { clock, shutdown, target, exit, log, remove };
  }

  it("listens to SIGTERM and SIGINT once each and can be removed", () => {
    const { target, remove } = setup(true);
    expect(target.listenerCount("SIGTERM")).toBe(1);
    expect(target.listenerCount("SIGINT")).toBe(1);
    remove();
    expect(target.listenerCount("SIGTERM")).toBe(0);
    expect(target.listenerCount("SIGINT")).toBe(0);
  });

  it("K1/K2 worker: exits 0 once the work in flight is released", async () => {
    const { shutdown, target, exit, log } = setup(true);
    const job = shutdown.begin("job")!;
    target.emit("SIGTERM", "SIGTERM");
    await new Promise((resolve) => setImmediate(resolve));
    expect(exit).not.toHaveBeenCalled();
    job.release();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(log).not.toHaveBeenCalled();
  });

  it("K5: exits 1 at the deadline and logs only a closed code and counts", async () => {
    const { clock, shutdown, target, exit, log } = setup(true);
    shutdown.begin("request");
    target.emit("SIGTERM", "SIGTERM");
    clock.advance(SHUTDOWN_GRACE_MS);
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(log.mock.calls).toEqual([["shutdown", { code: "SHUTDOWN_DEADLINE", request: 1, job: 0 }]]);
  });

  it("K6: a repeated or second signal starts nothing new and ends the process once", async () => {
    const { clock, shutdown, target, exit } = setup(true);
    const stop = vi.spyOn(shutdown, "stop");
    shutdown.begin("job");
    target.emit("SIGTERM", "SIGTERM");
    target.emit("SIGINT", "SIGINT");
    target.emit("SIGTERM", "SIGTERM");
    clock.advance(SHUTDOWN_GRACE_MS * 2);
    await vi.waitFor(() => expect(exit).toHaveBeenCalled());
    await new Promise((resolve) => setImmediate(resolve));
    expect(stop).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("web: drained does not exit (the server owner does), but a process still alive at the deadline exits 1", async () => {
    const { clock, target, exit, log } = setup(false);
    target.emit("SIGTERM", "SIGTERM");
    await new Promise((resolve) => setImmediate(resolve));
    expect(exit).not.toHaveBeenCalled();
    clock.advance(SHUTDOWN_GRACE_MS - 1);
    expect(exit).not.toHaveBeenCalled();
    clock.advance(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
    expect(log.mock.calls).toEqual([["shutdown", { code: "SHUTDOWN_DEADLINE", request: 0, job: 0 }]]);
  });

  it("web: work unfinished at the deadline exits once with its counts", async () => {
    const { clock, shutdown, target, exit, log } = setup(false);
    shutdown.begin("request");
    target.emit("SIGTERM", "SIGTERM");
    clock.advance(SHUTDOWN_GRACE_MS);
    await new Promise((resolve) => setImmediate(resolve));
    expect(exit).toHaveBeenCalledTimes(1);
    expect(log.mock.calls).toEqual([["shutdown", { code: "SHUTDOWN_DEADLINE", request: 1, job: 0 }]]);
  });
});
