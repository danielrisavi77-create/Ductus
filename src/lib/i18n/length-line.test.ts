import { describe, expect, it } from "vitest";

import { countTextWords, groupHr, lengthLine, pagesOf, wordRangeHr } from "./length-line";

const NBSP = " ";
const RANGE = { min: 2000, max: 2500 };

describe("length line of the status bar (FE-D6)", () => {
  it("groups thousands with a no-break space", () => {
    expect(groupHr(0)).toBe("0");
    expect(groupHr(999)).toBe("999");
    expect(groupHr(2000)).toBe(`2${NBSP}000`);
    expect(groupHr(1234567)).toBe(`1${NBSP}234${NBSP}567`);
  });

  it("gives the same optional target label to preview and notice", () => {
    expect(wordRangeHr(null)).toBeNull();
    expect(wordRangeHr({ min: null, max: null })).toBeNull();
    expect(wordRangeHr({ min: 1, max: null })).toBe("najmanje 1 riječ");
    expect(wordRangeHr({ min: null, max: 1_000_000 })).toBe(`najviše 1${NBSP}000${NBSP}000 riječi`);
    expect(wordRangeHr(RANGE)).toBe(`2${NBSP}000–2${NBSP}500 riječi`);
    expect(wordRangeHr({ min: 1, max: 1 })).toBe("1–1 riječ");
  });

  it("counts pages at 300 words, none before the first word, then at least one", () => {
    expect(pagesOf(0)).toBe(0);
    expect(pagesOf(1)).toBe(1);
    expect(pagesOf(449)).toBe(1);
    expect(pagesOf(450)).toBe(2);
    expect(pagesOf(2500)).toBe(8);
  });

  it("counts selected words the way the journal splits them", () => {
    expect(countTextWords("")).toBe(0);
    expect(countTextWords("   ")).toBe(0);
    expect(countTextWords(" jedna  dvije\ttri\n")).toBe(3);
  });

  it("matches the design line with a range", () => {
    const line = lengthLine(210, 0, RANGE);
    expect(line).toEqual({ selected: null, count: "210", rest: ` / 2${NBSP}000–2${NBSP}500 riječi · ≈ 1 str.` });
  });

  it("states one-sided limits without inventing the other end", () => {
    expect(lengthLine(210, 0, { min: 1, max: null }).rest).toBe(" / najmanje 1 riječ · ≈ 1 str.");
    expect(lengthLine(210, 0, { min: 2000, max: null }).rest).toBe(` / najmanje 2${NBSP}000 riječi · ≈ 1 str.`);
    expect(lengthLine(210, 0, { min: null, max: 2 }).rest).toBe(" / najviše 2 riječi · ≈ 1 str.");
    expect(lengthLine(210, 0, { min: null, max: 1000000 }).rest).toBe(` / najviše 1${NBSP}000${NBSP}000 riječi · ≈ 1 str.`);
    expect(lengthLine(0, 0, { min: null, max: null }).rest).toBe(" riječi");
  });

  it("keeps equal bounds, selected words and page estimate", () => {
    expect(lengthLine(450, 1, { min: 1000000, max: 1000000 })).toEqual({
      selected: "označeno 1 riječ",
      count: "450",
      rest: ` / 1${NBSP}000${NBSP}000–1${NBSP}000${NBSP}000 riječi · ≈ 2 str.`,
    });
  });

  it("without a range agrees the noun with the count", () => {
    expect(lengthLine(1, 0, null).rest).toBe(" riječ · ≈ 1 str.");
    expect(lengthLine(3, 0, null).rest).toBe(" riječi · ≈ 1 str.");
    expect(lengthLine(11, 0, null).rest).toBe(" riječi · ≈ 1 str.");
  });

  it("an empty document shows no page estimate", () => {
    expect(lengthLine(0, 0, RANGE)).toEqual({ selected: null, count: "0", rest: ` / 2${NBSP}000–2${NBSP}500 riječi` });
    expect(lengthLine(0, 0, null).rest).toBe(" riječi");
  });

  it("names a selection of words first, and only when there is one", () => {
    expect(lengthLine(210, 1, RANGE).selected).toBe("označeno 1 riječ");
    expect(lengthLine(210, 12, RANGE).selected).toBe("označeno 12 riječi");
    expect(lengthLine(210, 0, RANGE).selected).toBeNull();
  });

  // #476 contract 6280487079: /rad has no word range until the assignment
  // carries one (DAN-229), and the line then names none.
  it("without a range names no range at any count", () => {
    for (const words of [0, 1, 210, 2500]) {
      expect(lengthLine(words, 0, null).rest).not.toMatch(/[–/]/u);
    }
  });
});
