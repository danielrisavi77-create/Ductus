import type { Editor } from "@tiptap/core";
import type { Node as PMNode, NodeType } from "@tiptap/pm/model";
import { AllSelection, Selection, type Transaction } from "@tiptap/pm/state";

import { CITATION_FORM_META } from "@/editor/source";
import { storableText } from "@/editor/storable-text";

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
  | { ok: false; missing: SourceField[]; yearInvalid: boolean; tooLong: SourceField[]; unstorable: SourceField[] };

/**
 * Longest value of each field, in code points (F-154 point 2, owner decision
 * #87 `issuecomment-6423014866`). A guard of the form, not a threshold of
 * assessment. The field itself has no `maxLength`: a browser cuts pasted text
 * to it silently (QA on #866, c.6567210898), so a longer value is refused here
 * at the click, never cut.
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

/**
 * Whether the sheet keeps this text exactly as it is. `StorableInput` drops
 * U+0000 and replaces a lone surrogate in the editor (src/editor/storable-text.ts),
 * so text holding either would be written as other text than the form shows:
 * the duplicate check misses it and the evidence log refuses the change (QA on
 * #866, c.6561280081). The form refuses it instead; nothing is cut silently.
 */
export function storable(text: string): boolean {
  return storableText(text) === text;
}

// The fields a source of each kind is built from; a field of the other kind is never read.
const USED: Readonly<Record<SourceKind, readonly SourceField[]>> = {
  book: ["family", "given", "family2", "given2", "year", "title", "place", "publisher"],
  article: ["family", "given", "family2", "given2", "year", "title", "journal", "volume", "issue", "pages"],
};

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
  // Only the fields of the chosen kind count: a hidden field of the other kind is never read.
  const tooLong = USED[fields.kind]
    .filter((field) => field !== "year" && codePoints(value(field)) > FIELD_MAX[field]);
  const unstorable = USED[fields.kind].filter((field) => !storable(fields[field]));
  if (missing.length > 0 || yearInvalid || tooLong.length > 0 || unstorable.length > 0) {
    return { ok: false, missing, yearInvalid, tooLong, unstorable };
  }

  const authors: Person[] = [{ kind: "person", family: value("family"), given: value("given") }];
  if (value("family2") !== "") authors.push({ kind: "person", family: value("family2"), given: value("given2") });
  const base = { authors, year: Number(value("year")), title: value("title") };
  const optional = (field: SourceField) => (value(field) === "" ? {} : { [field]: value(field) });
  const source: BookSource | ArticleSource = fields.kind === "book"
    ? { ...base, type: "book", place: value("place"), publisher: value("publisher") }
    : { ...base, type: "article", journal: value("journal"), ...optional("volume"), ...optional("issue"), ...optional("pages") };
  return { ok: true, source };
}

/** A problem of the form, in the order the panel lists it. */
export type FormError =
  | { kind: "missing" | "tooLong" | "unstorable"; field: SourceField }
  | { kind: "yearInvalid" | "pageTooLong" | "pageUnstorable" };

/**
 * DAN-484: what the form names. A value over its limit or one the sheet would
 * change is named as soon as it is in the field (typed or pasted), and never
 * cut; an empty field or a malformed year only after a click (`tried`), so an
 * empty form says nothing.
 */
export function formErrors(check: SourceCheck, page: string, tried: boolean): FormError[] {
  const out: FormError[] = [];
  if (!check.ok) {
    if (tried) out.push(...check.missing.map((field) => ({ kind: "missing" as const, field })));
    if (tried && check.yearInvalid) out.push({ kind: "yearInvalid" });
    out.push(...check.tooLong.map((field) => ({ kind: "tooLong" as const, field })));
    out.push(...check.unstorable.map((field) => ({ kind: "unstorable" as const, field })));
  }
  if (!pageFits(page)) out.push({ kind: "pageTooLong" });
  if (!storable(page)) out.push({ kind: "pageUnstorable" });
  return out;
}

export type Source = BookSource | ArticleSource;

/** The in-text citation, with the page only when one is given. */
export function citationText(source: Source, page: string): string {
  const trimmed = page.trim();
  return formatInText(source, fpzgCitationStyle, trimmed === "" ? undefined : trimmed);
}

