import { describe, expect, it } from "vitest";

import { parseWorkLanguage, WORK_LANGUAGES } from "./work-language";

describe("work language parser", () => {
  it("is the closed set of the database CHECK", () => {
    expect(WORK_LANGUAGES).toEqual(["hr", "en"]);
  });

  it.each([
    ["hr", "hr"],
    ["en", "en"],
    ["de", null],
    ["HR", null],
    ["En", null],
    [" hr", null],
    ["hr ", null],
    ["hr-HR", null],
    ["en-GB", null],
    ["", null],
    [null, null],
    [undefined, null],
    [0, null],
    [["hr"], null],
    [{ toString: () => "hr" }, null],
    [new String("hr"), null],
  ])("%j reads as %j", (value, expected) => {
    expect(parseWorkLanguage(value)).toBe(expected);
  });
});
