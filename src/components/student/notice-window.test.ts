import { describe, expect, it } from "vitest";

import { noticeWindow } from "./notice-window";

const OPENS = "2026-11-02T08:00:00.000Z";
const DUE = "2026-11-30T22:59:00.000Z";
const at = (iso: string) => Date.parse(iso);

describe("FE-D8 notice window", () => {
  it("is not open before the opening instant, and open from it", () => {
    expect(noticeWindow(OPENS, DUE, at("2026-11-02T07:59:59.999Z"))).toBe("notOpen");
    expect(noticeWindow(OPENS, DUE, at(OPENS))).toBe("open");
  });

  it("stays open up to the due instant and is past due after it", () => {
    expect(noticeWindow(OPENS, DUE, at(DUE))).toBe("open");
    expect(noticeWindow(OPENS, DUE, at("2026-11-30T22:59:00.001Z"))).toBe("pastDue");
  });

  it("never closes on a date that does not parse", () => {
    expect(noticeWindow("not a date", DUE, at("2026-01-01T00:00:00Z"))).toBe("open");
    expect(noticeWindow(OPENS, "", at("2027-01-01T00:00:00Z"))).toBe("open");
  });

  it("reads not open first when the dates are inverted", () => {
    expect(noticeWindow(DUE, OPENS, at("2026-11-15T00:00:00Z"))).toBe("notOpen");
  });
});