export function entryText(source: Source): string {
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
  const range = section(blocks);
  if (range === null) return { kind: "insert", index: blocks.length, heading: true };
  const { start, end } = range;
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

const LETTERS = "abcdefghijklmnopqrstuvwxyz";

/** Where a letter goes into a block: before `offset` of the block's text. */
export type LetterAt = { index: number; offset: number; letter: string };

export type SuffixPlan =
  /**
   * The work, with the letter it takes; `promote` letters earlier text.
   * `taken`: the year form `work` came with (its letter, or none) is held by
   * another entry of the group, so a citation of `work` as it is would point there.
   */
  | { kind: "write"; source: Source; duplicate: boolean; promote: readonly LetterAt[]; taken: boolean }
  /** Every letter a to z is taken for this author and year: nothing is written. */
  | { kind: "full" };

// The bibliography section: the blocks after the first heading "Literatura" up to the next heading.
function section(blocks: readonly Block[]): { start: number; end: number } | null {
  const start = blocks.findIndex((b) => b.type === "heading" && b.text.trim() === BIBLIOGRAPHY_HEADING);
  if (start === -1) return null;
  let end = start + 1;
  while (end < blocks.length && blocks[end]!.type !== "heading") end++;
  return { start, end };
}

// The common start of a text without and with the letter "a", where the letter goes.
function lead(plain: string, lettered: string): string {
  let at = 0;
  while (at < plain.length && plain[at] === lettered[at]) at++;
  return plain.slice(0, at);
}

// What an entry of the author starts with in the bibliography: "Horvat, " for a person.
function listHead(author: Source["authors"][number]): string {
  return author.kind === "person" ? `${author.family}, ` : author.name;
}

// The name of an author in an in-text citation, as the domain's formatInText gives it.
function citedName(author: Source["authors"][number]): string {
  return author.kind === "person" ? author.family : (author.acronym?.trim() || author.name);
}

// The in-text form of a list of cited names: every name up to the style's
// limit, else the first and "i sur." (here the empty string after it).
function citedForm(names: readonly string[]): readonly string[] {
  return names.length > fpzgCitationStyle.inText.maxNamedAuthors ? [names[0]!, ""] : names;
}

/**
 * Every reading of the family names of an entry's authors after its first,
 * from what follows the first author's family name and comma: "Marko, Babić,
 * Iva i Kovač, Luka" gives [["Babić", "Kovač"]]. The joiner between authors
 * stands only in the part before the last author's given name, between the
 * given name before it and the last family name; a joiner anywhere else is
 * part of a name ("Babić, Iva i Ema", QA on #1407, c.6588415588). When that
 * part holds more than one joiner ("Iva i Ema i Kovač"), each is a reading.
 * `null` when the list is not one of persons (an organisation among them):
 * it cannot be read safely.
 */
function laterFamilies(rest: string): string[][] | null {
  const { authorJoiner } = fpzgCitationStyle.bibliography;
  // The first author's given name, then (family, given) pairs; the last family
  // name shares its part with the given name before it.
  const parts = rest.split(", ");
  if (parts.length === 1) return [[]];
  if (parts.length % 2 === 1) return null;
  const middle = parts.slice(1, -2).filter((_, i) => i % 2 === 0);
  const joined = parts[parts.length - 2]!;
  const readings: string[][] = [];
  for (let at = joined.indexOf(authorJoiner); at !== -1; at = joined.indexOf(authorJoiner, at + 1)) {
    readings.push([...middle, joined.slice(at + authorJoiner.length)]);
  }
  return readings.length === 0 ? null : readings;
}

/**
 * Whether an entry would be cited in the text as `work` is: the same in-text
 * form (every family name in order up to two authors, else the first author
 * and "i sur.") and the same year, with or without a letter. The year is read
 * at its place, in the first bracket after the first author that opens with
 * four digits, never in a title, place, publisher or journal such as
 * "Analiza (2021)" (QA on #1407, c.6586313749). "Horvat, Marko, Babić, Iva i
 * Kovač, Luka (2021)" is "(Horvat i sur., 2021)", not "(Horvat i Kovač, 2021)"
 * (QA on #1407, c.6587528637). An entry that cannot be read counts as shared,
 * so the student's citations stay as written, and so does one any reading of
 * whose names gives the same form (c.6588415588).
 */
function sharesCitation(text: string, work: Source): boolean {
  const first = work.authors[0]!;
  const head = listHead(first);
  if (!text.startsWith(head)) return false;
  const year = /\((\d{4})([^)]*)\)/.exec(text.slice(head.length));
  if (year === null || year[1] !== String(work.year) || !/^[a-z]?$/.test(year[2]!)) return false;
  // What stands between the first author's head and the year: a given name, or
  // more authors. An organisation has no given name: a stand-in keeps the shape.
  const rest = text.slice(head.length, head.length + year.index).trimEnd();
  const readings = laterFamilies(first.kind === "person" ? rest : `-${rest}`);
  if (readings === null) return true;
  const ours = citedForm(work.authors.map(citedName));
  return readings.some((later) => {
    const theirs = citedForm([citedName(first), ...later]);
    return theirs.length === ours.length && theirs.every((name, i) => name === ours[i]);
  });
}

