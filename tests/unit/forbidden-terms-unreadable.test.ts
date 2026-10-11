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
    ["narrow no-break space between a number and its unit", `5${cp(0x202f)}kg i 20${cp(0x202f)}%`, []],
    ["numbers that fold to ASCII digits and Latin letters", "m², ½ sata, ① korak, Ⅳ. poglavlje, １２", []],
    ["ASCII symbols between letters, which the source shows as they are", "a+b, x=y, C|D, cijena$dan, a~b, a^b, a`b, a<b>c", []],
    ["degree sign and marks at the edge of a word", "20 °C, Ductus™, ©Autor, ®Znak", []],
    ["mathematical and currency symbols set apart or next to digits", "Natrag ← → Dalje, 3×4, 3 × 4, 5 €, 5€, ±2, a ≤ b", []],
    ["control characters that are white space", "a\tb\nc\vd\fe\rf", []],
    ["line separator, which is shown as a space", `Rok${cp(0x2028)}predaje`, []],
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
      expect(found[0]!.reason).toBe(`${between}: U+${code.toString(16).toUpperCase()} (${UNREADABLE_HINTS.characters})`);
    },
  );

  it.each([
    ["a symbol in place of the first letter, as a part of its own", `<p>{${part(0x222b)}}umnjivo</p>`, "U+222B"],
    ["a symbol in place of the last letter, as a part of its own", `<p>Sumnjiv<b>{${part(0x2218)}}</b></p>`, "U+2218"],
    ["a symbol between two parts of an attribute", `<img alt={["Natrag", ${part(0x2192)}, "Dalje"]} />`, "U+2192"],
    // Closed up, as the dictionary reads it: an unknown part does not keep the symbol from the word.
    ["a symbol in place of the first letter, with an unknown part after it", `<p>{${part(0x222b)}}<span />umnjivo</p>`, "U+222B"],
    ["a symbol in place of the last letter, with an unknown part before it", `<p>Sumnjiv{n}{${part(0x2218)}}</p>`, "U+2218"],
  ])("reports %s", (_, line, code) => {
    write("src/components/Case.tsx", component([line]));
    expect(findUnreadableText(root!).map((entry) => entry.reason)).toEqual([`${between}: ${code} (${UNREADABLE_HINTS.characters})`]);
  });

  it.each([
    ["a plain space as a part of its own", '<p>Rok{" "}predaje</p>'],
    ["a no-break space as a part of its own", `<p>Rok{${part(0xa0)}}predaje</p>`],
    ["an odd space next to a plain one", `<p>Rok {${part(0x2009)}}predaje</p>`],
    ["an odd space between a number and its unit", `<p>5{${part(0x202f)}}kg</p>`],
    ["a symbol set apart by plain spaces in parts of their own", `<p>Natrag{" "}<span>{${part(0x2192)}}</span>{" "}Dalje</p>`],
    ["words in parts next to each other", "<tr><td>Od</td><td>do</td><td><b>Rok</b>predaje</td></tr>"],
    ["an odd space at the end of the text", `<p>Predano{${part(0x2009)}}</p>`],
  ])("does not report %s", (_, line) => {
    write("src/components/Case.tsx", component([line]));
    expect(findUnreadableText(root!)).toEqual([]);
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
