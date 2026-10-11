import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";

import { CLOSED_UP_NOTE, UNREADABLE_HINTS, findMisplacedUiText, findUnreadableText, isolatedHost, scanUiText, syntaxErrors } from "../../scripts/forbidden-terms/scan";
import { MAX_WINDOW_PARTS, PHRASE_BREAK, closedUpPastQuotes, findForbiddenTerms, findForbiddenTermsInMarkup, unreadableCharacters, windowsCutShort } from "../../scripts/forbidden-terms/terms";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const HR = "spremljeno (bez pojašnjenja)";
const cp = (...codes: number[]): string => String.fromCodePoint(...codes);

let root: string | undefined;
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});
const write = (relative: string, content: string): void => {
  root ??= mkdtempSync(path.join(tmpdir(), "ductus-terms-"));
  const file = path.join(root, ...relative.split("/"));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
};
const component = (lines: readonly string[]): string =>
  ["export const Case = ({ a, b, c, d, e, f, g, n }: Props) => (", ...lines.map((line) => `  ${line}`), ");", ""].join("\n");

// A part the scan cannot read, or an element it cannot place, does not keep
// the two sides of it apart: the text is also read closed up.
describe("text closed up over unknown parts", () => {
  /** What it is, the JSX, the entries it must be reported for. */
  const CLOSED_UP: readonly [string, readonly string[], readonly string[]][] = [
    ["empty inline element inside a word", ["<p>Sum<span />njivo</p>"], ["sumnjivo"]],
    ["element that is not on the inline list", ["<p>Sum<label>njivo</label></p>"], ["sumnjivo"]],
    ["custom element", ["<p>Kopi<x-part>rano</x-part></p>"], ["kopirano"]],
    ["fragment by name", ["<p>Sum<Fragment>njivo</Fragment></p>"], ["sumnjivo"]],
    ["component without children", ["<p>Hid<Part />den</p>"], ["hidden"]],
    ["component with children", ["<p>Skri<Em>veno</Em></p>"], ["skriveno"]],
    ["undefined between the halves", ["<p>Sum{undefined}njivo</p>"], ["sumnjivo"]],
    ["void between the halves", ["<p>Sum{void 0}njivo</p>"], ["sumnjivo"]],
    ["computed value between the halves", ["<p>Prepi{n}sano</p>"], ["prepisano"]],
    ["computed value in a template", ["<p>{`Sum${n}njivo`}</p>"], ["sumnjivo"]],
    ["computed value in an attribute", ['<img alt={"Sus" + n + "picious"} />'], ["suspicious"]],
    ["items of an array", ['<p>{["Sum", "njivo"]}</p>'], ["sumnjivo"]],
    ["phrase in the items of an array", ['<p>{["Nestali ", "podaci"]}</p>'], ["nestali podaci"]],
    ["entry in one item of an array", ['<p>{["Stanje", "Risk"]}</p>'], ["risk"]],
    ["two blocks next to each other", ["<div><div className={a}>Sum</div><div className={a}>njivo</div></div>"], ["sumnjivo"]],
    ["cells of a row", ["<tr><td>Vjero</td><td>jatnost</td></tr>"], ["vjerojatnost"]],
    // Contextual entries: the word is read closed up only when it is not whole otherwise.
    ["contextual word over an empty element", ["<p>Spre<span />mljeno</p>"], [HR]],
    ["contextual word over an empty element, with its place", ["<p>Spre<span />mljeno na uređaju</p>"], []],
    ["contextual word whole, unknown part before the place", ["<p>Spremljeno <Icon /> na uređaju</p>"], [HR]],
    ["contextual phrase whole, unknown part after it", ["<p>Spremljeno na uređaju<Icon />Predano</p>"], []],
    ["contextual phrase whole, block after it", ["<div><p>Spremljeno na uređaju</p><p>Predano</p></div>"], []],
    // Nothing to report: what stands on the two sides makes no entry.
    ["plain words around an empty element", ["<p>Pred<span />ano</p>"], []],
    ["plain words in two blocks", ["<ul><li>Zadatak</li><li>Rok predaje</li></ul>"], []],
    // Stricter side, kept on purpose: two blocks that do stand apart are still read closed up.
    ["stricter: end of one block and start of the next", ["<ul><li>Bijeli šum</li><li>njiva</li></ul>"], ["sumnjivo"]],
  ];

  it.each(CLOSED_UP)("%s", (_, lines, expected) => {
    write("src/components/Case.tsx", component(lines));
    expect(scanUiText(root!).flatMap((finding) => finding.terms.map((term) => term.entry))).toEqual(expected);
  });

  // Review of 56a69b1: such an entry is not there to see in the text as
  // written, so the finding shows the parts and says what joined them.
  it.each([
    ["two items of a list", "<ul><li>Pariz</li><li>ika</li></ul>", "rizik", "Pariz | ika"],
    ["an empty element inside a word", "<p>Sum<span />njivo</p>", "sumnjivo", "Sum | njivo"],
    ["a computed value inside a word", "<p>Prepi{n}sano danas</p>", "prepisano", "Prepi | sano danas"],
    ["a contextual word over an empty element", "<p>Spre<span />mljeno</p>", HR, "Spre | mljeno"],
  ])("says that the entry was found by joining the parts: %s", (_, line, entry, parts) => {
    write("src/components/Case.tsx", component([line]));
    const found = scanUiText(root!);
    expect(found.map((finding) => finding.terms.map((term) => term.entry))).toEqual([[entry]]);
    expect(found[0]!.text).toBe(`${parts} (${CLOSED_UP_NOTE})`);
    expect(CLOSED_UP_NOTE).toMatch(/joined: an element boundary or an unknown part/);
  });

  it.each([
    ["an entry in one piece", "<p>Sumnjivo</p>", "Sumnjivo"],
    ["an entry split by an inline element", "<p>Sum<b>njivo</b></p>", "Sumnjivo"],
    ["a phrase over a block boundary", "<div>Nestali<p>podaci</p></div>", "Nestali | podaci"],
    ["a bare contextual word", "<p>Spremljeno <Icon /> na uređaju</p>", "Spremljeno | na uređaju"],
  ])("leaves the text of a finding that needs no joining as it was: %s", (_, line, text) => {
    write("src/components/Case.tsx", component([line]));
    const found = scanUiText(root!);
    expect(found.at(-1)!.text).toBe(text);
    for (const finding of found) expect(finding.text).not.toContain(CLOSED_UP_NOTE);
  });
});

// With every boundary taken out at once, what stands before an entry touches
// it, and most entries are not found in a word that a letter touches. So the
// parts next to each other are also read closed up by themselves.
describe("an entry cut by boundaries, whatever stands next to it", () => {
  const B = PHRASE_BREAK;
  const EN = "saved (without saying where)";
  /** What it is, the parts of the text, the entries found. */
  const NEIGHBOURS: readonly [string, readonly string[], readonly string[]][] = [
    ["two parts, a part before", ["Opis", "hid", "den"], ["hidden"]],
    ["two parts, a part after", ["hid", "den", "Opis"], ["hidden"]],
    ["two parts, parts on both sides", ["Opis", "hid", "den", "Kraj"], ["hidden"]],
    ["two parts, several parts on both sides", ["Rok", "Opis", "Kopi", "rano", "Kraj", "Dalje"], ["kopirano"]],
    ["three parts, a part before", ["Opis", "Sus", "pic", "ious"], ["suspicious"]],
    ["three parts, parts on both sides", ["Opis", "Skri", "ve", "no", "Kraj"], ["skriveno"]],
    ["five parts, parts on both sides", ["Opis", "Vje", "ro", "jat", "no", "st", "Kraj"], ["vjerojatnost"]],
    ["a part for every letter, parts on both sides", ["Opis", ..."hidden", "Kraj"], ["hidden"]],
    ["a part for every letter of the longest word, parts on both sides", ["Opis", ..."vjerojatnost", "Kraj"], ["vjerojatnost"]],
    ["a part for every letter of a phrase", ["Opis", ..."proof of authorship", "Kraj"], ["proof of authorship"]],
    ["the part before ends in the one letter the entry does not follow", ["Zadatak", "ri", "zik"], ["rizik"]],
    ["an entry that must end where it ends, a part after", ["ano", "malan", "Opis"], ["anomalija, anomaly"]],
    ["an entry that must end where it ends, parts on both sides", ["Opis", "written by A", "I", "Kraj"], ["written by AI"]],
    ["a phrase with its first word whole in the part before", ["Opis", "nestali", "po", "daci", "Kraj"], ["nestali podaci"]],
    ["a phrase with its last word whole in the part after", ["Opis", "ne", "stali", "podaci", "Kraj"], ["nestali podaci"]],
    ["a phrase of four words, the last one cut", ["Opis", "warning", "about", "the", "stu", "dent", "Kraj"], ["warning about the student"]],
    ["a phrase with a cut in two of its words", ["Opis", "ne", "stali po", "daci", "Kraj"], ["nestali podaci"]],
    ["a phrase with a cut in two of its words and a quotation mark for its space", ["Opis", "ne", `stali${cp(0x201e)}`, "po", "daci", "Kraj"], ["nestali podaci"]],
    ["parts of invisible characters inside the entry", ["Opis", "hid", String.fromCodePoint(0x200b).repeat(80), String.fromCodePoint(0xad).repeat(80), "den", "Kraj"], ["hidden"]],
    ["quotation marks at the cuts", ["Opis", `hid${cp(0x201d)}`, `${cp(0x201e)}den`, "Kraj"], ["hidden"]],
    ["a contextual word, a part before", ["Opis", "Spre", "mljeno"], [HR]],
    ["a contextual word, parts on both sides", ["Opis", "sa", "ved", "Kraj"], [EN]],
    ["a contextual word cut, its place in the part after", ["Opis", "Spre", "mljeno", " na uređaju"], [HR]],
    // Nothing to report.
    ["plain words", ["Opis", "Rok", "predaje", "Kraj"], []],
    ["plain words that hold the letters of an entry between them", ["Opis", "hid", "e", "den", "Kraj"], []],
    ["an entry with a long part inside it", ["Opis", "hid", "Rok predaje zadatka je sutra u podne, a ne prekosutra navečer", "den"], []],
    ["a contextual word cut, with its place in the same part", ["Opis", "Spre", "mljeno na uređaju", "Kraj"], []],
    ["a contextual phrase whole", ["Opis", "Spremljeno na uređaju", "Kraj"], []],
    ["a contextual word cut twice, with its place in the same part", ["Opis", "Spre", "mlje", "no na uređaju", "Kraj", "Dalje"], []],
    ["a contextual word cut at quotation marks, with its place in the same part", ["Opis", `Spre${cp(0x201d)}`, `${cp(0x201e)}mljeno na uređaju`, "Kraj"], []],
    ["a contextual word cut, with its place in the same part and quotation marks around",["Opis", `${cp(0x201e)}Spre`, `mljeno na uređaju${cp(0x201d)}`, "Kraj"], []],
    ["a word that only ends like an entry", ["Opis", "aste", "risk"], ["risk"]],
  ];

  it.each(NEIGHBOURS)("%s", (_, parts, expected) => {
    const joined = parts.join(B);
    expect(findForbiddenTermsInMarkup(joined, joined).map((term) => term.entry)).toEqual(expected);
    // Empty parts between them change nothing.
    const padded = parts.join(B + B);
    expect(findForbiddenTermsInMarkup(padded, padded).map((term) => term.entry)).toEqual(expected);
  });

  it.each([
    ["items of a list", "<ul><li>Opis</li><li>hid</li><li>den</li><li>Kraj</li></ul>", "hidden", "Opis | hid | den | Kraj"],
    ["cells of a row", "<tr><td>Opis</td><td>Kopi</td><td>rano</td></tr>", "kopirano", "Opis | Kopi | rano"],
    ["unknown parts", "<p>Opis{n}Skri{n}veno{n}Kraj</p>", "skriveno", "Opis | Skri | veno | Kraj"],
    ["five cells of a row", "<tr><td>Opis</td><td>Sus</td><td>pic</td><td>ious</td><td>Kraj</td></tr>", "suspicious", "Opis | Sus | pic | ious | Kraj"],
    ["a contextual word in items of a list", "<ul><li>Opis</li><li>Spre</li><li>mljeno</li></ul>", HR, "Opis | Spre | mljeno"],
  ])("is found in %s, and the finding says that the parts were joined", (_, line, entry, parts) => {
    write("src/components/Case.tsx", component([line]));
    const found = scanUiText(root!);
    expect(found.map((finding) => finding.terms.map((term) => term.entry))).toContainEqual([entry]);
    expect(found.map((finding) => finding.text)).toContain(`${parts} (${CLOSED_UP_NOTE})`);
  });

  it("reads the same parts again by what stands around them", () => {
    const entries = (parts: readonly string[]): string[] => findForbiddenTermsInMarkup(parts.join(B), parts.join(B)).map((term) => term.entry);
    expect(entries(["Opis", "x", "po", "daci", "Kraj"])).toEqual([]);
    expect(entries(["Opis", "nestali", "po", "daci", "Kraj"])).toEqual(["nestali podaci"]);
    expect(entries(["Opis", "x", "po", "daci", "Kraj"])).toEqual([]);
  });

  it("adds nothing when the text is not read closed up", () => {
    const joined = ["Opis", "hid", "den", "Kraj"].join(B);
    expect(findForbiddenTermsInMarkup(joined, joined, false)).toEqual([]);
  });

  // Review of 8325bb0: parts without letters have no length, so a run of them
  // has to end a window by its count, and the text is then reported instead.
  const entriesIn = (parts: readonly string[]): string[] => findForbiddenTermsInMarkup(parts.join(B), parts.join(B)).map((term) => term.entry);
  const run = (count: number, part: string): string[] => Array.from({ length: count }, () => part);
  const NOTHING = cp(0x200b);
  const DOT = cp(0xb7);

  it("reads an entry over a window of 64 parts, and says that a text has a longer run of parts without letters", () => {
    expect(MAX_WINDOW_PARTS).toBe(64);
    // "hid", 62 parts of nothing and "den" are 64 parts.
    expect(entriesIn(["Opis", "hid", ...run(62, NOTHING), "den", "Kraj"])).toEqual(["hidden"]);
    expect(entriesIn(["Opis", "hid", ...run(63, NOTHING), "den", "Kraj"])).toEqual([]);
    expect(windowsCutShort(["Opis", "hid", ...run(63, NOTHING), "den", "Kraj"].join(B))).toBe(true);
    // The longest window that is read whole: 64 parts, the first and the last one with letters.
    expect(windowsCutShort(["hid", ...run(62, DOT), "den"].join(B))).toBe(false);
    expect(windowsCutShort(["hid", ...run(63, DOT), "den"].join(B))).toBe(true);
    expect(windowsCutShort(["hid", ...run(62, DOT), "den"].join(B + B))).toBe(false);
    expect(windowsCutShort(["hid", ...run(63, DOT), "den"].join(B + B))).toBe(true);
    expect(windowsCutShort(run(65, DOT).join(B))).toBe(true);
    expect(windowsCutShort(run(64, DOT).join(B))).toBe(false);
    // Wherever the run stands in the text.
    const LONG = "Rok predaje zadatka je sutra u podne, a ne prekosutra";
    // The part before the run is the first of a window as well, so one part fewer is enough there.
    expect(windowsCutShort([LONG, "a", LONG, "hid", ...run(62, DOT), "den"].join(B))).toBe(true);
    expect(windowsCutShort([LONG, "a", LONG, "hid", ...run(61, DOT), "den"].join(B))).toBe(false);
    // Only a window that its letters would not have ended: 48 of them inside it do not end it, 49 do.
    expect(windowsCutShort(["a", "b".repeat(48), ...run(62, DOT), "c"].join(B))).toBe(true);
    expect(windowsCutShort(["a", "b".repeat(49), ...run(62, DOT), "c"].join(B))).toBe(false);
    expect(windowsCutShort(["a", ...run(62, DOT), "b".repeat(48), "c"].join(B))).toBe(true);
    expect(windowsCutShort(["a", ...run(62, DOT), "b".repeat(49), "c"].join(B))).toBe(false);
  });

  it("never passes an entry cut over a run of parts without letters: it is found or the text is reported", { timeout: 60_000 }, () => {
    for (const part of [NOTHING, cp(0x201e)]) {
      for (const count of [0, 1, 2, 30, 31, 32, 60, 61, 62, 63, 64, 65, 66, 100, 140]) {
        for (const parts of [["Opis", "hid", ...run(count, part), "den", "Kraj"], ["Opis", ...run(count, part), "hid", ...run(count, part), "den"], ["Rok", "Kopi", ...run(count, part), "ra", ...run(count, part), "no", "Kraj"]]) {
          expect(entriesIn(parts).length > 0 || windowsCutShort(parts.join(B)), `${count} parts of U+${part.codePointAt(0)!.toString(16)}`).toBe(true);
        }
      }
    }
  });

  it.each([
    ["words", (index: number) => ["Opis", "Rok", "predaje", "Kraj"][index % 4]!],
    ["single letters", (index: number) => "abcdefghij"[index % 10]!],
    ["a mark after every word", (index: number) => (index % 2 === 0 ? "Rok" : DOT)],
    ["twelve marks after every word", (index: number) => (index % 13 === 0 ? "Rok predaje zadatka" : DOT)],
  ])("does not say so for a text of %s, however long", (_, part) => {
    for (const count of [3, 64, 65, 66, 500]) expect(windowsCutShort(Array.from({ length: count }, (__, index) => part(index)).join(B))).toBe(false);
  });

  it.each([
    ["marks", () => DOT],
    ["pictures", () => cp(0x1f600)],
    ["spaces", () => " "],
    ["different marks", (index: number) => `${DOT}${cp(0x2014)}${cp(0x2026)}!?:;,.`[index % 9]! + DOT.repeat(index % 7)],
  ])("reads a text with thousands of parts of %s in a time that grows with their number", { timeout: 60_000 }, (_, part) => {
    // Before the bound, 3000 such parts took two minutes and 1000 of them five seconds.
    const joined = ["hid", ...Array.from({ length: 5000 }, (__, index) => part(index)), "den"].join(B);
    const from = performance.now();
    expect(findForbiddenTermsInMarkup(joined, joined)).toEqual([]);
    expect(windowsCutShort(joined)).toBe(true);
    expect(performance.now() - from).toBeLessThan(15_000);
  });

  it("reports a text with a longer run of parts without letters than a window takes, and not a shorter one", () => {
    // A full stop: the guard has nothing else to say about it.
    const items = (count: number): string => `<ul><li>hid</li>${"<li>.</li>".repeat(count)}<li>den</li></ul>`;
    write("src/components/Case.tsx", component([items(63)]));
    expect(findUnreadableText(root!)).toEqual([{ file: "src/components/Case.tsx", line: 2, reason: `more than 64 parts of one text next to each other with hardly a letter between them (${UNREADABLE_HINTS.parts})` }]);
    expect(UNREADABLE_HINTS.parts).toMatch(/would not be found.*fewer parts/);
    write("src/components/Case.tsx", component([items(62)]));
    expect(findUnreadableText(root!)).toEqual([]);
    // The same for unknown parts in one element, and only for the text that has them:
    // the paragraph and the element around it, which starts with the same text; not the second paragraph.
    write("src/components/Case.tsx", component(["<div>", `  <p>hid${"{n}.".repeat(63)}{n}den</p>`, "  <p>Rok predaje</p>", "</div>"]));
    expect(findUnreadableText(root!).map((entry) => [entry.line, entry.reason.slice(0, 18)])).toEqual([[3, "more than 64 parts"], [3, "more than 64 parts"]]);
  });
});