/**
 * What an author written as `item` in Literatura could be cited as. An
 * organisation with its acronym, "BK (Babić i Kovač)", is cited "BK"; its name
 * may hold brackets, "BK (Zavod (Zagreb))" (QA on #1407, c.6590744530), so the
 * acronym may end at any " (". A person is cited by the family name, before
 * the comma of the given name; a comma may stand in a family name ("Babić,
 * Kovač, Iva"). With `anyComma` (the entry's commas do not make a list of
 * persons, so one stands in a given name the form takes, "Luka, ml.", review
 * on #1407, c.6590682130), the family name may end at any ", ".
 */
function citedReadings(item: string, anyComma: boolean): string[] {
  const readings = [item];
  if (item.endsWith(")")) {
    for (let at = item.indexOf(" ("); at > 0; at = item.indexOf(" (", at + 1)) readings.push(item.slice(0, at));
  }
  const last = item.lastIndexOf(", ");
  for (let at = item.indexOf(", "); at > 0; at = item.indexOf(", ", at + 1)) {
    if (anyComma || at === last) readings.push(item.slice(0, at));
  }
  return readings;
}

// Whether the commas of the names before the year make a list of persons, as
// `laterFamilies` reads one: "Babić, Ana i Kovač, Luka" does, "Babić, Ana i
// Kovač, Luka, ml." does not (a comma stands in a name).
function personList(names: string): boolean {
  const comma = names.indexOf(", ");
  return comma === -1 || laterFamilies(names.slice(comma + 2)) !== null;
}

/**
 * Whether an entry, read in any way its names allow, gives the same in-text
 * citation as the work, written as the domain writes it: "Babić, Ana i Kovač,
 * Luka (2021)" and "Babić i Kovač, Iva (2021)" are both "(Babić i Kovač,
 * 2021)" (review on #1407, c.6589873844). Unlike `sharesCitation`, it does
 * not ask the entry to open with the work's first author: a joiner, comma or
 * "i sur." inside a family name can move where the first author ends. One or
 * two authors are read in every split, organisations included; three or more
 * as a first author, then persons. A reading counts only when it gives the
 * same text, so this can only keep citations as written, never letter more.
 */
function sharesWrittenForm(text: string, work: Source): boolean {
  const year = /\((\d{4})([^)]*)\)/.exec(text);
  if (year === null || year[1] !== String(work.year) || !/^[a-z]?$/.test(year[2]!)) return false;
  const names = text.slice(0, year.index).trimEnd();
  const { authorJoiner } = fpzgCitationStyle.bibliography;
  const anyComma = !personList(names);
  const readings: string[][] = citedReadings(names, anyComma).map((name) => [name]);
  for (let at = names.indexOf(authorJoiner); at !== -1; at = names.indexOf(authorJoiner, at + 1)) {
    const later = citedReadings(names.slice(at + authorJoiner.length), anyComma);
    for (const first of citedReadings(names.slice(0, at), anyComma)) readings.push(...later.map((name) => [first, name]));
  }
  // Three or more: the first author ends at a comma (a person, then the given
  // name) or before the list goes on (an organisation); persons follow.
  for (let at = names.indexOf(", "); at !== -1; at = names.indexOf(", ", at + 1)) {
    const head = names.slice(0, at);
    for (const later of laterFamilies(names.slice(at + 2)) ?? []) readings.push([head, ...later]);
    for (const first of citedReadings(head, anyComma)) {
      for (const later of laterFamilies(`-${names.slice(at)}`) ?? []) readings.push([first, ...later]);
    }
  }
  const ours = citationText(work, "");
  return readings.some((reading) => {
    try {
      const authors = reading.map((family) => ({ kind: "person" as const, family, given: "-" }));
      return citationText({ ...work, authors }, "") === ours;
    } catch {
      return false;
    }
  });
}

