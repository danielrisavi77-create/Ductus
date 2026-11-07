import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { TeacherRoleOutcome } from "./teacher-role-action";
import { IDLE, dialogOpen, nextRoleStep, outcomeRole, refreshAfter, type RoleEvent, type RoleStep } from "./teacher-roles-flow";

// DAN-581 (A-02, plan #1592): one action at a time, one request per
// confirmed dialog. Invented person ids and names only.
type Kind = TeacherRoleOutcome["kind"];
const KINDS: Kind[] = ["confirmed", "revoked", "notConfirmed", "notCandidate", "unauthorized", "forbidden", "invalid", "unknown"];
const A = { action: "confirm", personId: "00000000-0000-4000-8000-00000000000a", name: "Osoba A (test)" } as const;
const B = { action: "revoke", personId: "00000000-0000-4000-8000-00000000000b", name: "Osoba B (test)" } as const;
const run = (events: RoleEvent[], from: RoleStep = IDLE) => events.reduce(nextRoleStep, from);

describe("teacher role flow", () => {
  it("asks, works once, then settles", () => {
    const asking = run([{ type: "ask", ...A }]);
    expect(asking).toEqual({ kind: "asking", ...A });
    expect(run([{ type: "send" }], asking)).toEqual({ kind: "working", ...A });
    expect(run([{ type: "send" }, { type: "settle", outcome: "confirmed" }], asking)).toEqual({ kind: "done", outcome: "confirmed", ...A });
  });

  it("takes a second click on the action as nothing (negative: double click)", () => {
    const working = run([{ type: "ask", ...A }, { type: "send" }]);
    expect(run([{ type: "send" }], working)).toBe(working);
  });

  it("cannot be cancelled, closed or re-aimed while a request runs", () => {
    const working = run([{ type: "ask", ...A }, { type: "send" }]);
    for (const event of [{ type: "cancel" }, { type: "close" }, { type: "ask", ...B }] as RoleEvent[]) {
      expect(run([event], working)).toBe(working);
    }
  });

  it("ignores a settle that no request waits for", () => {
    expect(run([{ type: "settle", outcome: "confirmed" }])).toBe(IDLE);
    const asking = run([{ type: "ask", ...A }]);
    expect(run([{ type: "settle", outcome: "confirmed" }], asking)).toBe(asking);
  });

  it("keeps the dialog open only to ask, to work, or after an unknown outcome", () => {
    expect(dialogOpen(IDLE)).toBe(false);
    for (const outcome of KINDS) {
      const done = run([{ type: "ask", ...B }, { type: "send" }, { type: "settle", outcome }]);
      expect(dialogOpen(done)).toBe(outcome === "unknown");
      expect(refreshAfter(outcome)).toBe(outcome !== "unknown");
      expect(outcomeRole(outcome)).toBe(outcome === "confirmed" || outcome === "revoked" ? "status" : "alert");
    }
  });

  it("sends at most one request per confirmed dialog, for the person it asked about", () => {
    const target = fc.constantFrom(A, B);
    const event: fc.Arbitrary<RoleEvent> = fc.oneof(
      target.map((t) => ({ type: "ask" as const, ...t })),
      fc.constantFrom<RoleEvent>({ type: "cancel" }, { type: "send" }, { type: "close" }),
      fc.constantFrom(...KINDS).map((outcome) => ({ type: "settle" as const, outcome })),
    );
    fc.assert(fc.property(fc.array(event, { maxLength: 40 }), (events) => {
      let step = IDLE;
      let open = false;
      for (const e of events) {
        const next = nextRoleStep(step, e);
        if (next.kind === "working" && step.kind !== "working") {
          // A request starts only from the dialog that asked, for the same person.
          expect(step.kind).toBe("asking");
          expect(open).toBe(false);
          open = true;
          if (step.kind === "asking") expect([next.personId, next.action]).toEqual([step.personId, step.action]);
        }
        if (step.kind === "working" && next.kind !== "working") {
          expect(next.kind).toBe("done");
          open = false;
        }
        if (step.kind === "working" && next.kind === "working") expect(next).toBe(step);
        step = next;
      }
    }));
  });
});
