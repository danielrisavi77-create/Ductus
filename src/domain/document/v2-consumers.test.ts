import { describe, expect, it } from "vitest";

import fpzgConfig from "../../../config/faculties/fpzg/citation.json";
import { parseCitationStyle } from "../citation";
import { canonicalizeJcs } from "../forensics/jcs";
import { deriveChapters } from "./chapters";
import { contentEqual, documentsEqual } from "./equality";
import { normalizeDocument } from "./normalize";
import type {
  CanonicalDocument,
  CanonicalDocumentV2,
  CitationNode,
  DocumentNodeV2,
  DocumentSource,
  InlineNode,
  InlineNodeV2,
  NodeId,
  SourceId,
} from "./schema";
import { textBlocksOf } from "./text-blocks";
import { validateVersionedDocument } from "./validate";
import { documentWordCount } from "./word-count";

/**
 * Input classes D2 to D7 of DAN-619 (d1), contract
 * docs/contracts/document-schema-v2.md §9.1: the domain consumers read v2
 * citations and sources, and v1 behaves as on main. Synthetic data only.
 */

const style = parseCitationStyle(fpzgConfig);
const ORPHAN = "[?]";
const rendering = { style, orphanMark: ORPHAN };

const sid = (i: number) => `${i.toString(16).padStart(8, "0")}-aaaa-4aaa-8aaa-aaaaaaaaaaaa` as SourceId;
const nid = (i: number) => `${i.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111` as NodeId;
const author = { kind: "person", family: "Prezime", given: "Ime" } as const;
const book = (i: number, extra: Partial<DocumentSource> = {}): DocumentSource =>
  ({ id: sid(i), type: "book", authors: [author], year: 2020, title: `Izvor ${i}`, place: "Mjesto", publisher: "Nakladnik", ...extra }) as DocumentSource;
const cite = (i: number, locator?: string): CitationNode =>
  locator === undefined ? { type: "citation", sourceId: sid(i) } : { type: "citation", sourceId: sid(i), locator };
const text = (value: string, marks: ("bold" | "italic")[] = []): InlineNode => ({ type: "text", text: value, marks });

function v2(children: InlineNodeV2[], sources: DocumentSource[] = [book(1)], heading = "Uvod"): CanonicalDocumentV2 {
  const nodes: DocumentNodeV2[] = [
    { type: "heading", id: nid(0), level: 1, children: [text(heading)] },
    { type: "paragraph", id: nid(1), children },
  ];
  return { schemaVersion: 2, nodes, sources };
}

/** A fixture the validator accepts (contract §§1 to 3). */
function valid(doc: CanonicalDocumentV2): CanonicalDocumentV2 {
  expect(validateVersionedDocument(doc)).toMatchObject({ ok: true });
  return doc;
}

const paragraph = (doc: CanonicalDocumentV2) => doc.nodes[1].children;

describe("D2: normalizeDocument v2", () => {
  it("keeps a citation between same-mark text runs separate and does not merge across it", () => {
    const input = v2([text("Prva"), cite(1, "str. 12"), text(" druga")]);
    const before = canonicalizeJcs(input);
    const result = normalizeDocument(input);
    expect(paragraph(result)).toEqual([text("Prva"), cite(1, "str. 12"), text(" druga")]);
    expect(canonicalizeJcs(paragraph(result)[1])).toBe(canonicalizeJcs(cite(1, "str. 12")));
    expect(canonicalizeJcs(input)).toBe(before);
    valid(result);
  });

  it("drops empty text next to a citation and merges same-mark text only between two text runs", () => {
    const input = v2([text(""), cite(1), text(""), text("a"), text("b"), cite(1), text("", ["bold"])]);
    expect(paragraph(normalizeDocument(input))).toEqual([cite(1), text("ab"), cite(1)]);
  });

  it("keeps two citations in a row as two positions, in order", () => {
    const input = v2([cite(1), cite(2, "9-12"), cite(1)], [book(1), book(2)]);
    expect(paragraph(normalizeDocument(input))).toEqual([cite(1), cite(2, "9-12"), cite(1)]);
  });

  it("keeps an absent locator absent and a present one byte-equal", () => {
    const result = paragraph(normalizeDocument(v2([cite(1), cite(1, " "), cite(1, " ")])));
    expect(Object.hasOwn(result[0], "locator")).toBe(false);
    expect(result.map((child) => canonicalizeJcs(child))).toEqual(
      [cite(1), cite(1, " "), cite(1, " ")].map((child) => canonicalizeJcs(child)),
    );
  });

  it("keeps an orphan citation and carries the sources over byte-equal, as a copy", () => {
    const sources = [book(2), book(1, { title: "Izvor ž" })];
    const input = v2([text("x"), cite(9)], sources);
    const result = normalizeDocument(input);
    expect(paragraph(result)).toEqual([text("x"), cite(9)]);
    expect(canonicalizeJcs(result.sources)).toBe(canonicalizeJcs(sources));
    expect(result.sources).not.toBe(input.sources);
    expect(result.schemaVersion).toBe(2);
  });

  it("is idempotent and leaves the input unchanged", () => {
    const input = v2([text("a"), text("b", ["bold"]), text("c", ["bold"]), cite(1), text(""), cite(9, "str. 1")]);
    const before = canonicalizeJcs(input);
    const once = normalizeDocument(input);
    expect(canonicalizeJcs(normalizeDocument(once))).toBe(canonicalizeJcs(once));
    expect(canonicalizeJcs(input)).toBe(before);
  });

  it("restores an empty v2 document with one paragraph and keeps it v2 with its sources", () => {
    const input: CanonicalDocumentV2 = { schemaVersion: 2, nodes: [], sources: [book(1)] };
    const result = normalizeDocument(input, () => "0000000f-1111-4111-8111-111111111111");
    expect(result).toEqual({
      schemaVersion: 2,
      nodes: [{ type: "paragraph", id: "0000000f-1111-4111-8111-111111111111", children: [] }],
      sources: [book(1)],
    });
  });

  it("keeps a v1 document v1, without sources", () => {
    const input: CanonicalDocument = {
      schemaVersion: 1,
      nodes: [{ type: "paragraph", id: nid(1), children: [{ type: "text", text: "a", marks: [] }, { type: "text", text: "b", marks: [] }] }],
    };
    const result = normalizeDocument(input);
    expect(result).toEqual({ schemaVersion: 1, nodes: [{ type: "paragraph", id: nid(1), children: [{ type: "text", text: "ab", marks: [] }] }] });
    expect(Object.hasOwn(result, "sources")).toBe(false);
  });
});