// Every place `part` stands in `text`.
function places(text: string, part: string): number[] {
  const out: number[] = [];
  for (let at = text.indexOf(part); at !== -1; at = text.indexOf(part, at + 1)) out.push(at);
  return out;
}

// Whether text[from, to) is a value as the domain's `required` keeps it: not empty, no space at either end.
function keptAt(text: string, from: number, to: number): boolean {
  return from < to && !/\s/.test(text[from]!) && !/\s/.test(text[to - 1]!);
}

// Whether text[from, to) is how the domain lists one author it cites as
// `cited`: "Horvat, Ana" (a person, any given name), "Zavod" or
// "Horvat (Zavod (2020))" (an organisation, without or with its acronym).
function listsAs(text: string, from: number, to: number, cited: string): boolean {
  const end = from + cited.length;
  if (!keptAt(cited, 0, cited.length) || end > to || !text.startsWith(cited, from)) return false;
  if (end === to) return true;
  if (text.startsWith(", ", end)) return keptAt(text, end + 2, to);
  return text.startsWith(" (", end) && text[to - 1] === ")" && keptAt(text, end + 2, to - 1);
}

// Whether `names`, all that stands before the year, is how the domain lists
// some authors that `formatInText` cites as `cited`: one author, two joined at
// any joiner of both, or three or more (the FPZG style names up to two) whose
// first is cited and which go on to a last author after a joiner.
function listsCited(names: string, cited: string): boolean {
  const { authorJoiner } = fpzgCitationStyle.bibliography;
  const { twoAuthorsJoiner, manyAuthorsSuffix } = fpzgCitationStyle.inText;
  if (listsAs(names, 0, names.length, cited)) return true;
  const joins = places(names, authorJoiner);
  for (const c of places(cited, twoAuthorsJoiner)) {
    const [left, right] = [cited.slice(0, c), cited.slice(c + twoAuthorsJoiner.length)];
    if (joins.some((j) => listsAs(names, 0, j, left) && listsAs(names, j + authorJoiner.length, names.length, right))) return true;
  }
  if (!cited.endsWith(manyAuthorsSuffix)) return false;
  const first = cited.slice(0, -manyAuthorsSuffix.length);
  return places(names, ", ").some((n) => listsAs(names, 0, n, first)
    && joins.some((j) => keptAt(names, n + 2, j) && keptAt(names, j + authorJoiner.length, names.length)));
}

// Whether `body` can follow the year in an entry: every kind opens with its
// title as a sentence, then a space and the rest, which ends a sentence or,
// for a web page, the bracket of the date it was read.
function entryBody(body: string): boolean {
  if (!/[.?!)]$/.test(body)) return false;
  return places(body, " ").some((at) => /[.?!]/.test(body[at - 1] ?? "") && keptAt(body, 0, at) && keptAt(body, at + 1, body.length));
}

/**
 * Whether some list of authors and some place of the year give exactly the
 * text of an entry through the domain, cited in the text as `work` is. The
 * form takes any text in a name, so the year is any " (2021) " or
 * " (2021a) " that a body follows, not the first bracket ("Horvat, Marko
 * (2020) (2021)", review on #1407, c.6591695313, QA c.6591747653), and a
 * given name may hold commas and the joiner ("Babić, Ana, ml. i Kovač, Luka i
 * Ivo, ml."). Every split is tried and each is checked in linear time, so the
 * reading is exact and bounded. Read with `sharesCitation` and
 * `sharesWrittenForm`, which keep entries written out of style by hand: an
 * entry any of them reads as ours keeps the citations as written, so this can
 * never letter more.
 */
function sharesForm(text: string, work: Source): boolean {
  const cited = citationText(work, "");
  const { open, close, authorYearSeparator } = fpzgCitationStyle.inText;
  const yearPart = `${authorYearSeparator}${work.year}${close}`;
  if (!cited.startsWith(open) || !cited.endsWith(yearPart)) return false;
  const ours = cited.slice(open.length, -yearPart.length);
  const opening = ` (${work.year}`;
  return places(text, opening).some((at) => {
    const after = /^[a-z]?\) /.exec(text.slice(at + opening.length));
    return after !== null && entryBody(text.slice(at + opening.length + after[0].length)) && listsCited(text.slice(0, at), ours);
  });
}

