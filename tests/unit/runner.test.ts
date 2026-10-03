import { describe, expect, it } from "vitest";

// Proves the `unit` project runs; replaced by real suites from M0.2 and M0.3.
describe("unit runner", () => {
  it("runs", () => {
    expect([1, 2, 3].map((n) => n * 2)).toEqual([2, 4, 6]);
  });
});
