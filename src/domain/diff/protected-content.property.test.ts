import { fc, test } from "@fast-check/vitest";
import { expect } from "vitest";

import { parseCitationStyle } from "@/domain/citation";

import fpzgConfig from "../../../config/faculties/fpzg/citation.json";

import { compareProtectedContent as compareIn, type ProtectedCheck } from "./protected-content";

// The style is required (M2.12-P02); the properties hold for the FPZG record.
const style = parseCitationStyle(fpzgConfig);
const compareProtectedContent = (source: string, proposed: string) => compareIn(source, proposed, style);

// Fragments that exercise every scanner; all invented.
const fragment = fc.constantFrom(
  " ", "\n", " ", " ", "a", "č", "COVID-", ".", ",", ";", ":", "-", "–", "−", "+",
  "„", "“", "”", "»", "«", "‚", "‘", "’", '"', "(", ")", "Horvat, ", "i sur.", "2007", "a",
  "6. 11. 2026.", "2026-11-06", "10–12", "1.234", "2,5", "0", "7", "٥",
);
const mixedText = fc.array(fc.oneof(fragment, fc.string({ maxLength: 4 })), { maxLength: 40 }).map((p) => p.join(""));
const anyText = fc.oneof(fc.string({ maxLength: 200 }), fc.string({ unit: "grapheme", maxLength: 80 }), mixedText);

const findings = (check: ProtectedCheck) => (check.ok ? check.findings : undefined);

test.prop([anyText])("identical texts give no findings", (text) => {
  expect(compareProtectedContent(text, text)).toEqual({ ok: true, findings: [] });
});

// Any single ASCII digit replaced by another one is found, wherever it sits:
// in a number, a date, a range, a quote or a source mark.
const withDigit = fc
  .tuple(mixedText, fc.integer({ min: 0, max: 9 }), mixedText)
  .map(([before, digit, after]) => ({ before, digit: String(digit), after }));

test.prop([withDigit, fc.integer({ min: 1, max: 9 })])(
  "changing any digit gives a finding",
  ({ before, digit, after }, shift) => {
    const other = String((Number(digit) + shift) % 10);
    const check = compareProtectedContent(`${before}${digit}${after}`, `${before}${other}${after}`);
    expect(check.ok).toBe(true);
    expect(findings(check)!.length).toBeGreaterThan(0);
  },
);

test.prop([anyText, anyText])("swapping the texts swaps removed and added", (a, b) => {
  const flip = (change: string) => (change === "removed" ? "added" : change === "added" ? "removed" : change);
  const forward = findings(compareProtectedContent(a, b))!;
  const backward = findings(compareProtectedContent(b, a))!;
  const signature = (list: typeof forward, swap: boolean) =>
    list
      .map((f) => `${f.kind}:${swap ? flip(f.change) : f.change}:${"count" in f ? f.count : ""}`)
      .sort();
  expect(signature(backward, true)).toEqual(signature(forward, false));
});

// Prose made of words and numbers: a changed number is a number finding.
const word = fc.constantFrom("stranka", "glasova", "posto", "u", "je", "bilo", "od", "do");
const prose = fc.array(fc.oneof(word, fc.nat({ max: 99_999 }).map(String)), { minLength: 1, maxLength: 20 });

test.prop([prose, fc.nat({ max: 99_999 }), fc.integer({ min: 1, max: 1_000 }), fc.nat()])(
  "a changed number in prose is a number finding",
  (parts, value, delta, at) => {
    const index = at % (parts.length + 1);
    const source = [...parts.slice(0, index), String(value), ...parts.slice(index)].join(" ");
    const proposed = [...parts.slice(0, index), String(value + delta), ...parts.slice(index)].join(" ");
    const list = findings(compareProtectedContent(source, proposed))!;
    expect(list.some((f) => f.kind === "number" && f.change !== "reordered")).toBe(true);
  },
);
