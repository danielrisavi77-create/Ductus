import { describe, expect, it } from "vitest";

import fpzgConfig from "../../../config/faculties/fpzg/citation.json";
import type { CanonicalDocumentV2, CitationNode, DocumentNodeV2, DocumentSource, NodeId, SourceId } from "../document/schema";
import { validateVersionedDocument } from "../document/validate";
import { canonicalizeJcs } from "../forensics/jcs";
import { assignYearSuffixes, deriveBibliography, formatBibliographyEntry, formatCitation, formatCitationInText } from "./index";
import { parseCitationStyle, sortBibliography, type BookSource, type Source } from "./index";

/**
 * Input classes K-c1 to K-c11 of DAN-619 (c), contract
 * docs/contracts/document-schema-v2.md §4, §9.1 and §10 (class 31).
 * Synthetic data only.
 */

const style = parseCitationStyle(fpzgConfig);

const id = (i: number) => `${i.toString(16).padStart(8, "0")}-aaaa-4aaa-8aaa-aaaaaaaaaaaa` as SourceId;
const nodeId = (i: number) => `${i.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111` as NodeId;
const author = { kind: "person", family: "Prezime", given: "Ime" } as const;
const book = (i: number, extra: Partial<DocumentSource> = {}): DocumentSource =>
  ({ id: id(i), type: "book", authors: [author], year: 2020, title: `Izvor ${i}`, place: "Mjesto", publisher: "Nakladnik", ...extra }) as DocumentSource;
const cite = (i: number, locator?: string): CitationNode =>
  (locator === undefined ? { type: "citation", sourceId: id(i) } : { type: "citation", sourceId: id(i), locator });

function doc(sources: DocumentSource[], citations: CitationNode[]): CanonicalDocumentV2 {
  const nodes: DocumentNodeV2[] = [
    { type: "heading", id: nodeId(0), level: 1, children: [{ type: "text", text: "Naslov", marks: [] }] },
    { type: "paragraph", id: nodeId(1), children: citations },
  ];
  const result = { schemaVersion: 2 as const, nodes, sources };
  // Every fixture is a document the validator accepts (contract §§1 to 3).
  expect(validateVersionedDocument(result)).toMatchObject({ ok: true });
  return result;
}

const suffixes = (d: CanonicalDocumentV2) => deriveBibliography(d, style).entries.map((e) => e.source.yearSuffix);

