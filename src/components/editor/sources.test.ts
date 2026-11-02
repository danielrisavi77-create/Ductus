// @vitest-environment node
import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { formatBibliographyEntry, formatInText, fpzgCitationStyle } from "@/domain/citation";
import { createEditorExtensions } from "@/editor/schema";
import { messagesHr } from "@/lib/i18n/messages.hr";

import { isUiTextModule } from "../../../scripts/forbidden-terms/scan";
import { findForbiddenTerms } from "../../../scripts/forbidden-terms/terms";

import {
  bibliographyPlan, blocksOf, citationText, EMPTY_FIELDS, entryText, FIELD_MAX, formErrors, PAGE_MAX, pageFits, sourceFromFields, storable, suffixPlan, writeSource,
  type SourceField, type SourceFields,
} from "./sources";

// DAN-343: invented authors and titles only.
const BOOK: SourceFields = {
  ...EMPTY_FIELDS, family: "Horvat", given: "Ana", year: "2021", title: "Izmišljena knjiga",
  place: "Zagreb", publisher: "Primjer",
};
const ARTICLE: SourceFields = {
  ...EMPTY_FIELDS, kind: "article", family: "Babić", given: "Iva", family2: "Kovač", given2: "Luka",
  year: "2019", title: "Izmišljeni članak", journal: "Primjer časopis", volume: "12", issue: "3", pages: "45-60",
};

// Built, not written as literals, like src/editor/storable-text.ts.
const NUL = String.fromCodePoint(0);
const LONE = String.fromCharCode(0xd800);

function sourceOf(fields: SourceFields) {
  const check = sourceFromFields(fields);
  if (!check.ok) throw new Error("expected a valid source");
  return check.source;
}

function editorWith(paragraphs: { type?: string; text: string }[]) {
  const editor = new Editor({
    element: null,
    extensions: createEditorExtensions(),
    content: {
      type: "doc",
      content: paragraphs.map(({ type = "paragraph", text }) => ({
        type, ...(type === "heading" ? { attrs: { level: 1 } } : {}),
        ...(text ? { content: [{ type: "text", text }] } : {}),
      })),
    },
  });
  return editor;
}

// The cursor at the end of the first block, where "Dodaj i citiraj" writes.
const atFirstEnd = (editor: Editor) => editor.commands.setTextSelection(editor.state.doc.child(0).nodeSize - 1);

const texts = (editor: Editor) => {
  const out: string[] = [];
  editor.state.doc.forEach((node) => out.push(`${node.type.name}:${node.textContent}`));
  return out;
};

