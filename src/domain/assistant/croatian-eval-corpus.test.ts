import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findForbiddenTerms } from "../../../scripts/forbidden-terms/terms";
import { purposeCatalog } from "./purpose-catalog";

/**
 * Guards the synthetic Croatian evaluation corpus (DAN-400, M9.1-P03,
 * docs/AI-HRVATSKI-PROTOKOL.md). The corpus is data for people who rate
 * model output; these checks keep it inside the catalogue, free of dictionary
 * terms and free of anything shaped like personal data, and make sure every
 * criterion rates model output, never a student.
 */

const CORPUS_PATH = path.join(__dirname, "../../../docs/ai-hrvatski/korpus.json");

const ITEM_KEYS = ["id", "purpose", "level", "instruction", "input", "criteria"] as const;
const CRITERION_KEYS = ["id", "subject", "text"] as const;
const MIN_ITEMS_PER_PURPOSE = 2;

interface Criterion {
  id: string;
  subject: string;
  text: string;
}
interface Item {
  id: string;
  purpose: string;
  level: number;
  instruction: string;
  input: string;
  criteria: string[];
}
interface Corpus {
  catalogVersion: number;
  criteria: Criterion[];
  items: Item[];
}

const PERSONAL_DATA_SHAPES: readonly [string, RegExp][] = [
  ["email", /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/u],
  ["oib or jmbag", /(?<!\d)\d{10,11}(?!\d)/u],
  ["phone", /(?:\+385|\b0\d{1,2})[\s/-]?\d{3}[\s/-]?\d{3,4}\b/u],
  ["url", /\b(?:https?:\/\/|www\.)(?![\w.-]*(?:example\.org|\.invalid)\b)/iu],
  // Only roles with a letter ("Student A", "Autorica B") stand for people, so
  // no name in the corpus can be taken for a real person at the faculty.
  ["name", /\p{Lu}\p{Ll}+\s+\p{Lu}\p{Ll}+/u],
  ["name", /\p{Lu}\p{Ll}+,\s*(?:\p{Lu}\.\s*)?\(?\d{4}/u],
  ["name", /\p{Lu}\p{Ll}+,\s+\p{Lu}\p{Ll}+,/u],
];

function sameKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && [...keys].sort().every((key, i) => key === actual[i]);
}

/** Every reason the corpus breaks a rule; empty when it keeps them all. */
function corpusProblems(corpus: Corpus): string[] {
  const problems: string[] = [];
  const catalogue = purposeCatalog(corpus.catalogVersion);
  if (!catalogue.ok) return ["unknown catalogue version"];
  const levels = new Map(catalogue.purposes.map((p) => [p.key, p.level]));

  const criterionIds = new Set<string>();
  for (const criterion of corpus.criteria) {
    if (!sameKeys(criterion, CRITERION_KEYS)) problems.push(`criterion ${criterion.id}: fields`);
    if (criterionIds.has(criterion.id)) problems.push(`criterion ${criterion.id}: duplicate id`);
    criterionIds.add(criterion.id);
    if (criterion.subject !== "model_output") problems.push(`criterion ${criterion.id}: subject`);
  }

  const itemIds = new Set<string>();
  const perPurpose = new Map<string, number>();
  for (const item of corpus.items) {
    if (!sameKeys(item, ITEM_KEYS)) problems.push(`item ${item.id}: fields`);
    if (itemIds.has(item.id)) problems.push(`item ${item.id}: duplicate id`);
    itemIds.add(item.id);
    const level = levels.get(item.purpose);
    if (level === undefined) problems.push(`item ${item.id}: purpose`);
    else if (level !== item.level) problems.push(`item ${item.id}: level`);
    perPurpose.set(item.purpose, (perPurpose.get(item.purpose) ?? 0) + 1);
    if (!Array.isArray(item.criteria) || item.criteria.length === 0) problems.push(`item ${item.id}: no criteria`);
    for (const id of item.criteria ?? []) if (!criterionIds.has(id)) problems.push(`item ${item.id}: criterion ${id}`);
  }
  for (const key of levels.keys()) {
    if ((perPurpose.get(key) ?? 0) < MIN_ITEMS_PER_PURPOSE) problems.push(`purpose ${key}: too few items`);
  }

  const texts = [
    ...corpus.criteria.map((c) => [`criterion ${c.id}`, c.text] as const),
    ...corpus.items.flatMap((i) => [[`item ${i.id}`, i.instruction] as const, [`item ${i.id}`, i.input] as const]),
  ];
  for (const [where, text] of texts) {
    for (const term of findForbiddenTerms(String(text))) problems.push(`${where}: dictionary term ${term.entry}`);
    for (const [shape, pattern] of PERSONAL_DATA_SHAPES) if (pattern.test(String(text))) problems.push(`${where}: ${shape}`);
  }
  return problems;
}

