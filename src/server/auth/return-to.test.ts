import { describe, expect, it } from "vitest";

import { DEFAULT_RETURN_TO, safeReturnTo } from "./return-to";

// Plan of attack #154, item 17.
const ATTACKS = [
  "https://zlo.test/",
  "//zlo.test",
  "/\\zlo.test",
  "\\\\zlo.test",
  "%2F%2Fzlo.test",
  "javascript:alert(1)",
  "zlo.test",
  "/\tzlo.test",
  "/\n/zlo.test",
  "/\u200e/zlo.test",
  "/\u0000",
  "/\ud800",
  "/api/auth/login",
  // QA of #191: the bare prefix too.
  "/api",
  "/api?x=1",
  "/api#x",
  "",
  `/${"a".repeat(512)}`,
  // Dot segments that the URL parser removes after the input check (review
  // of #191).
  "/.//zlo.test",
  "/a/..//zlo.test",
  "/%2e//zlo.test",
  "/%2E%2E//zlo.test",
  "/.//zlo.test/x?y=1",
  "/./\\zlo.test",
  "/a/../\\zlo.test",
];

describe("safeReturnTo", () => {
  it.each(ATTACKS)("sends %j to the default page", (value) => {
    expect(safeReturnTo(value)).toBe(DEFAULT_RETURN_TO);
  });

  it.each(ATTACKS)("keeps %j on the same origin", (value) => {
    expect(new URL(safeReturnTo(value), "https://ductus.example").origin).toBe("https://ductus.example");
  });

  it.each([undefined, null, 42, ["/rad"], { path: "/rad" }])("sends %j to the default page", (value) => {
    expect(safeReturnTo(value)).toBe(DEFAULT_RETURN_TO);
  });

  it.each([
    ["/rad?x=1", "/rad?x=1"],
    ["/", "/"],
    ["/kolegij/DEMO-101#upute", "/kolegij/DEMO-101#upute"],
    ["/%2F%2Fzlo.test", "/%2F%2Fzlo.test"],
    ["/a/../b", "/b"],
  ])("keeps the path %j of this application", (value, expected) => {
    expect(safeReturnTo(value)).toBe(expected);
  });
});
