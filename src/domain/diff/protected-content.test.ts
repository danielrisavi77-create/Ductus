import { describe, expect, it } from "vitest";

import {
  compareProtectedContent,
  MAX_PROTECTED_TEXT_LENGTH,
  type ProtectedFinding,
  type ProtectedKind,
} from "./protected-content";

// All texts are invented; no real person, work or student text.
function findings(source: string, proposed: string): readonly ProtectedFinding[] {
  const check = compareProtectedContent(source, proposed);
  if (!check.ok) throw new Error(`unexpected ${check.reason}`);
  return check.findings;
}

const kinds = (source: string, proposed: string): ProtectedKind[] =>
  [...new Set(findings(source, proposed).map((f) => f.kind))];

type Row = readonly [label: string, source: string, proposed: string, expected: readonly ProtectedFinding[]];

const same = (label: string, source: string, proposed: string): Row => [label, source, proposed, []];

const table: readonly Row[] = [
  // 1. plain numbers and digits of any script
  same("identical numbers", "Anketa je imala 120 ispitanika.", "Anketa je imala 120 ispitanika."),
  ["changed number", "Imala je 120 ispitanika.", "Imala je 125 ispitanika.", [
    { kind: "number", change: "removed", text: "120", count: 1 },
    { kind: "number", change: "added", text: "125", count: 1 },
  ]],
  ["Arabic-Indic digit is not 5", "Bilo ih je 5.", "Bilo ih je ٥.", [
    { kind: "number", change: "removed", text: "5", count: 1 },
    { kind: "number", change: "added", text: "٥", count: 1 },
  ]],
  ["dropped number", "Od 3 stranke ostale su 2.", "Od tri stranke ostale su 2.", [
    { kind: "number", change: "removed", text: "3", count: 1 },
  ]],
  // 2. decimals
  same("decimal comma equals decimal point", "Rast je 2,5 posto.", "Rast je 2.5 posto."),
  ["trailing zero is kept", "Rast je 2,5 posto.", "Rast je 2,50 posto.", [
    { kind: "number", change: "removed", text: "2,5", count: 1 },
    { kind: "number", change: "added", text: "2,50", count: 1 },
  ]],
  // 3. thousands
  same("dot thousands", "Ukupno 1.234.567 glasova.", "Ukupno 1234567 glasova."),
  same("no-break space thousands", "Ukupno 1 234 glasa.", "Ukupno 1.234 glasa."),
  same("narrow no-break space thousands", "Ukupno 1 234 glasa.", "Ukupno 1234 glasa."),
  ["plain space splits a number", "Ukupno 1 234 glasa.", "Ukupno 1234 glasa.", [
    { kind: "number", change: "removed", text: "1", count: 1 },
    { kind: "number", change: "removed", text: "234", count: 1 },
    { kind: "number", change: "added", text: "1234", count: 1 },
  ]],
  // 4. signs
  ["minus is kept", "Saldo je −5.", "Saldo je 5.", [
    { kind: "number", change: "removed", text: "−5", count: 1 },
    { kind: "number", change: "added", text: "5", count: 1 },
  ]],
  same("minus sign equals hyphen-minus", "Saldo je −5.", "Saldo je -5."),
  same("hyphen after a letter is not a sign", "U COVID-19 razdoblju.", "U COVID-19 razdoblju."),
  // 5. ranges
  same("range dash forms", "Na str. 10–12.", "Na str. 10-12."),
  same("range with spaces", "Na str. 10–12.", "Na str. 10 – 12."),
  ["range becomes two numbers", "Na str. 10–12.", "Na str. 10 i 12.", [
    { kind: "number", change: "removed", text: "10–12", count: 1 },
    { kind: "number", change: "added", text: "10", count: 1 },
    { kind: "number", change: "added", text: "12", count: 1 },
  ]],
  // 6. dates
  same("date with and without spaces", "Dana 6. 11. 2026. održan je skup.", "Dana 6.11.2026. održan je skup."),
  same("date with leading zero", "Dana 6. 11. 2026. održan je skup.", "Dana 06. 11. 2026. održan je skup."),
  same("ISO date", "Dana 6. 11. 2026. održan je skup.", "Dana 2026-11-06 održan je skup."),
  ["changed day", "Dana 6. 11. 2026. održan je skup.", "Dana 7. 11. 2026. održan je skup.", [
    { kind: "number", change: "removed", text: "6. 11. 2026", count: 1 },
    { kind: "number", change: "added", text: "7. 11. 2026", count: 1 },
  ]],
  // 7. quotes
  same("Croatian quotes", "Rekao je „ovo je izmišljeno”.", "Kazao je „ovo je izmišljeno”."),
  same("Croatian quotes closed by “", "Rekao je „ovo je izmišljeno“.", "Kazao je „ovo je izmišljeno“."),
  ["changed quote", "Rekao je „ovo je izmišljeno”.", "Rekao je „to je izmišljeno”.", [
    { kind: "quote", change: "removed", text: "„ovo je izmišljeno”", count: 1 },
    { kind: "quote", change: "added", text: "„to je izmišljeno”", count: 1 },
  ]],
  same("English quotes", "He said “a made-up line”.", "He said “a made-up line”."),
  same("guillemets", "Piše »izmišljeni red« i «drugi red».", "Piše »izmišljeni red« i «drugi red»."),
  same("straight quotes", 'Piše "izmišljeni red".', 'Stoji "izmišljeni red".'),
  ["apostrophe inside single quotes", "Piše ‘don’t do it’.", "Piše ‘do it’.", [
    { kind: "quote", change: "removed", text: "‘don’t do it’", count: 1 },
    { kind: "quote", change: "added", text: "‘do it’", count: 1 },
  ]],
  ["nested quote is part of the outer one", "Piše „on reče ‚ne’ i ode”.", "Piše „on reče ‚da’ i ode”.", [
    { kind: "quote", change: "removed", text: "„on reče ‚ne’ i ode”", count: 1 },
    { kind: "quote", change: "added", text: "„on reče ‚da’ i ode”", count: 1 },
  ]],
  same("unclosed quote is not a quote", "Piše „bez kraja.", "Piše „bez kraja."),
  same("NFD and NFC quote", "Piše „čovjek”.", "Piše „čovjek”."),
  ["number inside a quote counts as the quote", "Piše „bilo je 5 ljudi”.", "Piše „bilo je 6 ljudi”.", [
    { kind: "quote", change: "removed", text: "„bilo je 5 ljudi”", count: 1 },
    { kind: "quote", change: "added", text: "„bilo je 6 ljudi”", count: 1 },
  ]],
  // 8. source marks (FPZG author-year)
  same("page dash in a source mark", "Tvrdi se (Horvat, 2007: 9-12).", "Tvrdi se (Horvat, 2007: 9–12)."),
  ["changed year is a source finding only", "Tvrdi se (Horvat, 2007: 9).", "Tvrdi se (Horvat, 2008: 9).", [
    { kind: "source", change: "removed", text: "(Horvat, 2007: 9)", count: 1 },
    { kind: "source", change: "added", text: "(Horvat, 2008: 9)", count: 1 },
  ]],
  ["year letter matters", "Vidi (Horvat, 2007a).", "Vidi (Horvat, 2007b).", [
    { kind: "source", change: "removed", text: "(Horvat, 2007a)", count: 1 },
    { kind: "source", change: "added", text: "(Horvat, 2007b)", count: 1 },
  ]],
  same("institution author", "Prema (UN, 2020) stopa raste.", "Stopa raste prema (UN, 2020)."),
  ["several sources in one mark", "Vidi (Horvat, 2007; Kovač i sur., 2019: 4).", "Vidi (Horvat, 2007; Kovač i sur., 2019: 5).", [
    { kind: "source", change: "removed", text: "(Horvat, 2007; Kovač i sur., 2019: 4)", count: 1 },
    { kind: "source", change: "added", text: "(Horvat, 2007; Kovač i sur., 2019: 5)", count: 1 },
  ]],
  same("year and page only", "Isti autor (2007: 9) dodaje.", "Isti autor dodaje (2007: 9)."),
  ["plain parenthesis is not a source", "Kako pokazuje (vidi tablicu 3).", "Kako pokazuje (vidi tablicu 4).", [
    { kind: "number", change: "removed", text: "3", count: 1 },
    { kind: "number", change: "added", text: "4", count: 1 },
  ]],
  // 9. Unicode spaces around a date
  same("no-break spaces in a date", "Dana 6. 11. 2026.", "Dana 6. 11. 2026."),
  // 10. empty text
  same("empty texts", "", ""),
  ["text emptied", "Bilo ih je 5.", "", [{ kind: "number", change: "removed", text: "5", count: 1 }]],
  // 11. order
  ["swapped numbers", "Porez je s 5 na 7 posto.", "Porez je sa 7 na 5 posto.", [{ kind: "number", change: "reordered" }]],
  ["repeated number counted", "Bilo je 5 pa 5.", "Bilo je 5.", [{ kind: "number", change: "removed", text: "5", count: 1 }]],
];