const corpus = JSON.parse(readFileSync(CORPUS_PATH, "utf8")) as Corpus;

function broken(change: (copy: Corpus) => void): Corpus {
  const copy = structuredClone(corpus);
  change(copy);
  return copy;
}

describe("synthetic Croatian evaluation corpus", () => {
  it("keeps every rule", () => {
    expect(corpusProblems(corpus)).toEqual([]);
  });

  it("covers all ten purposes of catalogue version 2", () => {
    expect(corpus.catalogVersion).toBe(2);
    expect(new Set(corpus.items.map((i) => i.purpose)).size).toBe(10);
  });

  // One deliberately broken copy per class of input, so the guard is shown to fail.
  const breakages: readonly [string, (copy: Corpus) => void, string][] = [
    ["purpose outside the catalogue", (c) => void (c.items[0]!.purpose = "essay_writing"), "purpose"],
    ["missing purpose", (c) => void (c.items = c.items.filter((i) => i.purpose !== "data_coding")), "purpose data_coding: too few items"],
    ["wrong level", (c) => void (c.items[0]!.level = 2), "level"],
    ["duplicate item id", (c) => void (c.items[1]!.id = c.items[0]!.id), "duplicate id"],
    ["unknown criterion", (c) => void c.items[0]!.criteria.push("no-such-criterion"), "criterion no-such-criterion"],
    ["criterion about the student", (c) => void (c.criteria[0]!.subject = "student"), "subject"],
    ["dictionary term", (c) => void (c.items[0]!.input += " Tekst je sumnjiv."), "dictionary term"],
    ["english dictionary term", (c) => void (c.criteria[0]!.text += " No AI percentage."), "dictionary term"],
    ["email", (c) => void (c.items[0]!.input += " pisite na ime.prezime@fakultet.hr"), "email"],
    ["oib", (c) => void (c.items[0]!.input += " OIB 12345678903"), "oib or jmbag"],
    ["jmbag", (c) => void (c.items[0]!.instruction += " JMBAG 0067123456"), "oib or jmbag"],
    ["phone", (c) => void (c.items[0]!.input += " nazovite 091 234 5678"), "phone"],
    ["full name", (c) => void (c.items[0]!.input += " Razgovor je vodila Ana Kovač."), "name"],
    ["surname in a citation", (c) => void (c.items[0]!.input += " (Babić, 2020: 14)"), "name"],
    ["surname with an initial", (c) => void (c.items[0]!.input += " Babić, I. (2020)"), "name"],
    ["surname with a given name", (c) => void (c.items[0]!.input += " Babić, Iva, Naslov"), "name"],
    ["real url", (c) => void (c.items[0]!.input += " https://www.fpzg.unizg.hr/"), "url"],
    ["unknown item field", (c) => void Object.assign(c.items[0]!, { author: "x" }), "fields"],
    ["unknown criterion field", (c) => void Object.assign(c.criteria[0]!, { weight: 1 }), "fields"],
  ];

  it.each(breakages)("rejects %s", (_name, change, expected) => {
    const problems = corpusProblems(broken(change));
    expect(problems.some((p) => p.includes(expected))).toBe(true);
  });

  it("allows a reserved example address", () => {
    expect(corpusProblems(broken((c) => void (c.items[0]!.input += " https://example.org/clanak")))).toEqual([]);
  });

  it("allows roles with a letter in place of names", () => {
    const roles = " Student A i Mentorica B citiraju (Autorica C, 2020: 14) i Autor D (2021).";
    expect(corpusProblems(broken((c) => void (c.items[0]!.input += roles)))).toEqual([]);
  });
});
