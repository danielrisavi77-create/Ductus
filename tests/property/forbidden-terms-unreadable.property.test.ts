import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { fc, test } from "@fast-check/vitest";
import { expect } from "vitest";

import { findUnreadableText, scanUiText } from "../../scripts/forbidden-terms/scan";
import { findForbiddenTerms, findForbiddenTermsInMarkup, unreadableCharacters, PHRASE_BREAK } from "../../scripts/forbidden-terms/terms";

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

// QA of f8722f4: a space of another width, a symbol without ink or a symbol
// drawn like a letter, put between two halves of an entry as a part of its
// own, never passes, whatever the halves and however the text is put together.
const ODD_PARTS = [0x2009, 0x200a, 0x202f, 0x2002, 0x2005, 0x2006, 0x205f, 0x3000, 0x1680, 0x2800, 0x1d159, 0x2228, 0x222a, 0x2218, 0xa2, 0xb4, 0x2192, 0x1f600];
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
