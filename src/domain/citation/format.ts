import type { CitationStyle } from "./style";
import { CitationInputError, type Author, type Person, type Source } from "./types";

const collator = new Intl.Collator("hr", { sensitivity: "base" });

function required(value: string | undefined, field: string): string {
  const trimmed = value?.trim() ?? "";
  if (trimmed === "") {
    throw new CitationInputError(`${field} is required`);
  }
  return trimmed;
}

function checkSource(source: Source): void {
  if (source.authors.length === 0) {
    throw new CitationInputError("at least one author is required");
  }
  if (!Number.isInteger(source.year) || source.year < 1000 || source.year > 9999) {
    throw new CitationInputError("year must be a four-digit integer");
  }
  if (source.yearSuffix !== undefined && !/^[a-z]+$/.test(source.yearSuffix)) {
    throw new CitationInputError("yearSuffix must be lowercase letters");
  }
}

/** Page or page range; a hyphen or minus between numbers becomes the style's range dash. */
export function normalizePages(pages: string, style: CitationStyle): string {
  return required(pages, "pages").replace(/\s*[-‐‑‒—−]\s*/g, style.rangeDash).replace(/\s*–\s*/g, style.rangeDash);
}

function joinList(items: readonly string[], lastJoiner: string): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")}${lastJoiner}${items[items.length - 1]}`;
}

/** Appends a period unless the text already ends with sentence punctuation. */
function sentence(text: string): string {
  return /[.?!]$/.test(text) ? text : `${text}.`;
}

function inTextName(author: Author): string {
  if (author.kind === "person") return required(author.family, "author family name");
  return author.acronym?.trim() || required(author.name, "organization name");
}

function yearLabel(source: Source): string {
  return `${source.year}${source.yearSuffix ?? ""}`;
}

/** In-text citation, e.g. `(Becker, 2007: 9)`. Omit `page` when citing the work as a whole. */
export function formatInText(source: Source, style: CitationStyle, page?: string): string {
  return inText(source, style, () => (page === undefined ? undefined : normalizePages(page, style)));
}

/**
 * In-text citation of a stored locator (contract document-schema-v2 §9.1). A
 * locator that `normalizePages` refuses because it is only white space (`" "`,
 * U+2028, U+2029) is valid in a document and is shown exactly as stored.
 */
export function formatCitationInText(source: Source, style: CitationStyle, locator?: string): string {
  if (locator === undefined || locator.trim() !== "") return formatInText(source, style, locator);
  return inText(source, style, () => locator);
}

function inText(source: Source, style: CitationStyle, pages: () => string | undefined): string {
  checkSource(source);
  const t = style.inText;
  const names = source.authors.map(inTextName);
  const authors =
    names.length <= t.maxNamedAuthors
      ? joinList(names, t.twoAuthorsJoiner)
      : `${names[0]}${t.manyAuthorsSuffix}`;
  const shown = pages();
  const pagePart = shown === undefined ? "" : `${t.pageSeparator}${shown}`;
  return `${t.open}${authors}${t.authorYearSeparator}${yearLabel(source)}${pagePart}${t.close}`;
}

function listName(author: Author): string {
  if (author.kind === "person") {
    return `${required(author.family, "author family name")}, ${required(author.given, "author given name")}`;
  }
  const name = required(author.name, "organization name");
  const acronym = author.acronym?.trim();
  return acronym ? `${acronym} (${name})` : name;
}

function editorName(editor: Person): string {
  return `${required(editor.given, "editor given name")} ${required(editor.family, "editor family name")}`;
}

function formatAccessed(iso: string, label: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  const date = match ? new Date(Date.UTC(+match[1], +match[2] - 1, +match[3])) : undefined;
  if (!match || !date || date.getUTCMonth() !== +match[2] - 1 || date.getUTCDate() !== +match[3]) {
    throw new CitationInputError("accessed must be a valid YYYY-MM-DD date");
  }
  return `(${label} ${+match[3]}. ${+match[2]}. ${match[1]}.)`;
}

