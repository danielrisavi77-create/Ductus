import { describe, expect, it } from "vitest";

import { DEFAULT_RETURN_TO, safeReturnTo } from "./return-to";

// Plan of attack #154, item 17.
describe("safeReturnTo", () => {
  it.each([
    "https://zlo.test/",
    "//zlo.test",
    "/\\zlo.test",
    "\\\\zlo.test",
    "%2F%2Fzlo.test",
    "javascript:alert(1)",
    "zlo.test",
    "/\tzlo.test",
    "/\n/zlo.test",
    "/‎/zlo.test",
    "/\u0000",
    "/\ud800",
    "/api/auth/login",
    "",
    `/${"a".repeat(512)}`,
  ])("sends %j to the default page", (value) => {
    expect(safeReturnTo(value)).toBe(DEFAULT_RETURN_TO);
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