/**
 * DAN-484: the letter a work takes in the year of its citation and entry
 * (FPZG rule "same-year": 2021a, 2021b). The entries of the same authors and
 * year in the bibliography section are its group. The same work again keeps
 * its letter (and is a duplicate); the first other work of the group gives
 * the one already written the letter "a", in its entry and, when no other
 * entry shares its in-text form, in its in-text citations outside the
 * section; then the new work takes the next free letter.
 */
export function suffixPlan(blocks: readonly Block[], work: Source): SuffixPlan {
  const base: Source = { ...work };
  delete base.yearSuffix;
  const plain = entryText(base);
  const head = lead(plain, entryText({ ...base, yearSuffix: "a" }));
  const tail = plain.slice(head.length);
  const range = section(blocks);
  if (range === null) return { kind: "write", source: base, duplicate: false, promote: [], taken: false };

  type Member = { index: number; offset: number; letter: string | null; same: boolean };
  const members: Member[] = [];
  for (let i = range.start + 1; i < range.end; i++) {
    const text = blocks[i]!.text;
    const offset = text.length - text.trimStart().length + head.length;
    const trimmed = text.trim();
    if (!trimmed.startsWith(head)) continue;
    const rest = trimmed.slice(head.length);
    const letter = /^[a-z]\)/.test(rest) ? rest[0]! : null;
    if (letter === null && !rest.startsWith(")")) continue;
    members.push({ index: i, offset, letter, same: (letter === null ? rest : rest.slice(1)) === tail });
  }
  const same = members.find((m) => m.same);
  if (same !== undefined) {
    const source = same.letter === null ? base : { ...base, yearSuffix: same.letter };
    return { kind: "write", source, duplicate: true, promote: [], taken: false };
  }
  if (members.length === 0) return { kind: "write", source: base, duplicate: false, promote: [], taken: false };
  const taken = members.some((m) => m.letter === (work.yearSuffix ?? null));

  const free = [...LETTERS].filter((l) => !members.some((m) => m.letter === l));
  const unlettered = members.filter((m) => m.letter === null);
  if (free.length < unlettered.length + 1) return { kind: "full" };
  const promote: LetterAt[] = unlettered.map((m, i) => ({ index: m.index, offset: m.offset, letter: free[i]! }));
  // In-text citations name only the family names, so they are lettered only
  // when exactly one entry of the section could be the one they point to.
  if (unlettered.length === 1) {
    const citeHead = lead(citationText(base, ""), citationText({ ...base, yearSuffix: "a" }, ""));
    const { pageSeparator, close } = fpzgCitationStyle.inText;
    // Another entry outside the group cited in the same form (another given
    // name, the same year with or without a letter) could be what
    // "(Horvat, 2021)" points to: then the in-text citations stay as the
    // student wrote them. Works of the group are told apart by their letters.
    const group = new Set(members.map((m) => m.index));
    const sameForm = blocks.slice(range.start + 1, range.end)
      .some((b, i) => !group.has(range.start + 1 + i)
        && (sharesCitation(b.text.trim(), base) || sharesWrittenForm(b.text.trim(), base) || sharesForm(b.text.trim(), base)));
    if (!sameForm) {
      blocks.forEach((block, index) => {
        if (index > range.start && index < range.end) return;
        let from = block.text.indexOf(citeHead);
        while (from !== -1) {
          const next = block.text.slice(from + citeHead.length);
          if (next.startsWith(close) || next.startsWith(pageSeparator)) {
            promote.push({ index, offset: from + citeHead.length, letter: promote[0]!.letter });
          }
          from = block.text.indexOf(citeHead, from + citeHead.length);
        }
      });
    }
  }
  return { kind: "write", source: { ...base, yearSuffix: free[unlettered.length]! }, duplicate: false, promote, taken };
}

/** The top-level blocks of a document, as the plans read them. */
export function blocksOf(doc: PMNode): Block[] {
  const blocks: Block[] = [];
  doc.forEach((node) => blocks.push({ type: node.type.name, text: node.textContent }));
  return blocks;
}

// The panel also checks `isDestroyed` at the click, as the toolbar does; a
// headless editor in the unit tests reports itself destroyed.
function writable(editor: Editor | null): editor is Editor {
  return editor !== null && editor.isEditable;
}

// The document position before `offset` of the text of top-level block `index`.
function textPos(doc: PMNode, index: number, offset: number): number {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
  const block = doc.child(index);
  let seen = 0;
  let at = pos + 1;
  for (let i = 0; i < block.childCount; i++) {
    const child = block.child(i);
    const length = child.isText ? child.text!.length : child.textContent.length;
    if (child.isText && offset <= seen + length) return at + offset - seen;
    seen += length;
    at += child.nodeSize;
  }
  return at;
}

