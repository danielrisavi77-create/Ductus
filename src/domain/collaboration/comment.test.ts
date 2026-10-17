import { describe, expect, it } from "vitest";

import { isCommentBody, isDocumentId, isTextAnchorInput } from "./comment";

const ANCHOR = {
  nodeId: "11111111-1111-4111-8111-111111111111",
  quote: "drugi odlomak",
  prefix: "Ovo je ",
  suffix: " Studenta A.",
  startHint: 7,
  endHint: 20,
};

describe("B-10 comment body (attack 9)", () => {
  it("accepts plain text with newlines and tabs, and words like 'rizik' unfiltered", () => {
    expect(isCommentBody("Nastavnik N1: dobar uvod.\n\tRazradi rizik u drugom odlomku.")).toBe(true);
    expect(isCommentBody("<script>alert(1)</script>")).toBe(true); // shown as text, never HTML (attack 10)
  });

  it("counts code points like char_length: 2000 emoji pass, 2001 do not", () => {
    expect(isCommentBody("😀".repeat(2000))).toBe(true);
    expect(isCommentBody("😀".repeat(2001))).toBe(false);
  });

  it.each([
    ["empty", ""],
    ["blank only", " \n\t "],
    ["1 MB", "a".repeat(1024 * 1024)],
    ["NUL", "a\u0000b"],
    ["escape", "a\u001b[31mb"],
    ["C1 control", "a\u0085b"],
    ["RTL override", "a\u202Eb"],
    ["isolate", "a\u2066b"],
    ["not NFC", "Cafe\u0301"],
    ["not a string", 42],
  ])("refuses %s", (_name, value) => {
    expect(isCommentBody(value)).toBe(false);
  });
});

describe("B-10 anchor input", () => {
  it("accepts exactly the TextAnchor shape", () => {
    expect(isTextAnchorInput(ANCHOR)).toBe(true);
    expect(isTextAnchorInput({ ...ANCHOR, prefix: "", suffix: "" })).toBe(true);
  });

  it.each([
    ["unknown field", { ...ANCHOR, revision: 3 }],
    ["missing field", { nodeId: ANCHOR.nodeId, quote: "x", prefix: "", suffix: "", startHint: 0 }],
    ["array", [ANCHOR]],
    ["nil node id", { ...ANCHOR, nodeId: "00000000-0000-0000-0000-000000000000" }],
    ["empty quote", { ...ANCHOR, quote: "" }],
    ["quote over 500", { ...ANCHOR, quote: "q".repeat(501) }],
    ["prefix over 64", { ...ANCHOR, prefix: "p".repeat(65) }],
    ["control in suffix", { ...ANCHOR, suffix: "a\u0007" }],
    ["RTL override in quote", { ...ANCHOR, quote: "a\u202Db" }],
    ["fractional hint", { ...ANCHOR, startHint: 1.5 }],
    ["negative hint", { ...ANCHOR, startHint: -1 }],
    ["empty range", { ...ANCHOR, endHint: 7 }],
    ["hint over 1000000", { ...ANCHOR, endHint: 1_000_001 }],
    ["string hint", { ...ANCHOR, endHint: "20" }],
  ])("refuses %s", (_name, value) => {
    expect(isTextAnchorInput(value)).toBe(false);
  });
});

describe("B-10 document id", () => {
  it("mirrors the evidence.document id CHECK", () => {
    expect(isDocumentId("doc-student-a-1")).toBe(true);
    for (const value of ["", " doc", "doc ", "a\tb", "d".repeat(257), 7]) {
      expect(isDocumentId(value)).toBe(false);
    }
  });
});
