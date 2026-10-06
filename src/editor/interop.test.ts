import { describe, expect, it } from "vitest";

import {
  documentsEqual,
  emptyDocument,
  headingNode,
  normalizeDocument,
  paragraphNode,
  textNode,
  validateDocument,
  DOCUMENT_SCHEMA_VERSION,
  type CanonicalDocument,
  type NodeId,
} from "../domain/document";

import {
  canonicalToTiptap,
  countNodes,
  countWords,
  tiptapToCanonical,
  NODE_ID_ATTRIBUTE,
  type IdFactory,
  type TiptapDocumentJSON,
} from "./interop";

/* ------------------------------------------------------------- fixtures */

const ID_A = "11111111-1111-4111-8111-111111111111" as NodeId;
const ID_B = "22222222-2222-4222-8222-222222222222" as NodeId;
const ID_C = "33333333-3333-4333-8333-333333333333" as NodeId;
const ID_D = "44444444-4444-4444-8444-444444444444" as NodeId;

/** Deterministic id factory: one fresh id per call, in a fixed order. */
function factory(...ids: NodeId[]): IdFactory {
  let next = 0;
  return () => {
    const id = ids[next];
    next += 1;
    if (!id) {
      throw new Error("factory: ran out of prepared ids");
    }
    return id;
  };
}

function doc(...nodes: CanonicalDocument["nodes"]): CanonicalDocument {
  return { schemaVersion: DOCUMENT_SCHEMA_VERSION, nodes };
}

const FIXTURES: Record<string, CanonicalDocument> = {
  "empty paragraph": doc(paragraphNode(ID_A)),
  "single paragraph": doc(paragraphNode(ID_A, [textNode("Uvod u temu.")])),
  "marked runs": doc(
    paragraphNode(ID_A, [
      textNode("obično "),
      textNode("podebljano", ["bold"]),
      textNode(" i "),
      textNode("kurziv", ["italic"]),
      textNode(" i "),
      textNode("oboje", ["bold", "italic"]),
    ]),
  ),
  "all heading levels": doc(
    headingNode(ID_A, 1, [textNode("Naslov")]),
    headingNode(ID_B, 2, [textNode("Podnaslov")]),
    headingNode(ID_C, 3, [textNode("Pod-podnaslov")]),
  ),
  "mixed multi-block": doc(
    headingNode(ID_A, 1, [textNode("Rasprava")]),
    paragraphNode(ID_B, [textNode("Prvi odlomak.")]),
    paragraphNode(ID_C),
    paragraphNode(ID_D, [textNode("Drugi ", ["italic"]), textNode("odlomak.")]),
  ),
};

/* -------------------------------------------------------- round-trip law */

describe("round-trip law", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    it(`preserves "${name}" through canonical → Tiptap → canonical`, () => {
      const result = tiptapToCanonical(canonicalToTiptap(fixture), () => {
        throw new Error("no fresh id should be needed on a round trip");
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      expect(documentsEqual(result.doc, normalizeDocument(fixture))).toBe(true);
      expect(documentsEqual(result.doc, fixture)).toBe(true);
    });
  }

  it("round-trips the canonical empty document", () => {
    const fixture = emptyDocument(() => ID_A);
    const result = tiptapToCanonical(canonicalToTiptap(fixture));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(documentsEqual(result.doc, fixture)).toBe(true);
  });

  it("produces a document the domain validator accepts", () => {
    const result = tiptapToCanonical(canonicalToTiptap(FIXTURES["mixed multi-block"]));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(validateDocument(result.doc).ok).toBe(true);
  });
});

/* --------------------------------------------------------- canonical → tiptap */

describe("canonicalToTiptap", () => {
  it("emits a doc node whose children carry the node id attribute", () => {
    const json = canonicalToTiptap(doc(paragraphNode(ID_A, [textNode("tekst")])));

    expect(json).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { [NODE_ID_ATTRIBUTE]: ID_A },
          content: [{ type: "text", text: "tekst" }],
        },
      ],
    });
  });

  it("carries the heading level as an attribute", () => {
    const json = canonicalToTiptap(doc(headingNode(ID_B, 3, [textNode("N3")])));
    expect(json.content[0].attrs).toEqual({ [NODE_ID_ATTRIBUTE]: ID_B, level: 3 });
  });

  it("omits content for an empty block instead of emitting an empty array", () => {
    const json = canonicalToTiptap(doc(paragraphNode(ID_A)));
    expect(json.content[0].content).toBeUndefined();
  });

  it("omits marks for unmarked text and emits them in canonical order", () => {
    const json = canonicalToTiptap(
      doc(paragraphNode(ID_A, [textNode("plain"), textNode("both", ["italic", "bold"])])),
    );

    expect(json.content[0].content?.[0].marks).toBeUndefined();
    expect(json.content[0].content?.[1].marks).toEqual([
      { type: "bold" },
      { type: "italic" },
    ]);
  });

  it("does not mutate the canonical document it is given", () => {
    const fixture = doc(paragraphNode(ID_A, [textNode("x", ["bold"])]));
    const before = JSON.stringify(fixture);
    canonicalToTiptap(fixture);
    expect(JSON.stringify(fixture)).toBe(before);
  });
});

