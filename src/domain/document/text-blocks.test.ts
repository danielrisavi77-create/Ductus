import { describe, expect, it } from "vitest";

import { bulletItemNode, headingNode, paragraphNode, textNode, type NodeId } from "./schema";
import { textBlocksOf } from "./text-blocks";

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}` as NodeId;

describe("textBlocksOf (B-11c, #757)", () => {
  it("gives each node as a block in document order, marks dropped and runs joined", () => {
    const blocks = textBlocksOf({
      schemaVersion: 1,
      nodes: [
        headingNode(id(1), 2, [textNode("Uvod")]),
        paragraphNode(id(2), [textNode("Lorem "), textNode("ipsum", ["bold", "italic"]), textNode(" dolor.")]),
        paragraphNode(id(3)),
      ],
    });
    expect(blocks).toStrictEqual([
      { kind: "heading", text: "Uvod" },
      { kind: "paragraph", text: "Lorem ipsum dolor." },
      { kind: "paragraph", text: "" },
    ]);
  });

  it("gives a bullet list item as a paragraph, the only other kind of the contract", () => {
    const blocks = textBlocksOf({
      schemaVersion: 1,
      nodes: [
        paragraphNode(id(1), [textNode("Popis:")]),
        bulletItemNode(id(2), [textNode("prva "), textNode("stavka", ["bold"])]),
        bulletItemNode(id(3)),
      ],
    });
    expect(blocks).toStrictEqual([
      { kind: "paragraph", text: "Popis:" },
      { kind: "paragraph", text: "prva stavka" },
      { kind: "paragraph", text: "" },
    ]);
  });

  it("gives no blocks for an empty document", () => {
    expect(textBlocksOf({ schemaVersion: 1, nodes: [] })).toStrictEqual([]);
  });
});