describe("compareProtectedContent", () => {
  it.each(table)("%s", (_label, source, proposed, expected) => {
    expect(findings(source, proposed)).toEqual(expected);
  });

  it("orders kinds as source, quote, number", () => {
    expect(kinds("„a” (Horvat, 2007) 1", "„b” (Horvat, 2008) 2")).toEqual(["source", "quote", "number"]);
  });

  it("checks texts up to the limit and refuses longer ones", () => {
    const max = "a".repeat(MAX_PROTECTED_TEXT_LENGTH);
    expect(compareProtectedContent(max, max)).toEqual({ ok: true, findings: [] });
    expect(compareProtectedContent(`${max}a`, max)).toEqual({ ok: false, reason: "too-long" });
    expect(compareProtectedContent(max, `${max}a`)).toEqual({ ok: false, reason: "too-long" });
  });

  it("refuses values that are not text", () => {
    expect(compareProtectedContent(5 as unknown as string, "5")).toEqual({ ok: false, reason: "not-text" });
    expect(compareProtectedContent("5", null as unknown as string)).toEqual({ ok: false, reason: "not-text" });
  });

  it.each([
    ["opening quotes", "„".repeat(MAX_PROTECTED_TEXT_LENGTH)],
    ["mixed opening quotes", "„“»«‚‘\"".repeat(MAX_PROTECTED_TEXT_LENGTH / 8)],
    ["opening parentheses", "(".repeat(MAX_PROTECTED_TEXT_LENGTH)],
    ["unfinished source marks", "(Horvat, 2007: ".repeat(MAX_PROTECTED_TEXT_LENGTH / 16)],
    ["dangling ranges", "1-".repeat(MAX_PROTECTED_TEXT_LENGTH / 2)],
    ["digit groups", "1.234".repeat(MAX_PROTECTED_TEXT_LENGTH / 5)],
    ["one digit run", "1".repeat(MAX_PROTECTED_TEXT_LENGTH)],
    ["long source mark candidates", `(${"Horvat, ".repeat(37)}x)`.repeat(MAX_PROTECTED_TEXT_LENGTH / 300)],
  ])("stays fast on hostile input: %s", (_label, text) => {
    const started = performance.now();
    const check = compareProtectedContent(text, text);
    expect(check).toEqual({ ok: true, findings: [] });
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});
