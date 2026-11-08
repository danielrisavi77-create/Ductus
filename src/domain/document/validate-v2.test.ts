import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { canonicalizeJcs } from "../forensics/jcs";
import { SOURCE_TEXT_FIELD_MAX } from "./schema";
import { MAX_DOCUMENT_SNAPSHOT_BYTES, verifyDocumentSnapshot } from "./snapshot";
import { validateDocument, validateVersionedDocument } from "./validate";

/**
 * Document v2 validator, docs/contracts/document-schema-v2.md §10 classes 14
 * to 24, 29 and 30 (DAN-619 PR a). Synthetic data only.
 */

const SRC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SRC_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const P = "11111111-1111-4111-8111-111111111111";
const H = "22222222-2222-4222-8222-222222222222";

const person = (over: object = {}) => ({ kind: "person", family: "Prezime", given: "Ime", ...over });
const org = (over: object = {}) => ({ kind: "organization", name: "Ustanova", ...over });
const base = (over: object = {}) => ({ id: SRC, authors: [person()], year: 2020, title: "Izvor 1", ...over });
const book = (over: object = {}) => base({ type: "book", place: "Zagreb", publisher: "Nakladnik", ...over });
const article = (over: object = {}) => base({ type: "article", journal: "Časopis", ...over });
const chapter = (over: object = {}) =>
  base({ type: "chapter", editors: [person()], bookTitle: "Zbornik", place: "Zagreb", publisher: "Nakladnik", ...over });
const web = (over: object = {}) =>
  base({ type: "web", url: "https://primjer.hr/izvor", accessed: "2026-01-05", ...over });

const cite = (over: object = {}) => ({ type: "citation", sourceId: SRC, ...over });
const text = (value: string, marks: string[] = []) => ({ type: "text", text: value, marks });
const paragraph = (children: unknown[]) => ({ type: "paragraph", id: P, children });
const doc = (sources: unknown, children: unknown[] = [cite()]) => ({
  schemaVersion: 2,
  nodes: [paragraph(children)],
  sources,
});

type Err = [string, string];

/** A shallow copy of `value` without `key`. */
function without(value: object, key: string): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...value };
  delete copy[key];
  return copy;
}

function errs(input: unknown): Err[] {
  const outcome = validateVersionedDocument(input);
  return outcome.ok ? [] : outcome.errors.map((error) => [error.path, error.code]);
}

/** Accepted, version kept, and the copy is byte-identical in JCS. */
function expectAccepted(input: unknown): void {
  const outcome = validateVersionedDocument(input);
  expect(outcome.ok ? [] : outcome.errors).toEqual([]);
  if (!outcome.ok) return;
  expect(outcome.doc).not.toBe(input);
  expect(canonicalizeJcs(outcome.doc)).toBe(canonicalizeJcs(input));
}

