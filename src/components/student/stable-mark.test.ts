import { describe, expect, it } from "vitest";

import { stableMark } from "./stable-mark";

// #732 item 7: switching views on /rad renders the page again with a new `at`;
// the sheet keeps the mark of its session. Tags and times are invented.
const FIRST = { tag: "a1b2c3", at: 1_000 };

describe("stableMark", () => {
  it("keeps the first mark while the session stays the same", () => {
    expect(stableMark(FIRST, { tag: "a1b2c3", at: 2_000 })).toBe(FIRST);
  });

  it("takes the new mark of another session", () => {
    const other = { tag: "d4e5f6", at: 3_000 };
    expect(stableMark(FIRST, other)).toBe(other);
  });

  it("drops the mark when the page has no session, and takes the first one", () => {
    expect(stableMark(FIRST, null)).toBeNull();
    expect(stableMark(null, FIRST)).toBe(FIRST);
  });
});
