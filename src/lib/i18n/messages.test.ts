import { describe, expect, it } from "vitest";

import { MULTI_TAB_BLOCKED_MESSAGE, SYNC_STATE_LABELS } from "@/domain/sync/labels";

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

  // The save-state wording has one home, next to the state machine. A second
  // copy here could drift from it ("Spremljeno na uređaju", PRODUCT §5).
  it("does not repeat the save-state wording kept in the sync domain", () => {
    const syncTexts = new Set(
      [...Object.values(SYNC_STATE_LABELS).map((entry) => entry.label), MULTI_TAB_BLOCKED_MESSAGE].map(
        (text) => text.toLocaleLowerCase("hr"),
      ),
    );
    for (const [path, text] of all) {
      expect(syncTexts.has(text.toLocaleLowerCase("hr").trim()), path).toBe(false);
    }
  });

  it("never says a bare 'spremljeno'", () => {
    for (const [path, text] of all) {
      const lower = text.toLocaleLowerCase("hr").trim();
      expect(/^spremljeno\.?$/.test(lower), path).toBe(false);
    }
  });
});
