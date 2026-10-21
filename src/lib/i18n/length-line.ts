import { pluralHr, wordsHr } from "./hr";
import { messagesHr as t } from "./messages.hr";

/**
 * The length line of the status bar (FE-D6, design editor-v11: "označeno 12
 * riječi · 210 / 2 000–2 500 riječi · ≈ 1 str."). Pure, so the wording and
 * the arithmetic are tested without a DOM.
 */

/** The assignment's inclusive word limits; either end may be absent. */
export type WordRange = { readonly min: number | null; readonly max: number | null };

/** Words per page of the prototype (`Math.round(words / 300)`). */
const WORDS_PER_PAGE = 300;

const NBSP = " ";

/** "2 000", "12 500": thousands grouped with a no-break space, as in the design. */
export function groupHr(n: number): string {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/** Approximate pages; none before the first word, then at least one. */
export function pagesOf(words: number): number {
  return words > 0 ? Math.max(1, Math.round(words / WORDS_PER_PAGE)) : 0;
}

/** Words in a plain-text selection, split the way the journal counts them. */
export function countTextWords(text: string): number {
  return text.split(/\s+/u).filter((word) => word.length > 0).length;
}

export type LengthLine = {
  /** "označeno 12 riječi", or null without a selection of words. */
  readonly selected: string | null;
  /** The count itself, shown in bold. */
  readonly count: string;
  /** What follows the count: " / 2 000–2 500 riječi · ≈ 1 str." */
  readonly rest: string;
};

export function lengthLine(words: number, selectedWords: number, range: WordRange | null): LengthLine {
  const noun = range?.min != null && range.max != null
    ? ` / ${groupHr(range.min)}–${groupHr(range.max)} ${pluralHr(range.max, "riječ", "riječi", "riječi")}`
    : range?.min != null
      ? ` / ${t.workspace.wordMinimum.replace("{words}", groupHr(range.min))} ${pluralHr(range.min, "riječ", "riječi", "riječi")}`
      : range?.max != null
        ? ` / ${t.workspace.wordMaximum.replace("{words}", groupHr(range.max))} ${pluralHr(range.max, "riječ", "riječi", "riječi")}`
        : ` ${pluralHr(words, "riječ", "riječi", "riječi")}`;
  const pages = pagesOf(words);
  return {
    selected: selectedWords > 0 ? t.workspace.selectedWords.replace("{words}", wordsHr(selectedWords)) : null,
    count: groupHr(words),
    rest: pages > 0 ? `${noun} · ${t.workspace.pagesApprox.replace("{pages}", String(pages))}` : noun,
  };
}
