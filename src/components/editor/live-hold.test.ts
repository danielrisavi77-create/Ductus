import { describe, expect, it } from "vitest";

import { livePublishAction, type LivePublishAction } from "./live-hold";

type Halted = "signedOut" | "notFound" | null;

// Every input class of the guard (#882, DAN-215): the teacher view holds the
// publisher; only a run that may still write starts it again; a halt (401 or
// 404) is never undone by a change of mode.
const table: Array<[held: boolean, writable: boolean, halted: Halted, action: LivePublishAction]> = [
  [true, true, null, "stop"],
  [true, false, null, "stop"],
  [true, true, "signedOut", "none"],
  [true, false, "signedOut", "none"],
  [true, true, "notFound", "none"],
  [true, false, "notFound", "none"],
  [false, true, null, "start"],
  [false, false, null, "none"],
  [false, true, "signedOut", "none"],
  [false, false, "signedOut", "none"],
  [false, true, "notFound", "none"],
  [false, false, "notFound", "none"],
];

describe("livePublishAction (#882)", () => {
  it.each(table)("held=%s writable=%s halted=%s -> %s", (held, writable, halted, action) => {
    expect(livePublishAction({ held, writable, halted })).toBe(action);
  });

  it("the table covers every combination once", () => {
    const keys = new Set(table.map(([h, w, x]) => `${h}|${w}|${x}`));
    expect(keys.size).toBe(2 * 2 * 3);
    expect(table).toHaveLength(2 * 2 * 3);
  });

  it("a held view never starts, whatever else holds", () => {
    for (const writable of [true, false]) {
      for (const halted of [null, "signedOut", "notFound"] as const) {
        expect(livePublishAction({ held: true, writable, halted })).not.toBe("start");
      }
    }
  });

  it("only a writable run that has not halted starts", () => {
    const starts = table.filter(([, , , action]) => action === "start");
    expect(starts).toEqual([[false, true, null, "start"]]);
  });
});