describe("D3: citation equality inside a block", () => {
  const with_ = (child: InlineNodeV2) => v2([text("a"), child]);

  it("a citation equals only a citation with the same source and locator", () => {
    expect(contentEqual(with_(cite(1)), with_(cite(1)))).toBe(true);
    expect(documentsEqual(with_(cite(1, "str. 12")), with_(cite(1, "str. 12")))).toBe(true);
    expect(contentEqual(with_(cite(1)), with_(cite(2)))).toBe(false);
    expect(documentsEqual(with_(cite(1)), with_(cite(2)))).toBe(false);
  });

  it("an absent locator, an empty one and \"str. 12\" are three different citations", () => {
    const variants = [cite(1), cite(1, ""), cite(1, "str. 12")];
    for (const [i, a] of variants.entries()) {
      for (const [j, b] of variants.entries()) {
        expect(contentEqual(with_(a), with_(b))).toBe(i === j);
        expect(documentsEqual(with_(a), with_(b))).toBe(i === j);
      }
    }
  });

  it("a citation never equals text, in either order", () => {
    for (const other of [text(""), text("(Prezime, 2020)"), text(sid(1))]) {
      expect(contentEqual(with_(cite(1)), with_(other))).toBe(false);
      expect(contentEqual(with_(other), with_(cite(1)))).toBe(false);
      expect(documentsEqual(with_(other), with_(cite(1)))).toBe(false);
    }
  });
});

describe("D4: sources and versions in document equality", () => {
  const blocks = [text("Tekst "), cite(1)];
  const base = v2(blocks, [book(1), book(2)]);

  it("a source added, changed, deleted or moved with the same blocks is not equal", () => {
    const variants = [
      v2(blocks, [book(1), book(2), book(3)]),
      v2(blocks, [book(1), book(2, { year: 2021 })]),
      v2(blocks, [book(1)]),
      v2(blocks, [book(2), book(1)]),
    ];
    for (const other of variants) {
      expect(documentsEqual(base, other)).toBe(false);
      expect(contentEqual(base, other)).toBe(false);
      expect(contentEqual(other, base)).toBe(false);
    }
    expect(documentsEqual(base, v2(blocks, [book(1), book(2)]))).toBe(true);
  });

  it("v1 and v2 with the same nodes are never equal", () => {
    const nodes = [{ type: "paragraph" as const, id: nid(1), children: [{ type: "text" as const, text: "a", marks: [] }] }];
    const one: CanonicalDocument = { schemaVersion: 1, nodes };
    const two: CanonicalDocumentV2 = { schemaVersion: 2, nodes, sources: [] };
    expect(documentsEqual(one, two)).toBe(false);
    expect(documentsEqual(two, one)).toBe(false);
    expect(contentEqual(one, two)).toBe(false);
    expect(contentEqual(two, one)).toBe(false);
  });
});