/* --------------------------------------------------------- id strategy */

describe("node id strategy", () => {
  it("preserves an existing nodeId attribute", () => {
    const result = tiptapToCanonical(
      {
        type: "doc",
        content: [
          { type: "paragraph", attrs: { [NODE_ID_ATTRIBUTE]: ID_A }, content: [
            { type: "text", text: "a" },
          ] },
        ],
      },
      factory(ID_B),
    );

    expect(result.ok && result.doc.nodes[0].id).toBe(ID_A);
  });

  it("mints a fresh id for a block with no nodeId (a split paragraph)", () => {
    const result = tiptapToCanonical(
      {
        type: "doc",
        content: [
          { type: "paragraph", attrs: { [NODE_ID_ATTRIBUTE]: ID_A }, content: [
            { type: "text", text: "prvi" },
          ] },
          { type: "paragraph", content: [{ type: "text", text: "drugi" }] },
        ],
      },
      factory(ID_B),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.doc.nodes.map((node) => node.id)).toEqual([ID_A, ID_B]);
  });

  it("mints a fresh id when nodeId is explicitly null", () => {
    const result = tiptapToCanonical(
      { type: "doc", content: [{ type: "paragraph", attrs: { [NODE_ID_ATTRIBUTE]: null } }] },
      factory(ID_C),
    );

    expect(result.ok && result.doc.nodes[0].id).toBe(ID_C);
  });

  it("mints a fresh id for a block with no attrs at all", () => {
    const result = tiptapToCanonical(
      { type: "doc", content: [{ type: "paragraph" }] },
      factory(ID_C),
    );

    expect(result.ok && result.doc.nodes[0].id).toBe(ID_C);
  });

  it("re-mints a duplicated nodeId so identity stays unique (block paste)", () => {
    const result = tiptapToCanonical(
      {
        type: "doc",
        content: [
          { type: "paragraph", attrs: { [NODE_ID_ATTRIBUTE]: ID_A }, content: [
            { type: "text", text: "isti" },
          ] },
          { type: "paragraph", attrs: { [NODE_ID_ATTRIBUTE]: ID_A }, content: [
            { type: "text", text: "isti" },
          ] },
        ],
      },
      factory(ID_B),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.doc.nodes.map((node) => node.id)).toEqual([ID_A, ID_B]);
    expect(validateDocument(result.doc).ok).toBe(true);
  });

  it("rejects a tampered, non-UUID nodeId instead of replacing it", () => {
    const result = tiptapToCanonical(
      { type: "doc", content: [{ type: "paragraph", attrs: { [NODE_ID_ATTRIBUTE]: "not-a-uuid" } }] },
      factory(ID_B),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.errors).toEqual([
      { path: `$.content[0].attrs.${NODE_ID_ATTRIBUTE}`, code: "TIPTAP_NODE_ID_INVALID" },
    ]);
  });

  it("passes the block index to the id factory", () => {
    const seen: number[] = [];
    const ids = [ID_A, ID_B, ID_C];
    tiptapToCanonical(
      { type: "doc", content: [{ type: "paragraph" }, { type: "paragraph" }] },
      (index) => {
        seen.push(index);
        return ids[index];
      },
    );

    expect(seen).toEqual([0, 1]);
  });
});

/* ----------------------------------------------------------- rejections */