describe("sourceFromFields", () => {
  it("gives exactly the domain's text for a book and an article", () => {
    const book = sourceOf(BOOK);
    expect(citationText(book, "15")).toBe(formatInText(book, fpzgCitationStyle, "15"));
    expect(citationText(book, " ")).toBe(formatInText(book, fpzgCitationStyle));
    expect(entryText(book)).toBe(formatBibliographyEntry(book, fpzgCitationStyle));
    const article = sourceOf(ARTICLE);
    expect(article).toMatchObject({ type: "article", volume: "12", issue: "3", pages: "45-60" });
    expect(article.authors).toHaveLength(2);
    expect(entryText(article)).toBe(formatBibliographyEntry(article, fpzgCitationStyle));
  });

  it("names the fields still missing and refuses a year that is not four digits", () => {
    expect(sourceFromFields(EMPTY_FIELDS)).toEqual({
      ok: false, missing: ["family", "given", "year", "title", "place", "publisher"], yearInvalid: false, tooLong: [], unstorable: [],
    });
    expect(sourceFromFields({ ...EMPTY_FIELDS, kind: "article" })).toMatchObject({ missing: ["family", "given", "year", "title", "journal"] });
    expect(sourceFromFields({ ...BOOK, family2: "Kovač" })).toMatchObject({ ok: false, missing: ["given2"] });
    for (const year of ["21", "20211", "0999", "dvije"]) {
      expect(sourceFromFields({ ...BOOK, year })).toMatchObject({ ok: false, missing: [], yearInvalid: true });
    }
  });

  // F-154 point 2: every field has a limit in code points; one more is refused, never cut.
  it("accepts each field at its limit and refuses one character more", () => {
    const limits: Record<SourceField, number> = {
      family: 80, given: 80, family2: 80, given2: 80, year: 4, title: 300,
      place: 150, publisher: 150, journal: 150, volume: 10, issue: 10, pages: 20,
    };
    expect(FIELD_MAX).toEqual(limits);
    const kindOf = (field: SourceField) => (["journal", "volume", "issue", "pages"].includes(field) ? ARTICLE : BOOK);
    for (const field of Object.keys(limits) as SourceField[]) {
      if (field === "year") continue;
      const base = { ...kindOf(field), family2: "Kovač", given2: "Luka" };
      // "č" is one code point and two UTF-8 bytes: the limit counts code points.
      const at = "č".repeat(limits[field]);
      expect(sourceFromFields({ ...base, [field]: at }).ok, field).toBe(true);
      expect(sourceFromFields({ ...base, [field]: `${at}a` }), field).toMatchObject({ ok: false, tooLong: [field] });
    }
    expect(sourceFromFields({ ...BOOK, year: "20215" })).toMatchObject({ ok: false, yearInvalid: true, tooLong: [] });
  });

  it("does not let a hidden field of the previous kind block the form (review on #866, c.6578428081)", () => {
    // An article with 21 characters in "Stranice", then switched to a book and filled in correctly.
    const switched: SourceFields = { ...BOOK, journal: ARTICLE.journal, pages: "1".repeat(FIELD_MAX.pages + 1) };
    expect(switched.pages).toHaveLength(21);
    expect(sourceFromFields(switched)).toMatchObject({ ok: true, source: { type: "book" } });
  });

  it("bounds the page of a citation", () => {
    expect(PAGE_MAX).toBe(20);
    expect(pageFits("1".repeat(20))).toBe(true);
    expect(pageFits(` ${"1".repeat(20)} `)).toBe(true);
    expect(pageFits("1".repeat(21))).toBe(false);
  });

  // QA on #866 (c.6561280081): U+0000 or a lone surrogate would be changed by
  // StorableInput, so the form refuses it and never builds a source from it.
  it("refuses a field the sheet would not keep as typed", () => {
    for (const bad of [NUL, LONE]) {
      expect(sourceFromFields({ ...BOOK, title: `Knjiga${bad}test` })).toMatchObject({ ok: false, missing: [], unstorable: ["title"] });
      expect(sourceFromFields({ ...ARTICLE, pages: `45${bad}60` })).toMatchObject({ ok: false, unstorable: ["pages"] });
    }
    // A field of the other kind is never read, so it never blocks.
    expect(sourceFromFields({ ...BOOK, journal: `X${NUL}` }).ok).toBe(true);
    expect(sourceFromFields({ ...BOOK, title: "Knjiga\uD83D\uDCD6" }).ok).toBe(true);
    expect(storable(`15${NUL}`)).toBe(false);
    expect(storable("15")).toBe(true);
  });
});

describe("bibliographyPlan", () => {
  const heading = { type: "heading", text: "Literatura" };
  const p = (text: string) => ({ type: "paragraph", text });

  it("adds the heading at the end when there is none", () => {
    expect(bibliographyPlan([p("Uvod.")], "Horvat")).toEqual({ kind: "insert", index: 1, heading: true });
    expect(bibliographyPlan([{ type: "heading", text: "Literatura i izvori" }], "Horvat")).toMatchObject({ heading: true });
  });

  it("keeps Croatian alphabetical order inside the section only", () => {
    const blocks = [p("Uvod."), heading, p("Cvitan"), p("Ćosić"), p(""), { type: "heading", text: "Prilozi" }, p("Abel")];
    expect(bibliographyPlan(blocks, "Čolak")).toEqual({ kind: "insert", index: 3, heading: false });
    expect(bibliographyPlan(blocks, "Babić")).toEqual({ kind: "insert", index: 2, heading: false });
    expect(bibliographyPlan(blocks, "Dukić")).toEqual({ kind: "insert", index: 4, heading: false });
    expect(bibliographyPlan([heading], "Dukić")).toEqual({ kind: "insert", index: 1, heading: false });
  });

  it("does not add the same entry twice", () => {
    expect(bibliographyPlan([heading, p("Cvitan")], "Cvitan")).toEqual({ kind: "duplicate" });
    // Codex on #866: entries reordered by hand; the same entry later in the section is still found.
    expect(bibliographyPlan([heading, p("Zorić"), p("Babić")], "Babić")).toEqual({ kind: "duplicate" });
  });
});

