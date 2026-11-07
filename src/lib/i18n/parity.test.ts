import { describe, expect, it } from "vitest";

import { messagesHr } from "./messages.hr";
import { INTERFACE_LOCALES, messagesFor } from "./locale";
import { catalogueGaps } from "./parity";

const none = { missing: [], extra: [], placeholders: [] };

/** A list of `length` slots whose first slots hold `values` and the rest are holes (`["A", ,]` is `sparse(["A"], 2)`). */
const sparse = (values: readonly string[], length: number) => Object.assign(new Array<string>(length), values);

describe("catalogueGaps", () => {
  it.each([
    ["the same keys", { a: "A", b: { c: "C" } }, { a: "X", b: { c: "Y" } }, none],
    ["a missing key", { a: "A", b: "B" }, { a: "A" }, { ...none, missing: ["b"] }],
    ["an extra key", { a: "A" }, { a: "A", z: "Z" }, { ...none, extra: ["z"] }],
    ["a missing nested key", { s: { a: "A", b: "B" } }, { s: { a: "A" } }, { ...none, missing: ["s.b"] }],
    ["a text where a section stands", { s: { a: "A" } }, { s: "S" }, { ...none, missing: ["s.a"], extra: ["s"] }],
    ["a section where a text stands", { s: "S" }, { s: { a: "A" } }, { ...none, missing: ["s"], extra: ["s.a"] }],
    ["a shorter list", { l: ["one", "two"] }, { l: ["one"] }, { ...none, missing: ["l.1"] }],
    ["a longer list", { l: ["one"] }, { l: ["one", "two"] }, { ...none, extra: ["l.1"] }],
    // A hole has no value, so a list that ends in one is longer than its values: its last slot is reported as a stray value.
    ["a hole at the end of the other list", { l: ["A"] }, { l: sparse(["A"], 2) }, { ...none, extra: ["l.1"] }],
    ["a hole at the end of the reference list", { l: sparse(["A"], 2) }, { l: ["A"] }, { ...none, missing: ["l.1"] }],
    ["holes that make the other list longer", { l: ["A"] }, { l: sparse(["A"], 3) }, { ...none, extra: ["l.2"] }],
    ["holes that make the reference list longer", { l: sparse(["A"], 3) }, { l: ["A"] }, { ...none, missing: ["l.2"] }],
    ["a hole where the other list has a text", { l: sparse(["A"], 2) }, { l: ["A", "B"] }, { ...none, missing: ["l.1"], extra: ["l.1"] }],
    ["the same hole in both lists", { l: sparse(["A"], 2) }, { l: sparse(["A"], 2) }, none],
    ["a list of one hole against an empty list", { s: [] }, { s: sparse([], 1) }, { ...none, missing: ["s"], extra: ["s.0"] }],
    ["an empty list against a list of one hole", { s: sparse([], 1) }, { s: [] }, { ...none, missing: ["s.0"], extra: ["s"] }],
    ["an empty section against a full one", { s: { a: "A" } }, { s: {} }, { ...none, missing: ["s.a"], extra: ["s"] }],
    ["two empty sections", { s: {} }, { s: [] }, none],
    ["a value that is not text", { a: "A" }, { a: 1 }, { ...none, missing: ["a"], extra: ["a"] }],
    ["a missing placeholder", { a: "{n} words" }, { a: "words" }, { ...none, placeholders: ["a"] }],
    ["a renamed placeholder", { a: "{n} of {m}" }, { a: "{n} of {total}" }, { ...none, placeholders: ["a"] }],
    ["an extra placeholder", { a: "step" }, { a: "step {n}" }, { ...none, placeholders: ["a"] }],
    ["placeholders in another order", { a: "{step} of {last}" }, { a: "{last}: {step}" }, none],
    ["a placeholder used twice", { a: "{n}" }, { a: "{n} ({n})" }, none],
    ["a key named like a prototype member", { constructor: "A" }, {}, { ...none, missing: ["constructor"] }],
    // A key may hold a dot, so "a.b" and a → b are two paths; a path with such a key is written as its segments in JSON.
    ["a dotted key alone", { "a.b": "A" }, { "a.b": "X" }, none],
    ["a dotted key that is missing", { "a.b": "A" }, {}, { ...none, missing: ['["a.b"]'] }],
    ["a dotted key inside a section", { s: { "x.y": "A" } }, { s: { "x.y": "X" }, t: "T" }, { ...none, extra: ["t"] }],
    [
      "a missing leaf whose dotted path equals a dotted key",
      { a: { b: "{n}" }, "a.b": "{m}" },
      { "a.b": "{m}" },
      { ...none, missing: ["a.b"] },
    ],
    [
      "a missing dotted key whose path equals a nested leaf",
      { a: { b: "{n}" }, "a.b": "{m}" },
      { a: { b: "{n}" } },
      { ...none, missing: ['["a.b"]'] },
    ],
    [
      "other placeholders beside a nested leaf with the same dotted path",
      { "a.b": "{n}", a: { b: "B" } },
      { "a.b": "{m}", a: { b: "B" } },
      { ...none, placeholders: ['["a.b"]'] },
    ],
    [
      "other placeholders in a nested leaf beside a dotted key",
      { a: { b: "{n}" }, "a.b": "B" },
      { a: { b: "{m}" }, "a.b": "B" },
      { ...none, placeholders: ["a.b"] },
    ],
    ["a key that starts like a written path", { "[x": { y: "A" } }, {}, { ...none, missing: ['["[x","y"]'] }],
    ["an extra dotted key beside a nested leaf", { a: { b: "B" } }, { a: { b: "B" }, "a.b": "X" }, { ...none, extra: ['["a.b"]'] }],
  ])("reports %s", (_, reference, other, gaps) => {
    expect(catalogueGaps(reference, other)).toEqual(gaps);
  });
});

// Every catalogue of the interface has every key of the Croatian one, and only
// those (D-70, F-06): a key missing in one language is text that never shows.
describe("interface catalogues", () => {
  it.each(INTERFACE_LOCALES)("%s has the keys and placeholders of the Croatian catalogue", (locale) => {
    expect(catalogueGaps(messagesHr, messagesFor(locale))).toEqual(none);
  });
});
