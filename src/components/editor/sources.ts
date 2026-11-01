import type { Editor } from "@tiptap/core";
import type { Node as PMNode, NodeType } from "@tiptap/pm/model";
import { Selection, type Transaction } from "@tiptap/pm/state";

import { CITATION_FORM_META } from "@/editor/source";

import {
  formatBibliographyEntry, formatInText, fpzgCitationStyle,
  type ArticleSource, type BookSource, type Person,
} from "@/domain/citation";

/**
 * DAN-343: citations and the bibliography from the "Literatura" tab. The
 * text is plain text in the document (no new node or mark, D-98 addition),
 * and only `formatInText` / `formatBibliographyEntry` with the FPZG style
 * write it. Inserting goes through editor commands, like a toolbar button,
 * and nothing is written while the editor may not be written in.
 */

export type SourceKind = "book" | "article";

export type SourceFields = {
  kind: SourceKind;
  family: string;
  given: string;
  family2: string;
  given2: string;
  year: string;
  title: string;
  place: string;
  publisher: string;
  journal: string;
  volume: string;
  issue: string;
  pages: string;
};

export type SourceField = Exclude<keyof SourceFields, "kind">;

export const EMPTY_FIELDS: SourceFields = {
  kind: "book", family: "", given: "", family2: "", given2: "", year: "", title: "",
  place: "", publisher: "", journal: "", volume: "", issue: "", pages: "",
};

export type SourceCheck =
  | { ok: true; source: BookSource | ArticleSource }
  | { ok: false; missing: SourceField[]; yearInvalid: boolean; tooLong: SourceField[] };

/**
 * Longest value of each field, in code points (F-154 point 2, owner decision
 * #87 `issuecomment-6423014866`). A guard of the form, not a threshold of
 * assessment. The input's `maxLength` counts UTF-16 units, so it never lets
 * through a value this check refuses; a longer value is refused, never cut.
 */
export const FIELD_MAX: Readonly<Record<SourceField, number>> = {
  family: 80, given: 80, family2: 80, given2: 80, year: 4, title: 300,
  place: 150, publisher: 150, journal: 150, volume: 10, issue: 10, pages: 20,
};

/** Longest page of a citation, in code points. */
export const PAGE_MAX = 20;

const codePoints = (text: string) => [...text].length;

/** Whether the page of a citation fits its limit. */
export function pageFits(page: string): boolean {
  return codePoints(page.trim()) <= PAGE_MAX;
}

/** The heading the bibliography stands under; only this exact text is recognised. */
export const BIBLIOGRAPHY_HEADING = "Literatura";

/** The source the form describes, or which fields still need to be filled. */
export function sourceFromFields(fields: SourceFields): SourceCheck {
  const value = (field: SourceField) => fields[field].trim();
  const needed: SourceField[] = ["family", "given", "year", "title"];
  needed.push(...(fields.kind === "book" ? (["place", "publisher"] as const) : (["journal"] as const)));
  // A second author is optional, but half of one is not.
  if (value("family2") !== "" || value("given2") !== "") needed.push("family2", "given2");
  const missing = needed.filter((field) => value(field) === "");
  const yearInvalid = value("year") !== "" && !/^[1-9]\d{3}$/.test(value("year"));
  // The year has its own message: its form already bounds it to four digits.
  const tooLong = (Object.keys(FIELD_MAX) as SourceField[])
    .filter((field) => field !== "year" && codePoints(value(field)) > FIELD_MAX[field]);
  if (missing.length > 0 || yearInvalid || tooLong.length > 0) return { ok: false, missing, yearInvalid, tooLong };

  const authors: Person[] = [{ kind: "person", family: value("family"), given: value("given") }];
  if (value("family2") !== "") authors.push({ kind: "person", family: value("family2"), given: value("given2") });
  const base = { authors, year: Number(value("year")), title: value("title") };
  const optional = (field: SourceField) => (value(field) === "" ? {} : { [field]: value(field) });
  const source: BookSource | ArticleSource = fields.kind === "book"
    ? { ...base, type: "book", place: value("place"), publisher: value("publisher") }
    : { ...base, type: "article", journal: value("journal"), ...optional("volume"), ...optional("issue"), ...optional("pages") };
  return { ok: true, source };
}

/** The in-text citation, with the page only when one is given. */
export function citationText(source: BookSource | ArticleSource, page: string): string {
  const trimmed = page.trim();
  return formatInText(source, fpzgCitationStyle, trimmed === "" ? undefined : trimmed);
}

export function entryText(source: BookSource | ArticleSource): string {
  return formatBibliographyEntry(source, fpzgCitationStyle);
}

export type Block = { type: string; text: string };

export type BibliographyPlan =
  | { kind: "duplicate" }
  | { kind: "insert"; index: number; heading: boolean };