describe("writeSource", () => {
  it("writes the citation at the cursor and the entries in order under a new heading", () => {
    const editor = editorWith([{ text: "Prvi odlomak." }]);
    editor.commands.setTextSelection(editor.state.doc.child(0).nodeSize - 1);
    const book = sourceOf(BOOK);
    const article = sourceOf(ARTICLE);
    expect(writeSource(editor, book, "15", true)).not.toBeNull();
    expect(writeSource(editor, article, null, true)).not.toBeNull();
    expect(writeSource(editor, book, null, true)).not.toBeNull();
    expect(texts(editor)).toEqual([
      `paragraph:Prvi odlomak.${formatInText(book, fpzgCitationStyle, "15")}`,
      "heading:Literatura",
      `paragraph:${entryText(article)}`,
      `paragraph:${entryText(book)}`,
    ]);
    editor.destroy();
  });

  it("keeps the cursor after the citation when the bibliography is added below it", () => {
    // Codex on #866: a second "Dodaj i citiraj" must cite in the text, not in the first entry.
    const editor = editorWith([{ text: "Prvi odlomak." }]);
    editor.commands.setTextSelection(editor.state.doc.child(0).nodeSize - 1);
    const book = sourceOf(BOOK);
    const article = sourceOf(ARTICLE);
    expect(writeSource(editor, book, "", true)).not.toBeNull();
    expect(writeSource(editor, article, "", true)).not.toBeNull();
    const cited = `Prvi odlomak.${citationText(book, "")}${citationText(article, "")}`;
    expect(texts(editor)[0]).toBe(`paragraph:${cited}`);
    expect(editor.state.selection.empty).toBe(true);
    expect(editor.state.selection.head).toBe(1 + cited.length);
    editor.destroy();
  });

  it("cites in the text after everything was selected (Ctrl+A)", () => {
    // Review on #866 (c.6567118121): the whole-document selection took in the new bibliography.
    const editor = editorWith([{ text: "Prvi odlomak." }]);
    editor.commands.selectAll();
    const book = sourceOf(BOOK);
    const article = sourceOf(ARTICLE);
    expect(writeSource(editor, book, "", true)).not.toBeNull();
    expect(writeSource(editor, article, "", false)).not.toBeNull();
    const cited = `Prvi odlomak.${citationText(book, "")}${citationText(article, "")}`;
    expect(texts(editor)).toEqual(["paragraph:" + cited, "heading:Literatura", `paragraph:${entryText(book)}`]);
    expect(editor.state.selection.empty).toBe(true);
    expect(editor.state.selection.head).toBe(1 + cited.length);
    editor.destroy();
  });

  it("cites in the text after Ctrl+A and an entry added without a citation", () => {
    const editor = editorWith([{ text: "Prvi odlomak." }]);
    editor.commands.selectAll();
    const book = sourceOf(BOOK);
    expect(writeSource(editor, book, null, true)).not.toBeNull();
    expect(writeSource(editor, book, "15", false)).not.toBeNull();
    expect(texts(editor)).toEqual([
      `paragraph:Prvi odlomak.${citationText(book, "15")}`,
      "heading:Literatura",
      `paragraph:${entryText(book)}`,
    ]);
    editor.destroy();
  });

  it("cites in the text, not in the bibliography, after Ctrl+A with a bibliography already there", () => {
    // Review c.6574593813 and QA c.6574665912 on #866: the cursor went to the last entry.
    const editor = editorWith([{ text: "Prvi odlomak." }, { text: "Drugi odlomak." }]);
    const book = sourceOf(BOOK);
    const article = sourceOf(ARTICLE);
    expect(writeSource(editor, book, null, true)).not.toBeNull();
    editor.commands.selectAll();
    expect(writeSource(editor, article, "", false)).not.toBeNull();
    const cited = `Drugi odlomak.${citationText(article, "")}`;
    expect(texts(editor)).toEqual([
      "paragraph:Prvi odlomak.",
      `paragraph:${cited}`,
      "heading:Literatura",
      `paragraph:${entryText(book)}`,
    ]);
    expect(editor.state.selection.empty).toBe(true);
    expect(editor.state.selection.head).toBe(15 + 1 + cited.length);
    editor.destroy();
  });

  it("cites at the end of the last paragraph after Ctrl+A without a bibliography", () => {
    const editor = editorWith([{ text: "Prvi odlomak." }, { text: "Drugi odlomak." }]);
    editor.commands.selectAll();
    const article = sourceOf(ARTICLE);
    expect(writeSource(editor, article, "", false)).not.toBeNull();
    expect(texts(editor)).toEqual(["paragraph:Prvi odlomak.", `paragraph:Drugi odlomak.${citationText(article, "")}`]);
    editor.destroy();
  });

  it("never writes over selected text", () => {
    const editor = editorWith([{ text: "Ostaje." }]);
    editor.commands.setTextSelection({ from: 1, to: 8 });
    const book = sourceOf(BOOK);
    writeSource(editor, book, "", false);
    expect(texts(editor)).toEqual([`paragraph:Ostaje.${citationText(book, "")}`]);
    editor.destroy();
  });

  it("changes nothing while the sheet may not be written in", () => {
    const editor = editorWith([{ text: "Samo za čitanje." }]);
    editor.setEditable(false, false);
    const before = editor.state.doc.toJSON();
    const book = sourceOf(BOOK);
    expect(writeSource(editor, book, "", true)).toBeNull();
    expect(editor.state.doc.toJSON()).toEqual(before);
    expect(writeSource(null, book, "", false)).toBeNull();
    editor.destroy();
  });
});

