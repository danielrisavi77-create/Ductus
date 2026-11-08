import { describe, expect, it } from "vitest";

import { findForbiddenTerms } from "../../../scripts/forbidden-terms/terms";

import { messagesEn } from "./messages.en";

function leaves(node: unknown, path = ""): [string, string][] {
  if (typeof node === "string") {
    return [[path, node]];
  }
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    leaves(value, path ? `${path}.${key}` : key),
  );
}

// The English table carries the checks `messages.test.ts` makes on the
// Croatian one, in English. Key parity with the Croatian table is
// `parity.test.ts`; the repository scan (`tests/unit/forbidden-terms.test.ts`)
// reads this file as a catalogue too.
describe("messages.en", () => {
  const all = leaves(messagesEn);

  it("has no empty text", () => {
    for (const [path, text] of all) {
      expect(text.trim(), path).not.toBe("");
    }
  });

  // docs/PRODUCT.md §5, every entry in both languages. The English list of
  // D-276 is its own task and is not in the scanner yet.
  it("uses no word from the forbidden vocabulary", () => {
    for (const [path, text] of all) {
      expect(
        findForbiddenTerms(text).map((term) => term.entry),
        `${path}: "${text}"`,
      ).toEqual([]);
    }
  });

  it("never says a bare 'saved'", () => {
    for (const [path, text] of all) {
      expect(/^saved\.?$/i.test(text.trim()), path).toBe(false);
    }
  });

  // A Croatian letter left in a value is a string that was not translated.
  it("has no Croatian text left", () => {
    for (const [path, text] of all) {
      expect(/[čćđšžČĆĐŠŽ]/u.test(text), `${path}: "${text}"`).toBe(false);
    }
  });
});

// FE-D3 (DAN-222) in English: AAI@EduHr alone (D-09), and nothing about what
// is or is not recorded (D-142..D-144).
describe("messages.en prijava", () => {
  const prijava = leaves(messagesEn.prijava, "prijava");

  it("names AAI@EduHr on the sign-in button", () => {
    expect(messagesEn.prijava.button).toContain("AAI@EduHr");
  });

  it("offers no other way to sign in", () => {
    for (const [path, text] of prijava) {
      const lower = text.toLowerCase();
      for (const word of ["email", "e-mail", "passport", "google", "microsoft"]) {
        expect(lower.includes(word), `${path}: "${text}" contains "${word}"`).toBe(false);
      }
    }
  });

  it("makes no claim about recording, live view or replay", () => {
    for (const [path, text] of prijava) {
      const lower = text.toLowerCase();
      for (const word of ["record", "live", "replay", "keeps", "stored", "does not see", "cannot see"]) {
        expect(lower.includes(word), `${path}: "${text}" contains "${word}"`).toBe(false);
      }
    }
  });
});

// D-124: the interface name is Ductura in every language.
describe("product name in the English catalogue", () => {
  it("uses Ductura, never Ductus", () => {
    const named = leaves(messagesEn).filter(([, text]) => /\bDuctus\b/.test(text));
    expect(named).toEqual([]);
  });
});