describe("unknown nodes and marks are rejected, never dropped", () => {
  it("rejects a node type outside the F1 schema", () => {
    const result = tiptapToCanonical(
      {
        type: "doc",
        content: [
          { type: "paragraph", attrs: { [NODE_ID_ATTRIBUTE]: ID_A } },
          { type: "bulletList", content: [] },
        ],
      },
      factory(ID_B),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.errors).toContainEqual({
      path: "$.content[1].type",
      code: "TIPTAP_UNKNOWN_NODE_TYPE",
    });
  });

  it("rejects a mark outside the F1 schema", () => {
    const result = tiptapToCanonical(
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { [NODE_ID_ATTRIBUTE]: ID_A },
            content: [{ type: "text", text: "precrtano", marks: [{ type: "strike" }] }],
          },
        ],
      },
      factory(ID_B),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.errors).toContainEqual({
      path: "$.content[0].content[0].marks[0].type",
      code: "TIPTAP_UNKNOWN_MARK",
    });
  });

  it("rejects an inline node type outside the F1 schema", () => {
    const result = tiptapToCanonical(
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { [NODE_ID_ATTRIBUTE]: ID_A },
            content: [{ type: "hardBreak" }],
          },
        ],
      },
      factory(ID_B),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.errors).toContainEqual({
      path: "$.content[0].content[0].type",
      code: "TIPTAP_UNKNOWN_NODE_TYPE",
    });
  });

  it("rejects a heading level outside 1-3", () => {
    const result = tiptapToCanonical(
      {
        type: "doc",
        content: [{ type: "heading", attrs: { [NODE_ID_ATTRIBUTE]: ID_A, level: 4 } }],
      },
      factory(ID_B),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.errors).toContainEqual({
      path: "$.content[0].attrs.level",
      code: "TIPTAP_HEADING_LEVEL_INVALID",
    });
  });

  it("rejects a non-object payload", () => {
    expect(tiptapToCanonical(null)).toEqual({
      ok: false,
      errors: [{ path: "$", code: "TIPTAP_NOT_OBJECT" }],
    });
  });

  it("rejects a root node that is not a doc", () => {
    expect(tiptapToCanonical({ type: "paragraph", content: [] })).toEqual({
      ok: false,
      errors: [{ path: "$.type", code: "TIPTAP_ROOT_TYPE_INVALID" }],
    });
  });

  it("rejects a doc whose content is not an array", () => {
    expect(tiptapToCanonical({ type: "doc", content: "tekst" })).toEqual({
      ok: false,
      errors: [{ path: "$.content", code: "TIPTAP_CONTENT_NOT_ARRAY" }],
    });
  });

  it("rejects a text node whose text is not a string", () => {
    const result = tiptapToCanonical(
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { [NODE_ID_ATTRIBUTE]: ID_A },
            content: [{ type: "text", text: 42 }],
          },
        ],
      },
      factory(ID_B),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.errors).toContainEqual({
      path: "$.content[0].content[0].text",
      code: "TIPTAP_INLINE_TEXT_NOT_STRING",
    });
  });

  it("rejects marks that are not an array", () => {
    const result = tiptapToCanonical(
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { [NODE_ID_ATTRIBUTE]: ID_A },
            content: [{ type: "text", text: "x", marks: "bold" }],
          },
        ],
      },
      factory(ID_B),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.errors).toContainEqual({
      path: "$.content[0].content[0].marks",
      code: "TIPTAP_MARKS_NOT_ARRAY",
    });
  });

  it("collects every problem in one pass rather than failing fast", () => {
    const result = tiptapToCanonical(
      {
        type: "doc",
        content: [
          { type: "codeBlock" },
          { type: "heading", attrs: { [NODE_ID_ATTRIBUTE]: ID_A, level: 9 } },
        ],
      },
      factory(ID_B),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.errors).toHaveLength(2);
  });
});

/* ----------------------------------------------------------- normalising */

describe("editing artefacts are normalised, not rejected", () => {
  it("merges adjacent text runs carrying identical marks", () => {
    const result = tiptapToCanonical(
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { [NODE_ID_ATTRIBUTE]: ID_A },
            content: [
              { type: "text", text: "pod", marks: [{ type: "bold" }] },
              { type: "text", text: "ebljano", marks: [{ type: "bold" }] },
            ],
          },
        ],
      },
      factory(ID_B),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.doc.nodes[0].children).toEqual([
      { type: "text", text: "podebljano", marks: ["bold"] },
    ]);
  });

  it("sorts marks into canonical order (bold before italic)", () => {
    const result = tiptapToCanonical(
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { [NODE_ID_ATTRIBUTE]: ID_A },
            content: [
              {
                type: "text",
                text: "oboje",
                marks: [{ type: "italic" }, { type: "bold" }],
              },
            ],
          },
        ],
      },
      factory(ID_B),
    );

    expect(result.ok && result.doc.nodes[0].children[0].marks).toEqual(["bold", "italic"]);
  });

  it("drops empty text runs the editor may emit", () => {
    const result = tiptapToCanonical(
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { [NODE_ID_ATTRIBUTE]: ID_A },
            content: [
              { type: "text", text: "" },
              { type: "text", text: "sadržaj" },
            ],
          },
        ],
      },
      factory(ID_B),
    );

    expect(result.ok && result.doc.nodes[0].children).toEqual([
      { type: "text", text: "sadržaj", marks: [] },
    ]);
  });

  it("restores the one-block invariant for a doc with no content", () => {
    const result = tiptapToCanonical({ type: "doc", content: [] }, factory(ID_A), () => ID_C);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.doc.nodes).toHaveLength(1);
    expect(result.doc.nodes[0]).toEqual({ type: "paragraph", id: ID_C, children: [] });
  });

  it("is idempotent: re-projecting a projected document changes nothing", () => {
    const first = tiptapToCanonical(canonicalToTiptap(FIXTURES["marked runs"]));
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    const second = tiptapToCanonical(canonicalToTiptap(first.doc));
    expect(second.ok && documentsEqual(second.doc, first.doc)).toBe(true);
  });

  it("stamps the current schema version on every candidate", () => {
    const result = tiptapToCanonical(canonicalToTiptap(FIXTURES["single paragraph"]));
    expect(result.ok && result.doc.schemaVersion).toBe(DOCUMENT_SCHEMA_VERSION);
  });
});

