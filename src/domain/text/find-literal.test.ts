import { describe, expect, it } from "vitest";

import { findLiteral, isSearchableText, MAX_SEARCH_TEXT_LENGTH } from "./find-literal";

/**
 * DAN-507 (M5.10-P02, contract #1091 c.6587093852): literal search over one
 * run of text, the string side of the input classes. Synthetic text only.
 */

const at = (text: string, query: string, matchCase = true) =>
  findLiteral(text, { text: query, matchCase }).map(({ from, to }) => [from, to]);

describe("findLiteral", () => {
  it.each([
    // K1 empty query: never a match, never a loop.
    ["K1", "abc", "", true, []],
    // K2 no match.
    ["K2", "abc", "x", true, []],
    // K3 one match.
    ["K3", "izmisljeni tekst", "tekst", true, [[11, 16]]],
    // K4 several, left to right.
    ["K4", "ab ab ab", "ab", true, [[0, 2], [3, 5], [6, 8]]],
    // K5 overlaps: non-overlapping, leftmost first.
    ["K5 aaa", "aaa", "aa", true, [[0, 2]]],
    ["K5 aaaa", "aaaa", "aa", true, [[0, 2], [2, 4]]],
    // K10 a pattern is literal text.
    ["K10 .*", "a.*b axb", "a.*b", true, [[0, 4]]],
    ["K10 (a+)+$", "x(a+)+$", "(a+)+$", true, [[1, 7]]],
    ["K10 [", "a[b", "[", true, [[1, 2]]],
    ["K10 \\", "a\\b", "\\", true, [[1, 2]]],
    // K11 letter case.
    ["K11 case on", "Čaša čaša", "čaša", true, [[5, 9]]],
    ["K11 case off", "Čaša čaša ČAŠA", "čaša", false, [[0, 4], [5, 9], [10, 14]]],
    ["K11 ǅ", "ǄǅǆDž", "ǆ", false, [[0, 1], [1, 2], [2, 3]]],
    // İ lowercases to two code units: it is kept as it is, so the offsets hold.
    ["K11 İ", "İi", "i", false, [[1, 2]]],
    ["K11 İ itself", "İi", "İ", false, [[0, 1]]],
    // K12 surrogate pairs: a match never cuts one.
    ["K12 emoji", "a😀b😀", "😀", true, [[1, 3], [4, 6]]],
    ["K12 half", "a😀b", "\uDE00", true, []],
  ] as const)("%s", (_name, text, query, matchCase, expected) => {
    expect(at(text, query, matchCase)).toEqual(expected);
  });

  it("K10: a pattern that would backtrack is literal and fast on a long text", () => {
    const text = "a".repeat(200_000) + "!";
    const started = performance.now();
    expect(at(text, "(a+)+$")).toEqual([]);
    expect(at(text, "a".repeat(199) + "b")).toEqual([]);
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it("K13: a query that cannot be stored or typed finds nothing", () => {
    for (const query of ["\uD800", "a\u0000", "a\nb", "a\tb", "a\u2028", "\u0085", "x".repeat(MAX_SEARCH_TEXT_LENGTH + 1)]) {
      expect(at(`izmisljeno ${query} izmisljeno`, query)).toEqual([]);
    }
  });
});

describe("isSearchableText", () => {
  it.each([
    ["", true],
    ["obična riječ", true],
    ["😀", true],
    ["x".repeat(MAX_SEARCH_TEXT_LENGTH), true],
    ["x".repeat(MAX_SEARCH_TEXT_LENGTH + 1), false],
    ["\uD800", false],
    ["a\uDC00b", false],
    ["\u0000", false],
    ["a\nb", false],
    ["a\rb", false],
    ["a\tb", false],
    ["\u007F", false],
    ["\u0085", false],
    ["\u2028", false],
    ["\u2029", false],
  ])("%j → %s", (text, expected) => {
    expect(isSearchableText(text)).toBe(expected);
  });
});