/**
 * Writes the citation of `work` after the selection (never over selected
 * text) when `page` is given, and the entry into the bibliography when
 * `withEntry`, in one transaction, with the letter of its year from
 * `suffixPlan` (DAN-484). The plan is made from the sheet at the moment of the
 * write, not from what the form showed before. Returns the work as written,
 * or null and changes nothing while the editor may not be written in, when a
 * text is not `storable`, or when every letter of the year is taken.
 */
export function writeSource(editor: Editor | null, work: Source, page: string | null, withEntry: boolean): Source | null {
  if (!writable(editor)) return null;
  let written: Source | null = null;
  // No focus(): a keyboard user stays in the panel they clicked in.
  editor.chain().command(({ tr, state }) => {
    const plan = suffixPlan(blocksOf(tr.doc), work);
    // Tiptap dispatches even a command that returns false; nothing is written then.
    const refuse = () => { tr.setMeta("preventDispatch", true); return false; };
    if (plan.kind === "full") return refuse();
    // "Citiraj" for a work no longer in Literatura (Poništi) never writes the
    // letter, or the year without one, that another work of its group now holds
    // there: "(Horvat, 2021b)" would point to that work (review on #1407, c.6588340462).
    if (!withEntry && !plan.duplicate && plan.taken) return refuse();
    // "Citiraj" from the list letters nothing else: the work keeps the letter
    // its entry has in the sheet, or the one it was written with.
    const source = withEntry || plan.duplicate ? plan.source : work;
    const promote = withEntry && !plan.duplicate ? plan.promote : [];
    const citation = page === null ? null : citationText(source, page);
    const entry = withEntry && !plan.duplicate ? entryText(source) : null;
    // Text the sheet would change on the way in is never written (QA on #866).
    if ((citation !== null && !storable(citation)) || (entry !== null && !storable(entry))) return refuse();
    written = source;
    // Evidence: this change is `citation-form`, an event of its own (src/editor/source.ts).
    tr.setMeta(CITATION_FORM_META, true);
    // From the end of the document back, so each position still holds.
    const letters = promote.map((p) => ({ pos: textPos(tr.doc, p.index, p.offset), letter: p.letter }))
      .sort((x, y) => y.pos - x.pos);
    for (const { pos, letter } of letters) tr.insertText(letter, pos);
    // Everything selected (Ctrl+A) becomes a cursor at the end of the last text
    // block before the bibliography first. An `AllSelection` maps to the whole
    // new document, the added bibliography too, so the next citation would land
    // there (review on #866, c.6567118121, c.6574593813).
    if (tr.selection instanceof AllSelection) tr.setSelection(endOfText(tr.doc));
    if (citation !== null) tr.insertText(citation, citationAt(tr));
    if (entry === null) return true;
    const placed = bibliographyPlan(blocksOf(tr.doc), entry);
    if (placed.kind === "duplicate") return true;
    // The cursor stays in the student's text (Codex on #866): a split at the end
    // of the block the cursor ends would otherwise carry it into the new heading.
    const kept = tr.selection;
    const from = tr.mapping.maps.length;
    const { schema } = state;
    const blocks: [NodeType, Record<string, unknown> | null, string][] = [[schema.nodes.paragraph!, null, entry]];
    if (placed.heading) blocks.unshift([schema.nodes.heading!, { level: 1 }, BIBLIOGRAPHY_HEADING]);
    let pos = 0;
    for (let i = 0; i < placed.index; i++) pos += tr.doc.child(i).nodeSize;
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
  return written;
}

// The end of the last text block before the bibliography heading, or of the
// document when it has none (or nothing stands before the heading).
function endOfText(doc: PMNode): Selection {
  const start = blocksOf(doc).findIndex((b) => b.type === "heading" && b.text.trim() === BIBLIOGRAPHY_HEADING);
  if (start <= 0) return Selection.atEnd(doc);
  let pos = 0;
  for (let i = 0; i < start; i++) pos += doc.child(i).nodeSize;
  return Selection.near(doc.resolve(pos), -1);
}

// The citation goes at the end of the selection, inside a text block. Outside
// one, an insert would wrap the text in a new paragraph the evidence log
// refuses (review on #866), so it moves back to the end of the text block before.
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
