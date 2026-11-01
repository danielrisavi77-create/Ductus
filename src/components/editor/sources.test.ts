// @vitest-environment node
import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { formatBibliographyEntry, formatInText, fpzgCitationStyle } from "@/domain/citation";
import { createEditorExtensions } from "@/editor/schema";
import { messagesHr } from "@/lib/i18n/messages.hr";

import { isUiTextModule } from "../../../scripts/forbidden-terms/scan";
import { findForbiddenTerms } from "../../../scripts/forbidden-terms/terms";

import {
  bibliographyPlan, citationText, EMPTY_FIELDS, entryText, FIELD_MAX, PAGE_MAX, pageFits, sourceFromFields, writeSource,
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
      ok: false, missing: ["family", "given", "year", "title", "place", "publisher"], yearInvalid: false, tooLong: [],
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

  it("bounds the page of a citation", () => {
    expect(PAGE_MAX).toBe(20);
    expect(pageFits("1".repeat(20))).toBe(true);
    expect(pageFits(` ${"1".repeat(20)} `)).toBe(true);
    expect(pageFits("1".repeat(21))).toBe(false);
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
    expect(writeSource(editor, citationText(book, "15"), entryText(book))).toBe(true);
    expect(writeSource(editor, null, entryText(article))).toBe(true);
    expect(writeSource(editor, null, entryText(book))).toBe(true);
    expect(texts(editor)).toEqual([
      `paragraph:Prvi odlomak.${formatInText(book, fpzgCitationStyle, "15")}`,
      "heading:Literatura",
      `paragraph:${entryText(article)}`,
      `paragraph:${entryText(book)}`,
    ]);
    editor.destroy();
  });

  it("never writes over selected text", () => {
    const editor = editorWith([{ text: "Ostaje." }]);
    editor.commands.setTextSelection({ from: 1, to: 8 });
    writeSource(editor, "(X, 2020)", null);
    expect(texts(editor)).toEqual(["paragraph:Ostaje.(X, 2020)"]);
    editor.destroy();
  });

  it("changes nothing while the sheet may not be written in", () => {
    const editor = editorWith([{ text: "Samo za čitanje." }]);
    editor.setEditable(false, false);
    const before = editor.state.doc.toJSON();
    const book = sourceOf(BOOK);
    expect(writeSource(editor, citationText(book, ""), entryText(book))).toBe(false);
    expect(editor.state.doc.toJSON()).toEqual(before);
    expect(writeSource(null, "(X, 2020)", null)).toBe(false);
    editor.destroy();
  });
});

describe("the tab's text (PRODUCT §5)", () => {
  it("lives in the scanned catalogue and holds no forbidden term", () => {
    expect(isUiTextModule("src/lib/i18n/messages.hr.ts")).toBe(true);
    for (const text of Object.values(messagesHr.workspace.sources)) expect(findForbiddenTerms(text), text).toEqual([]);
  });
});