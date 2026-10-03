import { fc, test } from "@fast-check/vitest";
import { expect } from "vitest";

import { findForbiddenTerms } from "../../scripts/forbidden-terms/terms";

// One written form per dictionary entry (docs/PRODUCT.md 5).
const SAMPLES = [
  "sumnjivo",
  "rizik",
  "anomalija",
  "upozorenje o studentu",
  "postotak AI",
  "AI postotak",
  "vjerojatnost",
  "autentičnost",
  "napisao AI",
  "verificirano autorstvo",
  "dokaz autorstva",
  "kopirano",
  "prepisano",
  "nestali podaci",
  "skriveno",
  "suspicious",
  "risk",
  "probability",
  "authenticity",
  "written by AI",
  "proof of authorship",
  "missing data",
  "hidden",
];

const filler = fc.string({ unit: fc.constantFrom(..."abcčćdđ ,.!?-()0123456789") });
const separator = fc.constantFrom(" ", "\n", "\t", "\u00A0", " - ", ": ", "(", ")", ".");
const invisible = fc.constantFrom("", "\u00AD", "\u200B", "\u2060");

const variant = fc
  .tuple(fc.constantFrom(...SAMPLES), fc.infiniteStream(fc.boolean()), fc.infiniteStream(invisible))
  .map(([sample, upper, gaps]) => {
    const casing = [...sample].map((char) => (upper.next().value ? char.toLocaleUpperCase("hr") : char));
    return { sample, text: casing.map((char) => char + gaps.next().value).join("") };
  });

test.prop([filler, separator, variant, separator, filler])(
  "a dictionary entry is found in any surrounding text, case and invisible splitting",
  (before, open, { sample, text }, close, after) => {
    const sampleTerms = findForbiddenTerms(sample).map((t) => t.entry);
    expect(sampleTerms.length).toBeGreaterThan(0);
    const found = findForbiddenTerms(before + open + text + close + after).map((t) => t.entry);
    for (const entry of sampleTerms) expect(found).toContain(entry);
  },
);

test.prop([fc.constantFrom(...SAMPLES)])("diacritics left out still match", (sample) => {
  const plain = sample.normalize("NFD").replace(/\p{M}/gu, "").replaceAll("đ", "d");
  expect(findForbiddenTerms(plain).length).toBeGreaterThan(0);
});
