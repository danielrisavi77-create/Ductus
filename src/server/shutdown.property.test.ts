import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { createShutdownCoordinator, type Clock, type StopResult, type Ticket, type WorkKind } from "./shutdown";

// DAN-587: any sequence of begin, release, stop and clock ticks is compared
// with a plain model. Invariants: after stop() no new ticket; "drained" exactly
// when every ticket issued before stop() was released before the deadline;
// the count of active work is issued minus released and never negative.
const GRACE = 100;

type Step =
  | { op: "begin"; kind: WorkKind }
  | { op: "release"; index: number }
  | { op: "stop" }
  | { op: "tick"; ms: number };

const step: fc.Arbitrary<Step> = fc.oneof(
  fc.record({ op: fc.constant("begin" as const), kind: fc.constantFrom<WorkKind>("request", "job") }),
  fc.record({ op: fc.constant("release" as const), index: fc.nat(20) }),
  fc.record({ op: fc.constant("stop" as const) }),
  fc.record({ op: fc.constant("tick" as const), ms: fc.integer({ min: 1, max: 60 }) }),
);

function manualClock(): Clock & { advance(ms: number): void } {
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
      for (const [id, timer] of [...timers]) {
        if (timer.at > now || !timers.has(id)) continue;
        timers.delete(id);
        timer.fn();
      }
    },
  };
}

describe("shutdown coordinator model", () => {
  it("matches the model for any sequence of begin, release, stop and tick", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(step, { maxLength: 60 }), async (steps) => {
        const clock = manualClock();
        const shutdown = createShutdownCoordinator({ clock, graceMs: GRACE });
        const tickets: Array<{ ticket: Ticket; kind: WorkKind; released: boolean }> = [];
        let stopped = false;
        let elapsedSinceStop = 0;
        let result: StopResult | undefined;
        let expected: StopResult | undefined;
        let stopping: Promise<StopResult> | undefined;

        const open = (kind: WorkKind) => tickets.filter((t) => t.kind === kind && !t.released).length;
        const decide = () => {
          if (!stopped || expected) return;
          if (open("request") === 0 && open("job") === 0) expected = { outcome: "drained" };
          else if (elapsedSinceStop >= GRACE)
            expected = { outcome: "deadline", unfinished: { request: open("request"), job: open("job") } };
        };

        for (const s of steps) {
          if (s.op === "begin") {
            const ticket = shutdown.begin(s.kind);
            if (stopped) expect(ticket).toBeNull();
            else {
              expect(ticket).not.toBeNull();
              tickets.push({ ticket: ticket!, kind: s.kind, released: false });
            }
          } else if (s.op === "release") {
            const entry = tickets[s.index % Math.max(tickets.length, 1)];
            if (entry) {
              entry.ticket.release();
              entry.released = true;
            }
          } else if (s.op === "stop") {
            const next = shutdown.stop();
            if (stopping) expect(next).toBe(stopping);
            stopping = next;
            void next.then((r) => (result = r));
            stopped = true;
          } else {
            clock.advance(s.ms);
            if (stopped) elapsedSinceStop += s.ms;
          }
          decide();
          await Promise.resolve();
          await Promise.resolve();

          expect(shutdown.active()).toEqual({ request: open("request"), job: open("job") });
          expect(result).toEqual(expected);
          expect(shutdown.state()).toBe(!stopped ? "running" : expected ? "stopped" : "draining");
        }
      }),
    );
  });
});