// The domain's collator (sortBibliography): Croatian order, case ignored.
const collator = new Intl.Collator("hr", { sensitivity: "base" });

/** The order entries stand in, in the document and in the panel's list. */
export function compareEntries(a: string, b: string): number {
  return collator.compare(a, b);
}

/**
 * Where an entry goes among the top-level blocks: in the section under the
 * first heading "Literatura" (up to the next heading), before the first
 * entry it sorts ahead of, or after the last one. Without the heading, a new
 * heading and the entry go to the end. The same text twice is not added.
 */
export function bibliographyPlan(blocks: readonly Block[], entry: string): BibliographyPlan {
  const start = blocks.findIndex((b) => b.type === "heading" && b.text.trim() === BIBLIOGRAPHY_HEADING);
  if (start === -1) return { kind: "insert", index: blocks.length, heading: true };
  let end = start + 1;
  while (end < blocks.length && blocks[end]!.type !== "heading") end++;
  // The whole section first: a student may have reordered the entries by hand.
  for (let i = start + 1; i < end; i++) {
    if (blocks[i]!.text.trim() === entry) return { kind: "duplicate" };
  }
  let index = start + 1;
  for (let i = start + 1; i < end; i++) {
    const text = blocks[i]!.text.trim();
    if (text === "") continue;
    if (compareEntries(entry, text) < 0) return { kind: "insert", index: i, heading: false };
    index = i + 1;
  }
  return { kind: "insert", index, heading: false };
}

function blocksOf(doc: PMNode): Block[] {
  const blocks: Block[] = [];
  doc.forEach((node) => blocks.push({ type: node.type.name, text: node.textContent }));
  return blocks;
}

// The panel also checks `isDestroyed` at the click, as the toolbar does; a
// headless editor in the unit tests reports itself destroyed.
function writable(editor: Editor | null): editor is Editor {
  return editor !== null && editor.isEditable;
}

/**
 * Writes the citation after the selection (never over selected text) and, when
 * `entry` is given, the entry into the bibliography, in one transaction. Returns
 * false and changes nothing while the editor may not be written in.
 */
export function writeSource(editor: Editor | null, citation: string | null, entry: string | null): boolean {
  if (!writable(editor)) return false;
  // No focus(): a keyboard user stays in the panel they clicked in.
  return editor.chain().command(({ tr, state }) => {
    // Evidence: this change is `citation-form`, an event of its own (src/editor/source.ts).
    tr.setMeta(CITATION_FORM_META, true);
    if (citation !== null) tr.insertText(citation, citationAt(tr));
    if (entry === null) return true;
    const plan = bibliographyPlan(blocksOf(tr.doc), entry);
    if (plan.kind === "duplicate") return true;
    // The cursor stays in the student's text (Codex on #866): a split at the end
    // of the block the cursor ends would otherwise carry it into the new heading.
    const kept = tr.selection;
    const from = tr.mapping.maps.length;
    const { schema } = state;
    const blocks: [NodeType, Record<string, unknown> | null, string][] = [[schema.nodes.paragraph!, null, entry]];
    if (plan.heading) blocks.unshift([schema.nodes.heading!, { level: 1 }, BIBLIOGRAPHY_HEADING]);
    let pos = 0;
    for (let i = 0; i < plan.index; i++) pos += tr.doc.child(i).nodeSize;
    // Every top-level block of the schema is a text block (src/editor/schema.ts),
    // so the block before always takes a split. The evidence format writes a new block only as a split at the end of the
    // block before, as Enter does (src/editor/capture-rewrite.ts), never as a
    // closed block after another.
    for (const [type, attrs, text] of blocks) {
      const end = pos - 1;
      tr.split(end, 1, [{ type, attrs }]);
      tr.insertText(text, end + 2);
      pos = end + 3 + text.length;
    }
    tr.setSelection(keepBefore(kept, tr, from));
    return true;
  }).run();
}

// The citation goes at the end of the selection, inside a text block. With
// everything selected (Ctrl+A) that end is the document itself, where an
// insert would wrap the text in a new paragraph the evidence log refuses
// (review on #866), so it moves back to the end of the last text block.
function citationAt(tr: Transaction): number {
  const to = tr.doc.resolve(tr.selection.to);
  return to.parent.inlineContent ? to.pos : Selection.near(to, -1).to;
}

// The selection mapped over the bibliography steps only, leaning back, so a
// position at a split stays in the block it was in.
function keepBefore(selection: Selection, tr: Transaction, from: number): Selection {
  const steps = tr.mapping.slice(from);
  return selection.map(tr.doc, {
    map: (pos) => steps.map(pos, -1),
    mapResult: (pos) => steps.mapResult(pos, -1),
  });
}
