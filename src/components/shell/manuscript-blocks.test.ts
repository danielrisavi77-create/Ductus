import { describe, expect, it } from "vitest";

import { bulletItemNode, headingNode, paragraphNode, type NodeId } from "@/domain/document";

import { blockRuns } from "./manuscript-blocks";

// E1 (#823): how the read-only views group bullet items. Invented ids only.
const id = (n: number) => `5555555${n}-5555-4555-8555-555555555555` as NodeId;

describe("blockRuns", () => {
  it("makes one list of consecutive items and leaves every other block alone, in order", () => {
    const nodes = [
      headingNode(id(1), 1), bulletItemNode(id(2)), bulletItemNode(id(3)),
      paragraphNode(id(4)), bulletItemNode(id(5)),
    ];
    expect(blockRuns(nodes)).toEqual([
      { kind: "block", node: nodes[0] },
      { kind: "list", items: [nodes[1], nodes[2]] },
      { kind: "block", node: nodes[3] },
      { kind: "list", items: [nodes[4]] },
    ]);
  });

  it("gives nothing for no blocks and keeps a document without items as it is", () => {
    expect(blockRuns([])).toEqual([]);
    const nodes = [paragraphNode(id(1)), headingNode(id(2), 2)];
    expect(blockRuns(nodes).map((run) => run.kind === "block" && run.node)).toEqual(nodes);
  });
});