// DAN-484: two works of the same authors in one year are 2021a and 2021b (FPZG "same-year").
describe("the letter of the year", () => {
  const SECOND: SourceFields = { ...BOOK, title: "Druga izmišljena knjiga" };
  const THIRD: SourceFields = { ...BOOK, title: "Treća izmišljena knjiga" };
  const lettered = (fields: SourceFields, letter: string) => ({ ...sourceOf(fields), yearSuffix: letter });
  const atEnd = (editor: Editor) => editor.commands.setTextSelection(editor.state.doc.child(0).nodeSize - 1);

  it("gives no letter to a work alone in its author and year", () => {
    const editor = editorWith([{ text: "Tekst." }]);
    atEnd(editor);
    const book = sourceOf(BOOK);
    expect(writeSource(editor, book, "", true)).toEqual(book);
    expect(writeSource(editor, { ...book, year: 2020, title: "Ranija" }, "", true)?.yearSuffix).toBeUndefined();
    expect(writeSource(editor, sourceOf({ ...BOOK, family2: "Kovač", given2: "Luka" }), "", true)?.yearSuffix).toBeUndefined();
    expect(writeSource(editor, sourceOf({ ...BOOK, given: "Marko", title: "Treća" }), "", true)?.yearSuffix).toBeUndefined();
    editor.destroy();
  });

  it("letters the first work a, in its entry and in-text citations, and the second b", () => {
    const editor = editorWith([{ text: "Tekst." }, { text: "Drugi (Horvat, 2021: 9) i (Horvat, 20215)." }]);
    atEnd(editor);
    const first = sourceOf(BOOK);
    writeSource(editor, first, "", true);
    expect(writeSource(editor, sourceOf(SECOND), "4", true)).toEqual(lettered(SECOND, "b"));
    expect(texts(editor)).toEqual([
      `paragraph:Tekst.${citationText(lettered(BOOK, "a"), "")}${citationText(lettered(SECOND, "b"), "4")}`,
      "paragraph:Drugi (Horvat, 2021a: 9) i (Horvat, 20215).",
      "heading:Literatura",
      `paragraph:${entryText(lettered(BOOK, "a"))}`,
      `paragraph:${entryText(lettered(SECOND, "b"))}`,
    ]);
    // The third takes c; nothing written before changes again.
    expect(writeSource(editor, sourceOf(THIRD), null, true)?.yearSuffix).toBe("c");
    expect(texts(editor)[0]).toBe(`paragraph:Tekst.${citationText(lettered(BOOK, "a"), "")}${citationText(lettered(SECOND, "b"), "4")}`);
    expect(texts(editor).slice(3)).toEqual([BOOK, SECOND, THIRD].map((f, i) => `paragraph:${entryText(lettered(f, "abc"[i]!))}`));
    editor.destroy();
  });

  it("keeps the letter of a work already there, as a duplicate and in Citiraj", () => {
    const editor = editorWith([{ text: "Tekst." }]);
    atEnd(editor);
    writeSource(editor, sourceOf(BOOK), null, true);
    writeSource(editor, sourceOf(SECOND), null, true);
    const before = texts(editor);
    expect(writeSource(editor, sourceOf(SECOND), null, true)).toEqual(lettered(SECOND, "b"));
    expect(writeSource(editor, sourceOf(BOOK), null, true)).toEqual(lettered(BOOK, "a"));
    expect(texts(editor)).toEqual(before);
    expect(writeSource(editor, sourceOf(SECOND), "3", false)).toEqual(lettered(SECOND, "b"));
    expect(texts(editor)[0]).toBe(`paragraph:Tekst.${citationText(lettered(SECOND, "b"), "3")}`);
    editor.destroy();
  });

  it("letters works of two authors and leaves in-text citations alone when another given name shares them", () => {
    const editor = editorWith([{ text: "Vidi (Horvat, 2021)." }]);
    atEnd(editor);
    writeSource(editor, sourceOf(ARTICLE), null, true);
    expect(writeSource(editor, sourceOf({ ...ARTICLE, title: "Drugi članak" }), null, true)?.yearSuffix).toBe("b");
    expect(texts(editor)).toContain(`paragraph:${entryText({ ...sourceOf(ARTICLE), yearSuffix: "a" })}`);
    writeSource(editor, sourceOf(BOOK), null, true);
    writeSource(editor, sourceOf({ ...BOOK, given: "Marko", title: "Treća" }), null, true);
    expect(writeSource(editor, sourceOf(SECOND), null, true)?.yearSuffix).toBe("b");
    expect(texts(editor)[0]).toBe("paragraph:Vidi (Horvat, 2021).");
    expect(texts(editor)).toContain(`paragraph:${entryText(lettered(BOOK, "a"))}`);
    editor.destroy();
  });

  it("letters a citation split by marks and an entry with leading spaces", () => {
    const editor = new Editor({
      element: null, extensions: createEditorExtensions(),
      content: { type: "doc", content: [
        { type: "paragraph", content: [{ type: "text", text: "Vidi (Hor" }, { type: "text", text: "vat, 2021)", marks: [{ type: "bold" }] }] },
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Literatura" }] },
        { type: "paragraph", content: [{ type: "text", text: `  ${entryText(sourceOf(BOOK))}` }] },
      ] },
    });
    atEnd(editor);
    expect(writeSource(editor, sourceOf(SECOND), null, true)?.yearSuffix).toBe("b");
    expect(texts(editor)[0]).toBe("paragraph:Vidi (Horvat, 2021a)");
    expect(texts(editor)[2]).toBe(`paragraph:  ${entryText(lettered(BOOK, "a"))}`);
    editor.destroy();
  });

  it("writes nothing when every letter a to z is taken", () => {
    const taken = [..."abcdefghijklmnopqrstuvwxyz"].map((l) => ({ text: entryText(lettered({ ...BOOK, title: `Knjiga ${l}` }, l)) }));
    const editor = editorWith([{ text: "Tekst." }, { type: "heading", text: "Literatura" }, ...taken]);
    atEnd(editor);
    const before = editor.state.doc.toJSON();
    expect(suffixPlan(blocksOf(editor.state.doc), sourceOf(SECOND))).toEqual({ kind: "full" });
    expect(writeSource(editor, sourceOf(SECOND), "", true)).toBeNull();
    expect(editor.state.doc.toJSON()).toEqual(before);
    editor.destroy();
  });

  it("takes the letter from the sheet at the write, not from an earlier preview", () => {
    const editor = editorWith([{ text: "Tekst." }]);
    atEnd(editor);
    writeSource(editor, sourceOf(BOOK), null, true);
    const preview = suffixPlan(blocksOf(editor.state.doc), sourceOf(THIRD));
    expect(preview.kind === "write" && preview.source.yearSuffix).toBe("b");
    // Another write lands between the preview and the click.
    writeSource(editor, sourceOf(SECOND), null, true);
    expect(writeSource(editor, sourceOf(THIRD), null, true)?.yearSuffix).toBe("c");
    expect(texts(editor).filter((t) => t.includes("(2021b)"))).toHaveLength(1);
    editor.destroy();
  });
});

