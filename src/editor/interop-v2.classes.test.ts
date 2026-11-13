// @vitest-environment node
import { Editor, getSchema } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import type { CanonicalDocumentV2, DocumentSource, NodeId, SourceId } from "../domain/document";

import { canonicalToTiptap, tiptapToCanonical, type IdFactory } from "./interop";
import { canonicalToTiptapV2, tiptapToCanonicalV2 } from "./interop-v2";
import { createEditorExtensionsV2 } from "./schema";

/**
 * DAN-620 a, the input classes K1 to K15 of the contract (#1836
 * issuecomment-6858553907), written before the code: the v2 projection and
 * the citation node of the v2 editor. Invented ids and filler text only.
 */

const ID_A = "aaaaaaaa-0000-4000-8000-00000000000a" as NodeId;
const ID_B = "bbbbbbbb-0000-4000-8000-00000000000b" as NodeId;
const SRC_1 = "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as SourceId;
const SRC_2 = "22222222-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as SourceId;

const BOOK: DocumentSource = {
  id: SRC_1,
  type: "book",
  authors: [{ kind: "person", family: "Izmišljena", given: "Ana" }],
  year: 2020,
  title: "Naslov knjige",
  place: "Zagreb",
  publisher: "Nakladnik",
};

const mint: IdFactory = (i) => `cccccccc-0000-4000-8000-${i.toString(16).padStart(12, "0")}` as NodeId;

const text = (t: string, marks?: { type: string }[]) => (marks ? { type: "text", text: t, marks } : { type: "text", text: t });
const cite = (attrs: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ type: "citation", attrs, ...extra });
const para = (content: unknown[], id: string = ID_A) =>
  content.length === 0 ? { type: "paragraph", attrs: { nodeId: id } } : { type: "paragraph", attrs: { nodeId: id }, content };
const doc = (content: unknown[], attrs?: unknown) => (attrs === undefined ? { type: "doc", content } : { type: "doc", attrs, content });

const codes = (outcome: ReturnType<typeof tiptapToCanonicalV2>) => (outcome.ok ? [] : outcome.errors.map((e) => e.code));

/** Canonical → Tiptap → the real v2 editor → Tiptap → canonical. */
function throughEditor(input: CanonicalDocumentV2): CanonicalDocumentV2 {
  const editor = new Editor({ element: null, extensions: createEditorExtensionsV2(), content: canonicalToTiptapV2(input) });
  try {
    const back = tiptapToCanonicalV2(editor.getJSON(), mint);
    if (!back.ok) throw new Error(JSON.stringify(back.errors));
    return back.doc;
  } finally {
    editor.destroy();
  }
}

describe("K1 text-only blocks", () => {
  it("project to v2 with no sources", () => {
    const outcome = tiptapToCanonicalV2(doc([para([text("Prvi odlomak.")])]), mint);
    expect(outcome).toEqual({
      ok: true,
      doc: {
        schemaVersion: 2,
        nodes: [{ type: "paragraph", id: ID_A, children: [{ type: "text", text: "Prvi odlomak.", marks: [] }] }],
        sources: [],
      },
    });
  });
});

describe("K2 and K3 citation attributes", () => {
  it("K2 a citation with only sourceId has no locator key", () => {
    const outcome = tiptapToCanonicalV2(doc([para([cite({ sourceId: SRC_1, locator: null })])]), mint);
    expect(outcome.ok && outcome.doc.nodes[0]!.children).toEqual([{ type: "citation", sourceId: SRC_1 }]);
  });

  it("K3 a locator is kept", () => {
    const outcome = tiptapToCanonicalV2(doc([para([cite({ sourceId: SRC_1, locator: "str. 12" })])]), mint);
    expect(outcome.ok && outcome.doc.nodes[0]!.children).toEqual([{ type: "citation", sourceId: SRC_1, locator: "str. 12" }]);
  });
});

describe("K4 locator null, absent and empty", () => {
  it("null and absent give the same document", () => {
    const withNull = tiptapToCanonicalV2(doc([para([cite({ sourceId: SRC_1, locator: null })])]), mint);
    const absent = tiptapToCanonicalV2(doc([para([cite({ sourceId: SRC_1 })])]), mint);
    expect(withNull).toEqual(absent);
    expect(withNull.ok).toBe(true);
  });

  it("an empty locator is refused", () => {
    expect(codes(tiptapToCanonicalV2(doc([para([cite({ sourceId: SRC_1, locator: "" })])]), mint))).toEqual([
      "CITATION_LOCATOR_INVALID",
    ]);
  });
});

