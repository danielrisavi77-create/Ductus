import { fc, test } from "@fast-check/vitest";
import { expect } from "vitest";

import { decodeEntities } from "../../scripts/forbidden-terms/entities";
import { extractUiText, jsxTextValue } from "../../scripts/forbidden-terms/scan";
import { findForbiddenTerms, findForbiddenTermsInMarkup } from "../../scripts/forbidden-terms/terms";

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
  "posumnjati",
  "osumnjičen",
  "spremljeno",
  "suspected",
  "likelihood",
  "warning about the student",
  "student warning",
  "saved",
  // Inflected and derived forms (QA of 232c9f4).
  "autentičan",
  "neautentičan",
  "postoci AI",
  "postotak umjetne inteligencije",
  "vjerojatnošću",
  "visokorizičan",
  "anomalan",
  "anomaly",
  "prekopirano",
  "dokaz o autorstvu",
  "AI-generated",
  "percentage of artificial intelligence",
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

// QA of 39fde31: the same entries written the way markup writes them.
const entriesOf = (text: string) => findForbiddenTerms(text).map((term) => term.entry);
const asEntity = (char: string, form: number): string => {
  const code = char.codePointAt(0)!;
  if (form === 1) return `&#${code};`;
  if (form === 2) return `&#x${code.toString(16)};`;
  return char === " " ? "&nbsp;" : char;
};

test.prop([fc.constantFrom(...SAMPLES), fc.infiniteStream(fc.integer({ min: 0, max: 3 }))])(
  "an entry written with HTML entities in JSX text is found",
  (sample, forms) => {
    const written = [...sample].map((char) => asEntity(char, forms.next().value)).join("");
    expect(decodeEntities(written).replaceAll("\u00A0", " ")).toBe(sample);
    const [text] = extractUiText("src/components/Sample.tsx", `export const Sample = () => <p>${written}</p>;\n`, "component");
    expect(entriesOf(text!.text)).toEqual(entriesOf(sample));
  },
);

test.prop([fc.string()])("text without an ampersand is left as it is", (text) => {
  const plain = text.replaceAll("&", "");
  expect(decodeEntities(plain)).toBe(plain);
});

test.prop([fc.constantFrom(...SAMPLES), fc.nat()])("an entry split in two by an element is found in the joined reading", (sample, at) => {
  const cut = at % (sample.length + 1);
  const [head, tail] = [sample.slice(0, cut), sample.slice(cut)];
  const found = findForbiddenTermsInMarkup(head + tail, `${head} ${tail}`).map((term) => term.entry);
  for (const entry of entriesOf(sample)) {
    // "spremljeno" and "saved" are contextual: split inside the word, they are not reported.
    if (!/^(?:spremljeno|saved) /.test(entry)) expect(found).toContain(entry);
  }
});

test.prop([fc.constantFrom(...SAMPLES)])("an entry in full width letters is found", (sample) => {
  const wide = [...sample].map((char) => (/[!-~]/.test(char) ? String.fromCodePoint(char.codePointAt(0)! + 0xfee0) : char)).join("");
  expect(entriesOf(wide)).toEqual(entriesOf(sample));
});

test.prop([fc.array(fc.constantFrom("Nestali", "podaci", " ", "  ", "\t", "\n", "\r\n", "\n   ", "&nbsp;", "x"), { maxLength: 12 })])(
  "JSX text never keeps a line break and never loses a word",
  (pieces) => {
    const value = jsxTextValue(pieces.join(""));
    expect(value).not.toMatch(/[\r\n]/);
    const words = (text: string) => text.split(/[\s\u00A0]+/).filter(Boolean);
    expect(words(value)).toEqual(words(decodeEntities(pieces.join(""))));
  },
);