// DAN-484, contract #1091 c.6584858242 (confirmed c.6584911859): the classes
// of input of point 1, one row each. A block "# X" is a heading X; `entry(f, l)`
// and `cite(f, l, page)` are the domain's text with letter l (none when "").
describe("the letter of the year, class by class", () => {
  const SECOND: SourceFields = { ...BOOK, title: "Druga izmišljena knjiga" };
  const TWO: SourceFields = { ...BOOK, family2: "Kovač", given2: "Luka", title: "Zajednička knjiga" };
  const entry = (f: SourceFields, l = "") => entryText(l === "" ? sourceOf(f) : { ...sourceOf(f), yearSuffix: l });
  const cite = (f: SourceFields, l = "", page = "") => citationText(l === "" ? sourceOf(f) : { ...sourceOf(f), yearSuffix: l }, page);
  const letters = (n: number) => [..."abcdefghijklmnopqrstuvwxyz"].slice(0, n);

  type Row = { klass: string; before: string[]; work: SourceFields; letter: string | null; after: string[] };
  const rows: Row[] = [
    { klass: "1 no other work", before: ["T.", "# Literatura"], work: BOOK, letter: "", after: ["T.", "# Literatura", entry(BOOK)] },
    { klass: "2 same authors, another year", before: ["T. (Horvat, 2021)", "# Literatura", entry(BOOK)],
      work: { ...SECOND, year: "2020" }, letter: "",
      after: ["T. (Horvat, 2021)", "# Literatura", entry({ ...SECOND, year: "2020" }), entry(BOOK)] },
    { klass: "3 same year, another author", before: ["T. (Horvat, 2021)", "# Literatura", entry(BOOK)],
      work: { ...SECOND, family: "Kovač" }, letter: "",
      after: ["T. (Horvat, 2021)", "# Literatura", entry(BOOK), entry({ ...SECOND, family: "Kovač" })] },
    { klass: "4a same first author with a second, against the first alone", before: ["T. (Horvat, 2021)", "# Literatura", entry(BOOK)],
      work: TWO, letter: "", after: ["T. (Horvat, 2021)", "# Literatura", entry(BOOK), entry(TWO)] },
    { klass: "4b the first alone, against the first with a second", before: ["T.", "# Literatura", entry(TWO)],
      work: SECOND, letter: "", after: ["T.", "# Literatura", entry(SECOND), entry(TWO)] },
    { klass: "5 the same authors in reverse order", before: ["T.", "# Literatura", entry(TWO)],
      work: { ...TWO, family: "Kovač", given: "Luka", family2: "Horvat", given2: "Ana", title: "Obrnuta" }, letter: "",
      after: ["T.", "# Literatura", entry(TWO), entry({ ...TWO, family: "Kovač", given: "Luka", family2: "Horvat", given2: "Ana", title: "Obrnuta" })] },
    { klass: "6 a family name that starts another (Horvat / Horvatić)", before: ["T. (Horvatić, 2021)", "# Literatura", entry({ ...BOOK, family: "Horvatić" })],
      work: SECOND, letter: "", after: ["T. (Horvatić, 2021)", "# Literatura", entry(SECOND), entry({ ...BOOK, family: "Horvatić" })] },
    { klass: "7 the second work: the first becomes a in entry and citations, with and without a page",
      before: ["T. (Horvat, 2021) i (Horvat, 2021: 9).", "# Literatura", entry(BOOK)], work: SECOND, letter: "b",
      after: ["T. (Horvat, 2021a) i (Horvat, 2021a: 9).", "# Literatura", entry(BOOK, "a"), entry(SECOND, "b")] },
    { klass: "8 the same work again after its letter: a duplicate that keeps it",
      before: ["T.", "# Literatura", entry(BOOK, "a"), entry(SECOND, "b")], work: SECOND, letter: "b",
      after: ["T.", "# Literatura", entry(BOOK, "a"), entry(SECOND, "b")] },
    { klass: "9 a and b taken: c", before: ["T.", "# Literatura", entry(BOOK, "a"), entry(SECOND, "b")],
      work: { ...BOOK, title: "Treća" }, letter: "c",
      after: ["T.", "# Literatura", entry(BOOK, "a"), entry(SECOND, "b"), entry({ ...BOOK, title: "Treća" }, "c")] },
    { klass: "10 a gap (a, c): b", before: ["T.", "# Literatura", entry(BOOK, "a"), entry({ ...BOOK, title: "Treća" }, "c")],
      work: SECOND, letter: "b",
      after: ["T.", "# Literatura", entry(BOOK, "a"), entry(SECOND, "b"), entry({ ...BOOK, title: "Treća" }, "c")] },
    { klass: "11 all 26 letters taken: nothing is written",
      before: ["T.", "# Literatura", ...letters(26).map((l) => entry({ ...BOOK, title: `Knjiga ${l}` }, l))], work: SECOND, letter: null,
      after: ["T.", "# Literatura", ...letters(26).map((l) => entry({ ...BOOK, title: `Knjiga ${l}` }, l))] },
    { klass: "12 the same text outside the Literatura section neither counts nor changes",
      before: [entry(BOOK), "# Literatura", "# Prilozi", entry(BOOK)], work: SECOND, letter: "",
      after: [entry(BOOK), "# Literatura", entry(SECOND), "# Prilozi", entry(BOOK)] },
    { klass: "12b an entry written by hand with more after the year is not of the group",
      before: ["T. (Horvat, 2021)", "# Literatura", "Horvat, Ana (2021-2022) Ručno upisan rad."], work: SECOND, letter: "",
      after: ["T. (Horvat, 2021)", "# Literatura", "Horvat, Ana (2021-2022) Ručno upisan rad.", entry(SECOND)] },
    { klass: "13 a lettered citation and another author's citation stay as they are",
      before: ["T. (Horvat, 2021b) i (Kovač i Horvat, 2021) i (Horvat, 20215).", "# Literatura", entry(BOOK)], work: SECOND, letter: "b",
      after: ["T. (Horvat, 2021b) i (Kovač i Horvat, 2021) i (Horvat, 20215).", "# Literatura", entry(BOOK, "a"), entry(SECOND, "b")] },
    { klass: "14 two authors", before: ["T. (Babić i Kovač, 2019: 45).", "# Literatura", entry(ARTICLE)],
      work: { ...ARTICLE, title: "Drugi članak" }, letter: "b",
      after: ["T. (Babić i Kovač, 2019a: 45).", "# Literatura", entry(ARTICLE, "a"), entry({ ...ARTICLE, title: "Drugi članak" }, "b")] },
  ];
  const blocks = (lines: string[]) => lines.map((line) => (line.startsWith("# ") ? { type: "heading", text: line.slice(2) } : { text: line }));
  const shown = (editor: Editor) => texts(editor).map((line) => line.replace(/^heading:/, "# ").replace(/^paragraph:/, ""));

  it.each(rows)("class $klass", ({ before, work, letter, after }) => {
    const editor = editorWith(blocks(before));
    atFirstEnd(editor);
    const doc = editor.state.doc.toJSON();
    const plan = suffixPlan(blocksOf(editor.state.doc), sourceOf(work));
    const written = writeSource(editor, sourceOf(work), null, true);
    if (letter === null) {
      expect(plan).toEqual({ kind: "full" });
      expect(written).toBeNull();
      expect(editor.state.doc.toJSON()).toEqual(doc);
    } else {
      expect(written?.yearSuffix ?? "").toBe(letter);
      expect(plan.kind === "write" && (plan.source.yearSuffix ?? "")).toBe(letter);
    }
    expect(shown(editor)).toEqual(after);
    editor.destroy();
  });

  it("class 7 also letters the citation it writes, with and without a page", () => {
    for (const page of ["", "4"]) {
      const editor = editorWith(blocks(["T.", "# Literatura", entry(BOOK)]));
      atFirstEnd(editor);
      expect(writeSource(editor, sourceOf(SECOND), page, true)?.yearSuffix).toBe("b");
      expect(shown(editor)[0]).toBe(`T.${cite(SECOND, "b", page)}`);
      editor.destroy();
    }
  });
});