/** Unique v4 ids for a long `sources` list. */
const sourceId = (i: number) => `${i.toString(16).padStart(8, "0")}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
const many = (count: number) => Array.from({ length: count }, (_, i) => book({ id: sourceId(i) }));

describe("shared rules through the versioned validator (#1711 classes 1 to 13)", () => {
  const plain = (schemaVersion: unknown) => ({ schemaVersion, nodes: [paragraph([text("a")])] });

  it("accepts v1, v2 without citations and v2 with citations", () => {
    expectAccepted(plain(1));
    expectAccepted(doc([], [text("a")]));
    expectAccepted(doc([book()]));
  });

  it.each([3, 0, -1, 2.5, "2", true, null, [], {}, Number.MAX_SAFE_INTEGER + 1])(
    "refuses schemaVersion %j",
    (version) => {
      expect(errs(plain(version))).toEqual([["$.schemaVersion", "SCHEMA_VERSION_INVALID"]]);
    },
  );

  it("refuses an absent schemaVersion and a document that is not an object", () => {
    expect(errs({ nodes: [paragraph([text("a")])] })).toEqual([["$.schemaVersion", "SCHEMA_VERSION_INVALID"]]);
    for (const value of [null, [], "{}", 2, undefined]) expect(errs(value)).toEqual([["$", "DOCUMENT_NOT_OBJECT"]]);
  });

  it("applies the v1 node rules to v2", () => {
    expect(errs({ ...doc([]), nodes: [{ ...paragraph([]), type: "table" }] })).toEqual([
      ["$.nodes[0].type", "NODE_TYPE_INVALID"],
    ]);
    expect(errs(doc([], [{ type: "mention", text: "a" }]))).toEqual([["$.nodes[0].children[0].type", "INLINE_TYPE_INVALID"]]);
    expect(errs({ ...doc([]), nodes: [{ ...paragraph([]), extra: 1 }] })).toEqual([["$.nodes[0].extra", "UNKNOWN_FIELD"]]);
    expect(errs({ ...doc([]), nodes: [paragraph([]), paragraph([])] })).toEqual([["$.nodes[1].id", "NODE_ID_DUPLICATE"]]);
  });
});

describe("snapshot path stays v1 until the v2 sync path exists", () => {
  const encode = (value: unknown) => new TextEncoder().encode(canonicalizeJcs(value));
  /** A v2 document with sources whose JCS is exactly `size` bytes. */
  function v2OfSize(size: number) {
    const shell = doc([book()], [cite(), text("")]);
    const pad = size - encode(shell).byteLength;
    return doc([book()], [cite(), text("x".repeat(pad))]);
  }

  it("refuses a valid v2 snapshot as invalid up to 2 MiB and as too large above it", async () => {
    const atLimit = v2OfSize(MAX_DOCUMENT_SNAPSHOT_BYTES);
    expect(encode(atLimit).byteLength).toBe(MAX_DOCUMENT_SNAPSHOT_BYTES);
    expect(validateVersionedDocument(atLimit).ok).toBe(true);
    await expect(verifyDocumentSnapshot(encode(atLimit))).resolves.toEqual({ ok: false, reason: "invalid" });
    const over = encode(v2OfSize(MAX_DOCUMENT_SNAPSHOT_BYTES + 1));
    expect(over.byteLength).toBe(MAX_DOCUMENT_SNAPSHOT_BYTES + 1);
    await expect(verifyDocumentSnapshot(over)).resolves.toEqual({ ok: false, reason: "too_large" });
  });

  it("refuses a v2 snapshot with a BOM or a duplicate key", async () => {
    const jcs = canonicalizeJcs(doc([book()]));
    expect(jcs.startsWith('{"nodes"')).toBe(true);
    const withBom = new TextEncoder().encode(`\ufeff${jcs}`);
    const duplicate = new TextEncoder().encode(jcs.replace('{"nodes"', '{"schemaVersion":2,"nodes"'));
    for (const bytes of [withBom, duplicate]) {
      await expect(verifyDocumentSnapshot(bytes)).resolves.toEqual({ ok: false, reason: "invalid" });
    }
  });
});

describe("v2 top level (class 14, 15)", () => {
  it("accepts a document with every source type and a citation", () => {
    expectAccepted(
      doc(
        [
          book(),
          article({ id: SRC_B, volume: "3", issue: "2", pages: "1-20" }),
          chapter({ id: sourceId(1), pages: "5-9" }),
          web({ id: sourceId(2) }),
        ],
        [text("Kako tvrdi "), cite({ locator: "str. 12" }), text(" dalje.")],
      ),
    );
  });

  it("refuses v2 without `sources` or with a non-array `sources`", () => {
    const withoutSources = without(doc([]), "sources");
    expect(errs(withoutSources)).toEqual([["$.sources", "SOURCES_NOT_ARRAY"]]);
    for (const value of [null, {}, "[]", 0, { length: 0 }]) {
      expect(errs(doc(value))).toEqual([["$.sources", "SOURCES_NOT_ARRAY"]]);
    }
  });

  it("refuses `sources` in a v1 document as an unknown field", () => {
    const v1 = { schemaVersion: 1, nodes: [paragraph([])], sources: [] };
    expect(errs(v1)).toEqual([["$.sources", "UNKNOWN_FIELD"]]);
  });

  it("refuses any other top-level key of v2", () => {
    expect(errs({ ...doc([]), meta: {} })).toEqual([["$.meta", "UNKNOWN_FIELD"]]);
  });

  it("accepts 0, 1 and 500 sources and refuses 501", () => {
    expectAccepted(doc([], [text("a")]));
    expectAccepted(doc([book()]));
    expectAccepted(doc(many(500)));
    expect(errs(doc(many(501)))).toEqual([["$.sources", "SOURCES_TOO_MANY"]]);
  });

  it("keeps the order of `sources`: it is hashed, never sorted", () => {
    const input = doc([book({ id: SRC_B, title: "Izvor 2" }), book()]);
    const outcome = validateVersionedDocument(input);
    expect(outcome.ok && outcome.doc.schemaVersion === 2 && outcome.doc.sources.map((s) => s.id)).toEqual([
      SRC_B,
      SRC,
    ]);
  });

  it("refuses a hole or a non-object in `sources`", () => {
    const sparse: unknown[] = [book()];
    sparse.length = 2;
    expect(errs(doc(sparse))).toEqual([["$.sources[1]", "SOURCE_NOT_OBJECT"]]);
    for (const value of [null, [], "x", 1]) {
      expect(errs(doc([value]))).toEqual([["$.sources[0]", "SOURCE_NOT_OBJECT"]]);
    }
  });
});

describe("source id (class 16)", () => {
  it.each([
    ["uppercase", SRC.toUpperCase()],
    ["nil", "00000000-0000-0000-0000-000000000000"],
    ["version 1", "aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa"],
    ["bad variant", "aaaaaaaa-aaaa-4aaa-caaa-aaaaaaaaaaaa"],
    ["not a string", 7],
  ])("refuses an id that is %s", (_name, id) => {
    expect(errs(doc([book({ id })], [text("a")]))).toEqual([["$.sources[0].id", "SOURCE_ID_INVALID"]]);
  });

  it("refuses a duplicate id at the second record", () => {
    expect(errs(doc([book(), web()]))).toEqual([["$.sources[1].id", "SOURCE_ID_DUPLICATE"]]);
  });

  it("refuses a citation whose sourceId is not a lowercase v4 UUID", () => {
    expect(errs(doc([book()], [cite({ sourceId: SRC.toUpperCase() })]))).toEqual([
      ["$.nodes[0].children[0].sourceId", "CITATION_SOURCE_ID_INVALID"],
    ]);
    const noSource = without(cite(), "sourceId");
    expect(errs(doc([book()], [noSource]))).toEqual([
      ["$.nodes[0].children[0].sourceId", "CITATION_SOURCE_ID_INVALID"],
    ]);
  });
});

describe("source type and field set (class 17)", () => {
  it("refuses an unknown type without reporting its fields", () => {
    expect(errs(doc([book({ type: "thesis" })]))).toEqual([["$.sources[0].type", "SOURCE_TYPE_INVALID"]]);
    expect(errs(doc([book({ type: 3 })]))).toEqual([["$.sources[0].type", "SOURCE_TYPE_INVALID"]]);
  });

  it.each([
    ["a field of another type", book({ url: "https://primjer.hr" }), "url"],
    ["a note", article({ note: "x" }), "note"],
    ["a year suffix", web({ yearSuffix: "a" }), "yearSuffix"],
    ["pages on a book", book({ pages: "1" }), "pages"],
  ])("refuses %s as an unknown field", (_name, source, field) => {
    expect(errs(doc([source]))).toEqual([[`$.sources[0].${field}`, "UNKNOWN_FIELD"]]);
  });

  it("refuses `__proto__` from JSON on a source and on a citation", () => {
    const source = JSON.parse(`{"__proto__":{},${JSON.stringify(book()).slice(1)}`);
    expect(errs(doc([source]))).toEqual([["$.sources[0].__proto__", "UNKNOWN_FIELD"]]);
    const citation = JSON.parse(`{"__proto__":{"locator":"x"},"type":"citation","sourceId":"${SRC}"}`);
    expect(errs(doc([book()], [citation]))).toEqual([["$.nodes[0].children[0].__proto__", "UNKNOWN_FIELD"]]);
  });
});

describe("year and accessed date (class 18)", () => {
  it.each([999, 10000, 2020.5, "2020", -2020, null])("refuses year %s", (year) => {
    expect(errs(doc([book({ year })]))).toEqual([["$.sources[0].year", "SOURCE_YEAR_INVALID"]]);
  });

  it("accepts the years 1000 and 9999", () => {
    expectAccepted(doc([book({ year: 1000 })]));
    expectAccepted(doc([book({ year: 9999 })]));
  });

  it.each(["2026-02-30", "2026-1-5", " 2026-01-05", "2026-01-05 ", "2026-13-01", "05.01.2026.", 20260105])(
    "refuses accessed %s",
    (accessed) => {
      expect(errs(doc([web({ accessed })]))).toEqual([["$.sources[0].accessed", "SOURCE_ACCESSED_INVALID"]]);
    },
  );

  it("accepts a leap day", () => {
    expectAccepted(doc([web({ accessed: "2024-02-29" })]));
  });
});

describe("authors and editors (class 19, 30)", () => {
  it("accepts 1 and 50 authors, persons and organizations", () => {
    expectAccepted(doc([book({ authors: [org(), org({ acronym: "UST" }), person()] })]));
    expectAccepted(doc([book({ authors: Array.from({ length: 50 }, () => person()) })]));
  });

  it("refuses 0 and 51 authors or a non-array", () => {
    for (const authors of [[], Array.from({ length: 51 }, () => person()), person(), null]) {
      expect(errs(doc([book({ authors })]))).toEqual([["$.sources[0].authors", "AUTHORS_INVALID"]]);
    }
  });

  it("refuses the shape of an author at its exact path", () => {
    const noGiven = without(person(), "given");
    expect(errs(doc([book({ authors: [noGiven] })]))).toEqual([
      ["$.sources[0].authors[0].given", "AUTHOR_INVALID"],
    ]);
    expect(errs(doc([book({ authors: [person(), "Ime Prezime"] })]))).toEqual([
      ["$.sources[0].authors[1]", "AUTHOR_INVALID"],
    ]);
    expect(errs(doc([book({ authors: [person({ kind: "group" })] })]))).toEqual([
      ["$.sources[0].authors[0].kind", "AUTHOR_INVALID"],
    ]);
    expect(errs(doc([book({ authors: [person({ name: "Ustanova" })] })]))).toEqual([
      ["$.sources[0].authors[0].name", "AUTHOR_INVALID"],
    ]);
    expect(errs(doc([book({ authors: [org({ given: "Ime" })] })]))).toEqual([
      ["$.sources[0].authors[0].given", "AUTHOR_INVALID"],
    ]);
  });

  it("accepts 1 and 20 editors and refuses 0 and 21", () => {
    expectAccepted(doc([chapter()]));
    expectAccepted(doc([chapter({ editors: Array.from({ length: 20 }, () => person()) })]));
    for (const editors of [[], Array.from({ length: 21 }, () => person()), "Urednik"]) {
      expect(errs(doc([chapter({ editors })]))).toEqual([["$.sources[0].editors", "EDITORS_INVALID"]]);
    }
  });

  it("refuses an organization as an editor at its index", () => {
    expect(errs(doc([chapter({ editors: [person(), org()] })]))).toEqual([
      ["$.sources[0].editors[1]", "EDITORS_INVALID"],
    ]);
  });
});

/** Puts `value` in text field `field` and returns the document and the path. */
function placeField(field: keyof typeof SOURCE_TEXT_FIELD_MAX, value: unknown): [unknown, string] {
  switch (field) {
    case "family":
    case "given":
      return [doc([book({ authors: [person({ [field]: value })] })]), `$.sources[0].authors[0].${field}`];
    case "name":
    case "acronym":
      return [doc([book({ authors: [org({ [field]: value })] })]), `$.sources[0].authors[0].${field}`];
    case "bookTitle":
      return [doc([chapter({ [field]: value })]), `$.sources[0].${field}`];
    case "place":
    case "publisher":
      return [doc([book({ [field]: value })]), `$.sources[0].${field}`];
    default:
      return [doc([article({ [field]: value })]), `$.sources[0].${field}`];
  }
}

describe("text fields (class 20)", () => {
  const fields = Object.keys(SOURCE_TEXT_FIELD_MAX) as (keyof typeof SOURCE_TEXT_FIELD_MAX)[];

  it.each(fields)("%s: accepts N code points, astral counted as one, and refuses N+1", (field) => {
    const max = SOURCE_TEXT_FIELD_MAX[field];
    expectAccepted(placeField(field, "a".repeat(max))[0]);
    expectAccepted(placeField(field, "\u{1D400}".repeat(max))[0]);
    const [tooLong, path] = placeField(field, "a".repeat(max + 1));
    expect(errs(tooLong)).toEqual([[path, "SOURCE_FIELD_INVALID"]]);
  });

  it.each(fields)("%s: refuses empty, edge white space, FORBIDDEN and a non-string", (field) => {
    for (const value of ["", " Izvor", "Izvor ", " Izvor", "Izvor　", "Iz​vor", "Iz\ud800vor", 1]) {
      const [input, path] = placeField(field, value);
      expect(errs(input)).toEqual([[path, "SOURCE_FIELD_INVALID"]]);
    }
  });

  it("accepts inner white space and U+2028 inside a field", () => {
    expectAccepted(doc([book({ title: "Izvor  1 dio" })]));
  });
});

describe("url (class 21)", () => {
  const prefix = "https://primjer.hr/";

  it.each(["ftp://primjer.hr", "https://primjer.hr/a b", "https://primjer.hr/č", "primjer.hr", "HTTPS://primjer.hr", 1])(
    "refuses url %s",
    (url) => {
      expect(errs(doc([web({ url })]))).toEqual([["$.sources[0].url", "SOURCE_URL_INVALID"]]);
    },
  );

  it("accepts 2048 characters and refuses 2049", () => {
    expectAccepted(doc([web({ url: prefix + "a".repeat(2048 - prefix.length) })]));
    expect(errs(doc([web({ url: prefix + "a".repeat(2049 - prefix.length) })]))).toEqual([
      ["$.sources[0].url", "SOURCE_URL_INVALID"],
    ]);
  });

  it("accepts http as well as https", () => {
    expectAccepted(doc([web({ url: "http://primjer.hr/izvor?a=1&b=2#c" })]));
  });
});

describe("citation locator (class 22)", () => {
  const at = "$.nodes[0].children[0].locator";

  it("keeps an absent locator absent", () => {
    const outcome = validateVersionedDocument(doc([book()]));
    expect(outcome.ok && outcome.doc.nodes[0]).toEqual(paragraph([{ type: "citation", sourceId: SRC }]));
  });

  it.each([
    ["one code point", "1"],
    ["100 code points", "a".repeat(100)],
    ["100 astral characters", "\u{1F600}".repeat(100)],
    ["a single space", " "],
    ["edge spaces", " str. 12 "],
    ["U+2028 and U+2029", "a b c"],
  ])("accepts %s", (_name, locator) => {
    expectAccepted(doc([book()], [cite({ locator })]));
  });

  it.each([
    ["empty", ""],
    ["101 code points", "a".repeat(101)],
    ["101 astral characters", "\u{1F600}".repeat(101)],
    ["a lone high surrogate", "a\ud800"],
    ["a lone low surrogate", "\udc00a"],
    ["a number", 12],
    ["null", null],
  ])("refuses %s", (_name, locator) => {
    expect(errs(doc([book()], [cite({ locator })]))).toEqual([[at, "CITATION_LOCATOR_INVALID"]]);
  });

  const forbiddenEdges = [
    0x0000, 0x001f, 0x007f, 0x009f, 0x00ad, 0x061c, 0x180e, 0x200b, 0x200f, 0x202a, 0x202e, 0x2060, 0x2064,
    0x2066, 0x206f, 0xfeff,
  ];
  it.each(forbiddenEdges)("refuses FORBIDDEN U+%s", (codePoint) => {
    const locator = `str.${String.fromCodePoint(codePoint)}12`;
    expect(errs(doc([book()], [cite({ locator })]))).toEqual([[at, "CITATION_LOCATOR_INVALID"]]);
  });
});

describe("citation shape and place (class 23)", () => {
  it.each([
    ["marks", { marks: [] }],
    ["id", { id: P }],
    ["text", { text: "x" }],
  ])("refuses a citation with `%s`", (field, extra) => {
    expect(errs(doc([book()], [cite(extra)]))).toEqual([[`$.nodes[0].children[0].${field}`, "UNKNOWN_FIELD"]]);
  });

  it("refuses a citation in a heading", () => {
    const input = { schemaVersion: 2, nodes: [{ type: "heading", id: H, level: 1, children: [cite()] }], sources: [] };
    expect(errs(input)).toEqual([["$.nodes[0].children[0]", "CITATION_NOT_ALLOWED"]]);
  });

  it("accepts a citation in a bullet item and a quote", () => {
    expectAccepted({
      schemaVersion: 2,
      nodes: [
        { type: "bulletItem", id: P, children: [cite()] },
        { type: "quote", id: H, children: [text("a"), cite()] },
      ],
      sources: [book()],
    });
  });

  it("refuses a citation in a v1 document as an unknown inline type", () => {
    const input = { schemaVersion: 1, nodes: [paragraph([cite()])] };
    expect(errs(input)).toEqual([["$.nodes[0].children[0].type", "INLINE_TYPE_INVALID"]]);
  });

  it("validateDocument reads a v2 document as v1 and refuses it", () => {
    const outcome = validateDocument(doc([book()]));
    expect(outcome.ok ? [] : outcome.errors.map((e) => [e.path, e.code])).toEqual([
      ["$.sources", "UNKNOWN_FIELD"],
      ["$.schemaVersion", "SCHEMA_VERSION_INVALID"],
      ["$.nodes[0].children[0].type", "INLINE_TYPE_INVALID"],
    ]);
  });
});

describe("accepted shapes (class 24)", () => {
  it("accepts an orphan citation, a source without a citation and two citations in a row", () => {
    expectAccepted(doc([], [cite({ sourceId: SRC_B })]));
    expectAccepted(doc([book()], [text("bez citata")]));
    expectAccepted(doc([book()], [cite(), cite({ locator: "str. 12" })]));
  });

  it("does not treat text runs around a citation as adjacent", () => {
    expectAccepted(doc([book()], [text("a"), cite(), text("b")]));
    expectAccepted(doc([book()], [text("a", ["bold"]), cite(), text("b", ["bold"])]));
    expect(errs(doc([book()], [text("a"), text("b"), cite()]))).toEqual([
      ["$.nodes[0].children[1]", "ADJACENT_TEXT_SAME_MARKS"],
    ]);
  });

  it("an invalid citation still separates the runs on either side", () => {
    expect(errs(doc([book()], [text("a"), cite({ locator: "" }), text("b")]))).toEqual([
      ["$.nodes[0].children[1].locator", "CITATION_LOCATOR_INVALID"],
    ]);
  });
});

describe("required fields (class 29)", () => {
  const cases: [string, () => Record<string, unknown>, string[]][] = [
    ["book", book, ["id", "authors", "year", "title", "place", "publisher"]],
    ["article", article, ["id", "authors", "year", "title", "journal"]],
    ["chapter", chapter, ["id", "authors", "year", "title", "editors", "bookTitle", "place", "publisher"]],
    ["web", web, ["id", "authors", "year", "title", "url", "accessed"]],
  ];

  for (const [type, make, required] of cases) {
    it.each(required)(`${type}: refuses a record without %s`, (field) => {
      const source = make();
      delete source[field];
      expect(errs(doc([source], [text("a")]))).toEqual([[`$.sources[0].${field}`, "SOURCE_FIELD_MISSING"]]);
    });
  }

  it("refuses a record without a type, checking only the common fields", () => {
    const noType = without(book(), "type");
    expect(errs(doc([noType]))).toEqual([["$.sources[0].type", "SOURCE_FIELD_MISSING"]]);
  });

  it("accepts an article without its optional fields", () => {
    expectAccepted(doc([article()]));
  });
});

describe("K4: the version is part of the hash", () => {
  it("a v2 document hashes differently from a v1 document with the same nodes", () => {
    const nodes = [paragraph([text("Isti sadržaj")])];
    const v1 = validateVersionedDocument({ schemaVersion: 1, nodes });
    const v2 = validateVersionedDocument({ schemaVersion: 2, nodes, sources: [] });
    expect(v1.ok && v2.ok).toBe(true);
    if (!v1.ok || !v2.ok) return;
    expect(v1.doc.schemaVersion).toBe(1);
    expect(v2.doc.schemaVersion).toBe(2);
    const sha = (value: unknown) => createHash("sha256").update(canonicalizeJcs(value), "utf8").digest("hex");
    expect(sha(v1.doc)).not.toBe(sha(v2.doc));
  });
});
