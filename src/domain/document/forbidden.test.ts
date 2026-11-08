import { describe, expect, it } from "vitest";

import {
  FORBIDDEN_CODE_POINT_RANGES,
  WHITE_SPACE_CODE_POINT_RANGES,
  allowedCodePointLength,
  isAllowedText,
  isAllowedTrimmedText,
  isForbiddenCodePoint,
  isWhiteSpaceCodePoint,
} from "./forbidden";

/** docs/contracts/document-schema-v2.md §2.3 and §3.2 (DAN-619 PR a). */

describe("FORBIDDEN set", () => {
  it("holds exactly the contract ranges", () => {
    expect(FORBIDDEN_CODE_POINT_RANGES).toEqual([
      [0x0000, 0x001f],
      [0x007f, 0x009f],
      [0x00ad, 0x00ad],
      [0x061c, 0x061c],
      [0x180e, 0x180e],
      [0x200b, 0x200f],
      [0x202a, 0x202e],
      [0x2060, 0x2064],
      [0x2066, 0x206f],
      [0xfeff, 0xfeff],
    ]);
  });

  it.each(FORBIDDEN_CODE_POINT_RANGES.map(([low, high]) => [low, high]))(
    "refuses both edges of U+%s..U+%s and allows the neighbours",
    (low, high) => {
      expect(isForbiddenCodePoint(low)).toBe(true);
      expect(isForbiddenCodePoint(high)).toBe(true);
      expect(allowedCodePointLength(String.fromCodePoint(low))).toBeNull();
      expect(allowedCodePointLength(String.fromCodePoint(high))).toBeNull();
      if (!FORBIDDEN_CODE_POINT_RANGES.some(([l, h]) => low - 1 >= l && low - 1 <= h) && low > 0) {
        expect(isForbiddenCodePoint(low - 1)).toBe(false);
      }
      if (!FORBIDDEN_CODE_POINT_RANGES.some(([l, h]) => high + 1 >= l && high + 1 <= h)) {
        expect(isForbiddenCodePoint(high + 1)).toBe(false);
      }
    },
  );

  it("allows U+2028, U+2029 and U+2065", () => {
    for (const codePoint of [0x2028, 0x2029, 0x2065]) {
      expect(isForbiddenCodePoint(codePoint)).toBe(false);
    }
    expect(allowedCodePointLength("a b ")).toBe(4);
  });
});

describe("allowedCodePointLength", () => {
  it("counts code points, an astral character as one", () => {
    expect(allowedCodePointLength("")).toBe(0);
    expect(allowedCodePointLength("str. 12")).toBe(7);
    expect(allowedCodePointLength("\u{1F600}\u{1D400}")).toBe(2);
    expect(allowedCodePointLength("č")).toBe(2);
  });

  it("refuses a lone high or low surrogate anywhere", () => {
    for (const value of ["\ud800", "a\ud83d", "\ud83da", "\udc00", "a\ude00b", "\ude00\ud83d"]) {
      expect(allowedCodePointLength(value)).toBeNull();
    }
  });
});

describe("text rules", () => {
  it("isAllowedText: 1 to max code points, any edge", () => {
    expect(isAllowedText("", 5)).toBe(false);
    expect(isAllowedText(" ", 5)).toBe(true);
    expect(isAllowedText("\u{1F600}".repeat(5), 5)).toBe(true);
    expect(isAllowedText("\u{1F600}".repeat(6), 5)).toBe(false);
    expect(isAllowedText(5, 5)).toBe(false);
    expect(isAllowedText(null, 5)).toBe(false);
  });

  it.each(WHITE_SPACE_CODE_POINT_RANGES.flatMap(([low, high]) => [low, high]))(
    "isAllowedTrimmedText refuses White_Space U+%s at either end",
    (codePoint) => {
      expect(isWhiteSpaceCodePoint(codePoint)).toBe(true);
      const space = String.fromCodePoint(codePoint);
      expect(isAllowedTrimmedText(`${space}Izvor`, 20)).toBe(false);
      expect(isAllowedTrimmedText(`Izvor${space}`, 20)).toBe(false);
    },
  );

  it("isAllowedTrimmedText allows inner space and astral edges", () => {
    expect(isAllowedTrimmedText("Izvor 1", 20)).toBe(true);
    expect(isAllowedTrimmedText("Izvor dio", 20)).toBe(true);
    expect(isAllowedTrimmedText("\u{1F600}x\u{1F600}", 3)).toBe(true);
    expect(isAllowedTrimmedText("", 20)).toBe(false);
  });
});