describe("D5: textBlocksOf v2", () => {
  it("shows a citation in its in-text form and an orphan as the caller's mark", () => {
    const doc = valid(v2([text("Prema "), cite(1, "str. 12"), text(" i "), cite(9)]));
    expect(textBlocksOf(doc, rendering)).toEqual([
      { kind: "heading", text: "Uvod" },
      { kind: "paragraph", text: `Prema (Prezime, 2020: str. 12) i ${ORPHAN}` },
    ]);
  });

  it("shows blank locators as stored and does not throw", () => {
    const doc = valid(v2([cite(1, " "), cite(1, " "), cite(1, " ")]));
    const before = canonicalizeJcs(doc);
    expect(textBlocksOf(doc, rendering)[1].text).toBe("(Prezime, 2020:  )(Prezime, 2020:  )(Prezime, 2020:  )");
    expect(canonicalizeJcs(doc)).toBe(before);
  });

  it("gives v1 the same blocks as on main", () => {
    const doc: CanonicalDocument = {
      schemaVersion: 1,
      nodes: [
        { type: "heading", id: nid(0), level: 2, children: [{ type: "text", text: "Naslov", marks: ["bold"] }] },
        { type: "bulletItem", id: nid(1), children: [{ type: "text", text: "a", marks: [] }, { type: "text", text: "b", marks: ["italic"] }] },
      ],
    };
    expect(textBlocksOf(doc)).toEqual([
      { kind: "heading", text: "Naslov" },
      { kind: "paragraph", text: "ab" },
    ]);
  });
});

describe("D6: deriveChapters v2", () => {
  it("gives the same chapters with a citation or an orphan in a paragraph as without it", () => {
    const plain = deriveChapters(valid(v2([text("Tekst")])));
    expect(deriveChapters(valid(v2([text("Tekst"), cite(1, "str. 12")])))).toEqual(plain);
    expect(deriveChapters(valid(v2([cite(9)])))).toEqual(plain);
    expect(plain.chapters.map((chapter) => chapter.title)).toEqual(["Uvod"]);
    expect(plain.chapters[0].ownBlockIds).toEqual([nid(1)]);
  });
});

/** The word count of conflict.ts and recovery.ts on main, kept to compare v1. */
function mainWordCount(doc: CanonicalDocument): number {
  let total = 0;
  for (const node of doc.nodes) {
    for (const word of node.children.map((child) => child.text).join("").split(/\s+/u)) {
      if (word.length > 0) total += 1;
    }
  }
  return total;
}

describe("D7: documentWordCount", () => {
  it("counts a citation as no word but as a boundary between words", () => {
    expect(documentWordCount(valid(v2([text("Prva"), cite(1), text(" riječ")])))).toBe(1 + 2);
    expect(documentWordCount(valid(v2([text("Prva"), cite(1), text("riječ")])))).toBe(1 + 2);
    expect(documentWordCount(valid(v2([text("a"), cite(1), cite(9), text("b c")])))).toBe(1 + 3);
    expect(documentWordCount(valid(v2([cite(1)])))).toBe(1);
    expect(documentWordCount(valid(v2([cite(9, "str. 12")])))).toBe(1);
    expect(documentWordCount(valid(v2([cite(1), cite(9)], [book(1)], "Dva naslova")))).toBe(2);
  });

  it.each<[string, InlineNodeV2[], number]>([
    ["at the start", [cite(1), text("prva druga")], 2],
    ["in the middle", [text("prva"), cite(1), text("druga")], 2],
    ["at the end", [text("prva druga"), cite(1)], 2],
    ["two in a row", [text("prva"), cite(1), cite(9, "str. 12"), text("druga")], 2],
    ["two in a row at the start", [cite(1), cite(9), text("prva")], 1],
    ["two in a row at the end", [text("prva"), cite(1), cite(9)], 1],
    ["at the start, in the middle and at the end", [cite(1), text("prva"), cite(9), text("druga"), cite(1)], 2],
  ])("keeps the words around a citation %s apart and adds none", (_, children, words) => {
    expect(documentWordCount(valid(v2(children, [book(1)])))).toBe(1 + words);
  });

  it("gives v1 the same count as on main", () => {
    const docs: CanonicalDocument[] = [
      { schemaVersion: 1, nodes: [{ type: "paragraph", id: nid(1), children: [] }] },
      {
        schemaVersion: 1,
        nodes: [
          { type: "heading", id: nid(0), level: 1, children: [{ type: "text", text: "Jedan dva", marks: [] }] },
          { type: "paragraph", id: nid(1), children: [{ type: "text", text: " tri četiri\n", marks: [] }, { type: "text", text: "pet", marks: ["bold"] }] },
          { type: "quote", id: nid(2), children: [{ type: "text", text: " šest  ", marks: [] }] },
        ],
      },
    ];
    for (const doc of docs) expect(documentWordCount(doc)).toBe(mainWordCount(doc));
    expect(documentWordCount(docs[1])).toBe(6);
  });
});
