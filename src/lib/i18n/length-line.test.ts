import { describe, expect, it } from "vitest";

import { DEMO_WORK_CONTEXT } from "./demo-context.hr";
import { countTextWords, groupHr, lengthLine, pagesOf } from "./length-line";

const NBSP = " ";
const RANGE = { min: 2000, max: 2500 };

describe("length line of the status bar (FE-D6)", () => {
  it("groups thousands with a no-break space", () => {
    expect(groupHr(0)).toBe("0");
    expect(groupHr(999)).toBe("999");
    expect(groupHr(2000)).toBe(`2${NBSP}000`);
    expect(groupHr(1234567)).toBe(`1${NBSP}234${NBSP}567`);
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

  it("uses a demo range that is a real range", () => {
    expect(DEMO_WORK_CONTEXT.words.min).toBeLessThan(DEMO_WORK_CONTEXT.words.max);
  });
});
