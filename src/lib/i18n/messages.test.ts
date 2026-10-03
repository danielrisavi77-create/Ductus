import { describe, expect, it } from "vitest";

import { messagesHr } from "./messages.hr";

function leaves(node: unknown, path = ""): [string, string][] {
  if (typeof node === "string") {
    return [[path, node]];
  }
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    leaves(value, path ? `${path}.${key}` : key),
  );
}

// docs/PRODUCT.md §5, "Ne koristiti nikad" (stems, so inflected forms match).
const FORBIDDEN = [
  "sumnj",
  "rizik",
  "anomalij",
  "upozorenje o studentu",
  "postot",
  "vjerojatnost",
  "autentičn",
  "napisao ai",
  "verificirano autorstvo",
  "dokaz autorstva",
  "kopiran",
  "prepisan",
  "nestali podaci",
  "skriven",
];

describe("messages.hr", () => {
  const all = leaves(messagesHr);

  it("has no empty text", () => {
    for (const [path, text] of all) {
      expect(text.trim(), path).not.toBe("");
    }
  });

  it("uses no word from the forbidden vocabulary", () => {
    for (const [path, text] of all) {
      const lower = text.toLocaleLowerCase("hr");
      for (const word of FORBIDDEN) {
        expect(lower.includes(word), `${path}: "${text}" contains "${word}"`).toBe(false);
      }
    }
  });

  it("never says a bare 'spremljeno'", () => {
    for (const [path, text] of all) {
      const lower = text.toLocaleLowerCase("hr").trim();
      expect(/^spremljeno\.?$/.test(lower), path).toBe(false);
    }
  });
});
