import { describe, expect, it } from "vitest";

import { nextTab } from "./accessTabs";

describe("nextTab", () => {
  it("wraps around in both directions", () => {
    expect(nextTab(2, "ArrowRight", 3)).toBe(0);
    expect(nextTab(0, "ArrowLeft", 3)).toBe(2);
  });

  it("moves to the ends with Home and End", () => {
    expect(nextTab(1, "Home", 3)).toBe(0);
    expect(nextTab(1, "End", 3)).toBe(2);
  });

  it("ignores other keys and an empty list", () => {
    expect(nextTab(1, "Enter", 3)).toBeNull();
    expect(nextTab(0, "ArrowRight", 0)).toBeNull();
  });
});
