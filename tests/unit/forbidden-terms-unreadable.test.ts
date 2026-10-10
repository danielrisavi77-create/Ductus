import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { CLOSED_UP_NOTE, UNREADABLE_HINTS, findUnreadableText, scanUiText } from "../../scripts/forbidden-terms/scan";
import { PHRASE_BREAK, findForbiddenTerms, unreadableCharacters } from "../../scripts/forbidden-terms/terms";

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
    ["a phrase over a block boundary", "<div>Nestali<p>podaci</p></div>", `Nestali${PHRASE_BREAK}podaci${PHRASE_BREAK}`],
    ["a bare contextual word", "<p>Spremljeno <Icon /> na uređaju</p>", `Spremljeno ${PHRASE_BREAK} na uređaju`],
  ])("leaves the text of a finding that needs no joining as it was: %s", (_, line, text) => {
    write("src/components/Case.tsx", component([line]));
    const found = scanUiText(root!);
    expect(found.at(-1)!.text).toBe(text);
    for (const finding of found) expect(finding.text).not.toContain(CLOSED_UP_NOTE);
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
    // What the dictionary matching already takes out of a word (invisible format characters, marks, fillers).
    ["soft hyphen, zero width space and joiner", `Pre${cp(0xad)}da${cp(0x200b)}n${cp(0x200d)}o`, []],
    ["combining mark and variation selector", `Pre${cp(0x34f)}da${cp(0xfe0f)}no`, []],
    ["Hangul filler", `Pre${cp(0x115f)}dano`, []],
  ];

  it.each(CHARACTERS)("%s", (_, text, expected) => {
    expect(unreadableCharacters(text)).toEqual(expected);
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

  it("reports the same for an attribute", () => {
    write("src/components/Case.tsx", component([`<Field hint={${Array.from({ length: 7 }, (_, index) => `(${"abcdefg"[index]} ? "x" : "y")`).join(" + ")}} />`]));
    expect(findUnreadableText(root!).map((entry) => entry.reason)).toEqual([`more than 64 readings of one text (${UNREADABLE_HINTS.readings})`]);
  });

  it("finds none in this repository (write the text in Croatian or English letters, or split the element)", () => {
    expect(findUnreadableText(REPO_ROOT)).toEqual([]);
  });
});