describe("characters interface text may not hold", () => {
  /** What it is, the text, the code points reported. */
  const CHARACTERS: readonly [string, string, readonly string[]][] = [
    ["Cyrillic je in a Latin word", `Sumn${cp(0x458)}ivo`, ["U+0458"]],
    ["Cyrillic i", `R${cp(0x456)}zik`, ["U+0456"]],
    ["Cyrillic a", `Kopir${cp(0x430)}no`, ["U+0430"]],
    ["Greek omicron", `Skriven${cp(0x3bf)}`, ["U+03BF"]],
    ["dotless i", `R${cp(0x131)}zik`, ["U+0131"]],
    ["IPA letter", `Sum${cp(0x272)}jivo`, ["U+0272"]],
    ["Cyrillic letter in a word that is no entry", `Predan${cp(0x43e)}`, ["U+043E"]],
    ["a word written in another script", cp(0x420, 0x438, 0x441, 0x43a), ["U+0420", "U+0438", "U+0441", "U+043A"]],
    ["hair space inside a word", `Sum${cp(0x200a)}njivo`, ["U+200A"]],
    ["thin space inside a word", `Sum${cp(0x2009)}njivo`, ["U+2009"]],
    ["Braille blank inside a word", `Sum${cp(0x2800)}njivo`, ["U+2800"]],
    ["Braille blank in place of the space of a phrase", `Nestali${cp(0x2800)}podaci`, ["U+2800"]],
    ["musical null note inside a word", `Sum${cp(0x1d159)}njivo`, ["U+1D159"]],
    ["two inkless characters in a row", `Sum${cp(0x2800, 0x200a)}njivo`, ["U+2800", "U+200A"]],
    ["inkless character next to a soft hyphen", `Sum${cp(0x200a, 0xad)}njivo`, ["U+200A"]],
    ["private use code point",`Sum${cp(0xe000)}njivo`, ["U+E000"]],
    ["private use code point at the end", `Predano${cp(0xf8ff)}`, ["U+F8FF"]],
    ["unassigned code point", `Sum${cp(0x2065)}njivo`, ["U+2065"]],
    ["the same character twice", `${cp(0x430)}n${cp(0x430)}`, ["U+0430"]],
    // QA of f8722f4: between two letters only a plain space sets words apart.
    ["thin space after a hyphen inside a word", `Sum-${cp(0x2009)}njivo`, ["U+2009"]],
    ["narrow no-break space between two letters, which is thin enough to cut a word unseen", `Sum${cp(0x202f)}njivo`, ["U+202F"]],
    ["emoji between two letters, which are two words to no reader", `Predano${cp(0x1f389)}danas`, ["U+1F389"]],
    ["mathematical symbol drawn like a letter, between two letters", `S${cp(0x222a)}mnjivo`, ["U+222A"]],
    ["mathematical symbol between two letters", `Sum${cp(0x2218)}njivo`, ["U+2218"]],
    ["currency sign between two letters", `Ri${cp(0xa2)}ik`, ["U+00A2"]],
    ["modifier symbol between two letters", `Sum${cp(0xb4)}njivo`, ["U+00B4"]],
    ["arrow between two letters", `Natrag${cp(0x2192)}Dalje`, ["U+2192"]],
    ["mathematical symbol between two letters, with punctuation around it", `Sum-${cp(0x2218)}-njivo`, ["U+2218"]],
    ["currency sign between two letters, with punctuation around it", `Ri.${cp(0xa2)}.ik`, ["U+00A2"]],
    ["modifier symbol between two letters, with punctuation around it", `Sum'${cp(0xb4)}'njivo`, ["U+00B4"]],
    ["mathematical symbol in place of the first letter", `${cp(0x222b)}umnjivo`, ["U+222B"]],
    ["mathematical symbol in place of the last letter", `Sumnjiv${cp(0x2218)}`, ["U+2218"]],
    ["currency sign in place of the first letter", `${cp(0xa2)}opied`, ["U+00A2"]],
    ["modifier symbol at the end of a word", `Rizik${cp(0x2c5)}`, ["U+02C5"]],
    // Review of 2bc1f81: a punctuation mark outside ASCII stands between two letters only if it is written there.
    ["connector mark between two letters (Pc)", `Sum${cp(0x203f)}njivo`, ["U+203F"]],
    ["full width low line between two letters (Pc)", `Sum${cp(0xff3f)}njivo`, ["U+FF3F"]],
    ["upright dash between two letters (Pd)", `Sumnj${cp(0xfe31)}vo`, ["U+FE31"]],
    ["figure dash between two letters (Pd)", `Sum${cp(0x2012)}njivo`, ["U+2012"]],
    ["opening quotation mark between two letters (Ps)", `Sum${cp(0x201e)}njivo`, ["U+201E"]],
    ["full width opening bracket between two letters (Ps)", `Sum${cp(0xff08)}njivo`, ["U+FF08"]],
    ["full width closing bracket between two letters (Pe)", `Sum${cp(0xff09)}njivo`, ["U+FF09"]],
    ["closing bracket of another kind between two letters (Pe)", `Sum${cp(0x2046)}njivo`, ["U+2046"]],
    ["opening double quotation mark between two letters (Pi)", `Sum${cp(0x201c)}njivo`, ["U+201C"]],
    ["opening angle quotation mark between two letters (Pi)", `Sum${cp(0xab)}njivo`, ["U+00AB"]],
    ["closing double quotation mark between two letters (Pf)", `Sum${cp(0x201d)}njivo`, ["U+201D"]],
    ["closing angle quotation mark between two letters (Pf)", `Sum${cp(0xbb)}njivo`, ["U+00BB"]],
    ["upright bar of another script between two letters (Po)", `Sumnj${cp(0x5c0)}vo`, ["U+05C0"]],
    ["double upright line between two letters (Po)", `Sumnj${cp(0x2016)}vo`, ["U+2016"]],
    ["inverted exclamation mark between two letters (Po)", `R${cp(0xa1)}zik`, ["U+00A1"]],
    ["dagger between two letters (Po)", `Au${cp(0x2020)}enticnost`, ["U+2020"]],
    ["middle dot between two letters (Po)", `Sum${cp(0xb7)}njivo`, ["U+00B7"]],
    ["hyphenation point between two letters (Po)", `Sum${cp(0x2027)}njivo`, ["U+2027"]],
    ["full width full stop between two letters (Po)", `Sum${cp(0xff0e)}njivo`, ["U+FF0E"]],
    ["a mark that is not written there, next to one that is", `Sum${cp(0x2013, 0x5c0)}njivo`, ["U+05C0"]],
    ["quotation mark after a line break with no space, since only a plain space sets words apart", `kraj.\n${cp(0x201e)}Sada${cp(0x201d)}`, ["U+201E"]],
    ["digit of another script inside a word", `R${cp(0x661)}zik`, ["U+0661"]],
    ["digit of another script drawn like a letter, at the end of a word", `Skriven${cp(0x7c0)}`, ["U+07C0"]],
    ["number of another script drawn like a letter", `Skriven${cp(0x3007)}`, ["U+3007"]],
    ["digit of another script by itself", cp(0x665), ["U+0665"]],
    ["control character inside a word", `Sum${cp(0x1)}njivo`, ["U+0001"]],
    ["escape character", `${cp(0x1b)}[0m`, ["U+001B"]],
    ["delete character", `Sum${cp(0x7f)}njivo`, ["U+007F"]],
    ["C1 control character", `Sum${cp(0x85)}njivo`, ["U+0085"]],
    ["surrogate without its pair", `Sum${"\uD800"}njivo`, ["U+D800"]],
    // Allowed: Croatian and English text as it is written.
    ["Croatian letters", "Čekanje, ćirilica, đak, šuma, žir; DŽ, Dž, LJ, NJ", []],
    ["Latin letters with other diacritics", "Café, naïve, Zürich, Ångström", []],
    ["full width letters, which the dictionary folds", "Ｐｒｅｄａｎｏ", []],
    ["ligature", "ﬁnale", []],
    ["no-break space between words", `Spremljeno na${cp(0xa0)}uređaju`, []],
    ["symbol set apart by spaces", "Predano ✓ danas", []],
    ["symbol after a word", "Ductus © 2026", []],
    ["inkless character next to a plain space", `Rok ${cp(0x2800)}predaje`, []],
    ["punctuation, digits and line breaks", "Rok: 2. 11. 2026. (14:05)\n„Predaj” – 50 %", []],
    ["emoji after a word", "Predano 🎉", []],
    ["the marks written between two letters: apostrophe (Pf)", `it${cp(0x2019)}s, rock${cp(0x2019)}n${cp(0x2019)}roll`, []],
    ["the marks written between two letters: hyphen and non-breaking hyphen (Pd)", `e${cp(0x2010)}indeks, e${cp(0x2011)}indeks`, []],
    ["the marks written between two letters: en dash and em dash (Pd)", `Zagreb${cp(0x2013)}Split, rok${cp(0x2014)}danas`, []],
    ["the marks written between two letters: ellipsis (Po)", `Pričekaj${cp(0x2026)}spremno`, []],
    ["ASCII marks between two letters", "on-line, it's, a.b, a_b, a/b, (a)b, a:b, a\"b\"c, a!b, a,b;c", []],
    ["quotation marks and brackets at the edge of a word", `Gumb ${cp(0x201e)}Predaj${cp(0x201d)} i ${cp(0xab)}Natrag${cp(0xbb)}, (${cp(0x201c)}Rok${cp(0x201d)}), ${cp(0x2018)}da${cp(0x2019)}`, []],
    ["marks outside ASCII at the edge of a word or between digits", `${cp(0xa1)}Hola!, Autor${cp(0x2020)}, 3${cp(0xb7)}4, Naslov ${cp(0xb7)} Autor, ${cp(0x2022)} Stavka`, []],
    ["narrow no-break space between a number and its unit", `5${cp(0x202f)}kg i 20${cp(0x202f)}%`, []],
    ["numbers that fold to ASCII digits and Latin letters", "m², ½ sata, ① korak, Ⅳ. poglavlje, １２", []],
    ["ASCII symbols between letters, which the source shows as they are", "a+b, x=y, C|D, cijena$dan, a~b, a^b, a`b, a<b>c", []],
    ["degree sign and marks at the edge of a word", "20 °C, Ductus™, ©Autor, ®Znak", []],
    ["mathematical and currency symbols set apart or next to digits", "Natrag ← → Dalje, 3×4, 3 × 4, 5 €, 5€, ±2, a ≤ b", []],
    ["control characters that are white space", "a\tb\nc\vd\fe\rf", []],
    ["line separator, which a page may show as nothing", `Rok${cp(0x2028)}predaje`, ["U+2028"]],
    // What the dictionary matching already takes out of a word (invisible format characters, marks, fillers).
    ["soft hyphen, zero width space and joiner", `Pre${cp(0xad)}da${cp(0x200b)}n${cp(0x200d)}o`, []],
    ["combining mark and variation selector", `Pre${cp(0x34f)}da${cp(0xfe0f)}no`, []],
    ["Hangul filler", `Pre${cp(0x115f)}dano`, []],
  ];

  it.each(CHARACTERS)("%s", (_, text, expected) => {
    expect(unreadableCharacters(text)).toEqual(expected);
  });

  // Every code point, so that no category is left to chance: outside ASCII,
  // a mark, a symbol or a space between two letters is reported unless it is
  // one of these, which are written out here a second time on purpose.
  it("reports every punctuation mark, symbol and space outside ASCII between two letters, but for a short list", () => {
    const written = [0xa0, 0x2010, 0x2011, 0x2013, 0x2014, 0x2019, 0x2026];
    const passed: number[] = [];
    let seen = 0;
    for (let code = 0x80; code <= 0x10ffff; code += 1) {
      if (code >= 0xd800 && code <= 0xdfff) continue;
      const char = cp(code);
      if (!/[\p{P}\p{S}\p{Zs}]/u.test(char)) continue;
      seen += 1;
      if (unreadableCharacters(`Sum${char}njivo`).length === 0) passed.push(code);
      else expect(unreadableCharacters(`Sum${char}njivo`)).toEqual([`U+${code.toString(16).toUpperCase().padStart(4, "0")}`]);
    }
    expect(seen).toBeGreaterThan(8000);
    expect(passed).toEqual(written);
  });

  it("leaves what the dictionary already takes out of a word to the dictionary", () => {
    for (const inside of [cp(0xad), cp(0x200b), cp(0x34f), cp(0xfe0f), cp(0xe0041), cp(0x115f), cp(0x180e), cp(0x17b5)]) {
      expect(findForbiddenTerms(`Sum${inside}njivo`).map((term) => term.entry)).toEqual(["sumnjivo"]);
    }
  });
});

