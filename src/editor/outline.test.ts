import { getSchema } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { currentHeading, headingOutline } from "./outline";
import { createEditorExtensions, NODE_ID_ATTRIBUTE } from "./schema";

const schema = getSchema(createEditorExtensions());

type Block = { kind: "p" } | { kind: "h"; level: number; id?: string };

function docOf(blocks: readonly [Block, string][]) {
  return schema.node("doc", null, blocks.map(([block, text]) => {
    const content = text === "" ? [] : [schema.text(text)];
    return block.kind === "p"
      ? schema.node("paragraph", null, content)
      : schema.node("heading", { level: block.level, [NODE_ID_ATTRIBUTE]: block.id ?? null }, content);
  }));
}

describe("headingOutline", () => {
  it("lists only headings, in document order, with level, text, id and position", () => {
    const doc = docOf([
      [{ kind: "h", level: 1, id: "a" }, "Uvod"],
      [{ kind: "p" }, "Prvi odlomak."],
      [{ kind: "h", level: 2, id: "b" }, "Okvir"],
      [{ kind: "h", level: 3, id: "c" }, "Pojmovi"],
    ]);
    const outline = headingOutline(doc);
    expect(outline.map(({ id, level, text }) => ({ id, level, text }))).toEqual([
      { id: "a", level: 1, text: "Uvod" },
      { id: "b", level: 2, text: "Okvir" },
      { id: "c", level: 3, text: "Pojmovi" },
    ]);
    // The position points at the heading node itself.
    for (const entry of outline) expect(doc.nodeAt(entry.pos)?.type.name).toBe("heading");
  });

  it("is empty for a document without headings", () => {
    expect(headingOutline(docOf([[{ kind: "p" }, "Samo tekst."]]))).toEqual([]);
  });

  it("keeps an empty heading with empty text and a heading without an id yet", () => {
    const outline = headingOutline(docOf([[{ kind: "h", level: 2 }, "   "]]));
    expect(outline).toEqual([{ id: null, level: 2, text: "", pos: 0 }]);
  });
});

describe("currentHeading", () => {
  const outline = headingOutline(docOf([
    [{ kind: "p" }, "Prije."],
    [{ kind: "h", level: 1, id: "a" }, "Uvod"],
    [{ kind: "p" }, "Tekst."],
    [{ kind: "h", level: 2, id: "b" }, "Okvir"],
  ]));

  it("is -1 above the first heading", () => {
    expect(currentHeading(outline, 1)).toBe(-1);
  });

  it("is the last heading at or before the selection", () => {
    expect(currentHeading(outline, outline[0]!.pos)).toBe(0);
    expect(currentHeading(outline, outline[1]!.pos - 1)).toBe(0);
    expect(currentHeading(outline, outline[1]!.pos + 2)).toBe(1);
  });

  it("is -1 for an empty outline", () => {
    expect(currentHeading([], 5)).toBe(-1);
  });
});
