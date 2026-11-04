// @vitest-environment node
import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { formatBibliographyEntry, formatInText, fpzgCitationStyle } from "@/domain/citation";
import { createEditorExtensions } from "@/editor/schema";
import { messagesHr } from "@/lib/i18n/messages.hr";

import { isUiTextModule } from "../../../scripts/forbidden-terms/scan";
import { findForbiddenTerms } from "../../../scripts/forbidden-terms/terms";

import {
  bibliographyPlan, citationText, EMPTY_FIELDS, entryText, FIELD_MAX, formErrors, PAGE_MAX, pageFits, sourceFromFields, storable, writeSource,
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

  it("keeps the cursor after the citation when the bibliography is added below it", () => {
    // Codex on #866: a second "Dodaj i citiraj" must cite in the text, not in the first entry.
    const editor = editorWith([{ text: "Prvi odlomak." }]);
    editor.commands.setTextSelection(editor.state.doc.child(0).nodeSize - 1);
    const book = sourceOf(BOOK);
    const article = sourceOf(ARTICLE);
    expect(writeSource(editor, citationText(book, ""), entryText(book))).toBe(true);
    expect(writeSource(editor, citationText(article, ""), entryText(article))).toBe(true);
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
    expect(writeSource(editor, citationText(book, ""), entryText(book))).toBe(true);
    expect(writeSource(editor, citationText(article, ""), null)).toBe(true);
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
    expect(writeSource(editor, null, entryText(book))).toBe(true);
    expect(writeSource(editor, citationText(book, "15"), null)).toBe(true);
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
    expect(writeSource(editor, null, entryText(book))).toBe(true);
    editor.commands.selectAll();
    expect(writeSource(editor, citationText(article, ""), null)).toBe(true);
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
    expect(writeSource(editor, citationText(article, ""), null)).toBe(true);
    expect(texts(editor)).toEqual(["paragraph:Prvi odlomak.", `paragraph:Drugi odlomak.${citationText(article, "")}`]);
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

describe("the form's errors, field by field", () => {
  const BOOK_FIELDS: SourceField[] = ["family", "given", "family2", "given2", "title", "place", "publisher"];
  const ARTICLE_FIELDS: SourceField[] = ["family", "given", "family2", "given2", "title", "journal", "volume", "issue", "pages"];
  const ASTRAL = "\u{1D49C}"; // one code point, two UTF-16 units
  const cases = [
    ...BOOK_FIELDS.map((field) => ({ kind: "book", base: { ...BOOK, family2: "Kovač", given2: "Luka" }, field })),
    ...ARTICLE_FIELDS.map((field) => ({ kind: "article", base: ARTICLE, field })),
  ] as const;

  it.each(cases)("$kind $field", ({ base, field }) => {
    const max = FIELD_MAX[field];
    const at = (fill: string) => ({ ...base, [field]: fill });
    const errs = (fields: SourceFields, tried: boolean) => formErrors(sourceFromFields(fields), "", tried);
    // Empty or only spaces: named only after a click, and only when the field is needed.
    for (const blank of ["", "   "]) {
      const needed = sourceFromFields(at(blank)).ok === false;
      expect(errs(at(blank), false)).toEqual([]);
      expect(errs(at(blank), true)).toEqual(needed ? [{ kind: "missing", field }] : []);
    }
    // At the limit, in code points, with spaces around and with an astral character.
    for (const fill of ["č".repeat(max), `  ${"č".repeat(max)}  `, `${ASTRAL}${"č".repeat(max - 1)}`]) {
      expect(errs(at(fill), false)).toEqual([]);
      expect(errs(at(fill), true)).toEqual([]);
    }
    // One more: named at once, with and without a click, and the value is not cut.
    const over = at(`${ASTRAL}${"č".repeat(max)}`);
    expect(errs(over, false)).toEqual([{ kind: "tooLong", field }]);
    expect(errs(over, true)).toEqual([{ kind: "tooLong", field }]);
    expect(over[field]).toHaveLength(max + 2);
    // A character the sheet would change: named at once too.
    expect(errs(at(`a${NUL}`), false)).toEqual([{ kind: "unstorable", field }]);
    expect(errs(at(`a${LONE}`), true)).toEqual([{ kind: "unstorable", field }]);
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
    for (const tried of [false, true]) {
      expect(formErrors(ok, "", tried)).toEqual([]);
      expect(formErrors(ok, "1".repeat(PAGE_MAX), tried)).toEqual([]);
      expect(formErrors(ok, ` ${ASTRAL}${"1".repeat(PAGE_MAX - 1)} `, tried)).toEqual([]);
      expect(formErrors(ok, "1".repeat(PAGE_MAX + 1), tried)).toEqual([{ kind: "pageTooLong" }]);
      expect(formErrors(ok, `1${NUL}`, tried)).toEqual([{ kind: "pageUnstorable" }]);
    }
    // An empty form says nothing until a click; the page still speaks at once.
    expect(formErrors(sourceFromFields(EMPTY_FIELDS), "1".repeat(PAGE_MAX + 1), false)).toEqual([{ kind: "pageTooLong" }]);
  });
});

// DAN-484 narrowed contract (#1407 c.6626765838): the form never reads or
// changes text already in the sheet; it only inserts a new citation and entry.
describe("the form leaves the sheet's text as it is", () => {
  // As the panel writes on "Dodaj i citiraj": its text comes from the fields only.
  const addAndCite = (editor: Editor, fields: SourceFields, page = "") => {
    const source = sourceOf(fields);
    return writeSource(editor, citationText(source, page), entryText(source));
  };
  const blocks = (editor: Editor) => {
    const out: unknown[] = [];
    editor.state.doc.forEach((node) => out.push(node.toJSON()));
    return out;
  };

  it("N1 a second work of the author and year is (Horvat, 2021), and the first stays byte-equal", () => {
    const editor = editorWith([{ text: "Prvi odlomak." }]);
    editor.commands.setTextSelection(editor.state.doc.child(0).nodeSize - 1);
    expect(addAndCite(editor, BOOK)).toBe(true);
    const before = blocks(editor);
    const firstCited = texts(editor)[0]!;
    const second = { ...BOOK, title: "Druga izmišljena knjiga" };
    expect(citationText(sourceOf(second), "")).toBe("(Horvat, 2021)");
    expect(addAndCite(editor, second)).toBe(true);
    expect(texts(editor)).toEqual([
      `${firstCited}(Horvat, 2021)`,
      "heading:Literatura",
      `paragraph:${entryText(sourceOf(second))}`,
      `paragraph:${entryText(sourceOf(BOOK))}`,
    ]);
    // Every block but the cited paragraph and the new entry is the same node as before.
    expect(blocks(editor).filter((_, i) => i !== 0 && i !== 2)).toEqual(before.slice(1));
    editor.destroy();
  });

  it("N2 a given name with a year in it stays as written when the author's other year is added", () => {
    // Scenarios of review c.6624200228 and QA c.6624252521.
    const editor = editorWith([{ text: "Prvi odlomak." }]);
    editor.commands.setTextSelection(editor.state.doc.child(0).nodeSize - 1);
    const first = { ...BOOK, given: "Ana (2021)", year: "2020" };
    expect(addAndCite(editor, first)).toBe(true);
    const before = blocks(editor);
    const firstCited = texts(editor)[0]!;
    expect(addAndCite(editor, BOOK)).toBe(true);
    const after = texts(editor);
    expect(after[0]).toBe(`${firstCited}${citationText(sourceOf(BOOK), "")}`);
    expect(after).toContain(`paragraph:${entryText(sourceOf(first))}`);
    expect(entryText(sourceOf(first))).toContain("Horvat, Ana (2021)");
    expect(blocks(editor).filter((node) => JSON.stringify(node).includes("Ana (2021) (2020)"))).toEqual(
      before.filter((node) => JSON.stringify(node).includes("Ana (2021) (2020)")),
    );
    editor.destroy();
  });

  it("N3 a pasted run of names in Literatura changes neither the preview nor any block", () => {
    const pasted = `${"Babić, A, i ".repeat(160)}(2021) Naslov. Zagreb: Primjer.`;
    const empty = editorWith([{ text: "Prvi odlomak." }]);
    const withRun = editorWith([{ text: "Prvi odlomak." }, { type: "heading", text: "Literatura" }, { text: pasted }]);
    const fields = { ...BOOK, family: "Babić", given: "A" };
    // The preview the panel shows is a function of the fields alone.
    const preview = [citationText(sourceOf(fields), ""), entryText(sourceOf(fields))];
    for (const editor of [empty, withRun]) {
      editor.commands.setTextSelection(editor.state.doc.child(0).nodeSize - 1);
      const before = blocks(editor);
      expect(addAndCite(editor, fields)).toBe(true);
      expect([citationText(sourceOf(fields), ""), entryText(sourceOf(fields))]).toEqual(preview);
      expect(texts(editor)[0]).toBe(`paragraph:Prvi odlomak.${preview[0]}`);
      expect(texts(editor)).toContain(`paragraph:${preview[1]}`);
      // Every block already there, the pasted run included, is unchanged.
      for (const node of before.slice(1)) expect(blocks(editor)).toContainEqual(node);
      editor.destroy();
    }
    expect(pasted).toHaveLength(12 * 160 + 31);
  });
});

describe("writeSource and unstorable text", () => {
  // QA on #866: the second entry with U+0000 became a duplicate and stopped the evidence log.
  it("writes nothing that the sheet would change on the way in", () => {
    const editor = editorWith([{ text: "Prvi odlomak." }]);
    editor.commands.setTextSelection(editor.state.doc.child(0).nodeSize - 1);
    const book = sourceOf(BOOK);
    expect(writeSource(editor, null, entryText(book))).toBe(true);
    const before = editor.state.doc.toJSON();
    const withNul = { ...book, title: `Izmišljena${NUL} knjiga` };
    expect(writeSource(editor, null, entryText(withNul))).toBe(false);
    expect(writeSource(editor, citationText(book, `1${NUL}5`), null)).toBe(false);
    expect(writeSource(editor, citationText(book, `1${LONE}`), entryText(book))).toBe(false);
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