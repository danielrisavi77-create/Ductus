import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { fc, test } from "@fast-check/vitest";
import { expect } from "vitest";

import { findUnreadableText, scanUiText } from "../../scripts/forbidden-terms/scan";
import { closedUpPastQuotes, findForbiddenTerms, findForbiddenTermsInMarkup, unreadableCharacters, windowsCutShort, PHRASE_BREAK } from "../../scripts/forbidden-terms/terms";

// A dictionary entry with one of its letters swapped for a letter that looks
// the same, or with a character without ink put into it, never passes: either
// the dictionary still finds it or the character itself is reported.
const SAMPLES = ["sumnjivo", "rizik", "anomalija", "vjerojatnost", "autentičnost", "kopirano", "prepisano", "skriveno", "nestali podaci", "dokaz autorstva"];
const ENGLISH = ["suspicious", "risk", "anomaly", "probability", "authenticity", "copied", "hidden", "missing data", "proof of authorship"];

/** Letters of other scripts that are drawn like a Latin one. */
const LOOKALIKES: Readonly<Record<string, readonly number[]>> = {
  a: [0x430, 0x3b1, 0x251],
  c: [0x441, 0x3f2],
  e: [0x435, 0x3b5],
  i: [0x456, 0x131, 0x3b9],
  j: [0x458, 0x3f3],
  n: [0x272, 0x578],
  o: [0x43e, 0x3bf, 0x585],
  p: [0x440, 0x3c1],
  s: [0x455, 0x282],
  v: [0x3bd, 0x475],
  y: [0x443, 0x3b3],
  k: [0x3ba, 0x43a],
  h: [0x4bb, 0x570],
  d: [0x501, 0x257],
  r: [0x433, 0x27c],
  u: [0x3c5, 0x57d],
  z: [0x290, 0x1d22],
};
/** Characters that leave no ink, both the ones the dictionary folds away and the ones it does not. */
const INKLESS = [0xad, 0x200b, 0x2060, 0x34f, 0xfe0f, 0x115f, 0x200a, 0x2006, 0x2800, 0xe000, 0xf8ff, 0x2065, 0x1d159];

const caught = (text: string): boolean => findForbiddenTerms(text).length > 0 || unreadableCharacters(text).length > 0;
const sample = fc.constantFrom(...SAMPLES, ...ENGLISH);

test.prop([sample, fc.nat(), fc.nat()])("an entry with a letter of another script in place of one of its own never passes", (text, at, pick) => {
  const places = [...text].flatMap((char, index) => (LOOKALIKES[char] ? [index] : []));
  const index = places[at % places.length]!;
  const options = LOOKALIKES[text[index]!]!;
  const swapped = text.slice(0, index) + String.fromCodePoint(options[pick % options.length]!) + text.slice(index + 1);
  expect(swapped).not.toBe(text);
  expect(caught(swapped)).toBe(true);
  expect(caught(swapped.toLocaleUpperCase("hr"))).toBe(true);
});

test.prop([sample, fc.nat(), fc.array(fc.constantFrom(...INKLESS), { minLength: 1, maxLength: 3 })])(
  "an entry with characters without ink put into it never passes",
  (text, at, codes) => {
    const index = 1 + (at % (text.length - 1));
    expect(caught(text.slice(0, index) + String.fromCodePoint(...codes) + text.slice(index))).toBe(true);
  },
);

// Closing the text up: whatever unknown parts and element boundaries stand
// inside an entry, the entry is found.
test.prop([fc.constantFrom(...SAMPLES, ...ENGLISH), fc.array(fc.nat(), { minLength: 1, maxLength: 3 })])("an entry cut by phrase breaks is found", (text, cuts) => {
  let joined = text;
  for (const cut of cuts) {
    const index = 1 + (cut % (joined.length - 1));
    joined = joined.slice(0, index) + PHRASE_BREAK + joined.slice(index);
  }
  const expected = findForbiddenTerms(text).map((term) => term.entry);
  const found = findForbiddenTermsInMarkup(joined, joined).map((term) => term.entry);
  for (const entry of expected) expect(found).toContain(entry);
});

// Review of 2bc1f81: a punctuation mark outside ASCII that is not written
  // between two letters, one of each category, put between two letters of an
  // entry, alone or next to marks that are written there.
const MARKS = [0x203f, 0xff3f, 0xfe31, 0x2012, 0x201e, 0xff08, 0xff09, 0x2046, 0x201c, 0xab, 0x201d, 0xbb, 0x5c0, 0x2016, 0xa1, 0x2020, 0xb7, 0x2027, 0xff0e];
const WRITTEN = [0x2010, 0x2011, 0x2013, 0x2014, 0x2019, 0x2026];