// DAN-484 point 2: what the form names live (tried = false) and after a click,
// over every field of both kinds. A limit counts code points; nothing is cut.
describe("the form's errors, field by field", () => {
  const BOOK_FIELDS: SourceField[] = ["family", "given", "family2", "given2", "title", "place", "publisher"];
  const ARTICLE_FIELDS: SourceField[] = ["family", "given", "family2", "given2", "title", "journal", "volume", "issue", "pages"];
  const ASTRAL = "\u{1D49C}"; // one code point, two UTF-16 units
  const full = { ...BOOK, family2: "Kovač", given2: "Luka" };
  const fullArticle = { ...ARTICLE };
  const cases = [
    ...BOOK_FIELDS.map((field) => ({ kind: "book", base: full, field })),
    ...ARTICLE_FIELDS.map((field) => ({ kind: "article", base: fullArticle, field })),
  ] as const;

  it.each(cases)("$kind $field", ({ base, field }) => {
    const max = FIELD_MAX[field];
    const at = (fill: string) => ({ ...base, [field]: fill });
    const errs = (fields: SourceFields, tried: boolean) => formErrors(sourceFromFields(fields), "", tried);
    // Empty: named only after a click, and only when the field is needed.
    const empty = at("");
    const needed = sourceFromFields(empty).ok === false;
    expect(errs(empty, false)).toEqual([]);
    expect(errs(empty, true).some((e) => e.kind === "missing")).toBe(needed);
    // At the limit, in code points, with spaces around and with an astral character.
    expect(errs(at("č".repeat(max)), false)).toEqual([]);
    expect(errs(at(`  ${"č".repeat(max)}  `), false)).toEqual([]);
    expect(errs(at(`${ASTRAL}${"č".repeat(max - 1)}`), false)).toEqual([]);
    // One more: named at once, without a click, and the value is not cut.
    const over = at(`${ASTRAL}${"č".repeat(max)}`);
    expect(errs(over, false)).toEqual([{ kind: "tooLong", field }]);
    expect(over[field]).toHaveLength(max + 2);
    // A character the sheet would change: named at once too.
    expect(errs(at(`a${NUL}`), false)).toEqual([{ kind: "unstorable", field }]);
  });

  it("never names a hidden field of the other kind", () => {
    const over = (field: SourceField) => "1".repeat(FIELD_MAX[field] + 1);
    expect(formErrors(sourceFromFields({ ...BOOK, journal: over("journal"), pages: over("pages") }), "", true)).toEqual([]);
    expect(formErrors(sourceFromFields({ ...ARTICLE, place: over("place"), publisher: `x${NUL}` }), "", true)).toEqual([]);
  });

  it("names a malformed year with its own message, and only after a click", () => {
    expect(formErrors(sourceFromFields({ ...BOOK, year: "20215" }), "", false)).toEqual([]);
    expect(formErrors(sourceFromFields({ ...BOOK, year: "20215" }), "", true)).toEqual([{ kind: "yearInvalid" }]);
  });

  it("names the page of a citation at once, at the limit and one over", () => {
    const ok = sourceFromFields(BOOK);
    expect(formErrors(ok, "1".repeat(PAGE_MAX), false)).toEqual([]);
    expect(formErrors(ok, ` ${ASTRAL}${"1".repeat(PAGE_MAX - 1)} `, false)).toEqual([]);
    expect(formErrors(ok, "1".repeat(PAGE_MAX + 1), false)).toEqual([{ kind: "pageTooLong" }]);
    expect(formErrors(ok, `1${NUL}`, false)).toEqual([{ kind: "pageUnstorable" }]);
    // An empty form says nothing until a click; the page still speaks at once.
    expect(formErrors(sourceFromFields(EMPTY_FIELDS), "1".repeat(PAGE_MAX + 1), false)).toEqual([{ kind: "pageTooLong" }]);
  });
});

