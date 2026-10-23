import { fc, test } from "@fast-check/vitest";
import { expect } from "vitest";

import { initialNotice, mayRecord, noticeStep, type Acknowledgment, type NoticeEvent, type NoticeState } from "./notice-gate";

// F-7: "prije potvrde ništa ne ide na poslužitelj". Over any order of clicks,
// confirmations and server replies, a request leaves only on a confirmation
// of a ticked box with none in flight, and recording opens only after the
// server's acknowledgment time.
const result: fc.Arbitrary<Acknowledgment> = fc.oneof(
  fc.constant({ kind: "acknowledged", at: "2026-11-02T09:14:00.000Z" } as const),
  fc.constantFrom("stale", "unauthorized", "forbidden", "invalid", "unavailable").map((kind) => ({ kind })),
);
const event: fc.Arbitrary<NoticeEvent> = fc.oneof(
  fc.constant({ type: "toggle" } as const),
  fc.constant({ type: "confirm" } as const),
  result.map((r) => ({ type: "settled", result: r }) as const),
);

test.prop([fc.array(event, { maxLength: 40 })])("no request and no recording before an explicit confirmation", (events) => {
  let state: NoticeState = initialNotice(null);
  let acknowledgedByServer = false;
  for (const e of events) {
    const before = state;
    const step = noticeStep(state, e);
    if (step.send) {
      expect(e.type).toBe("confirm");
      expect(before).toMatchObject({ phase: "reading", checked: true });
    }
    if (before.phase === "sending" && e.type === "settled" && e.result.kind === "acknowledged") {
      acknowledgedByServer = true;
    }
    state = step.state;
    expect(mayRecord(state)).toBe(acknowledgedByServer);
  }
});
