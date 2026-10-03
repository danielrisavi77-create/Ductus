import { describe, expect, it } from "vitest";

import { normalizeDocument } from "./normalize";
import { validateDocument } from "./validate";
import {
  headingNode,
  newNodeId,
  paragraphNode,
  textNode,
  type CanonicalDocument,
  type InlineNode,
  type Mark,
} from "./schema";

const ID_A = newNodeId(() => "11111111-1111-4111-8111-111111111111");
const ID_B = newNodeId(() => "22222222-2222-4222-8222-222222222222");

function raw(text: string, marks: Mark[]): InlineNode {
  return { type: "text", text, marks };
}

function doc(...nodes: CanonicalDocument["nodes"]): CanonicalDocument {
  return { schemaVersion: 1, nodes };
}

const fixtures: Record<string, CanonicalDocument> = {
  empty: doc(paragraphNode(ID_A)),
  clean: doc(
    headingNode(ID_A, 1, [textNode("Uvod")]),
    paragraphNode(ID_B, [textNode("Tekst", ["bold"])]),
  ),
  mergeable: doc(
    paragraphNode(ID_A, [raw("Prvi ", []), raw("drugi", [])]),
  ),
  emptyRuns: doc(
    paragraphNode(ID_A, [raw("", []), raw("a", ["bold"]), raw("", ["bold"])]),
  ),
  messyMarks: doc(
    paragraphNode(ID_A, [
      raw("a", ["italic", "bold"]),
      raw("b", ["bold", "italic", "bold"]),
    ]),
  ),
  headingWithRuns: doc(
    headingNode(ID_A, 3, [raw("Za", ["bold"]), raw("ključak", ["bold"])]),
  ),
};

describe("normalizeDocument", () => {
  it("merges adjacent text nodes with identical marks", () => {
    const result = normalizeDocument(fixtures.mergeable);
    expect(result.nodes[0].children).toEqual([
      { type: "text", text: "Prvi drugi", marks: [] },
    ]);
  });

  it("merges runs inside a heading too", () => {
    const result = normalizeDocument(fixtures.headingWithRuns);
    expect(result.nodes[0].children).toEqual([
      { type: "text", text: "Zaključak", marks: ["bold"] },
    ]);
  });

  it("does not merge across different marks", () => {
    const input = doc(
      paragraphNode(ID_A, [raw("a", []), raw("b", ["bold"]), raw("c", [])]),
    );
    expect(normalizeDocument(input).nodes[0].children).toHaveLength(3);
  });

  it("drops empty text nodes", () => {
    const result = normalizeDocument(fixtures.emptyRuns);
    expect(result.nodes[0].children).toEqual([
      { type: "text", text: "a", marks: ["bold"] },
    ]);
  });

  it("leaves an empty paragraph as an empty paragraph", () => {
    const result = normalizeDocument(fixtures.empty);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].children).toEqual([]);
  });

  it("sorts and deduplicates marks, then merges what becomes identical", () => {
    const result = normalizeDocument(fixtures.messyMarks);
    expect(result.nodes[0].children).toEqual([
      { type: "text", text: "ab", marks: ["bold", "italic"] },
    ]);
  });

  it("preserves node ids, order, types and heading levels", () => {
    const result = normalizeDocument(fixtures.clean);
    expect(result.nodes.map((node) => node.id)).toEqual([ID_A, ID_B]);
    expect(result.nodes[0].type).toBe("heading");
    expect(result.nodes[0]).toMatchObject({ level: 1 });
  });

  it("never mutates its input", () => {
    const input = fixtures.mergeable;
    const snapshot = structuredClone(input);
    Object.freeze(input);
    Object.freeze(input.nodes);
    normalizeDocument(input);
    expect(input).toEqual(snapshot);
  });

  it("restores the block invariant for a document with no nodes", () => {
    const degenerate = { schemaVersion: 1, nodes: [] } as CanonicalDocument;
    const result = normalizeDocument(
      degenerate,
      () => "33333333-3333-4333-8333-333333333333",
    );
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].type).toBe("paragraph");
  });

  it("is idempotent over every fixture", () => {
    for (const [name, fixture] of Object.entries(fixtures)) {
      const once = normalizeDocument(fixture);
      const twice = normalizeDocument(once);
      expect(twice, name).toEqual(once);
      expect(JSON.stringify(twice), name).toBe(JSON.stringify(once));
    }
  });

  it("produces documents that pass validation", () => {
    for (const [name, fixture] of Object.entries(fixtures)) {
      const result = validateDocument(normalizeDocument(fixture));
      expect(result.ok, name).toBe(true);
    }
  });

  it("always stamps schema version 1", () => {
    expect(normalizeDocument(fixtures.clean).schemaVersion).toBe(1);
  });
});