test.prop([sample, fc.nat(), fc.constantFrom(...MARKS), fc.array(fc.constantFrom(...WRITTEN), { maxLength: 2 }), fc.boolean()])(
  "an entry with a mark that is not written inside a word between two of its letters never passes",
  (text, at, mark, written, first) => {
    const letters = [...text];
    const places = letters.flatMap((_, index) => (index > 0 && letters[index - 1] !== " " && letters[index] !== " " ? [index] : []));
    const index = places[at % places.length]!;
    const run = String.fromCodePoint(...(first ? [mark, ...written] : [...written, mark]));
    expect(caught(letters.slice(0, index).join("") + run + letters.slice(index).join(""))).toBe(true);
  },
);

// QA of f8722f4: a space of another width, a symbol without ink or a symbol
// drawn like a letter, put between two halves of an entry as a part of its
// own, never passes, whatever the halves and however the text is put together.
const ODD_PARTS = [0x2009, 0x200a, 0x202f, 0x2002, 0x2005, 0x2006, 0x205f, 0x3000, 0x1680, 0x2800, 0x1d159, 0x2228, 0x222a, 0x2218, 0xa2, 0xb4, 0x2192, 0x1f600, ...MARKS];
const WAYS: readonly ((before: string, odd: string, after: string) => string)[] = [
  (before, odd, after) => `<p>${before}{${odd}}${after}</p>`,
  (before, odd, after) => `<p>${before}<span>{${odd}}</span>${after}</p>`,
  (before, odd, after) => `<p><b>${before}</b><i>{${odd}}</i><b>${after}</b></p>`,
  (before, odd, after) => `<p>{[${JSON.stringify(before)}, ${odd}, ${JSON.stringify(after)}]}</p>`,
  (before, odd, after) => `<p>{\`${before}\${${odd}}${after}\`}</p>`,
  (before, odd, after) => `<img alt={${JSON.stringify(before)} + ${odd} + ${JSON.stringify(after)}} />`,
  (before, odd, after) => `<p>${before}{n}{${odd}}${after}</p>`,
  (before, odd, after) => `<div><div>${before}</div><div>{${odd}}</div><div>${after}</div></div>`,
];