/* --------------------------------------------------------------- counts */

describe("countNodes / countWords", () => {
  it("counts block nodes", () => {
    expect(countNodes(FIXTURES["mixed multi-block"])).toBe(4);
    expect(countNodes(FIXTURES["empty paragraph"])).toBe(1);
  });

  it("counts words across blocks without fusing them", () => {
    expect(
      countWords(doc(paragraphNode(ID_A, [textNode("dva")]), paragraphNode(ID_B, [textNode("tri")]))),
    ).toBe(2);
  });

  it("counts words across mark boundaries within a block", () => {
    expect(countWords(FIXTURES["marked runs"])).toBe(6);
  });

  it("counts nothing in an empty document", () => {
    expect(countWords(emptyDocument(() => ID_A))).toBe(0);
  });

  it("ignores runs of whitespace", () => {
    expect(countWords(doc(paragraphNode(ID_A, [textNode("  a \n\t b  ")])))).toBe(2);
  });
});

/* ---------------------------------------------------------- type surface */

describe("TiptapDocumentJSON", () => {
  it("is the shape canonicalToTiptap returns", () => {
    const json: TiptapDocumentJSON = canonicalToTiptap(FIXTURES["all heading levels"]);
    expect(json.type).toBe("doc");
    expect(json.content).toHaveLength(3);
  });
});

/**
 * `isPlainObject` now applies the same prototype rule as `validate.ts` (F1-10).
 * ProseMirror JSON is not always ours — it can come from a paste, from storage
 * or from a future import — and a class instance or a forged `__proto__`
 * carrier must not be read as a node and have its properties trusted.
 */
describe("tiptapToCanonical — plain objects only", () => {
  class Doc {
    type = "doc";
    content: unknown[] = [];
  }

  it("refuses a prototype-bearing object as the document root", () => {
    const result = tiptapToCanonical(new Doc(), factory(ID_A));

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors).toEqual([
      { path: "$", code: "TIPTAP_NOT_OBJECT" },
    ]);
  });

  it("refuses a prototype-bearing object as a block node", () => {
    class Paragraph {
      type = "paragraph";
      content: unknown[] = [];
    }

    const result = tiptapToCanonical(
      { type: "doc", content: [new Paragraph()] },
      factory(ID_A),
    );

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors).toContainEqual({
      path: "$.content[0]",
      code: "TIPTAP_NODE_NOT_OBJECT",
    });
  });

  it("refuses prototype-bearing attrs", () => {
    class Attrs {
      [NODE_ID_ATTRIBUTE] = ID_A;
    }

    const result = tiptapToCanonical(
      { type: "doc", content: [{ type: "paragraph", attrs: new Attrs(), content: [] }] },
      factory(ID_B),
    );

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors).toContainEqual({
      path: "$.content[0].attrs",
      code: "TIPTAP_ATTRS_NOT_OBJECT",
    });
  });

  it("still accepts a null-prototype object, as validate.ts does", () => {
    const paragraph = Object.assign(Object.create(null) as Record<string, unknown>, {
      type: "paragraph",
      attrs: Object.assign(Object.create(null) as Record<string, unknown>, {
        [NODE_ID_ATTRIBUTE]: ID_A,
      }),
      content: [{ type: "text", text: "bez prototipa" }],
    });
    const root = Object.assign(Object.create(null) as Record<string, unknown>, {
      type: "doc",
      content: [paragraph],
    });

    const result = tiptapToCanonical(root, factory(ID_B));

    expect(result.ok).toBe(true);
    expect(result.ok && result.doc.nodes[0].id).toBe(ID_A);
  });
});