function body(source: Source, style: CitationStyle): string {
  const b = style.bibliography;
  const title = sentence(required(source.title, "title"));
  switch (source.type) {
    case "book":
      return `${title} ${required(source.place, "place")}: ${required(source.publisher, "publisher")}.`;
    case "article": {
      const volume = source.volume?.trim();
      const issue = source.issue?.trim();
      const numbering = [volume, issue].filter(Boolean).join("/");
      const journal = required(source.journal, "journal");
      const head = numbering ? `${journal} ${numbering}` : journal;
      return source.pages === undefined
        ? `${title} ${sentence(head)}`
        : `${title} ${head}: ${normalizePages(source.pages, style)}.`;
    }
    case "chapter": {
      if (source.editors.length === 0) {
        throw new CitationInputError("at least one editor is required");
      }
      const editors = joinList(source.editors.map(editorName), b.authorJoiner);
      const where = `${required(source.place, "place")}: ${required(source.publisher, "publisher")}`;
      const pages = source.pages === undefined ? "" : `: ${normalizePages(source.pages, style)}`;
      return `${title} ${b.inLabel} ${editors} (${b.editorLabel}) ${sentence(required(source.bookTitle, "book title"))} ${where}${pages}.`;
    }
    case "web":
      return `${title} ${required(source.url, "url")} ${formatAccessed(source.accessed, b.accessedLabel)}`;
  }
}

/** One bibliography entry, e.g. `Šiber, Ivan (2003) Politički marketing. Zagreb: Politička kultura.` */
export function formatBibliographyEntry(source: Source, style: CitationStyle): string {
  checkSource(source);
  const b = style.bibliography;
  const authors = joinList(source.authors.map(listName), b.authorJoiner);
  const year = `(${yearLabel(source)})${b.periodAfterYear ? "." : ""}`;
  return `${authors} ${year} ${body(source, style)}`;
}

function sortKey(author: Author): string {
  return author.kind === "person" ? `${author.family} ${author.given}` : (author.acronym ?? author.name);
}

function compareSources(a: Source, b: Source): number {
  const length = Math.min(a.authors.length, b.authors.length);
  for (let i = 0; i < length; i++) {
    const byName = collator.compare(sortKey(a.authors[i]), sortKey(b.authors[i]));
    if (byName !== 0) return byName;
  }
  if (a.authors.length !== b.authors.length) return a.authors.length - b.authors.length;
  if (a.year !== b.year) return a.year - b.year;
  return compareYearSuffixes(a.yearSuffix ?? "", b.yearSuffix ?? "");
}

/** `a` ... `z`, `aa`, `ab`, ...: shorter first, then by letter. */
function compareYearSuffixes(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The suffix at `index`: 0 is `a`, 25 is `z`, 26 is `aa`, 701 is `zz`, 702 is `aaa`. */
function yearSuffixAt(index: number): string {
  let suffix = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    suffix = String.fromCharCode(97 + ((n - 1) % 26)) + suffix;
  }
  return suffix;
}

/** Alphabetical by family name (Croatian collation), then chronological. Does not mutate the input. */
export function sortBibliography<T extends Source>(sources: readonly T[]): T[] {
  return [...sources].sort(compareSources);
}

/**
 * Gives works with the same authors and year the suffixes a, b, ... ordered by
 * title, continuing after z with aa, ab, ... (contract document-schema-v2 §4),
 * so it never throws. Suffixes already present are kept and never reused.
 * Does not mutate the input.
 */
export function assignYearSuffixes<T extends Source>(sources: readonly T[]): T[] {
  const groupKey = (s: Source) => `${s.authors.map(sortKey).join("|")}#${s.year}`;
  const groups = new Map<string, T[]>();
  for (const source of sources) {
    const key = groupKey(source);
    groups.set(key, [...(groups.get(key) ?? []), source]);
  }
  const suffixes = new Map<T, string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const taken = new Set(group.flatMap((s) => (s.yearSuffix === undefined ? [] : [s.yearSuffix])));
    const unsuffixed = group
      .filter((s) => s.yearSuffix === undefined)
      .sort((x, y) => collator.compare(x.title, y.title));
    let next = 0;
    for (const source of unsuffixed) {
      while (taken.has(yearSuffixAt(next))) next++;
      suffixes.set(source, yearSuffixAt(next++));
    }
  }
  return sources.map((s) => (suffixes.has(s) ? { ...s, yearSuffix: suffixes.get(s) } : s));
}