describe("writeSource and unstorable text", () => {
  // QA on #866: the second entry with U+0000 became a duplicate and stopped the evidence log.
  it("writes nothing that the sheet would change on the way in", () => {
    const editor = editorWith([{ text: "Prvi odlomak." }]);
    editor.commands.setTextSelection(editor.state.doc.child(0).nodeSize - 1);
    const book = sourceOf(BOOK);
    expect(writeSource(editor, book, null, true)).not.toBeNull();
    const before = editor.state.doc.toJSON();
    const withNul = { ...book, title: `Izmišljena${NUL} knjiga` };
    expect(writeSource(editor, withNul, null, true)).toBeNull();
    expect(writeSource(editor, book, `1${NUL}5`, false)).toBeNull();
    expect(writeSource(editor, book, `1${LONE}`, true)).toBeNull();
    expect(editor.state.doc.toJSON()).toEqual(before);
    editor.destroy();
  });
});

describe("the tab's text (PRODUCT §5)", () => {
  it("lives in the scanned catalogue and holds no forbidden term", () => {
    expect(isUiTextModule("src/lib/i18n/messages.hr.ts")).toBe(true);
    for (const text of Object.values(messagesHr.workspace.sources)) expect(findForbiddenTerms(text), text).toEqual([]);
  });
});