import { describe, expect, it } from "vitest";

import {
  assignYearSuffixes,
  CitationInputError,
  CitationStyleError,
  formatBibliographyEntry,
  formatInText,
  fpzgCitationStyle as style,
  parseCitationStyle,
  sortBibliography,
  type BookSource,
  type Person,
  type Source,
} from "./index";
import fpzgConfig from "../../../config/faculties/fpzg/citation.json";

const person = (family: string, given: string): Person => ({ kind: "person", family, given });

const book = (authors: Person[], year: number, title = "Naslov"): BookSource => ({
  type: "book",
  authors,
  year,
  title,
  place: "Zagreb",
  publisher: "Nakladnik",
});

// Examples from the FPZG Upute (2013./2015.) as recorded in Lekta fpzg.json.
describe("FPZG examples from Lekta", () => {
  it("formats the book entry exactly", () => {
    const siber: BookSource = {
      type: "book",
      authors: [person("Šiber", "Ivan")],
      year: 2003,
      title: "Politički marketing",
      place: "Zagreb",
      publisher: "Politička kultura",
    };
    expect(formatBibliographyEntry(siber, style)).toBe(
      "Šiber, Ivan (2003) Politički marketing. Zagreb: Politička kultura.",
    );
  });

  it("formats single-author in-text citation with a colon before the page", () => {
    expect(formatInText(book([person("Becker", "Howard")], 2007), style, "9")).toBe("(Becker, 2007: 9)");
  });

  it("joins two authors with „i“", () => {
    const source = book([person("Swanson", "David"), person("Mancini", "Paolo")], 1996);
    expect(formatInText(source, style, "9")).toBe("(Swanson i Mancini, 1996: 9)");
  });

  it("omits the page when citing the work as a whole", () => {
    expect(formatInText(book([person("Becker", "Howard")], 2007), style)).toBe("(Becker, 2007)");
  });

  it("formats the article numbering volume/issue: pages with an en dash (Lekta kucni-stil)", () => {
    const source: Source = {
      type: "article",
      authors: [person("Đurđević", "Željka")],
      year: 2013,
      yearSuffix: "b",
      title: "Čitanje izbornih programa: Šibenik i Čakovec",
      journal: "Politička misao",
      volume: "17",
      issue: "6",
      pages: "792-805",
    };
    expect(formatBibliographyEntry(source, style)).toBe(
      "Đurđević, Željka (2013b) Čitanje izbornih programa: Šibenik i Čakovec. Politička misao 17/6: 792–805.",
    );
    expect(formatInText(source, style, "800")).toBe("(Đurđević, 2013b: 800)");
  });
});

describe("other source types", () => {
  it("formats a chapter in an edited book", () => {
    const source: Source = {
      type: "chapter",
      authors: [person("Kovačić", "Ljiljana")],
      year: 2018,
      title: "Žene u hrvatskom saboru",
      editors: [person("Njegovan", "Ćiril"), person("Džaja", "Šime")],
      bookTitle: "Političke stranke i izbori",
      place: "Zagreb",
      publisher: "Fakultet političkih znanosti",
      pages: "21–48",
    };
    expect(formatBibliographyEntry(source, style)).toBe(
      "Kovačić, Ljiljana (2018) Žene u hrvatskom saboru. U: Ćiril Njegovan i Šime Džaja (ur.) Političke stranke i izbori. Zagreb: Fakultet političkih znanosti: 21–48.",
    );
  });

  it("formats a web source with a mandatory access date", () => {
    const source: Source = {
      type: "web",
      authors: [{ kind: "organization", acronym: "DZS", name: "Državni zavod za statistiku" }],
      year: 2022,
      title: "Popis stanovništva 2021.",
      url: "https://podaci.dzs.hr/",
      accessed: "2026-10-03",
    };
    expect(formatBibliographyEntry(source, style)).toBe(
      "DZS (Državni zavod za statistiku) (2022) Popis stanovništva 2021. https://podaci.dzs.hr/ (pristupljeno 3. 10. 2026.)",
    );
    expect(formatInText(source, style)).toBe("(DZS, 2022)");
  });

  it("rejects an invalid access date", () => {
    const source: Source = {
      type: "web",
      authors: [person("Horvat", "Ana")],
      year: 2024,
      title: "Blog",
      url: "https://example.org",
      accessed: "2026-02-30",
    };
    expect(() => formatBibliographyEntry(source, style)).toThrow(CitationInputError);
  });

  it("does not double the period after a title ending in a question mark", () => {
    const source = book([person("Šimić", "Đuro")], 2020, "Što je politika?");
    expect(formatBibliographyEntry(source, style)).toBe("Šimić, Đuro (2020) Što je politika? Zagreb: Nakladnik.");
  });
});

