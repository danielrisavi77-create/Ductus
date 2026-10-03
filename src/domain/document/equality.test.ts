import { describe, expect, it } from "vitest";

import { contentEqual, documentsEqual } from "./equality";
import {
  headingNode,
  newNodeId,
  paragraphNode,
  textNode,
  type CanonicalDocument,
} from "./schema";

const ID_A = newNodeId(() => "11111111-1111-4111-8111-111111111111");
const ID_B = newNodeId(() => "22222222-2222-4222-8222-222222222222");

function doc(...nodes: CanonicalDocument["nodes"]): CanonicalDocument {
  return { schemaVersion: 1, nodes };
}

const base = doc(
  headingNode(ID_A, 2, [textNode("Uvod")]),
  paragraphNode(ID_B, [textNode("Tekst", ["bold"])]),
);

describe("documentsEqual", () => {
  it("is true for deep copies", () => {
    expect(documentsEqual(base, structuredClone(base))).toBe(true);
  });

  it("is true for the same reference", () => {
    expect(documentsEqual(base, base)).toBe(true);
  });

  it("is false when a node id differs", () => {
    const other = doc(
      headingNode(ID_B, 2, [textNode("Uvod")]),
      paragraphNode(ID_A, [textNode("Tekst", ["bold"])]),
    );
    expect(documentsEqual(base, other)).toBe(false);
  });

  it("is false when text, marks, level, type or length differ", () => {
    expect(
      documentsEqual(base, doc(headingNode(ID_A, 2, [textNode("Uvod")]))),
    ).toBe(false);
    expect(
      documentsEqual(
        base,
        doc(
          headingNode(ID_A, 3, [textNode("Uvod")]),
          paragraphNode(ID_B, [textNode("Tekst", ["bold"])]),
        ),
      ),
    ).toBe(false);
    expect(
      documentsEqual(
        base,
        doc(
          headingNode(ID_A, 2, [textNode("Uvod")]),
          paragraphNode(ID_B, [textNode("Tekst", ["italic"])]),
        ),
      ),
    ).toBe(false);
    expect(
      documentsEqual(
        base,
        doc(
          headingNode(ID_A, 2, [textNode("Uvod")]),
          paragraphNode(ID_B, [textNode("Drugi tekst", ["bold"])]),
        ),
      ),
    ).toBe(false);
    expect(
      documentsEqual(
        base,
        doc(
          paragraphNode(ID_A, [textNode("Uvod")]),
          paragraphNode(ID_B, [textNode("Tekst", ["bold"])]),
        ),
      ),
    ).toBe(false);
  });

  it("is false when child counts differ", () => {
    expect(documentsEqual(doc(paragraphNode(ID_A)), base)).toBe(false);
  });
});

describe("contentEqual", () => {
  it("ignores node ids", () => {
    const retyped = doc(
      headingNode(ID_B, 2, [textNode("Uvod")]),
      paragraphNode(ID_A, [textNode("Tekst", ["bold"])]),
    );
    expect(contentEqual(base, retyped)).toBe(true);
    expect(documentsEqual(base, retyped)).toBe(false);
  });

  it("still compares text, marks, order and block shape", () => {
    expect(
      contentEqual(base, doc(headingNode(ID_A, 2, [textNode("Uvod")]))),
    ).toBe(false);
    expect(
      contentEqual(
        doc(paragraphNode(ID_A, [textNode("a"), textNode("b", ["bold"])])),
        doc(paragraphNode(ID_A, [textNode("b", ["bold"]), textNode("a")])),
      ),
    ).toBe(false);
  });

  it("is true for an empty document pair with different ids", () => {
    expect(contentEqual(doc(paragraphNode(ID_A)), doc(paragraphNode(ID_B)))).toBe(
      true,
    );
  });

  it("does not mutate its arguments", () => {
    const a = structuredClone(base);
    const b = structuredClone(base);
    Object.freeze(a);
    Object.freeze(b);
    expect(() => contentEqual(a, b)).not.toThrow();
    expect(a).toEqual(base);
  });
});
