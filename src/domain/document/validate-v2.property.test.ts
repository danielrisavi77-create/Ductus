import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";

import { canonicalizeJcs } from "../forensics/jcs";
import { VALIDATION_ERROR_CODES, validateVersionedDocument } from "./validate";

/**
 * Properties of the versioned validator from the #1711 plan (DAN-619 PR a):
 * (a) total, (b) an accepted document returns to byte-identical JCS, (c) an
 * accepted v1 stays v1, (d) the input is never mutated; G4 many citations.
 * Generated content only.
 */

const nodeId = (i: number) => `${i.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`;
const sourceId = (i: number) => `${i.toString(16).padStart(8, "0")}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;

const unit = fc.constantFrom("a", "Z", "1", "č", "Ž", "-", " ", " ", "\u{1F600}", "́");
/** A source text field: no edge white space, nothing FORBIDDEN. */
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
  fc.record(
    {
      type: fc.constant("chapter"),
      authors,
      year,
      title: field,
      editors: fc.array(person, { minLength: 1, maxLength: 2 }),
      bookTitle: field,
      place: field,
      publisher: field,
      pages: field,
    },
    { requiredKeys: ["type", "authors", "year", "title", "editors", "bookTitle", "place", "publisher"] },
  ),
  fc.record({
    type: fc.constant("web"),
    authors,
    year,
    title: field,
    url: fc.constantFrom("https://primjer.hr/a", "http://primjer.hr/?q=1#x"),
    accessed: fc.constantFrom("2026-01-05", "2024-02-29", "1999-12-31"),
  }),
);
const sources = fc
  .array(source, { maxLength: 4 })
  .map((list) => list.map((record, i) => ({ id: sourceId(i), ...record })));

const MARKS = [[], ["bold"], ["italic"], ["bold", "italic"]] as const;
const textRun = fc.tuple(field, fc.nat(3)).map(([t, m]) => ({ type: "text", text: t, marks: [...MARKS[m]] }));
const citation = fc.record(
  { type: fc.constant("citation"), sourceId: fc.nat(5).map(sourceId), locator },
  { requiredKeys: ["type", "sourceId"] },
);

type Child = { type: string; text?: string; marks?: string[] };
/** Merges adjacent same-mark text runs, so every generated block is valid. */
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

const block = (withCitations: boolean) =>
  fc.oneof(
    fc.record({
      type: fc.constantFrom("paragraph", "bulletItem", "quote"),
      children: fc.array(withCitations ? fc.oneof(textRun, citation) : textRun, { maxLength: 5 }).map(merge),
    }),
    fc.record({
      type: fc.constant("heading"),
      level: fc.integer({ min: 1, max: 3 }),
      children: fc.array(textRun, { maxLength: 4 }).map(merge),
    }),
  );
const nodes = (withCitations: boolean) =>
  fc
    .array(block(withCitations), { minLength: 1, maxLength: 4 })
    .map((list) => list.map((node, i) => ({ ...node, id: nodeId(i) })));

const v1Doc = nodes(false).map((list) => ({ schemaVersion: 1, nodes: list }));
const v2Doc = fc.record({ schemaVersion: fc.constant(2), nodes: nodes(true), sources });
const validDoc = fc.oneof(v1Doc, v2Doc);

/** Every object or array inside `value`, with the root. */
function containers(value: unknown, out: object[] = []): object[] {
  if (value !== null && typeof value === "object") {
    out.push(value);
    for (const child of Object.values(value)) containers(child, out);
  }
  return out;
}

/** A valid document with one value somewhere replaced or one key added. */
const brokenDoc = fc
  .tuple(validDoc, fc.nat(), fc.nat(), fc.jsonValue({ maxDepth: 2 }), fc.boolean())
  .map(([input, pick, keyPick, replacement, addKey]) => {
    const copy = structuredClone(input) as unknown;
    const all = containers(copy);
    const target = all[pick % all.length] as Record<string, unknown>;
    const keys = Object.keys(target);
    if (addKey || keys.length === 0) target.extra = replacement;
    else target[keys[keyPick % keys.length]] = replacement;
    return copy;
  });

const KNOWN = new Set<string>(VALIDATION_ERROR_CODES);

describe("validateVersionedDocument properties", () => {
  test.prop([fc.oneof(brokenDoc, fc.anything(), validDoc)])("(a) is total: accept or known codes", (input) => {
    const outcome = validateVersionedDocument(input);
    if (!outcome.ok) {
      expect(outcome.errors.length).toBeGreaterThan(0);
      for (const error of outcome.errors) expect(KNOWN.has(error.code)).toBe(true);
    }
  });

  test.prop([validDoc])("(b) accepts a valid document and returns byte-identical JCS", (input) => {
    const outcome = validateVersionedDocument(input);
    expect(outcome.ok ? [] : outcome.errors).toEqual([]);
    if (outcome.ok) {
      expect(canonicalizeJcs(outcome.doc)).toBe(canonicalizeJcs(input));
      const again = validateVersionedDocument(JSON.parse(canonicalizeJcs(outcome.doc)));
      expect(again.ok && canonicalizeJcs(again.doc)).toBe(canonicalizeJcs(input));
    }
  });

  test.prop([v1Doc])("(c) an accepted v1 stays v1 and gains no sources", (input) => {
    const outcome = validateVersionedDocument(input);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.doc.schemaVersion).toBe(1);
      expect(Object.hasOwn(outcome.doc, "sources")).toBe(false);
    }
  });

  test.prop([fc.oneof(brokenDoc, validDoc)])("(d) does not mutate its input", (input) => {
    const before = canonicalizeJcs(input);
    const outcome = validateVersionedDocument(input);
    expect(canonicalizeJcs(input)).toBe(before);
    if (outcome.ok) expect(outcome.doc).not.toBe(input);
  });
});

describe("G4: many citations", () => {
  it("validates 50 000 citations and 500 sources without recursion", () => {
    const children = Array.from({ length: 50_000 }, (_, i) =>
      i % 2 === 0
        ? { type: "citation", sourceId: sourceId(i % 500) }
        : { type: "citation", sourceId: sourceId(i % 500), locator: "str. 12" },
    );
    const input = {
      schemaVersion: 2,
      nodes: [{ type: "paragraph", id: nodeId(0), children }],
      sources: Array.from({ length: 500 }, (_, i) => ({
        id: sourceId(i),
        type: "book",
        authors: [{ kind: "person", family: "Prezime", given: "Ime" }],
        year: 2020,
        title: `Izvor ${i + 1}`,
        place: "Zagreb",
        publisher: "Nakladnik",
      })),
    };
    const outcome = validateVersionedDocument(input);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(canonicalizeJcs(outcome.doc)).toBe(canonicalizeJcs(input));
  });
});