describe("K5 sourceId", () => {
  it.each([
    ["upper case", SRC_1.toUpperCase()],
    ["not v4", "11111111-aaaa-1aaa-8aaa-aaaaaaaaaaaa"],
    ["nil", "00000000-0000-0000-0000-000000000000"],
    ["a number", 7],
    ["null", null],
  ])("%s is refused", (_name, sourceId) => {
    expect(codes(tiptapToCanonicalV2(doc([para([cite({ sourceId })])]), mint))).toEqual(["CITATION_SOURCE_ID_INVALID"]);
  });

  it("missing is refused", () => {
    expect(codes(tiptapToCanonicalV2(doc([para([cite({ locator: "str. 1" })])]), mint))).toEqual([
      "CITATION_SOURCE_ID_INVALID",
    ]);
  });
});

describe("K6 locator", () => {
  it.each([
    ["101 code points", "č".repeat(101)],
    ["a forbidden character", "str.\u0000 1"],
    ["a lone surrogate", "str. \uD800"],
    ["a number", 12],
  ])("%s is refused", (_name, locator) => {
    expect(codes(tiptapToCanonicalV2(doc([para([cite({ sourceId: SRC_1, locator })])]), mint))).toEqual([
      "CITATION_LOCATOR_INVALID",
    ]);
  });

  it("100 code points outside the BMP are accepted", () => {
    const locator = "\u{1F600}".repeat(100);
    expect(codes(tiptapToCanonicalV2(doc([para([cite({ sourceId: SRC_1, locator })])]), mint))).toEqual([]);
  });
});

describe("K7 a citation in a heading", () => {
  it("is refused", () => {
    const heading = { type: "heading", attrs: { nodeId: ID_A, level: 1 }, content: [text("Uvod"), cite({ sourceId: SRC_1 })] };
    expect(codes(tiptapToCanonicalV2(doc([heading]), mint))).toEqual(["CITATION_NOT_ALLOWED"]);
  });

  it("cannot be held by the editor's heading", () => {
    const schema = getSchema(createEditorExtensionsV2());
    const citation = schema.nodes.citation!.create({ sourceId: SRC_1 });
    expect(schema.nodes.heading!.validContent(schema.nodes.heading!.create(null, citation).content)).toBe(false);
    expect(schema.nodes.paragraph!.validContent(schema.nodes.paragraph!.create(null, citation).content)).toBe(true);
  });
});

describe("K8 a marked citation", () => {
  it.each([[[{ type: "bold" }]], [[{ type: "italic" }, { type: "bold" }]], [[{ type: "underline" }]], ["bold"]])(
    "is refused, never stripped: %j",
    (marks) => {
      expect(codes(tiptapToCanonicalV2(doc([para([cite({ sourceId: SRC_1 }, { marks })])]), mint))).toEqual([
        "TIPTAP_CITATION_MARKED",
      ]);
    },
  );

  it("an empty mark list is no mark", () => {
    expect(codes(tiptapToCanonicalV2(doc([para([cite({ sourceId: SRC_1 }, { marks: [] })])]), mint))).toEqual([]);
  });
});

describe("K9 unknown attributes and keys", () => {
  it.each([
    ["an unknown attribute", cite({ sourceId: SRC_1, page: 3 })],
    ["a node id", cite({ sourceId: SRC_1, nodeId: ID_B })],
    ["attrs that are not an object", { type: "citation", attrs: [SRC_1] }],
    ["no attrs", { type: "citation" }],
    ["text on a citation", cite({ sourceId: SRC_1 }, { text: "x" })],
    ["content on a citation", cite({ sourceId: SRC_1 }, { content: [] })],
  ])("%s is refused", (_name, citation) => {
    expect(codes(tiptapToCanonicalV2(doc([para([citation])]), mint))).toEqual(["TIPTAP_CITATION_INVALID"]);
  });
});

