import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  REVISION_TEXT_MAX,
  isExpectedSeq,
  isRangeHash,
  isRequestId,
  isRevisionKind,
  isRevisionNumber,
  isRevisionText,
} from "./revision-input";
import { BLANKS, TEXT_CASES } from "../../../tests/unit/revision-text-cases";

describe("isRevisionText (class 8)", () => {
  it.each(TEXT_CASES)("%s", (_name, text, ok) => {
    expect(isRevisionText(text)).toBe(ok);
  });

  it("refuses what is not a string", () => {
    for (const value of [null, undefined, 1, true, ["a"], { a: "a" }]) expect(isRevisionText(value)).toBe(false);
  });

  it("refuses a lone surrogate anywhere", () => {
    fc.assert(fc.property(
      fc.string({ minLength: 1, maxLength: 40 }),
      fc.integer({ min: 0xd800, max: 0xdfff }),
      fc.nat(),
      (text, unit, at) => {
        const i = at % (text.length + 1);
        // Splitting inside a pair would only make another lone surrogate.
        const value = text.slice(0, i) + String.fromCharCode(unit) + text.slice(i);
        return !isRevisionText(value);
      },
    ));
  });

  it("refuses every text made only of the blank set", () => {
    fc.assert(fc.property(fc.array(fc.constantFrom(...BLANKS), { minLength: 1, maxLength: 50 }), (parts) =>
      !isRevisionText(parts.join(""))));
  });

  it("refuses the NFD form of an NFC text with a combining mark", () => {
    const letters = fc.constantFrom("\u010D", "\u0107", "\u017E", "\u0161", "\u0111", "\u00E1", "\u00E9", "\u0151", "\u00F1");
    fc.assert(fc.property(fc.string({ maxLength: 20 }), letters, (prefix, letter) => {
      const nfc = `x${prefix.replace(/[\uD800-\uDFFF]/g, "")}${letter}`.normalize("NFC");
      return nfc.normalize("NFD") === nfc || !isRevisionText(nfc.normalize("NFD"));
    }));
  });

  it("refuses every C0 and C1 control inside text except newline and tab", () => {
    const control = fc.oneof(fc.integer({ min: 0, max: 0x1f }), fc.integer({ min: 0x7f, max: 0x9f }));
    fc.assert(fc.property(control, (code) =>
      isRevisionText(`a${String.fromCharCode(code)}b`) === (code === 0x09 || code === 0x0a)));
  });

  it("counts code points, not UTF-16 units", () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: REVISION_TEXT_MAX + 5 }), (n) =>
      isRevisionText("\u{1D11E}".repeat(n)) === (n <= REVISION_TEXT_MAX)));
  });
});

describe("numbers (classes 6 and 7)", () => {
  const BAD = [null, true, "3", "", 3.5, -1, -0, 2 ** 53, Number.NaN, Number.POSITIVE_INFINITY, [], {}];

  it("a revision is a safe integer from 0", () => {
    for (const ok of [0, 1, 2 ** 53 - 1]) expect(isRevisionNumber(ok)).toBe(true);
    for (const bad of BAD) expect(isRevisionNumber(bad)).toBe(false);
  });

  it("a counter starts at 1", () => {
    for (const ok of [1, 2 ** 53 - 1]) expect(isExpectedSeq(ok)).toBe(true);
    for (const bad of [0, ...BAD]) expect(isExpectedSeq(bad)).toBe(false);
  });

  it("agrees with the bigint range for every integer", () => {
    fc.assert(fc.property(fc.integer({ min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }), (n) =>
      isRevisionNumber(n) === n >= 0 && isExpectedSeq(n) === n >= 1));
  });
});

describe("kind, hash and request id", () => {
  it("kind is done or declined", () => {
    expect(isRevisionKind("done")).toBe(true);
    expect(isRevisionKind("declined")).toBe(true);
    for (const bad of ["Done", "accepted", "", null, 1]) expect(isRevisionKind(bad)).toBe(false);
  });

  it("hash is 64 lowercase hex digits", () => {
    expect(isRangeHash("a".repeat(64))).toBe(true);
    for (const bad of ["A".repeat(64), "a".repeat(63), "a".repeat(65), `${"a".repeat(64)}\n`, "g".repeat(64), null]) {
      expect(isRangeHash(bad)).toBe(false);
    }
  });

  it("request id is the lowercase canonical uuid only (G7)", () => {
    const id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    expect(isRequestId(id)).toBe(true);
    for (const bad of [id.toUpperCase(), ` ${id}`, `${id} `, `{${id}}`, id.replace(/-/g, ""), "", 1, null]) {
      expect(isRequestId(bad)).toBe(false);
    }
  });
});