test.prop([sample, fc.nat(), fc.array(fc.constantFrom(...ODD_PARTS), { minLength: 1, maxLength: 2 }), fc.constantFrom(...WAYS)])(
  "an entry with an odd part of its own between two of its letters never passes",
  (text, at, codes, way) => {
    const letters = [...text];
    // Between two letters: a part next to the space of a phrase leaves the phrase whole.
    const places = letters.flatMap((_, index) => (index > 0 && letters[index - 1] !== " " && letters[index] !== " " ? [index] : []));
    const index = places[at % places.length]!;
    const root = mkdtempSync(path.join(tmpdir(), "ductus-terms-"));
    try {
      mkdirSync(path.join(root, "src", "components"), { recursive: true });
      const line = way(letters.slice(0, index).join(""), JSON.stringify(String.fromCodePoint(...codes)), letters.slice(index).join(""));
      writeFileSync(path.join(root, "src", "components", "Case.tsx"), `export const Case = ({ n }: Props) => (\n  ${line}\n);\n`);
      expect(scanUiText(root).length + findUnreadableText(root).length).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

// Review of 92793ef: the guard leaves out quotation marks next to an element
// boundary, so the dictionary has to find an entry cut there, whatever
// quotation marks stand on the two sides of the cut.
const QUOTES = [0xab, 0xbb, 0x2018, 0x201a, 0x201c, 0x201d, 0x201e, 0x2019];
const quotes = fc.array(fc.constantFrom(...QUOTES), { maxLength: 3 }).map((codes) => String.fromCodePoint(...codes));

test.prop([sample, fc.nat(), quotes, quotes, fc.integer({ min: 1, max: 3 })])("an entry cut where a phrase ends is found with quotation marks at the cut", (text, at, before, after, breaks) => {
  const letters = [...text];
  const places = letters.flatMap((_, index) => (index > 0 && letters[index - 1] !== " " && letters[index] !== " " ? [index] : []));
  const index = places[at % places.length]!;
  const joined = letters.slice(0, index).join("") + before + PHRASE_BREAK.repeat(breaks) + after + letters.slice(index).join("");
  const expected = findForbiddenTerms(text).map((term) => term.entry);
  const found = findForbiddenTermsInMarkup(joined, joined).map((term) => term.entry);
  for (const entry of expected) expect(found).toContain(entry);
  // And nothing is reported by the guard in its place, so the dictionary is what holds here.
  expect(unreadableCharacters(closedUpPastQuotes(joined))).toEqual([]);
});

// An entry cut by boundaries is found whatever stands in the parts next to
// it: words that would touch it once every boundary is taken out, the letter
// one entry may not follow, quotation marks at the cuts.
const NEIGHBOURS = ["Opis", "Rok", "Zadatak", "Kraj", "i", "na", "2", "Rok predaje.", "\u201ERok\u201D"];
const neighbours = fc.array(fc.constantFrom(...NEIGHBOURS), { maxLength: 4 });

test.prop([sample, fc.array(fc.nat(), { minLength: 1, maxLength: 20 }), neighbours, neighbours, fc.boolean()])(
  "an entry cut by boundaries is found whatever stands next to it",
  (text, cuts, before, after, upper) => {
    const letters = [...(upper ? text.toLocaleUpperCase("hr") : text)];
    const places = letters.flatMap((_, index) => (index > 0 && letters[index - 1] !== " " && letters[index] !== " " ? [index] : []));
    const at = new Set(cuts.map((cut) => places[cut % places.length]!));
    const cut = letters.map((letter, index) => (at.has(index) ? PHRASE_BREAK + letter : letter)).join("");
    const joined = [...before, cut, ...after].join(PHRASE_BREAK);
    const expected = findForbiddenTerms(text).map((term) => term.entry);
    const found = findForbiddenTermsInMarkup(joined, joined).map((term) => term.entry);
    for (const entry of expected) expect(found).toContain(entry);
  },
);

// QA of 2b6b414: a contextual word cut by boundaries is found although the
// same word stands whole, with its place, anywhere else in the text: in a
// part of its own or in the part the cut word begins or ends in.
const WHERE = ["Spremljeno na uređaju", "spremljeno na poslužitelju", "Saved on this device", "saved to the server", "Spremljena na uređaju"];
const beside = fc.array(fc.tuple(fc.constantFrom(...WHERE, ...NEIGHBOURS), fc.constantFrom(PHRASE_BREAK, ". ", `.${PHRASE_BREAK}`)), { maxLength: 4 });
const CUT_WORDS: readonly [string, string][] = [
  ["spremljeno", "spremljeno (bez pojašnjenja)"],
  ["Spremljena", "spremljeno (bez pojašnjenja)"],
  ["saved", "saved (without saying where)"],
  ["SAVED", "saved (without saying where)"],
];

test.prop([fc.constantFrom(...CUT_WORDS), fc.array(fc.nat(), { minLength: 1, maxLength: 9 }), beside, beside, fc.constantFrom(PHRASE_BREAK, ". ")])(
  "a contextual word cut by boundaries is found whatever says where next to it",
  ([word, entry], cuts, before, after, end) => {
    const at = new Set(cuts.map((cut) => 1 + (cut % (word.length - 1))));
    const cut = [...word].map((letter, index) => (at.has(index) ? PHRASE_BREAK + letter : letter)).join("");
    const joined = before.map(([text, glue]) => text + glue).join("") + cut + (after.length > 0 ? end : "") + after.map(([text, glue]) => text + glue).join("");
    expect(findForbiddenTermsInMarkup(joined, joined).map((term) => term.entry)).toContain(entry);
  },
);

// And the other way: texts that say where, whole, next to plain words make no
// finding however they are set next to each other.
test.prop([fc.array(fc.tuple(fc.constantFrom(...WHERE, "Opis", "Rok", "Kraj", "2", "Rok predaje."), fc.constantFrom(PHRASE_BREAK, ". ", `.${PHRASE_BREAK}`, PHRASE_BREAK + PHRASE_BREAK)), { maxLength: 8 })])(
  "contextual words that say where are not reported whatever stands next to them",
  (pieces) => {
    const joined = pieces.map(([text, glue]) => text + glue).join("");
    expect(findForbiddenTermsInMarkup(joined, joined)).toEqual([]);
  },
);

// Review of 8325bb0: a window takes a bounded number of parts, so an entry cut
// over a long run of parts that the dictionary reads as nothing is either
// found or the text is reported as one with too long a run.
const EMPTY_PARTS = [0x200b, 0xad, 0x201e, 0x201d, 0xab];
const emptyRun = fc.tuple(fc.constantFrom(...EMPTY_PARTS), fc.constantFrom(0, 1, 5, 40, 61, 62, 63, 64, 65, 90)).map(([code, count]) => Array.from({ length: count }, () => String.fromCodePoint(code)));

test.prop([sample, fc.array(fc.tuple(fc.nat(), emptyRun), { minLength: 1, maxLength: 3 }), neighbours, neighbours])(
  "an entry cut over runs of parts that are read as nothing is found or the text is reported",
  (text, cuts, before, after) => {
    const letters = [...text];
    const places = letters.flatMap((_, index) => (index > 0 && letters[index - 1] !== " " && letters[index] !== " " ? [index] : []));
    const runs = new Map(cuts.map(([cut, run]) => [places[cut % places.length]!, run]));
    const cut = letters.map((letter, index) => (runs.has(index) ? [PHRASE_BREAK, ...runs.get(index)!.map((part) => part + PHRASE_BREAK), letter].join("") : letter)).join("");
    const joined = [...before, cut, ...after].join(PHRASE_BREAK);
    const found = findForbiddenTermsInMarkup(joined, joined).map((term) => term.entry);
    if (!windowsCutShort(joined)) for (const entry of findForbiddenTerms(text).map((term) => term.entry)) expect(found).toContain(entry);
  },
);
