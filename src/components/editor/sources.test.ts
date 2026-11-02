// @vitest-environment node
import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { formatBibliographyEntry, formatInText, fpzgCitationStyle } from "@/domain/citation";
import { createEditorExtensions } from "@/editor/schema";
import { messagesHr } from "@/lib/i18n/messages.hr";

import { isUiTextModule } from "../../../scripts/forbidden-terms/scan";
import { findForbiddenTerms } from "../../../scripts/forbidden-terms/terms";

import {
  bibliographyPlan, blocksOf, citationText, EMPTY_FIELDS, entryText, FIELD_MAX, PAGE_MAX, pageFits, sourceFromFields, storable, suffixPlan, writeSource,
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