describe("K10 an orphan", () => {
  it("is accepted and kept", () => {
    const outcome = tiptapToCanonicalV2(doc([para([cite({ sourceId: SRC_2 })])], { sources: [BOOK] }), mint);
    expect(outcome.ok && outcome.doc.nodes[0]!.children).toEqual([{ type: "citation", sourceId: SRC_2 }]);
    expect(outcome.ok && outcome.doc.sources).toEqual([BOOK]);
  });
});

describe("K11 the sources attribute", () => {
  it("missing attrs or sources give an empty list", () => {
    for (const attrs of [undefined, {}]) {
      const outcome = tiptapToCanonicalV2(doc([para([text("a")])], attrs), mint);
      expect(outcome.ok && outcome.doc.sources).toEqual([]);
    }
  });

  it("sources that are not an array are refused", () => {
    for (const sources of [null, {}, "[]", 0]) {
      expect(codes(tiptapToCanonicalV2(doc([para([text("a")])], { sources }), mint))).toEqual(["SOURCES_NOT_ARRAY"]);
    }
  });

  it("attrs that are not an object are refused", () => {
    expect(codes(tiptapToCanonicalV2(doc([para([text("a")])], [BOOK]), mint))).toEqual(["TIPTAP_ATTRS_NOT_OBJECT"]);
  });

  it("an invalid record is refused with the domain's code", () => {
    const noPublisher: Record<string, unknown> = { ...BOOK };
    delete noPublisher.publisher;
    expect(codes(tiptapToCanonicalV2(doc([para([text("a")])], { sources: [noPublisher] }), mint))).toEqual([
      "SOURCE_FIELD_MISSING",
    ]);
    expect(codes(tiptapToCanonicalV2(doc([para([text("a")])], { sources: [BOOK, BOOK] }), mint))).toEqual([
      "SOURCE_ID_DUPLICATE",
    ]);
  });

  it("a value JSON cannot hold is refused with a known code, never thrown", () => {
    const withFunction = { ...BOOK, title: () => "Naslov" };
    const withSymbol = { ...BOOK, title: Symbol("naslov") };
    for (const sources of [[withFunction], [withSymbol]]) {
      expect(codes(tiptapToCanonicalV2(doc([para([text("a")])], { sources }), mint))).toEqual(["SOURCE_FIELD_INVALID"]);
    }
    // A property of the list itself is no record: it is left out, never cloned.
    const extra = Object.assign([structuredClone(BOOK)], { onLoad: () => undefined });
    const outcome = tiptapToCanonicalV2(doc([para([text("a")])], { sources: extra }), mint);
    expect(outcome.ok && outcome.doc.sources).toEqual([BOOK]);
  });

  it("the input list is not shared with the result", () => {
    const sources = [structuredClone(BOOK)];
    const outcome = tiptapToCanonicalV2(doc([para([text("a")])], { sources }), mint);
    expect(outcome.ok && outcome.doc.sources).not.toBe(sources);
    expect(outcome.ok && outcome.doc.sources[0]).not.toBe(sources[0]);
  });
});

describe("K12 more than 500 sources", () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ ...BOOK, id: `${i.toString(16).padStart(8, "0")}-aaaa-4aaa-8aaa-aaaaaaaaaaaa` }));

  it("500 are accepted, 501 refused", () => {
    expect(codes(tiptapToCanonicalV2(doc([para([text("a")])], { sources: many(500) }), mint))).toEqual([]);
    expect(codes(tiptapToCanonicalV2(doc([para([text("a")])], { sources: many(501) }), mint))).toEqual(["SOURCES_TOO_MANY"]);
  });
});