describe("deriveBibliography (DAN-619 c)", () => {
  it("K-c1: no citations give no entries and no orphans", () => {
    expect(deriveBibliography(doc([], []), style)).toEqual({ entries: [], orphanCitations: 0 });
    expect(deriveBibliography(doc([book(1), book(2)], []), style)).toEqual({ entries: [], orphanCitations: 0 });
  });

  it("K-c2: a source cited several times is one entry", () => {
    const result = deriveBibliography(doc([book(1)], [cite(1), cite(1, "str. 12"), cite(1, "9-12")]), style);
    expect(result.entries.map((e) => e.sourceId)).toEqual([id(1)]);
    expect(result.entries[0].text).toBe("Prezime, Ime (2020) Izvor 1. Mjesto: Nakladnik.");
    expect(result.orphanCitations).toBe(0);
  });

  it("K-c3: citations without a source are counted, not listed", () => {
    expect(deriveBibliography(doc([book(1)], [cite(1), cite(9)]), style)).toMatchObject({ orphanCitations: 1 });
    const three = deriveBibliography(doc([book(1)], [cite(9), cite(8, " "), cite(9), cite(1)]), style);
    expect(three.orphanCitations).toBe(3);
    expect(three.entries.map((e) => e.sourceId)).toEqual([id(1)]);
  });

  it("K-c4: a source without a citation is left out", () => {
    expect(deriveBibliography(doc([book(1), book(2)], [cite(2)]), style).entries.map((e) => e.sourceId)).toEqual([id(2)]);
  });

  it("K-c5: suffixes for groups of 1, 2, 26, 27 and 500 works", () => {
    const titled = (n: number) => Array.from({ length: n }, (_, i) => book(i, { title: `Izvor ${String(i).padStart(3, "0")}` }));
    const group = (n: number) => doc(titled(n), titled(n).map((_, i) => cite(i)));
    expect(suffixes(group(1))).toEqual([undefined]);
    expect(suffixes(group(2))).toEqual(["a", "b"]);
    const letters = "abcdefghijklmnopqrstuvwxyz".split("");
    expect(suffixes(group(26))).toEqual(letters);
    expect(suffixes(group(27))).toEqual([...letters, "aa"]);
    const five = suffixes(group(500));
    expect(five).toHaveLength(500);
    expect(new Set(five).size).toBe(500);
    expect(five.slice(24, 29)).toEqual(["y", "z", "aa", "ab", "ac"]);
    expect(five.at(-1)).toBe("sf");
    expect(deriveBibliography(group(500), style).entries.at(-1)!.text).toBe(
      "Prezime, Ime (2020sf) Izvor 499. Mjesto: Nakladnik.",
    );
  });

  it("K-c6: titles equal under collation and identical records are ordered by id", () => {
    const sources = [book(3, { title: "izvor 1" }), book(1, { title: "Izvor 1" }), book(2, { title: "Izvor 1" })];
    const result = deriveBibliography(doc(sources, [cite(3), cite(2), cite(1)]), style);
    expect(result.entries.map((e) => [e.sourceId, e.source.yearSuffix])).toEqual([
      [id(1), "a"],
      [id(2), "b"],
      [id(3), "c"],
    ]);
  });

  it("K-c7: the order of sources does not change the bibliography", () => {
    const sources = [
      book(1, { title: "Izvor 2" }),
      book(2, { title: "izvor 2" }),
      book(3, { authors: [{ kind: "person", family: "prezime", given: "ime" }] }),
      book(4, { year: 2019 }),
      book(5, { authors: [{ kind: "organization", name: "Organizacija" }] }),
    ];
    const citations = [cite(5), cite(4), cite(3), cite(2), cite(1)];
    const expected = deriveBibliography(doc(sources, citations), style);
    for (const order of [[4, 3, 2, 1, 0], [2, 0, 4, 1, 3], [1, 0, 2, 3, 4]]) {
      expect(deriveBibliography(doc(order.map((i) => sources[i]), citations), style)).toEqual(expected);
    }
  });

  it("K-c8 (class 31): locators are shown, blank ones as stored, and the document bytes do not change", () => {
    const locators = [undefined, "str. 12", "9-12", " ", "\u2028", "\u2029"];
    const d = doc([book(1)], locators.map((l) => cite(1, l)));
    const before = canonicalizeJcs(d);
    const bibliography = deriveBibliography(d, style);
    const shown = (d.nodes[1].children as CitationNode[]).map((c) => formatCitation(c, bibliography, style));
    const blank = ["(Prezime, 2020:  )", "(Prezime, 2020: \u2028)", "(Prezime, 2020: \u2029)"];
    expect(shown).toEqual(["(Prezime, 2020)", "(Prezime, 2020: str. 12)", "(Prezime, 2020: 9–12)", ...blank]);
    expect(formatCitation(cite(9), bibliography, style)).toBeUndefined();
    expect(canonicalizeJcs(d)).toBe(before);
  });

  it("K-c9: every source type gives the entry of formatBibliographyEntry", () => {
    const long = "\u{1D49C}".repeat(200);
    const sources: DocumentSource[] = [
      book(1, { authors: [{ kind: "person", family: long, given: "Ime" }] }),
      { id: id(2), type: "article", authors: [{ kind: "organization", name: "Organizacija", acronym: "ORG" }], year: 2021, title: "Izvor 2", journal: "Časopis", volume: "3", issue: "2", pages: "1-9" },
      { id: id(3), type: "chapter", authors: [author], year: 2022, title: "Izvor 3", editors: [author], bookTitle: "Zbornik", place: "Mjesto", publisher: "Nakladnik", pages: "10-20" },
      { id: id(4), type: "web", authors: [{ kind: "organization", name: "Organizacija" }], year: 2023, title: "Izvor 4", url: "https://primjer.hr/a", accessed: "2024-02-29" },
    ];
    const result = deriveBibliography(doc(sources, [cite(1), cite(2), cite(3), cite(4)]), style);
    expect(result.entries).toHaveLength(4);
    for (const entry of result.entries) {
      const plain: Partial<DocumentSource> = { ...sources.find((s) => s.id === entry.sourceId)! };
      delete plain.id;
      expect(entry.source).toEqual(plain);
      expect(entry.text).toBe(formatBibliographyEntry(plain as Source, style));
    }
  });
});

describe("year suffixes past z (DAN-619 c)", () => {
  const work = (title: string, yearSuffix?: string): BookSource =>
    ({ type: "book", authors: [author], year: 2020, title, place: "Mjesto", publisher: "Nakladnik", ...(yearSuffix === undefined ? {} : { yearSuffix }) });
  const titled = (n: number) => Array.from({ length: n }, (_, i) => work(`Izvor ${String(i).padStart(3, "0")}`));

  it("K-c10: single-letter behaviour is unchanged", () => {
    const tagged = work("Izvor 1", "a");
    expect(assignYearSuffixes([tagged, work("Izvor 2"), work("Izvor 3")]).map((s) => s.yearSuffix)).toEqual(["a", "b", "c"]);
    expect(sortBibliography([work("x", "c"), work("x", "a"), work("x")]).map((s) => s.yearSuffix)).toEqual([undefined, "a", "c"]);
    expect(formatCitationInText(work("x", "b"), style, "9-12")).toBe("(Prezime, 2020b: 9–12)");
  });

  it("K-c11: letters run a..z, aa..az, ba.., zz, aaa and skip taken ones", () => {
    const at = (n: number) => assignYearSuffixes(titled(n)).map((s) => s.yearSuffix);
    const all = at(703);
    expect([all[0], all[25], all[26], all[51], all[52], all[701], all[702]]).toEqual(["a", "z", "aa", "az", "ba", "zz", "aaa"]);
    const withTaken = assignYearSuffixes([...titled(27), work("Izvor zzz", "aa")]).map((s) => s.yearSuffix);
    expect(withTaken.slice(25)).toEqual(["z", "ab", "aa"]);
    const sorted = sortBibliography(assignYearSuffixes(titled(28)).reverse()).map((s) => s.yearSuffix);
    expect(sorted.slice(24)).toEqual(["y", "z", "aa", "ab"]);
    expect(formatCitationInText(assignYearSuffixes(titled(27))[26], style)).toBe("(Prezime, 2020aa)");
  });
});