describe("authors", () => {
  it("uses „i sur.“ for three or more authors in text", () => {
    const source = book([person("Čulo", "Ivan"), person("Ćorić", "Mia"), person("Žitko", "Luka")], 2021);
    expect(formatInText(source, style, "3–4")).toBe("(Čulo i sur., 2021: 3–4)");
  });

  it("lists all authors with full names in the bibliography", () => {
    const source = book([person("Čulo", "Ivan"), person("Ćorić", "Mia"), person("Žitko", "Luka")], 2021);
    expect(formatBibliographyEntry(source, style)).toBe(
      "Čulo, Ivan, Ćorić, Mia i Žitko, Luka (2021) Naslov. Zagreb: Nakladnik.",
    );
  });

  it("rejects a source without authors or with an empty family name", () => {
    expect(() => formatInText(book([], 2020), style)).toThrow(CitationInputError);
    expect(() => formatInText(book([person(" ", "Ana")], 2020), style)).toThrow(CitationInputError);
  });
});

describe("ordering", () => {
  it("sorts by Croatian alphabet, then chronologically", () => {
    const sources = [
      book([person("Šiber", "Ivan")], 2003),
      book([person("Čulo", "Ivan")], 2021),
      book([person("Cvitan", "Ana")], 2019),
      book([person("Ćorić", "Mia")], 2010),
      book([person("Cvitan", "Ana")], 2001),
      book([person("Sabol", "Zoran")], 2005),
      book([person("Zubak", "Iva")], 2000),
    ];
    expect(sortBibliography(sources).map((s) => `${s.authors[0].kind === "person" ? s.authors[0].family : ""} ${s.year}`)).toEqual([
      "Cvitan 2001",
      "Cvitan 2019",
      "Čulo 2021",
      "Ćorić 2010",
      "Sabol 2005",
      "Šiber 2003",
      "Zubak 2000",
    ]);
  });

  it("assigns a and b to same-author same-year works by title", () => {
    const first = book([person("Lapavitsas", "Costas")], 2013, "Zadnji naslov");
    const second = book([person("Lapavitsas", "Costas")], 2013, "Analiza");
    const other = book([person("Lapavitsas", "Costas")], 2011);
    const result = assignYearSuffixes([first, second, other]);
    expect(result.map((s) => s.yearSuffix)).toEqual(["b", "a", undefined]);
    expect(first.yearSuffix).toBeUndefined();
  });

  it("keeps existing suffixes and never reuses them", () => {
    const tagged = { ...book([person("Lapavitsas", "Costas")], 2013, "Analiza"), yearSuffix: "a" };
    const untaggedB = book([person("Lapavitsas", "Costas")], 2013, "Beta");
    const untaggedC = book([person("Lapavitsas", "Costas")], 2013, "Cijena");
    expect(assignYearSuffixes([tagged, untaggedB, untaggedC]).map((s) => s.yearSuffix)).toEqual(["a", "b", "c"]);
    expect(assignYearSuffixes([tagged, untaggedC]).map((s) => s.yearSuffix)).toEqual(["a", "b"]);
  });
});

describe("style config", () => {
  it("records its Lekta provenance (D-83)", () => {
    expect(fpzgConfig.provenance.decision).toMatch(/^D-83/);
    expect(fpzgConfig.provenance.lektaCommit).toMatch(/^[0-9a-f]{7,40}$/);
  });

  it("fails closed on a malformed config", () => {
    expect(() => parseCitationStyle({ ...fpzgConfig, inText: { ...fpzgConfig.inText, open: 1 } })).toThrow(
      CitationStyleError,
    );
    expect(() => parseCitationStyle({ ...fpzgConfig, style: "numeric" })).toThrow(CitationStyleError);
    expect(() => parseCitationStyle({ ...fpzgConfig, rangeDash: "" })).toThrow(CitationStyleError);
    expect(() => parseCitationStyle(null)).toThrow(CitationStyleError);
  });
});