describe("text the scan cannot read", () => {
  it("reports a character outside interface text wherever a scanned file holds it, without quoting the text", () => {
    write("app/page.tsx", `export default () => (\n  <main>\n    <p>Predan${cp(0x43e)}</p>\n    <img alt="R${cp(0x131)}zik" />\n  </main>\n);\n`);
    write("src/domain/sync/labels.ts", `export const A = "Predano";\nexport const B = "Sum${cp(0x2800)}njivo";\n`);
    write("src/domain/sync/state.ts", `export const A = "kopir${cp(0x430)}no";\n`);
    write("src/lib/i18n/hr.json", `{\n  "a": "Predano",\n  "b": "Sumn${cp(0x458)}ivo"\n}\n`);
    write("src/components/Row.tsx", `export const Row = () => <p title={"Skr${cp(0x456)}veno"}>{"Stanje" + "${cp(0xe000)}"}</p>;\n`);
    const found = findUnreadableText(root!);
    expect(found.map((entry) => [entry.file, entry.line, (entry.reason.match(/U\+[0-9A-F]+/g) ?? []).join(", ")])).toEqual([
      ["app/page.tsx", 3, "U+043E"],
      ["app/page.tsx", 4, "U+0131"],
      ["src/components/Row.tsx", 1, "U+0456"],
      ["src/components/Row.tsx", 1, "U+E000"],
      ["src/domain/sync/labels.ts", 2, "U+2800"],
      ["src/domain/sync/state.ts", 1, "U+0430"],
      ["src/lib/i18n/hr.json", 3, "U+0458"],
    ]);
    // The reason names code points and says what to do, also for a string that is not interface text; it never quotes the text.
    for (const entry of found) {
      const [what, ...rest] = entry.reason.split(" (");
      expect(what).toMatch(/^characters outside interface text: U\+[0-9A-F]{4,6}(?:, U\+[0-9A-F]{4,6})*$/);
      expect(rest.join(" (")).toBe(`${UNREADABLE_HINTS.characters})`);
    }
    expect(UNREADABLE_HINTS.characters).toMatch(/Croatian or English letters/);
    expect(UNREADABLE_HINTS.characters).toMatch(/not interface text.*String\.fromCodePoint/);
  });

  // QA of f8722f4: a character that says nothing by itself can be a part of
  // its own between two parts with letters, so the guard reads the unit.
  const between = "characters outside interface text, where its parts meet";
  const part = (code: number): string => JSON.stringify(cp(code));
  /** How the text is put together, the JSX around the odd part. */
  const MEETING: readonly [string, (odd: string) => string][] = [
    ["an expression of its own", (odd) => `<p>Sum{${odd}}njivo</p>`],
    ["the content of an inline element", (odd) => `<p>Sum<span>{${odd}}</span>njivo</p>`],
    ["an inline element between two others", (odd) => `<p><b>Sum</b><i>{${odd}}</i><b>njivo</b></p>`],
    ["an item of an array", (odd) => `<p>{["Sum", ${odd}, "njivo"]}</p>`],
    ["a place in a template", (odd) => `<p>{\`Sum\${${odd}}njivo\`}</p>`],
    ["an item of an array in an attribute", (odd) => `<img alt={["Sum", ${odd}, "njivo"]} />`],
    ["a place in a template of an attribute", (odd) => `<img alt={\`Sum\${${odd}}njivo\`} />`],
    ["a part after an unknown one", (odd) => `<p>Sum{n}{${odd}}njivo</p>`],
    ["one side of a condition", (odd) => `<p>Sum{n ? ${odd} : "-"}njivo</p>`],
    ["the other side of a condition", (odd) => `<p>Sum{n ? "-" : ${odd}}njivo</p>`],
    ["a block between two blocks", (odd) => `<div><div>Sum</div><div>{${odd}}</div><div>njivo</div></div>`],
  ];
  const ODD_PARTS: readonly [string, number][] = [
    ["thin space", 0x2009],
    ["hair space", 0x200a],
    ["narrow no-break space", 0x202f],
    ["Braille blank", 0x2800],
    ["mathematical symbol drawn like a letter", 0x222a],
  ];

  it.each(MEETING.flatMap(([how, build]) => ODD_PARTS.map(([what, code]) => [what, how, build(part(code)), code] as const)))(
    "reports a %s that is %s between two parts with letters",
    (_, __, line, code) => {
      write("src/components/Case.tsx", component([line]));
      // The dictionary does not find the entry: the guard is what stops it.
      expect(scanUiText(root!)).toEqual([]);
      const found = findUnreadableText(root!);
      expect(found.map((entry) => [entry.file, entry.line])).toEqual([["src/components/Case.tsx", 2]]);
      expect(found[0]!.reason).toBe(`${between}: U+${code.toString(16).toUpperCase()} (${UNREADABLE_HINTS.meeting})`);
    },
  );

  it.each([
    ["a symbol in place of the first letter, as a part of its own", `<p>{${part(0x222b)}}umnjivo</p>`, "U+222B"],
    ["a symbol in place of the last letter, as a part of its own", `<p>Sumnjiv<b>{${part(0x2218)}}</b></p>`, "U+2218"],
    ["a mark drawn like a letter, as a part of its own", `<p>Sumnj{${part(0x5c0)}}vo</p>`, "U+05C0"],
    ["a mark that is not written between two letters, between two elements", `<p><b>Natrag</b><i>{${part(0xb7)}}</i><b>Dalje</b></p>`, "U+00B7"],
    ["a symbol between two parts of an attribute", `<img alt={["Natrag", ${part(0x2192)}, "Dalje"]} />`, "U+2192"],
    // Closed up, as the dictionary reads it: an unknown part does not keep the symbol from the word.
    ["a symbol in place of the first letter, with an unknown part after it", `<p>{${part(0x222b)}}<span />umnjivo</p>`, "U+222B"],
    ["a symbol in place of the last letter, with an unknown part before it", `<p>Sumnjiv{n}{${part(0x2218)}}</p>`, "U+2218"],
  ])("reports %s", (_, line, code) => {
    write("src/components/Case.tsx", component([line]));
    expect(findUnreadableText(root!).map((entry) => entry.reason)).toEqual([`${between}: ${code} (${UNREADABLE_HINTS.meeting})`]);
  });

  it.each([
    ["a plain space as a part of its own", '<p>Rok{" "}predaje</p>'],
    ["a no-break space as a part of its own", `<p>Rok{${part(0xa0)}}predaje</p>`],
    ["an odd space next to a plain one", `<p>Rok {${part(0x2009)}}predaje</p>`],
    ["an odd space between a number and its unit", `<p>5{${part(0x202f)}}kg</p>`],
    ["a symbol set apart by plain spaces in parts of their own", `<p>Natrag{" "}<span>{${part(0x2192)}}</span>{" "}Dalje</p>`],
    ["a dash as a part of its own between two words", `<p><b>Zagreb</b>{${part(0x2013)}}<b>Split</b></p>`],
    ["a mark set apart by plain spaces in parts of their own", `<p>Natrag{" "}<span>{${part(0xb7)}}</span>{" "}Dalje</p>`],
    ["words in parts next to each other", "<tr><td>Od</td><td>do</td><td><b>Rok</b>predaje</td></tr>"],
    ["an odd space at the end of the text", `<p>Predano{${part(0x2009)}}</p>`],
  ])("does not report %s", (_, line) => {
    write("src/components/Case.tsx", component([line]));
    expect(findUnreadableText(root!)).toEqual([]);
  });

  // Review of 92793ef: a paragraph or a list item that begins or ends with a
  // quotation mark is ordinary text. The guard leaves out Croatian and English
  // quotation marks next to an element boundary, and may do so only because
  // the dictionary reads the text without them: an entry cut there is found.
  const QUOTES: readonly [string, number, number][] = [
    ["Croatian quotation marks", 0x201e, 0x201d],
    ["English quotation marks", 0x201c, 0x201d],
    ["angle quotation marks", 0xbb, 0xab],
    ["single quotation marks", 0x2018, 0x2019],
    ["low single quotation mark", 0x201a, 0x2018],
  ];
  const BLOCKS: readonly [string, (first: string, second: string, third: string) => string][] = [
    ["paragraphs", (first, second, third) => `<div><p>${first}</p><p>${second}</p><p>${third}</p></div>`],
    ["items of a list", (first, second, third) => `<ul><li>${first}</li><li>${second}</li><li>${third}</li></ul>`],
    ["a heading and paragraphs", (first, second, third) => `<section><h2>${first}</h2><p>${second}</p><p>${third}</p></section>`],
  ];
  const QUOTED = BLOCKS.flatMap(([blocks, build]) => QUOTES.map(([marks, open, close]) => [blocks, marks, build, cp(open), cp(close)] as const));

  it.each(QUOTED)("does not report %s that begin or end with %s", (_, __, build, open, close) => {
    for (const [first, second, third] of [
      ["Pritisni gumb.", `${open}Predaj${close}`, "Zatim pričekaj"],
      ["Pritisni gumb", `${open}Predaj${close}.`, "Zatim pričekaj"],
      [`Što znači ${open}predano${close}?`, "Rad je predan", `(${open}Rok${close})`],
      [`Gumb ${open}Predaj${close}`, `${open}Natrag${close}, ${open}Dalje${close}`, "Kraj"],
    ] as const) {
      write("src/components/Case.tsx", component([build(first, second, third)]));
      expect(findUnreadableText(root!)).toEqual([]);
      expect(scanUiText(root!)).toEqual([]);
    }
  });

  it.each(QUOTED)("finds an entry cut between %s with %s at the cut", (_, __, build, open, close) => {
    for (const [first, second] of [
      ["Sum", `${open}njivo`],
      [`Sum${close}`, "njivo"],
      [`Sum${close}`, `${open}njivo`],
      [`Sum${close}${close}`, `${open}${open}njivo`],
      [`Ri${open}`, `${close}zik`],
    ] as const) {
      write("src/components/Case.tsx", component([build(first, second, "Kraj")]));
      const found = scanUiText(root!);
      expect(found.flatMap((finding) => finding.terms.map((term) => term.entry))).toHaveLength(1);
      expect(found[0]!.text).toContain(CLOSED_UP_NOTE);
    }
    write("src/components/Case.tsx", component([build("Spre", `${open}mljeno${close}`, "Kraj")]));
    expect(scanUiText(root!).flatMap((finding) => finding.terms.map((term) => term.entry))).toEqual([HR]);
  });

  it.each([
    ["a quotation mark between two letters of one string", `<p>{"Gumb${cp(0x201e)}Predaj"}</p>`, "U+201E"],
    ["a quotation mark at an inline boundary, where no phrase ends", `<p><b>Gumb</b>${cp(0x201e)}Predaj${cp(0x201d)}</p>`, "U+201E"],
    ["a bracket outside ASCII at the start of a block", `<div><p>Pritisni gumb.</p><p>${cp(0xff08)}Predaj${cp(0xff09)}</p></div>`, "U+FF08"],
    ["a quotation mark of another language at the start of a block", `<div><p>Pritisni gumb.</p><p>${cp(0x300c)}Predaj${cp(0x300d)}</p></div>`, "U+300C"],
    ["a mark drawn like a letter next to a quotation mark at a boundary", `<div><p>Sumnj${cp(0x201d)}</p><p>${cp(0x5c0)}vo</p></div>`, "U+05C0"],
    ["an odd space next to a quotation mark at a boundary", `<div><p>Sum${cp(0x201d)}</p><p>{${part(0x2009)}}njivo</p></div>`, "U+2009"],
  ])("still reports %s", (_, line, code) => {
    write("src/components/Case.tsx", component([line]));
    expect(findUnreadableText(root!).map((entry) => entry.reason.match(/U\+[0-9A-F]+/g))).toContainEqual([code]);
  });

  it("closes a text up past quotation marks only where a phrase ends between two words", () => {
    const B = PHRASE_BREAK;
    const [open, close] = [cp(0x201e), cp(0x201d)];
    expect(closedUpPastQuotes(`gumb.${B}${open}Predaj${close}${B}Zatim`)).toBe("gumb.PredajZatim");
    expect(closedUpPastQuotes(`znači ${open}predano${close}?${B}${B}Rad`)).toBe(`znači ${open}predano?Rad`);
    expect(closedUpPastQuotes(`Sum${close}${B} ${B}${open}njivo`)).toBe("Sum njivo");
    expect(closedUpPastQuotes(`Gumb${open}Predaj${close} je`)).toBe(`Gumb${open}Predaj${close} je`);
    expect(closedUpPastQuotes(`Sum${B}${cp(0xff08)}${cp(0x2009)}njivo`)).toBe(`Sum${cp(0xff08)}${cp(0x2009)}njivo`);
    expect(UNREADABLE_HINTS.meeting).toMatch(/only a plain space sets words apart: an element boundary, a line break and ASCII punctuation do not/);
    expect(UNREADABLE_HINTS.meeting).toMatch(/Put \{" "\} between the two parts or elements/);
  });

  it("reports a character once: in the string that holds it, and not again for the text around it", () => {
    write("src/components/Case.tsx", component([`<p>Rok <b>{"Sum${cp(0x2009)}njivo"}</b> i {"R${cp(0x456)}zik"}</p>`]));
    expect(findUnreadableText(root!).map((entry) => entry.reason.split(" (")[0])).toEqual([
      "characters outside interface text: U+2009",
      "characters outside interface text: U+0456",
    ]);
  });

  it("reports a character where parts meet although a string elsewhere in the file was reported for it", () => {
    write("src/components/Case.tsx", `const LABEL = "Sum${cp(0x2009)}njivo";\n${component([`<p>Ri{${part(0x2009)}}zik</p>`])}`);
    expect(findUnreadableText(root!).map((entry) => [entry.line, entry.reason.split(" (")[0]])).toEqual([
      [1, "characters outside interface text: U+2009"],
      [3, `${between}: U+2009`],
    ]);
  });

  it("reports a control character and a digit of another script in any string of a scanned file", () => {
    write("src/domain/sync/state.ts", `export const A = "Sum${cp(0x1)}njivo";\nexport const B = "R${cp(0x661)}zik";\nexport const C = " \\t\\n\\r\\f\\v(";\n`);
    expect(findUnreadableText(root!).map((entry) => [entry.line, entry.reason.split(" (")[0]])).toEqual([
      [1, "characters outside interface text: U+0001"],
      [2, "characters outside interface text: U+0661"],
    ]);
  });

  it("does not report a character that the source builds from its code point", () => {
    write("src/domain/sync/state.ts", "export const SAMPLE = `kopir${String.fromCodePoint(0x430)}no`;\n");
    expect(findUnreadableText(root!)).toEqual([]);
  });

  const alternatives = (count: number): string[] => Array.from({ length: count }, (_, index) => `  {${"abcdefg"[index]} ? "${index}" : "-"}`);

  it("reports a text with more readings than are kept, and not one within the limit", () => {
    write("src/components/Case.tsx", component(["<p>", ...alternatives(6), '  Sum{g ? "njivo" : "njiva"}', "</p>"]));
    const reason = `more than 64 readings of one text (${UNREADABLE_HINTS.readings})`;
    expect(UNREADABLE_HINTS.readings).toMatch(/inline parts into elements of their own/);
    expect(findUnreadableText(root!)).toEqual([{ file: "src/components/Case.tsx", line: 3, reason }]);
    write("src/components/Case.tsx", component(["<p>", ...alternatives(5), '  Sum{g ? "njivo" : "njiva"}', "</p>"]));
    expect(findUnreadableText(root!)).toEqual([]);
    expect(scanUiText(root!).flatMap((finding) => finding.terms.map((term) => term.entry))).toEqual(["sumnjivo"]);
  });

  // Mutants that survived the QA of f8722f4.
  it("marks only the text that has too many readings, not the one after it", () => {
    write("src/components/Case.tsx", component(["<div>", "  <p>", ...alternatives(6).map((line) => `  ${line}`), '    Sum{g ? "njivo" : "njiva"}', "  </p>", "  <p>Rok predaje</p>", '  <img alt={"Rok" + n} />', "</div>"]));
    const found = findUnreadableText(root!);
    // The outer element holds the text of the first paragraph; the second paragraph and the attribute do not.
    expect(found.map((entry) => entry.line)).toEqual([3, 4]);
    for (const entry of found) expect(entry.reason).toMatch(/^more than 64 readings/);
  });

  it("reads an item of an array that it cannot read as an unknown part, not as nothing", () => {
    // Read as nothing, the place would follow the word in one phrase and clear it.
    for (const line of ['<p>{["Spremljeno", ...a, " na uređaju"]}</p>', '<p>{["Spremljeno", , " na uređaju"]}</p>']) {
      write("src/components/Case.tsx", component([line]));
      expect(scanUiText(root!).flatMap((finding) => finding.terms.map((term) => term.entry))).toEqual([HR]);
    }
    write("src/components/Case.tsx", component(['<p>{["Sum", ...a, "njivo"]}</p>']));
    expect(scanUiText(root!).map((finding) => finding.text)).toEqual([`Sum | njivo (${CLOSED_UP_NOTE})`]);
  });

  it("reports the same for an attribute", () => {
    write("src/components/Case.tsx", component([`<Field hint={${Array.from({ length: 7 }, (_, index) => `(${"abcdefg"[index]} ? "x" : "y")`).join(" + ")}} />`]));
    expect(findUnreadableText(root!).map((entry) => entry.reason)).toEqual([`more than 64 readings of one text (${UNREADABLE_HINTS.readings})`]);
  });

  it("finds none in this repository (write the text in Croatian or English letters, or split the element)", () => {
    expect(findUnreadableText(REPO_ROOT)).toEqual([]);
  });
});

