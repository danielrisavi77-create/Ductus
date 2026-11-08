import { fc, test } from "@fast-check/vitest";
import { describe, expect } from "vitest";

import fpzgConfig from "../../../config/faculties/fpzg/citation.json";
import { parseCitationStyle } from "../citation";
import { canonicalizeJcs } from "../forensics/jcs";
import { deriveChapters } from "./chapters";
import { contentEqual, documentsEqual } from "./equality";
import { normalizeDocument } from "./normalize";
import type { CanonicalDocumentV2, InlineNodeV2 } from "./schema";
import { textBlocksOf } from "./text-blocks";
import { validateVersionedDocument } from "./validate";
import { documentWordCount } from "./word-count";

/**
 * Properties P1 to P3 of DAN-619 (d1), contract
 * docs/contracts/document-schema-v2.md §9.1, over generated v2 documents the
 * validator accepts (the generator of validate-v2.property.test.ts) and over
 * raw blocks with empty and unmerged text. Generated content only.
 */

const style = parseCitationStyle(fpzgConfig);
const rendering = { style, orphanMark: "[?]" };

const nodeId = (i: number) => `${i.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`;
const sourceId = (i: number) => `${i.toString(16).padStart(8, "0")}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;

const unit = fc.constantFrom("a", "Z", "1", "č", "Ž", "-", " ", " ", "\u{1F600}", "́");
const field = fc.string({ unit, maxLength: 8 }).map((inner) => `x${inner}y`);
const locator = fc.string({ unit, minLength: 1, maxLength: 12 });

const person = fc.record({ kind: fc.constant("person"), family: field, given: field });
const organization = fc.record(
  { kind: fc.constant("organization"), name: field, acronym: field },
  { requiredKeys: ["kind", "name"] },
);
const authors = fc.array(fc.oneof(person, organization), { minLength: 1, maxLength: 3 });
const year = fc.integer({ min: 1000, max: 9999 });
const source = fc.oneof(
  fc.record({ type: fc.constant("book"), authors, year, title: field, place: field, publisher: field }),
  fc.record(
    { type: fc.constant("article"), authors, year, title: field, journal: field, volume: field, issue: field, pages: field },
    { requiredKeys: ["type", "authors", "year", "title", "journal"] },
  ),
  fc.record({
    type: fc.constant("web"),
    authors,
    year,
    title: field,
    url: fc.constantFrom("https://primjer.example/a", "http://primjer.example/?q=1#x"),
    accessed: fc.constantFrom("2026-01-05", "2024-02-29", "1999-12-31"),
  }),
);
const sourcesOf = (min: number) =>
  fc
    .array(source, { minLength: min, maxLength: 4 })
    .map((list) => list.map((record, i) => ({ id: sourceId(i), ...record })));

const MARKS = [[], ["bold"], ["italic"], ["bold", "italic"]] as const;
const textRun = (value: fc.Arbitrary<string>) =>
  fc.tuple(value, fc.nat(3)).map(([t, m]) => ({ type: "text", text: t, marks: [...MARKS[m]] }));
/** Sources 0 to 5: some cited, some orphans, as a document may hold. */
const citation = fc.record(
  { type: fc.constant("citation"), sourceId: fc.nat(5).map(sourceId), locator },
  { requiredKeys: ["type", "sourceId"] },
);

type Child = { type: string; text?: string; marks?: string[] };
function merge(children: Child[]): Child[] {
  const out: Child[] = [];
  for (const child of children) {
    const last = out.at(-1);
    if (child.type === "text" && last?.type === "text" && last.marks!.join() === child.marks!.join()) {
      last.text += child.text!;
    } else {
      out.push({ ...child });
    }
  }
  return out;
}

/** `raw`: empty text and unmerged same-mark runs, as normalize may receive them. */
const block = (raw: boolean) => {
  const run = textRun(raw ? fc.oneof(fc.constant(""), field) : field);
  const list = (children: fc.Arbitrary<Child>, max: number) =>
    fc.array(children, { maxLength: max }).map((items) => (raw ? items : merge(items)));
  return fc.oneof(
    fc.record({ type: fc.constantFrom("paragraph", "bulletItem", "quote"), children: list(fc.oneof(run, citation), 6) }),
    fc.record({ type: fc.constant("heading"), level: fc.integer({ min: 1, max: 3 }), children: list(run, 4) }),
  );
};
const nodes = (raw: boolean) =>
  fc
    .array(block(raw), { minLength: 1, maxLength: 4 })
    .map((list) => list.map((node, i) => ({ ...node, id: nodeId(i) })));

const docOf = (raw: boolean, minSources = 0) =>
  fc
    .record({ schemaVersion: fc.constant(2 as const), nodes: nodes(raw), sources: sourcesOf(minSources) })
    .map((doc) => doc as unknown as CanonicalDocumentV2);

/** A generated v2 document the validator accepts. */
const v2Doc = (minSources = 0) =>
  docOf(false, minSources).filter((doc) => validateVersionedDocument(doc).ok);
const rawDoc = docOf(true);

const citationsOf = (doc: CanonicalDocumentV2) =>
  doc.nodes.flatMap((node) => (node.children as readonly InlineNodeV2[]).filter((child) => child.type === "citation"));

describe("P1: the v2 consumers are total and pure", () => {
  test.prop([v2Doc(), v2Doc()])("no exception and no mutation of any input", (a, b) => {
    const before = [canonicalizeJcs(a), canonicalizeJcs(b)];
    normalizeDocument(a);
    documentsEqual(a, b);
    contentEqual(a, b);
    textBlocksOf(a, rendering);
    deriveChapters(a);
    documentWordCount(a);
    expect([canonicalizeJcs(a), canonicalizeJcs(b)]).toEqual(before);
  });

  test.prop([rawDoc])("normalize does not throw or mutate on raw blocks", (doc) => {
    const before = canonicalizeJcs(doc);
    normalizeDocument(doc);
    expect(canonicalizeJcs(doc)).toBe(before);
  });
});

describe("P2: normalize v2 keeps citations and sources", () => {
  test.prop([fc.oneof(rawDoc, v2Doc())])("idempotent; citation sequence and sources byte-equal", (doc) => {
    const once = normalizeDocument(doc);
    expect(canonicalizeJcs(normalizeDocument(once))).toBe(canonicalizeJcs(once));
    expect(citationsOf(once).map((c) => canonicalizeJcs(c))).toEqual(citationsOf(doc).map((c) => canonicalizeJcs(c)));
    expect(canonicalizeJcs(once.sources)).toBe(canonicalizeJcs(doc.sources));
    expect(validateVersionedDocument(once)).toMatchObject({ ok: true });
  });

  test.prop([v2Doc()])("a valid document is already normal", (doc) => {
    const once = normalizeDocument(doc);
    expect(contentEqual(doc, once)).toBe(true);
    expect(documentsEqual(doc, once)).toBe(true);
    expect(canonicalizeJcs(once)).toBe(canonicalizeJcs(doc));
  });
});

describe("P3: the sources are part of the document", () => {
  const changed = fc.tuple(v2Doc(2), source, fc.nat(), fc.nat(2)).map(([doc, extra, pick, kind]) => {
    const list = structuredClone(doc.sources) as unknown[];
    const i = pick % list.length;
    if (kind === 0) list.push({ id: sourceId(99), ...extra });
    else if (kind === 1) list.splice(i, 1);
    else [list[i], list[(i + 1) % list.length]] = [list[(i + 1) % list.length], list[i]];
    return [doc, { ...doc, sources: list } as CanonicalDocumentV2] as const;
  });

  test.prop([changed])("added, deleted or swapped sources with the same blocks are not equal", ([doc, other]) => {
    for (const [a, b] of [[doc, other], [other, doc]]) {
      expect(documentsEqual(a, b)).toBe(false);
      expect(contentEqual(a, b)).toBe(false);
    }
    expect(documentsEqual(doc, structuredClone(doc))).toBe(true);
  });
});