describe("K13 round trip through the real editor", () => {
  const cases: [string, CanonicalDocumentV2["nodes"][number]["children"]][] = [
    ["an empty paragraph", []],
    ["a citation alone", [{ type: "citation", sourceId: SRC_1 }]],
    [
      "a citation at the start and at the end",
      [
        { type: "citation", sourceId: SRC_1, locator: "str. 3" },
        { type: "text", text: " sredina ", marks: ["bold"] },
        { type: "citation", sourceId: SRC_2 },
      ],
    ],
    [
      "adjacent citations",
      [
        { type: "text", text: "Prije", marks: [] },
        { type: "citation", sourceId: SRC_1 },
        { type: "citation", sourceId: SRC_1, locator: "pogl. 2" },
        { type: "text", text: "poslije", marks: [] },
      ],
    ],
    [
      "same-mark text on both sides of a citation",
      [
        { type: "text", text: "a", marks: ["italic"] },
        { type: "citation", sourceId: SRC_2 },
        { type: "text", text: "b", marks: ["italic"] },
      ],
    ],
    [
      "a citation next to a surrogate pair",
      [
        { type: "text", text: "\u{1F600}", marks: [] },
        { type: "citation", sourceId: SRC_1, locator: "\u{1F600}" },
        { type: "text", text: "\u{1F600}", marks: [] },
      ],
    ],
  ];

  it.each(cases)("%s", (_name, children) => {
    const input: CanonicalDocumentV2 = {
      schemaVersion: 2,
      nodes: [
        { type: "heading", id: ID_B, level: 2, children: [{ type: "text", text: "Naslov", marks: [] }] },
        { type: "quote", id: ID_A, children },
      ],
      sources: [BOOK],
    };
    expect(throughEditor(input)).toEqual(input);
  });

  it("the editor's JSON is what the projection writes", () => {
    const input: CanonicalDocumentV2 = {
      schemaVersion: 2,
      nodes: [{ type: "bulletItem", id: ID_A, children: [{ type: "citation", sourceId: SRC_1 }] }],
      sources: [BOOK],
    };
    const editor = new Editor({ element: null, extensions: createEditorExtensionsV2(), content: canonicalToTiptapV2(input) });
    expect(editor.getJSON()).toEqual(canonicalToTiptapV2(input));
    editor.destroy();
  });
});

describe("K14 the v1 projection", () => {
  it("does not take a citation", () => {
    const outcome = tiptapToCanonical(doc([para([cite({ sourceId: SRC_1 })])]), mint);
    expect(outcome.ok ? [] : outcome.errors.map((e) => e.code)).toEqual(["TIPTAP_UNKNOWN_NODE_TYPE"]);
  });

  it("gives the same JSON for a text-only document, apart from the sources", () => {
    const input = { schemaVersion: 1 as const, nodes: [{ type: "paragraph" as const, id: ID_A, children: [] }] };
    const { attrs, ...rest } = canonicalToTiptapV2({ ...input, schemaVersion: 2, sources: [] });
    expect(attrs).toEqual({ sources: [] });
    expect(rest).toEqual(canonicalToTiptap(input));
  });
});

describe("K15 HTML of a citation", () => {
  const schema = getSchema(createEditorExtensionsV2());
  const rule = schema.nodes.citation!.spec.parseDOM![0]!;
  /** An element with only the attributes the rule reads; no DOM in this test. */
  const element = (attributes: Record<string, string>) =>
    ({ getAttribute: (name: string) => attributes[name] ?? null }) as unknown as HTMLElement;
  const parse = (attributes: Record<string, string>) => rule.getAttrs!(element(attributes));

  it("is read from span[data-citation]", () => {
    expect(rule.tag).toBe("span[data-citation]");
  });

  it.each([
    ["no source id", { "data-citation": "" }],
    ["an upper-case source id", { "data-citation": "", "data-source-id": SRC_1.toUpperCase() }],
    ["an empty locator", { "data-citation": "", "data-source-id": SRC_1, "data-locator": "" }],
    ["a long locator", { "data-citation": "", "data-source-id": SRC_1, "data-locator": "x".repeat(101) }],
    ["a forbidden locator", { "data-citation": "", "data-source-id": SRC_1, "data-locator": "a\u0007" }],
  ])("with %s is dropped", (_name, attributes) => {
    expect(parse(attributes)).toBe(false);
  });

  it.each([[{ sourceId: SRC_1, locator: null }], [{ sourceId: SRC_2, locator: "str. 4–5" }]])(
    "round-trips through its own HTML: %j",
    (attrs) => {
      const node = schema.nodes.citation!.create(attrs);
      const [tag, attributes] = schema.nodes.citation!.spec.toDOM!(node) as [string, Record<string, string>];
      expect(tag).toBe("span");
      expect(schema.nodes.citation!.create(parse(attributes) as Record<string, unknown>).attrs).toEqual(node.attrs);
    },
  );
});