// QA of 2b6b414: a file that does not parse, or is not UTF-8, was read as
// far as the parser or the decoder could guess and passed with no finding.
// Each of the three checks now stops on it, and the process that runs them
// ends with an exit code that is not 0.
describe("a file the scan cannot read", () => {
  const CHECKS = { scanUiText, findUnreadableText, findMisplacedUiText } as const;
  const names = Object.keys(CHECKS) as (keyof typeof CHECKS)[];
  const writeBytes = (relative: string, bytes: readonly number[]): void => {
    write(relative, "");
    writeFileSync(path.join(root!, ...relative.split("/")), Buffer.from(bytes));
  };
  /** The checks that read a file: the guard for misplaced text reads only the modules outside the text modules. */
  const readBy = (file: string): (keyof typeof CHECKS)[] => names.filter((name) => name !== "findMisplacedUiText" || (file.endsWith("ts") && !file.endsWith(".tsx") && !/(?:labels|messages)\.ts$/.test(file)));
  /** What it is, the file, its content, the error. */
  const BROKEN: readonly [string, string, string, RegExp][] = [
    ["a component with an element that is not closed", "src/components/Case.tsx", "export const C = <p>Predano", /^src\/components\/Case\.tsx:1: the file does not parse, so the scan cannot read it \(TS\d+, 2 in all\)$/],
    ["a component with an error on a later line", "src/components/Case.tsx", "export const C = () => (\n  <p>Rok</p>\n  <p>Predano</p>\n);\n", /^src\/components\/Case\.tsx:[2-4]: the file does not parse/],
    ["a text module with a string that is not closed", "src/domain/sync/labels.ts", 'export const LABEL = "Predano;\n', /^src\/domain\/sync\/labels\.ts:1: the file does not parse/],
    ["a module outside the text modules", "src/domain/sync/state.ts", "export const STATE = {;\n", /^src\/domain\/sync\/state\.ts:1: the file does not parse/],
    ["a module under app", "app/api/status/route.ts", "export function GET( {\n", /^app\/api\/status\/route\.ts:[12]: the file does not parse/],
    // Review of f08b750: the errors are asked for through the compiler's own interface, for both kinds of file.
    ["a component with a closing tag of another element", "src/components/Case.tsx", "export const C = () => <p>Predano</div>;\n", /^src\/components\/Case\.tsx:1: the file does not parse, so the scan cannot read it \(TS\d+, \d+ in all\)$/],
    ["a component with an expression that is not closed", "src/components/Case.tsx", 'import { Icon } from "./Icon";\n\nexport const C = () => <p>{"Predano"</p>;\n', /^src\/components\/Case\.tsx:3: the file does not parse/],
    ["a component with a second element next to the first", "app/rad/page.tsx", "export default function Page() {\n  return <p>Rok</p><p>Predano</p>;\n}\n", /^app\/rad\/page\.tsx:2: the file does not parse/],
    ["a text module with a template that is not closed", "src/domain/sync/messages.ts", "export const MESSAGE = `Predano ${1;\n", /^src\/domain\/sync\/messages\.ts:[12]: the file does not parse, so the scan cannot read it \(TS\d+, \d+ in all\)$/],
    ["a module with JSX, which a module cannot hold", "src/domain/sync/state.ts", "export const STATE = <p>Predano</p>;\n", /^src\/domain\/sync\/state\.ts:1: the file does not parse/],
    ["a module with the other extension", "src/domain/sync/state.mts", "export const STATE = [1, 2;\n", /^src\/domain\/sync\/state\.mts:1: the file does not parse/],
  ];

  it.each(BROKEN)("stops on %s", (_, file, content, message) => {
    write(file, content);
    for (const name of readBy(file)) expect(() => CHECKS[name](root!), name).toThrow(message);
    // The message names the file and the line, and never quotes the text.
    expect(() => scanUiText(root!)).not.toThrow(/Predano|Rok/);
  });

  /** What it is, the file, its bytes. */
  const NOT_UTF8: readonly [string, string, readonly number[]][] = [
    ["a component of bytes that are no text", "src/components/Case.tsx", [0xff, 0xfe, 0xff]],
    ["a component with one byte that is not UTF-8 inside a word", "src/components/Case.tsx", [...Buffer.from("export const C = () => <p>Sum"), 0xff, ...Buffer.from("njivo</p>;\n")]],
    ["a component with a sequence that is cut short", "src/components/Case.tsx", [...Buffer.from("export const C = () => <p>Rok"), 0xc5, ...Buffer.from("</p>;\n")]],
    ["a component with a surrogate written as three bytes", "src/components/Case.tsx", [...Buffer.from('export const C = "'), 0xed, 0xa0, 0x80, ...Buffer.from('";\n')]],
    ["a text module", "src/domain/sync/labels.ts", [...Buffer.from('export const LABEL = "Rok'), 0x80, ...Buffer.from('";\n')]],
    ["a module outside the text modules", "src/domain/sync/state.ts", [...Buffer.from('export const STATE = "a'), 0xfe, ...Buffer.from('";\n')]],
    ["a catalogue", "src/lib/i18n/hr.json", [...Buffer.from('{ "title": "Rok'), 0xff, ...Buffer.from('" }\n')]],
  ];

  it.each(NOT_UTF8)("stops on %s that is not UTF-8", (_, file, bytes) => {
    writeBytes(file, bytes);
    const message = `${file}: the file is not valid UTF-8, so the scan cannot read it`;
    for (const name of readBy(file)) expect(() => CHECKS[name](root!), name).toThrow(message);
  });

  it("stops on a catalogue that is not JSON, as before", () => {
    write("src/lib/i18n/hr.json", '{ "title": "Rok" ');
    expect(() => scanUiText(root!)).toThrow(SyntaxError);
    expect(() => findUnreadableText(root!)).toThrow(SyntaxError);
    // A byte order mark is kept in what is read, as it was, so a catalogue that starts with one is not JSON.
    write("src/lib/i18n/hr.json", `${cp(0xfeff)}{ "title": "Rok" }\n`);
    expect(() => scanUiText(root!)).toThrow(SyntaxError);
  });

  // Only syntax stops a check. What a type checker would refuse (a module that
  // is not there, a value of the wrong type, a name nobody declared) is for
  // `tsc` to say, and such a file is read like any other.
  it("reads a file that parses although it would not type check", () => {
    write("src/components/Case.tsx", 'import { Missing } from "./nowhere";\nimport type { Props } from "@/none";\n\nconst count: number = "tri";\n\nexport const Case = (props: Props) => <Missing {...props} value={undeclared}>Sumnjivo {count}</Missing>;\n');
    write("src/domain/sync/state.ts", 'import { nothing } from "node:nothing";\n\nexport const STATE: string = nothing satisfies number;\nexport enum Kind {\n  A = "a",\n}\ndeclare const later: unique symbol;\nexport type Later = typeof later;\n');
    write("app/api/status/route.ts", "export async function GET(): Promise<Response> {\n  return await fetch(missing);\n}\n");
    expect(scanUiText(root!).flatMap((finding) => finding.terms.map((term) => term.entry))).toEqual(["sumnjivo"]);
    expect(findUnreadableText(root!)).toEqual([]);
    expect(findMisplacedUiText(root!)).toEqual([]);
  });

  it("reads files that parse and are UTF-8 as before, with or without a byte order mark", () => {
    write("src/components/Case.tsx", `${cp(0xfeff)}${component(["<p>Sumnjivo. Čćđšž</p>"])}`);
    write("src/domain/sync/labels.ts", 'export const LABEL = "Rok predaje – „sutra”";\n');
    write("src/domain/sync/state.ts", "export const STATE = { open: true } as const;\n");
    write("src/lib/i18n/hr.json", '{ "title": "Rok" }\n');
    expect(scanUiText(root!).flatMap((finding) => finding.terms.map((term) => term.entry))).toEqual(["sumnjivo"]);
    expect(findUnreadableText(root!)).toEqual([]);
    expect(findMisplacedUiText(root!)).toEqual([]);
  });

  it("does not stop on a file it does not read", () => {
    writeBytes("src/components/Case.test.tsx", [0xff, 0xfe, 0xff]);
    write("src/components/Other.spec.tsx", "export const C = <p>Predano");
    writeBytes("src/assets/picture.png", [0x89, 0x50, 0x4e, 0x47, 0xff]);
    for (const name of names) expect(CHECKS[name](root!), name).toEqual([]);
  });

  // The checks run inside a test run, and a check that throws is what fails
  // it. This runs them the same way in a process of their own and reads the
  // exit code: 0 for a clean tree, 3 for a finding, and 1, with the file
  // named, when a file cannot be read.
  it("ends the process that runs the checks with an exit code that is not 0", () => {
    const work = mkdtempSync(path.join(tmpdir(), "ductus-terms-run-"));
    try {
      const typescript = createRequire(import.meta.url).resolve("typescript");
      for (const name of ["scan", "terms", "entities"]) {
        const written = readFileSync(path.join(REPO_ROOT, "scripts", "forbidden-terms", `${name}.ts`), "utf8");
        const { outputText } = ts.transpileModule(written, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
        writeFileSync(path.join(work, `${name}.mjs`), outputText.replace(/from "\.\/(terms|entities)"/g, 'from "./$1.mjs"').replace('from "typescript"', `from ${JSON.stringify(pathToFileURL(typescript).href)}`));
      }
      writeFileSync(
        path.join(work, "run.mjs"),
        'import { findMisplacedUiText, findUnreadableText, scanUiText } from "./scan.mjs";\nconst root = process.argv[2];\nconst found = [...scanUiText(root), ...findUnreadableText(root), ...findMisplacedUiText(root)];\nprocess.exit(found.length > 0 ? 3 : 0);\n',
      );
      const run = (): { status: number | null; stderr: string } => spawnSync(process.execPath, [path.join(work, "run.mjs"), root!], { encoding: "utf8" });

      write("src/components/Case.tsx", component(["<p>Rok predaje</p>"]));
      expect(run()).toMatchObject({ status: 0, stderr: "" });
      write("src/components/Case.tsx", component(["<p>Sumnjivo</p>"]));
      expect(run().status).toBe(3);
      write("src/components/Case.tsx", "export const C = <p>Predano");
      const broken = run();
      expect(broken.status).toBe(1);
      expect(broken.stderr).toContain("src/components/Case.tsx:1: the file does not parse, so the scan cannot read it");
      writeBytes("src/components/Case.tsx", [0xff, 0xfe, 0xff]);
      const bytes = run();
      expect(bytes.status).toBe(1);
      expect(bytes.stderr).toContain("src/components/Case.tsx: the file is not valid UTF-8, so the scan cannot read it");
      write("src/components/Case.tsx", component(["<p>Rok predaje</p>"]));
      writeBytes("src/domain/sync/state.ts", [...Buffer.from('export const STATE = "a'), 0xfe, ...Buffer.from('";\n')]);
      expect(run().status).toBe(1);
      // A module that does not parse, with the component next to it in order.
      write("src/domain/sync/state.ts", "export const STATE = {;\n");
      const plain = run();
      expect(plain.status).toBe(1);
      expect(plain.stderr).toContain("src/domain/sync/state.ts:1: the file does not parse, so the scan cannot read it");
      write("src/domain/sync/state.ts", "export const STATE = {};\n");
      expect(run()).toMatchObject({ status: 0, stderr: "" });
      // QA of e11efe6: what reaches a page from a file that is not read is a finding of the guard, so the code is 3.
      write("src/components/Case.spec.tsx", "export default function Case() { return <p>Sumnjivo</p>; }\n");
      write("app/rad/page.tsx", 'import Case from "../../src/components/Case.spec";\nexport default function Page() { return <Case />; }\n');
      expect(run()).toMatchObject({ status: 3, stderr: "" });
      write("app/rad/page.tsx", 'import copy from "./missing.json";\nexport default function Page() { return <p>{copy.title}</p>; }\n');
      expect(run()).toMatchObject({ status: 3, stderr: "" });
      write("app/rad/copy.json", '{ "title": "Sumnjivo" }');
      write("app/rad/page.tsx", 'import copy from "./copy.json";\nexport default function Page() { return <p>{copy.title}</p>; }\n');
      expect(run()).toMatchObject({ status: 3, stderr: "" });
      write("src/domain/sync/labels.ts", 'export const LABEL = "Sum" + "njivo";\n');
      write("app/rad/copy.json", '{ "title": "Rok" }');
      expect(run()).toMatchObject({ status: 3, stderr: "" });
      write("src/domain/sync/labels.ts", 'export const LABEL = "Rok " + "predaje";\n');
      expect(run()).toMatchObject({ status: 0, stderr: "" });
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 60_000);
});

// Review of 2f797cc: the mark that stands where a phrase ends was a line
// feed, so closing a text up also took out the line breaks that are written
// in it, and two words on two lines were read as one. The mark is now a code
// point that is no character; a line break that is written stays where it is.
describe("a line break written in the text is not a boundary to close up", () => {
  const B = PHRASE_BREAK;
  const entries = (): string[] => scanUiText(root!).flatMap((finding) => finding.terms.map((term) => term.entry));
  const [LF, CRLF, TAB] = ["\n", "\r\n", "\t"];

  /** What it is, the content of the file with `|` where the white space goes. */
  const WRITTEN: readonly [string, string, string][] = [
    ["a string in JSX", "src/components/Case.tsx", 'export const Case = () => <p>{"Sum|njivo"}</p>;\n'],
    ["a template in JSX", "src/components/Case.tsx", "export const Case = () => <p>{`Sum|njivo`}</p>;\n"],
    ["a template with a placeholder in JSX", "src/components/Case.tsx", "export const Case = ({ n }: Props) => <p>{`${n} Kopi|rano`}</p>;\n"],
    ["a chain in JSX", "src/components/Case.tsx", 'export const Case = () => <p>{"Hid|" + "den"}</p>;\n'],
    ["an attribute", "src/components/Case.tsx", 'export const Case = () => <img alt={"Sus|picious"} />;\n'],
    ["a string of a text module", "src/domain/sync/labels.ts", 'export const A = "Sum|njivo";\n'],
    ["a chain of a text module", "src/domain/sync/labels.ts", 'export const A = "Skri|" + "veno";\n'],
    ["a template of a text module", "src/domain/sync/labels.ts", "export const A = (n: number) => `${n} Prepi|sano`;\n"],
    ["a string outside the text modules", "src/domain/sync/state.ts", 'export const A = "Sum|njivo";\n'],
    ["a catalogue", "src/lib/i18n/hr.json", '{ "title": "Sum|njivo" }\n'],
  ];
  /** How the white space is written: by its escape, or as itself where the source can hold it. */
  const SPACES: readonly [string, string, string | null][] = [
    ["a line feed", "\\n", LF],
    ["a carriage return and a line feed", "\\r\\n", CRLF],
    ["a tab", "\\t", TAB],
  ];

  it.each(WRITTEN.flatMap(([what, file, content]) => SPACES.map(([space, escape, raw]) => [what, space, file, content, escape, raw] as const)))("%s with %s between two halves of an entry", (_, __, file, content, escape, raw) => {
    write(file, content.replace("|", escape));
    expect(entries()).toEqual([]);
    expect(findUnreadableText(root!)).toEqual([]);
    // Only a template can hold the white space as itself.
    if (content.includes("`") && raw !== null) {
      write(file, content.replace("|", raw));
      expect(entries()).toEqual([]);
      expect(findUnreadableText(root!)).toEqual([]);
    }
  });

  it.each([LF, CRLF, TAB, `${LF}${LF}`, ` ${LF} `])("reads two words with white space written between them as two words: %j", (space) => {
    for (const [first, second] of [["Sum", "njivo"], ["Hid", "den"], ["Nestali po", "daci"], ["Spre", "mljeno"], ["sa", "ved"]] as const) {
      const text = `${first}${space}${second}`;
      expect(findForbiddenTermsInMarkup(text, text)).toEqual([]);
      expect(findForbiddenTermsInMarkup(`Opis${B}${text}${B}Kraj`, `Opis${B}${text}${B}Kraj`)).toEqual([]);
      expect(findForbiddenTermsInMarkup(`${text}${B}Kraj`, `${text}${B}Kraj`, false)).toEqual([]);
    }
  });

  it("still closes up over the mark, and next to white space that is written", () => {
    const found = (text: string): string[] => findForbiddenTermsInMarkup(text, text).map((term) => term.entry);
    expect(found(`Sum${B}njivo`)).toEqual(["sumnjivo"]);
    expect(found(`Rok${LF}Sum${B}njivo${LF}Kraj`)).toEqual(["sumnjivo"]);
    expect(found(`Opis${B}Rok${LF}hid${B}den${CRLF}Kraj${B}Dalje`)).toEqual(["hidden"]);
    // A written line break ends the phrase of a contextual word, as it always did.
    expect(found(`Spremljeno${LF}na uređaju`)).toEqual([HR]);
    expect(found("Spremljeno na uređaju")).toEqual([]);
  });

  it("does not take a run of lines for a run of parts, or the quotation marks at a line break for those at a boundary", () => {
    const lines = Array.from({ length: 80 }, () => cp(0xb7)).join(LF);
    expect(windowsCutShort(`hid${LF}${lines}${LF}den`)).toBe(false);
    expect(windowsCutShort(`hid${B}${lines.replaceAll(LF, B)}${B}den`)).toBe(true);
    const quoted = `Sum${cp(0x201d)}${LF}${cp(0x201e)}njivo`;
    expect(closedUpPastQuotes(quoted)).toBe(quoted);
    expect(closedUpPastQuotes(quoted.replace(LF, B))).toBe("Sumnjivo");
  });

  it("uses a mark that is no character, and reports that code point when a source writes it", () => {
    expect(B).toBe(cp(0xffff));
    expect(/^\p{Cn}$/u.test(B)).toBe(true);
    expect(unreadableCharacters(`Rok${B}predaje`)).toEqual(["U+FFFF"]);
    // Written in a source, it cuts a word as a boundary does: the entry is found and the code point is reported.
    for (const [file, content] of [
      ["src/components/Case.tsx", 'export const Case = () => <p>{"Sum\\uFFFFnjivo"}</p>;\n'],
      ["src/components/Case.tsx", `export const Case = () => <p>Sum${B}njivo</p>;\n`],
      ["src/domain/sync/labels.ts", 'export const A = "Sum" + "\\uFFFF" + "njivo";\n'],
      ["src/domain/sync/state.ts", `export const A = "Rok${B}predaje";\n`],
    ] as const) {
      write(file, content);
      expect(findUnreadableText(root!).map((entry) => entry.reason.match(/U\+[0-9A-F]+/g)), content).toContainEqual(["U+FFFF"]);
      if (content.includes("Sum")) expect(entries(), content).toContain("sumnjivo");
    }
  });
});

// Review of 4898e6f: the mark of a boundary is no character, so a finding
// that showed its text with the mark in it could not be read in a log. A
// finding shows the parts trimmed, with " | " between them, and nothing for
// a boundary at an end of the text.
describe("the text of a finding does not show the mark of a boundary", () => {
  const B = PHRASE_BREAK;
  const shown = (line: string): string[] => {
    write("src/components/Case.tsx", component([line]));
    return scanUiText(root!).map((finding) => finding.text);
  };
  const placed = (line: string): string[] => {
    write("src/components/Case.tsx", component([line]));
    return scanUiText(root!).map((finding) => `${finding.file}:${finding.line} ${finding.terms.map((term) => term.entry).join(", ")}`);
  };

  /** What it is, the JSX, the text of every finding. */
  const TEXTS: readonly [string, string, readonly string[]][] = [
    ["a phrase over a block boundary", "<div>Nestali<p>podaci</p></div>", ["Nestali | podaci"]],
    ["a phrase over two block boundaries", "<div><p>Nestali</p><p>podaci</p></div>", ["Nestali | podaci"]],
    ["a bare contextual word before an unknown part", "<p>Spremljeno <Icon /> na uređaju</p>", ["Spremljeno | na uređaju"]],
    ["a bare contextual word before a computed value", "<p>Saved {n} on this device</p>", ["Saved | on this device"]],
    ["a bare contextual word between two unknown parts", "<p>{n} Spremljeno {n}</p>", ["Spremljeno"]],
    ["a bare contextual word in a template", "<p>{`Spremljeno ${n} na uređaju`}</p>", ["Spremljeno | na uređaju"]],
    ["a word closed up over an unknown part", "<p>Sum{n}njivo</p>", [`Sum | njivo (${CLOSED_UP_NOTE})`]],
    ["a word closed up over items of a list", "<ul><li>Opis</li><li>hid</li><li>den</li></ul>", [`Opis | hid | den (${CLOSED_UP_NOTE})`]],
    ["a text without a boundary", "<p>Nestali <b>podaci</b> </p>", ["Nestali podaci "]],
  ];

  it.each(TEXTS)("%s", (_, line, texts) => {
    expect(shown(line)).toEqual(texts);
  });

  it("shows no finding of either kind with the mark in it", () => {
    const texts = TEXTS.flatMap(([, line]) => shown(line));
    expect(texts.filter((text) => text.includes(CLOSED_UP_NOTE)).length).toBeGreaterThan(0);
    expect(texts.filter((text) => !text.includes(CLOSED_UP_NOTE) && text.includes(" | ")).length).toBeGreaterThan(0);
    for (const text of texts) expect(text).not.toContain(B);
    for (const text of texts) expect(text).not.toMatch(/\p{Cn}/u);
  });

  // " | " is only how a boundary is shown: a bar that a text writes is read as the text it is.
  it.each([
    ["<p>Spremljeno <Icon /> na uređaju</p>", "<p>Spremljeno | <Icon /> | na uređaju</p>"],
    ["<div>Nestali<p>podaci</p></div>", "<div>Nestali |<p>| podaci</p></div>"],
    ["<p>Sum{n}njivo</p>", "<p>Sum{n}njivo | Rok</p>"],
  ])("reports the same entries in the same place when the text writes a bar next to a boundary: %s", (plain, barred) => {
    const found = placed(plain);
    expect(found).toHaveLength(1);
    expect(placed(barred)).toEqual(found);
  });

  it("does not take a bar that a text writes for a boundary", () => {
    // Written apart with a bar, two halves of a word are two words, and nothing is closed up over the bar.
    expect(shown("<p>Sum | njivo</p>")).toEqual([]);
    expect(shown("<p>Spre | mljeno</p>")).toEqual([]);
    // A phrase with a bar between its words is found as the text it is, with or without a boundary.
    expect(placed("<p>Nestali | podaci</p>")).toEqual(placed("<p>Nestali podaci</p>"));
    expect(shown("<p>Nestali | podaci</p>")).toEqual(["Nestali | podaci"]);
  });
});

// Review of e11efe6 by the second provider: a line or paragraph separator
// between two letters was read as a space, though a page may show nothing
// for it, and a control of text direction was dropped, though it changes the
// order in which the letters are shown. Both are reported wherever they
// stand, and so is every other format character but four.
describe("separators and format characters", () => {
  const code = (value: number): string => `U+${value.toString(16).toUpperCase().padStart(4, "0")}`;
  const escape = (value: number): string => `\\u${value.toString(16).toUpperCase().padStart(4, "0")}`;
  const reported = (): string[][] => findUnreadableText(root!).map((entry) => [entry.file, ...(entry.reason.match(/U\+[0-9A-F]+/g) ?? [])]);

  /** What it is, the code point. Every one of them is in the Basic Multilingual Plane, so it has an escape. */
  const NAMED: readonly [string, number][] = [
    ["line separator (Zl)", 0x2028],
    ["paragraph separator (Zp)", 0x2029],
    ["Arabic letter mark", 0x61c],
    ["left-to-right mark", 0x200e],
    ["right-to-left mark", 0x200f],
    ["left-to-right embedding", 0x202a],
    ["right-to-left embedding", 0x202b],
    ["pop directional formatting", 0x202c],
    ["left-to-right override", 0x202d],
    ["right-to-left override", 0x202e],
    ["left-to-right isolate", 0x2066],
    ["right-to-left isolate", 0x2067],
    ["first strong isolate", 0x2068],
    ["pop directional isolate", 0x2069],
    ["word joiner", 0x2060],
    ["invisible times", 0x2062],
    ["a deprecated format character", 0x206a],
    ["byte order mark", 0xfeff],
    ["interlinear annotation anchor", 0xfff9],
    ["Arabic number sign, which is drawn", 0x600],
    ["Mongolian vowel separator", 0x180e],
  ];
  /** Where the text stands, the file, its content with `|` where the character goes, whether the escape is JSON's or the source's. */
  const PLACES: readonly [string, string, string][] = [
    ["a string in JSX", "src/components/Case.tsx", 'export const Case = () => <p>{"Sum|njivo"}</p>;\n'],
    ["an attribute", "src/components/Case.tsx", 'export const Case = () => <img alt="Sum|njivo" />;\n'],
    ["a template in JSX", "src/components/Case.tsx", "export const Case = () => <p>{`Sum|njivo`}</p>;\n"],
    ["a string of a text module", "src/domain/sync/labels.ts", 'export const A = "Sum|njivo";\n'],
    ["a string outside the text modules", "src/domain/sync/state.ts", 'export const A = "Sum|njivo";\n'],
    ["a catalogue", "src/lib/i18n/hr.json", '{ "title": "Sum|njivo" }\n'],
  ];

  it.each(NAMED.flatMap(([what, value]) => PLACES.map(([where, file, content]) => [what, where, value, file, content] as const)))("reports a %s between the letters of an entry in %s", (_, __, value, file, content) => {
    // Written as itself.
    write(file, content.replace("|", cp(value)));
    expect(reported()).toEqual([[file, code(value)]]);
    // Written by its escape; an attribute without braces has none.
    if (!content.includes('alt="')) {
      write(file, content.replace("|", escape(value)));
      expect(reported()).toEqual([[file, code(value)]]);
    }
  });

  it.each(PLACES)("reports the controls that show the letters of an entry in another order, in %s", (_, file, content) => {
    for (const [open, close] of [[0x202e, 0x202c], [0x2067, 0x2069], [0x202b, 0x202c]] as const) {
      write(file, content.replace("Sum|njivo", `${cp(open)}ovijnmuS${cp(close)}`));
      expect(reported()).toEqual([[file, code(open), code(close)]]);
    }
  });

  it.each(NAMED)("reports a %s wherever it stands", (_, value) => {
    const char = cp(value);
    for (const text of [`Sum${char}njivo`, `${char}Rok`, `Rok${char}`, `Rok ${char} predaje`, `2${char}3`, char]) expect(unreadableCharacters(text), JSON.stringify(text)).toEqual([code(value)]);
    expect(unreadableCharacters(`Rok${char}${char}predaje`)).toEqual([code(value)]);
  });

  // Every code point, so that the category is not left to a list: the four
  // that the dictionary reads a word past are written out here a second time.
  it("reports every separator of lines and every format character, but for four", () => {
    const written = [0xad, 0x200b, 0x200c, 0x200d];
    const passed: number[] = [];
    let seen = 0;
    for (let value = 0x80; value <= 0x10ffff; value += 1) {
      const char = cp(value);
      if (!/[\p{Cf}\p{Zl}\p{Zp}]/u.test(char)) continue;
      seen += 1;
      const found = [`Sum${char}njivo`, `${char}Rok`, `Rok ${char} predaje`].map((text) => unreadableCharacters(text));
      if (found.every((codes) => codes.length === 0)) passed.push(value);
      else expect(found, code(value)).toEqual([[code(value)], [code(value)], [code(value)]]);
    }
    expect(seen).toBeGreaterThan(160);
    expect(passed).toEqual(written);
    // The four show nothing inside a word, and the dictionary reads the word past them.
    for (const value of written) {
      expect(findForbiddenTerms(`Sum${cp(value)}njivo`).map((term) => term.entry)).toEqual(["sumnjivo"]);
      expect(unreadableCharacters(`Sum${cp(value)}njivo`)).toEqual([]);
    }
  });

  it("reports such a character as a part of its own between two parts with letters", () => {
    for (const value of [0x2028, 0x2029, 0x202e, 0x200f, 0x2060]) {
      write("src/components/Case.tsx", `export const Case = () => <p>Sum{${JSON.stringify(cp(value))}}njivo</p>;\n`);
      expect(reported()).toEqual([["src/components/Case.tsx", code(value)]]);
    }
  });
});

// Review of 2b6b414 by the second provider: the parts strictly inside a
// window are measured, so what stands in the first part of it, however long,
// does not end the window early.
describe("an entry cut into three parts after a long text in the same part", () => {
  const B = PHRASE_BREAK;
  const CUT: readonly [string, string, string, string][] = [
    ["saved (without saying where)", "Sa", "v", "ed"],
    ["hidden", "hi", "dd", "en"],
    ["sumnjivo", "Sum", "nji", "vo"],
    ["nestali podaci", "ne", "stali po", "daci"],
    [HR, "Spre", "mlje", "no"],
  ];
  // 49 and 60 are the lengths of the review; 48 is the bound of a window, and the rest is around it and far past it.
  const LENGTHS = [0, 1, 47, 48, 49, 50, 60, 63, 64, 65, 96, 128, 300, 1000];

  it.each(CUT.flatMap(([entry, a, b, c]) => LENGTHS.map((length) => [entry, length, a, b, c] as const)))("finds %s after %i characters", (entry, length, a, b, c) => {
    const [long, words, other] = ["x".repeat(length), "rok ".repeat(length), "y".repeat(length)];
    for (const parts of [
      [`${long} ${a}`, b, c, "Later"],
      [`${words}${a}`, b, c, "Later"],
      [long, a, b, c, "Later"],
      [a, b, `${c} ${long}`, "Later"],
      ["Opis", `${long} ${a}`, b, `${c} ${other}`, "Later"],
    ]) {
      const joined = parts.join(B);
      expect(findForbiddenTermsInMarkup(joined, joined).map((term) => term.entry), JSON.stringify(parts.map((part) => part.length))).toEqual([entry]);
      expect(windowsCutShort(joined)).toBe(false);
    }
  });
});

// A string is shown in a finding as the source writes it, but for the code
// point of the mark: no log can show it, so it is shown by its escape.
describe("the text of a finding for a string that writes the code point of the mark", () => {
  const B = PHRASE_BREAK;
  it.each([
    ["a string in JSX", "src/components/Case.tsx", 'export const Case = () => <p>{"Sumnjivo|danas"}</p>;\n'],
    ["an attribute", "src/components/Case.tsx", 'export const Case = () => <img alt={"Sumnjivo|danas"} />;\n'],
    ["a string of a text module", "src/domain/sync/labels.ts", 'export const A = "Sumnjivo|danas";\n'],
    ["a string outside the text modules", "src/domain/sync/state.ts", 'export const A = "Sumnjivo|danas";\n'],
    ["a catalogue", "src/lib/i18n/hr.json", '{ "title": "Sumnjivo|danas" }\n'],
  ])("shows the escape in %s", (_, file, content) => {
    for (const written of [B, "\\uFFFF"]) {
      write(file, content.replace("|", written));
      const found = scanUiText(root!);
      expect(found.map((finding) => [finding.file, finding.terms.map((term) => term.entry).join(", ")])).toContainEqual([file, "sumnjivo"]);
      for (const finding of found) expect(finding.text).not.toContain(B);
      expect(found.map((finding) => finding.text)).toContain("Sumnjivo\\uFFFFdanas");
      // The guard reports the code point as before.
      expect(findUnreadableText(root!).map((entry) => entry.reason.match(/U\+[0-9A-F]+/g))).toContainEqual(["U+FFFF"]);
    }
  });

  it("leaves every other string as it is written", () => {
    write("src/domain/sync/labels.ts", 'export const A = " Sumnjivo \\\\uFFFF danas ";\n');
    expect(scanUiText(root!).map((finding) => finding.text)).toEqual([" Sumnjivo \\uFFFF danas "]);
  });
});

// QA of e11efe6: three ways for text to reach a page from a place the scan
// did not read. What cannot be read fails a check.
describe("text that reaches a page from outside the files the scan reads", () => {
  const entries = (): string[] => scanUiText(root!).flatMap((finding) => finding.terms.map((term) => term.entry));
  const reasons = (): [string, number, string][] => findUnreadableText(root!).map((entry) => [entry.file, entry.line, entry.reason]);

  it("reports a page that imports a component named like a test, which is not read", () => {
    write("src/qa/Case.spec.tsx", "export default function Case() { return <p>Sumnjivo</p>; }\n");
    write("app/qa-spec/page.tsx", 'import Case from "../../src/qa/Case.spec";\nexport default function Page() { return <Case />; }\n');
    expect(entries()).toEqual([]);
    expect(reasons()).toEqual([["app/qa-spec/page.tsx", 1, `import of the test module "../../src/qa/Case.spec" (${UNREADABLE_HINTS.testModule})`]]);
    expect(UNREADABLE_HINTS.testModule).toMatch(/test files are not read/);
  });

  /** How the import is written, on the second line of the file. */
  const TEST_IMPORTS: readonly [string, string, string][] = [
    ["a test module by its whole name", "src/components/Page.tsx", 'import { Case } from "./Case.test.tsx";'],
    ["a test module under the alias", "src/components/Page.tsx", 'import { Case } from "@/components/Case.test";'],
    ["a spec module with another extension", "src/components/Page.tsx", 'import { Case } from "./Case.spec.mjs";'],
    ["a test module for its side effects", "app/layout.tsx", 'import "./setup.test";'],
    ["a test module for a type", "src/domain/sync/state.ts", 'import type { Fixture } from "./state.test";'],
    ["a test module handed on", "src/domain/sync/index.ts", 'export * from "./state.spec";'],
    ["a test module handed on by name", "src/domain/sync/labels.ts", 'export { LABEL } from "./labels.test";'],
    ["a test module loaded later", "src/components/Page.tsx", 'export const Case = lazy(() => import("./Case.spec"));'],
    ["a test module required", "src/domain/sync/state.ts", 'export const fixture = require("./state.test");'],
    ["a test module in the old form", "src/domain/sync/state.ts", 'import fixture = require("./state.spec");'],
  ];

  it.each(TEST_IMPORTS)("reports the import of %s", (_, file, line) => {
    write(file, `export const A = 1;\n${line}\n`);
    const name = /"([^"]+)"/.exec(line)![1]!;
    expect(reasons()).toEqual([[file, 2, `import of the test module "${name}" (${UNREADABLE_HINTS.testModule})`]]);
  });

  it("does not report the import of a module that only has test or spec in its name", () => {
    write("src/components/Page.tsx", 'import { a } from "./latest";\nimport { b } from "./spec";\nimport { c } from "./test/Case";\nimport { d } from "./Case.testing";\nimport { e } from "inspect";\nimport f from "./contest.css";\nexport const all = [a, b, c, d, e, f, "./Case.test"];\n');
    expect(reasons()).toEqual([]);
  });

  it("does not read the test file itself, and an import inside one is nobody's", () => {
    write("src/qa/Case.spec.tsx", 'import other from "./Other.test";\nimport copy from "./nowhere.json";\nexport default function Case() { return <p>Sumnjivo</p>; }\n');
    expect(entries()).toEqual([]);
    expect(reasons()).toEqual([]);
  });

  it("reads a .json file that a page imports from outside the catalogues like a catalogue", () => {
    write("src/qa/data/copy.json", '{"title":"Sumnjivo"}');
    write("app/qa-json/page.tsx", 'import copy from "../../src/qa/data/copy.json";\nexport default function Page() { return <p>{copy.title}</p>; }\n');
    expect(scanUiText(root!).map((finding) => [finding.file, finding.line, finding.text, finding.terms.map((term) => term.entry)])).toEqual([["src/qa/data/copy.json", 1, "Sumnjivo", ["sumnjivo"]]]);
    expect(reasons()).toEqual([]);
    // Not imported, it is not interface text, as before.
    write("app/qa-json/page.tsx", "export default function Page() { return <p>Rok</p>; }\n");
    expect(entries()).toEqual([]);
  });

  /** Where the importing file and the data are, and how the import names the data. */
  const DATA: readonly [string, string, string, string][] = [
    ["next to the importing file", "src/components/Page.tsx", "src/components/copy.json", "./copy.json"],
    ["outside app and src", "src/domain/citation/index.ts", "config/faculties/x/citation.json", "../../../config/faculties/x/citation.json"],
    ["under the alias", "app/rad/page.tsx", "src/data/copy.json", "@/data/copy.json"],
    ["with the extension in capitals", "src/components/Page.tsx", "src/components/copy.JSON", "./copy.JSON"],
    ["from a text module", "src/domain/sync/labels.ts", "src/domain/sync/words.json", "./words.json"],
  ];

  it.each(DATA)("reads imported data %s", (_, file, data, name) => {
    write(data, '{\n  "a": { "label": "Rok" },\n  "b": ["Risk", { "c": "Spremljeno" }]\n}\n');
    write(file, `import words from "${name}";\nexport const all = words;\n`);
    expect(scanUiText(root!).map((finding) => [finding.file, finding.line, finding.terms.map((term) => term.entry)])).toEqual([
      [data, 3, ["risk"]],
      [data, 3, [HR]],
    ]);
    expect(reasons()).toEqual([]);
  });

  it.each([
    ["an import", 'import words from "./words.json";'],
    ["an import handed on", 'export { default } from "./words.json";'],
    ["an import loaded later", 'export const words = import("./words.json");'],
    ["a require", 'export const words = require("./words.json");'],
  ])("reads the data of %s", (_, line) => {
    write("src/components/words.json", `["Sum${cp(0x456)}njivo", "Kopirano"]`);
    write("src/components/Page.tsx", `${line}\n`);
    expect(entries()).toEqual(["kopirano"]);
    // The guard reads its strings too.
    expect(reasons().map(([file, , reason]) => [file, reason.split(" (")[0]])).toEqual([["src/components/words.json", "characters outside interface text: U+0456"]]);
  });

  it("reads imported data once, whoever imports it, and a catalogue as it always was", () => {
    write("src/components/words.json", '["Kopirano"]');
    write("src/lib/i18n/hr.json", '{ "title": "Skriveno" }');
    write("src/components/A.tsx", 'import words from "./words.json";\nimport hr from "../lib/i18n/hr.json";\nexport const a = [words, hr];\n');
    write("src/components/B.tsx", 'import words from "@/components/words.json";\nimport hr from "@/lib/i18n/hr.json";\nexport const b = [words, hr];\n');
    expect(scanUiText(root!).map((finding) => [finding.file, finding.terms.map((term) => term.entry)])).toEqual([
      ["src/lib/i18n/hr.json", ["skriveno"]],
      ["src/components/words.json", ["kopirano"]],
    ]);
    expect(reasons()).toEqual([]);
  });

  /** What it is, how the import names the data. */
  const LOST: readonly [string, string][] = [
    ["data that is not there", "./missing.json"],
    ["data under an alias the scan does not know", "~/data/copy.json"],
    ["data of a package", "some-package/copy.json"],
    ["data outside the repository", "../../../outside.json"],
    ["data under the alias that is not there", "@/data/missing.json"],
  ];

  it.each(LOST)("reports the import of %s", (_, name) => {
    write("src/data/copy.json", '{"title":"Sumnjivo"}');
    write("src/components/Page.tsx", `export const A = 1;\n\nimport copy from "${name}";\nexport const all = copy;\n`);
    expect(reasons()).toEqual([["src/components/Page.tsx", 3, `import of "${name}", a data file the scan cannot find (${UNREADABLE_HINTS.dataFile})`]]);
    expect(UNREADABLE_HINTS.dataFile).toMatch(/read like a catalogue/);
    expect(entries()).toEqual([]);
  });

  it("stops on imported data that is not JSON or not UTF-8, like a catalogue", () => {
    write("src/components/Page.tsx", 'import words from "./words.json";\nexport const all = words;\n');
    write("src/components/words.json", '{ "title": "Rok" ');
    expect(() => scanUiText(root!)).toThrow(SyntaxError);
    expect(() => findUnreadableText(root!)).toThrow(SyntaxError);
    writeFileSync(path.join(root!, "src", "components", "words.json"), Buffer.from([0x7b, 0xff, 0x7d]));
    expect(() => scanUiText(root!)).toThrow("src/components/words.json: the file is not valid UTF-8, so the scan cannot read it");
  });

  // A text module puts text together too. Its `+` chains and templates are
  // read as the same expression is read in JSX.
  it("finds an entry that a text module puts together from literal parts", () => {
    write("src/qa/labels.ts", 'export const concatenated = "Sum" + "njivo";\nexport const templated = `Sum${"nji"}vo`;\n');
    write("app/qa-concat/page.tsx", 'import { concatenated, templated } from "../../src/qa/labels";\nexport default function Page() {\n  return <div><p>{concatenated}</p><p>{templated}</p></div>;\n}\n');
    expect(scanUiText(root!).map((finding) => [finding.file, finding.line, finding.text, finding.terms.map((term) => term.entry)])).toEqual([
      ["src/qa/labels.ts", 1, "Sumnjivo", ["sumnjivo"]],
      ["src/qa/labels.ts", 2, "Sumnjivo", ["sumnjivo"]],
    ]);
    expect(reasons()).toEqual([]);
  });

  /** What it is, the line of a text module, the entries found. */
  const COMPOSED: readonly [string, string, readonly string[]][] = [
    ["three literals", 'export const A = "Su" + "mnj" + "ivo";', ["sumnjivo"]],
    ["literals in brackets", 'export const A = ("Kopi" + ("ra" + "no")) as string;', ["kopirano"]],
    ["a literal and a template without placeholders", 'export const A = "Hid" + `den`;', ["hidden"]],
    ["a template inside a template", "export const A = `Vje${`ro${\"jat\"}no`}st`;", ["vjerojatnost"]],
    ["a chain inside a template", 'export const A = `Pre${"pi" + "sa"}no`;', ["prepisano"]],
    ["a phrase over two literals", 'export const A = "Nestali " + "podaci";', ["nestali podaci"]],
    ["a property of an object", 'export const A = { label: "Ri" + "zik" };', ["rizik"]],
    ["an item of an array", 'export const A = ["Rok", "Sus" + "picious"];', ["suspicious"]],
    ["what a function returns", 'export const a = (): string => "Skri" + "veno";', ["skriveno"]],
    ["an argument of a call", 'export const A = label("Ano" + "malija");', ["anomalija, anomaly"]],
    ["one branch of a condition", 'export const A = (n: number) => (n > 1 ? "Sum" + "njivo" : "Rok");', ["sumnjivo"]],
    ["a condition between the halves", 'export const A = (n: boolean) => "Sum" + (n ? "njivo" : "a");', ["sumnjivo"]],
    ["a computed part between the halves", 'export const A = (n: number) => "Sum" + n + "njivo";', ["sumnjivo"]],
    ["a computed part between the halves of a template", "export const A = (n: number) => `Kopi${n}rano`;", ["kopirano"]],
    ["an assignment", 'let a = "Rok";\na += "x";\na = "Sum" + "njivo";', ["sumnjivo"]],
    // Nothing to report.
    ["a message with a number in it", "export const A = (n: number) => `Naziv smije imati najviše ${n} znakova.`;", []],
    ["plain words put together", 'export const A = "Rok " + "predaje";', []],
    ["numbers added up", "export const A = (a: number, b: number) => a + b + 1;", []],
    ["a contextual word and its place", 'export const A = "Spremljeno na uređaju" + ".";', []],
  ];

  it.each(COMPOSED)("in a text module: %s", (_, line, expected) => {
    write("src/domain/sync/labels.ts", `${line}\n`);
    expect(entries()).toEqual(expected);
    expect(reasons()).toEqual([]);
  });

  it("reports an entry that is whole in one literal once, where it stands, and not again for the expression", () => {
    write("src/domain/sync/messages.ts", 'export const A = (n: number) =>\n  "Rok " +\n  "Sumnjivo " + n;\n');
    expect(scanUiText(root!).map((finding) => [finding.line, finding.text])).toEqual([[3, "Sumnjivo "]]);
  });

  it("says that an entry of a text module was found by joining the parts around a computed one", () => {
    write("src/domain/sync/labels.ts", 'export const A = (n: number) => "Sum" + n + "njivo";\n');
    expect(scanUiText(root!).map((finding) => finding.text)).toEqual([`Sum | njivo (${CLOSED_UP_NOTE})`]);
  });

  it("reports a character that is harmless alone between two parts of a text module, and too many readings", () => {
    write("src/domain/sync/labels.ts", `export const A = "Sum" + ${JSON.stringify(cp(0x2009))} + "njivo";\n`);
    expect(reasons().map(([, line, reason]) => [line, reason.split(" (")[0]])).toEqual([[1, "characters outside interface text, where its parts meet: U+2009"]]);
    // Once for the whole expression, not again for the chains and templates inside it.
    write("src/domain/sync/labels.ts", `export const A = "Sum" + ${JSON.stringify(cp(0x2009))} + "njivo" + "x";\nexport const B = \`a\${"Ri" + ${JSON.stringify(cp(0x2009))} + "zik"}b\`;\n`);
    expect(reasons().map(([, line, reason]) => [line, reason.split(" (")[0]])).toEqual([
      [1, "characters outside interface text, where its parts meet: U+2009"],
      [2, "characters outside interface text, where its parts meet: U+2009"],
    ]);
    write("src/domain/sync/labels.ts", `export const A = (a: boolean) => ${Array.from({ length: 7 }, () => '(a ? "x" : "y")').join(" + ")};\n`);
    expect(reasons().map(([, , reason]) => reason)).toEqual([`more than 64 readings of one text (${UNREADABLE_HINTS.readings})`]);
  });

  it("puts text together like that only in a text module", () => {
    // Outside one, a string is checked against the Croatian entries by itself, as before.
    write("src/domain/sync/state.ts", 'export const A = "Hid" + "den";\nexport const B = "Sum" + "njivo";\n');
    write("src/components/Case.tsx", 'const label = "Kopi" + "rano";\nexport const Case = () => <p>{label}</p>;\n');
    expect(entries()).toEqual([]);
  });

  // QA of e11efe6: the program that is asked for syntax errors holds the one
  // file, and its host is asked for no other: no module name is looked up.
  it("asks the compiler for the syntax errors of one file without looking up what it imports", () => {
    const WRITTEN = '/// <reference types="node" />\n/// <reference path="./other.d.ts" />\nimport { missing } from "./nowhere";\nimport data from "node:fs";\nimport type { T } from "@/none";\nexport * from "./also-nowhere";\nconst n: number = "tri";\nexport const C = (t: T) => <p>{missing}{undeclared}{data}{n}{t}</p>;\n';
    for (const [name, kind] of [["src/components/Case.tsx", ts.ScriptKind.TSX], ["src/domain/sync/state.ts", ts.ScriptKind.TS]] as const) {
      const written = kind === ts.ScriptKind.TSX ? WRITTEN : WRITTEN.replace(/<p>.*<\/p>/, "[missing, data, n, t]");
      const source = ts.createSourceFile(name, written, ts.ScriptTarget.Latest, true, kind);
      const host = isolatedHost(source);
      // Every way a host is asked about a file other than the one it holds, and what it was asked to look up.
      const asked: string[] = [];
      const looked: string[] = [];
      const files = { ...host };
      expect([files.fileExists("/src/components/nowhere.ts"), files.readFile("/src/components/nowhere.ts")]).toEqual([false, undefined]);
      host.fileExists = (file) => (asked.push(`fileExists ${file}`), files.fileExists(file));
      host.readFile = (file) => (asked.push(`readFile ${file}`), files.readFile(file));
      host.getSourceFile = (file, ...rest) => (file === name ? undefined : asked.push(`getSourceFile ${file}`), files.getSourceFile(file, ...rest));
      host.directoryExists = (file) => (asked.push(`directoryExists ${file}`), false);
      host.getDirectories = (file) => (asked.push(`getDirectories ${file}`), []);
      host.resolveModuleNameLiterals = (names, ...rest) => {
        looked.push(...names.map((literal) => literal.text));
        const resolved = files.resolveModuleNameLiterals!(names, ...rest);
        expect(resolved.map((entry) => entry.resolvedModule)).toEqual(names.map(() => undefined));
        return resolved;
      };
      expect(syntaxErrors(source, host)).toEqual([]);
      expect(asked).toEqual([]);
      expect(looked.sort()).toEqual(["./also-nowhere", "./nowhere", "@/none", "node:fs"]);
      // The same host still gives the errors of the file it holds.
      const broken = ts.createSourceFile(name, `${written}export const D = {;\n`, ts.ScriptTarget.Latest, true, kind);
      expect(syntaxErrors(broken).length).toBeGreaterThan(0);
    }
  });
});

// QA of 2b6b414: whether a contextual word is read closed up was decided for
// the whole text, so one acceptable "Spremljeno na uređaju" anywhere in it
// kept a second, cut "Spre|mljeno" from being read at all. It is decided for
// each place the word stands in.
describe("a contextual word cut by a boundary next to one that says where", () => {
  const B = PHRASE_BREAK;
  const EN = "saved (without saying where)";
  /** What it is, the parts of the text, the entries found. */
  const BESIDE: readonly [string, readonly string[], readonly string[]][] = [
    ["the phrase before the cut word, in its part", ["Spremljeno na uređaju. Spre", "mljeno"], [HR]],
    ["the phrase after the cut word, in its part", ["Spre", "mljeno. Spremljeno na uređaju"], [HR]],
    ["the English phrase before the cut word, in its part", ["Saved on this device. Sa", "ved"], [EN]],
    ["the English phrase after the cut word, in its part", ["Sa", "ved. Saved on this device"], [EN]],
    ["the phrase in a part before", ["Spremljeno na uređaju", "Spre", "mljeno"], [HR]],
    ["the phrase in a part after", ["Spre", "mljeno", "Spremljeno na poslužitelju"], [HR]],
    ["the English phrase in a part before", ["Saved to the server", "sa", "ved"], [EN]],
    ["the English phrase in a part after", ["sa", "ved", "Saved on your device"], [EN]],
    ["the phrase on both sides", ["Spremljeno na uređaju", "Spre", "mljeno", "Spremljeno na poslužitelju"], [HR]],
    ["the phrase on both sides and other parts around", ["Opis", "Saved on this device", "sa", "ved", "Saved on the server", "Kraj"], [EN]],
    ["the phrase before, a part for every letter of the word", ["Opis", "Spremljeno na uređaju", ..."spremljeno", "Kraj"], [HR]],
    ["the phrase after, a part for every letter of the word", ["Opis", ..."saved", "Saved on this device", "Kraj"], [EN]],
    ["the phrase before in its part, the word cut twice", ["Opis", "Spremljeno na uređaju, spre", "mlje", "no", "Kraj"], [HR]],
    ["the phrase before, quotation marks at the cut", ["Spremljeno na uređaju", `Spre${cp(0x201d)}`, `${cp(0x201e)}mljeno`, "Kraj"], [HR]],
    ["the phrase before in its part, quotation marks at the cut", [`Spremljeno na uređaju. Spre${cp(0x201d)}`, `${cp(0x201e)}mljeno`], [HR]],
    // The whole word is taken out of the phrase of the cut one: what follows it does not say where the cut one was saved.
    ["the phrase right after the cut word, in its part", ["Spre", "mljeno Spremljeno na uređaju"], [HR]],
    ["the English phrase right after the cut word, in its part", ["sa", "ved Saved on this device"], [EN]],
    ["the Croatian phrase and a cut English word", ["Spremljeno na uređaju", "sa", "ved"], [EN]],
    ["the English phrase and a cut Croatian word", ["Saved on this device. Spre", "mljeno"], [HR]],
    ["both phrases and both words cut", ["Spremljeno na uređaju", "Saved on this device", "Spre", "mljeno", "Opis", "sa", "ved"], [HR, EN]],
    ["the phrase twice and the cut word between them in one part", ["Spremljeno na uređaju. Spre", "mljeno. Spremljeno na poslužitelju"], [HR]],
    // Nothing to report: every place the word stands in says where.
    ["the phrase and a cut word with its place in the same part", ["Opis", "Spremljeno na uređaju", "Spre", "mljeno na poslužitelju", "Kraj"], []],
    ["the English phrase and a cut word with its place in the same part", ["Opis", "Saved on this device", "sa", "ved to the server", "Kraj"], []],
    ["the phrase twice in one part, a part after", ["Spremljeno na uređaju. Spremljeno na poslužitelju", "Predano"], []],
    ["the phrase in three parts next to each other", ["Spremljeno na uređaju", "Spremljeno na poslužitelju", "Saved on this device", "Predano"], []],
    ["the phrase and plain words cut", ["Spremljeno na uređaju", "Pred", "ano", "Saved on this device"], []],
  ];

  it.each(BESIDE)("%s", (_, parts, expected) => {
    const joined = parts.join(B);
    expect(findForbiddenTermsInMarkup(joined, joined).map((term) => term.entry)).toEqual(expected);
    // Empty parts between them change nothing.
    const padded = parts.join(B + B);
    expect(findForbiddenTermsInMarkup(padded, padded).map((term) => term.entry)).toEqual(expected);
    // And the text as written holds none of it.
    expect(findForbiddenTermsInMarkup(joined, joined, false)).toEqual([]);
  });

  /** What it is, the JSX, the entries of the scan. */
  const IN_JSX: readonly [string, string, readonly string[]][] = [
    ["an empty element, the phrase before", "<p>Spremljeno na uređaju. Spre<i />mljeno</p>", [HR]],
    ["an empty element, the phrase after", "<p>Spre<i />mljeno. Spremljeno na uređaju</p>", [HR]],
    ["an empty element, the English phrase before", "<p>Saved on this device. Sa<i />ved</p>", [EN]],
    ["an empty element, the English phrase after", "<p>Sa<i />ved. Saved on this device</p>", [EN]],
    ["blocks, the phrase before", "<div><p>Spremljeno na uređaju</p><p>Spre</p><p>mljeno</p></div>", [HR]],
    ["blocks, the phrase after", "<div><p>Spre</p><p>mljeno</p><p>Spremljeno na uređaju</p></div>", [HR]],
    ["blocks, the English phrase before", "<ul><li>Saved on this device</li><li>Sa</li><li>ved</li></ul>", [EN]],
    ["blocks, the English phrase after", "<ul><li>Sa</li><li>ved</li><li>Saved on this device</li></ul>", [EN]],
    ["an array, the phrase before", '<p>{["Spremljeno na uređaju. Spre", undefined, "mljeno"]}</p>', [HR]],
    ["an array, the phrase after", '<p>{["Spre", undefined, "mljeno. Spremljeno na uređaju"]}</p>', [HR]],
    ["an array, the English phrase before", '<p>{["Saved on this device. Sa", undefined, "ved"]}</p>', [EN]],
    ["an array, the English phrase after", '<p>{["Sa", n, "ved. ", "Saved on this device"]}</p>', [EN]],
    ["a computed value, the phrase before", "<p>Spremljeno na poslužitelju. Spre{n}mljeno</p>", [HR]],
    ["a computed value, the phrase right after", "<p>Spre{n}mljeno Spremljeno na uređaju</p>", [HR]],
    ["an attribute, the English phrase before", '<img alt={"Saved on this device. Sa" + n + "ved"} />', [EN]],
    // Nothing to report.
    ["an empty element in a word that says where, the phrase before", "<p>Spremljeno na uređaju. Spre<i />mljeno na poslužitelju</p>", []],
    ["blocks that each say where", "<div><p>Spremljeno na uređaju</p><p>Saved on this device</p><p>Predano</p></div>", []],
  ];

  it.each(IN_JSX)("in %s", (_, line, expected) => {
    write("src/components/Case.tsx", component([line]));
    const found = scanUiText(root!);
    expect(found.flatMap((finding) => finding.terms.map((term) => term.entry))).toEqual(expected);
    // The cut word is not there to see as written, so the finding says that the parts were joined.
    for (const finding of found) expect(finding.text).toContain(CLOSED_UP_NOTE);
    expect(findUnreadableText(root!)).toEqual([]);
  });
});
