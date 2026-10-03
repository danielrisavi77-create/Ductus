import { fc, test } from "@fast-check/vitest";
import { expect } from "vitest";

import { formatInText, fpzgCitationStyle as style, normalizePages, type BookSource } from "./index";

const name = fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim() !== "");

const source = fc.record({
  family: name,
  given: name,
  year: fc.integer({ min: 1000, max: 9999 }),
});

test.prop([source, fc.option(fc.integer({ min: 1, max: 2000 }), { nil: undefined })])(
  "in-text citation is parenthesised and carries the year",
  ({ family, given, year }, page) => {
    const book: BookSource = {
      type: "book",
      authors: [{ kind: "person", family, given }],
      year,
      title: "Naslov",
      place: "Zagreb",
      publisher: "Nakladnik",
    };
    const citation = formatInText(book, style, page === undefined ? undefined : String(page));
    expect(citation.startsWith("(")).toBe(true);
    expect(citation.endsWith(")")).toBe(true);
    expect(citation).toContain(`, ${year}`);
    expect(citation.includes(": ")).toBe(page !== undefined);
  },
);

test.prop([fc.integer({ min: 1, max: 9999 }), fc.integer({ min: 1, max: 9999 }), fc.constantFrom("-", "–", " - ", "—")])(
  "page ranges normalise to an en dash and are idempotent",
  (from, to, dash) => {
    const once = normalizePages(`${from}${dash}${to}`, style);
    expect(once).toBe(`${from}–${to}`);
    expect(normalizePages(once, style)).toBe(once);
  },
);
