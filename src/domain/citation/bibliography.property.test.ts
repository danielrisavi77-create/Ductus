import { fc, test } from "@fast-check/vitest";
import { describe, expect } from "vitest";

import fpzgConfig from "../../../config/faculties/fpzg/citation.json";
import type { CanonicalDocumentV2, CitationNode } from "../document/schema";
import { validateVersionedDocument } from "../document/validate";
import { canonicalizeJcs } from "../forensics/jcs";
import { deriveBibliography, formatCitation, parseCitationStyle } from "./index";

/**
 * Properties of the bibliography derivation, DAN-619 (c): total, the input is
 * never mutated, and (e) from contract §10, deterministic and independent of
 * the order of `sources`. Generated documents pass the v2 validator.
 * Synthetic data only.
 */

const style = parseCitationStyle(fpzgConfig);

const sourceId = (i: number) => `${i.toString(16).padStart(8, "0")}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
const nodeId = (i: number) => `${i.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`;

const unit = fc.constantFrom("a", "Z", "1", "č", "Ž", "-", " ", "\u{1F600}", "\u2028");
/** A text field with no edge white space: `Izvor` plus generated content. */
const field = fc.string({ unit, maxLength: 6 }).map((inner) => `Izvor ${inner}1`);
const person = fc.record({ kind: fc.constant("person"), family: fc.constantFrom("Prezime", "prezime", "Drugo"), given: fc.constantFrom("Ime", "ime") });
const orgFields = { kind: fc.constant("organization"), name: fc.constantFrom("Organizacija", "ORG"), acronym: fc.constantFrom("ORG", "O") };
const organization = fc.record(orgFields, { requiredKeys: ["kind", "name"] });
/** Mostly one shared author and few years, so groups that need suffixes are common. */
const authors = fc.oneof(
  { arbitrary: fc.constant([{ kind: "person", family: "Prezime", given: "Ime" }]), weight: 3 },
  { arbitrary: fc.array(fc.oneof(person, organization), { minLength: 1, maxLength: 2 }), weight: 1 },
);
const year = fc.constantFrom(2019, 2020);
const title = fc.oneof(fc.constantFrom("Izvor 1", "izvor 1", "Izvor 2"), field);

const source = fc.oneof(
  fc.record({ type: fc.constant("book"), authors, year, title, place: field, publisher: field }),
  fc.record(
    { type: fc.constant("article"), authors, year, title, journal: field, volume: field, issue: field, pages: field },
    { requiredKeys: ["type", "authors", "year", "title", "journal"] },
  ),
  fc.record(
    { type: fc.constant("chapter"), authors, year, title, editors: fc.array(person, { minLength: 1, maxLength: 2 }), bookTitle: field, place: field, publisher: field, pages: field },
    { requiredKeys: ["type", "authors", "year", "title", "editors", "bookTitle", "place", "publisher"] },
  ),
  fc.record({ type: fc.constant("web"), authors, year, title, url: fc.constant("https://primjer.hr/a"), accessed: fc.constant("2024-02-29") }),
);

const locator = fc.oneof(fc.constantFrom("str. 12", "9-12", " ", "\u2028", "\u2029"), fc.string({ unit, minLength: 1, maxLength: 8 }));
const citation = fc.record(
  { type: fc.constant("citation"), sourceId: fc.nat(40).map(sourceId), locator },
  { requiredKeys: ["type", "sourceId"] },
);
const text = { type: "text", text: "Tekst", marks: [] as string[] };
/** Text runs are never adjacent, so every generated block is valid. */
const children = fc.array(citation, { maxLength: 4 }).map((list) => list.flatMap((c) => [c, text]));

const document = fc
  .tuple(
    fc.array(source, { maxLength: 30 }),
    fc.array(children, { minLength: 1, maxLength: 4 }),
    fc.array(fc.option(fc.nat(), { freq: 4 }), { minLength: 32, maxLength: 32 }),
  )
  .map(([records, blocks, picks]) => {
    const sources = records.map((record, i) => ({ id: sourceId(i), ...record }));
    // Point most generated citations at the sources that exist; the rest stay orphans.
    blocks.flat().forEach((child, i) => {
      if (child.type === "citation" && sources.length > 0 && picks[i] !== null) {
        (child as { sourceId: string }).sourceId = sourceId(picks[i] % sources.length);
      }
    });
    return {
      schemaVersion: 2,
      nodes: blocks.map((list, i) => ({ type: "paragraph", id: nodeId(i), children: structuredClone(list) })),
      sources,
    };
  })
  .filter((d) => validateVersionedDocument(d).ok) as fc.Arbitrary<CanonicalDocumentV2>;

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const citationsOf = (d: CanonicalDocumentV2) =>
  d.nodes.flatMap((n) => n.children).filter((c): c is CitationNode => c.type === "citation");

describe("deriveBibliography properties", () => {
  test.prop([document])("is total and never mutates its input", (d) => {
    const before = canonicalizeJcs(d);
    const frozen = deepFreeze(d);
    const bibliography = deriveBibliography(frozen, style);
    for (const c of citationsOf(frozen)) formatCitation(c, bibliography, style);
    expect(canonicalizeJcs(frozen)).toBe(before);
  });

  test.prop([document])("lists each cited source once, counts the rest as orphans", (d) => {
    const { entries, orphanCitations } = deriveBibliography(d, style);
    const ids = new Set(d.sources.map((s) => s.id));
    const cited = citationsOf(d).map((c) => c.sourceId);
    expect(new Set(entries.map((e) => e.sourceId))).toEqual(new Set(cited.filter((x) => ids.has(x))));
    expect(entries).toHaveLength(new Set(entries.map((e) => e.sourceId)).size);
    expect(orphanCitations).toBe(cited.filter((x) => !ids.has(x)).length);
    const labels = entries.map((e) => `${JSON.stringify(e.source.authors)}#${e.source.year}${e.source.yearSuffix ?? ""}`);
    expect(new Set(labels).size).toBe(labels.length);
  });

  test.prop([document, fc.array(fc.nat())])("(e) is deterministic and ignores the order of sources", (d, keys) => {
    const expected = deriveBibliography(d, style);
    expect(deriveBibliography(structuredClone(d), style)).toEqual(expected);
    const shuffled = d.sources
      .map((s, i) => ({ s, k: keys[i] ?? i }))
      .sort((a, b) => a.k - b.k)
      .map(({ s }) => s);
    expect(deriveBibliography({ ...d, sources: shuffled }, style)).toEqual(expected);
  });
});
