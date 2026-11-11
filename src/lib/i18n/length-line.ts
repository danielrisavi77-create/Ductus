import { pluralHr } from "./hr";
import { DEFAULT_INTERFACE_LOCALE, messagesFor, type InterfaceLocale } from "./locale";

/**
 * The length line of the status bar (FE-D6, design editor-v11: "označeno 12
 * riječi · 210 / 2 000–2 500 riječi · ≈ 1 str."). Pure, so the wording and
 * the arithmetic are tested without a DOM. Croatian is the default; English
 * (M11.5-P01b) takes its templates from the catalogue and its own grouping
 * and plural ("2,000–2,500 words").
 */

/** The assignment's inclusive word limits; either end may be absent. */
export type WordRange = { readonly min: number | null; readonly max: number | null };

/** Words per page of the prototype (`Math.round(words / 300)`). */
const WORDS_PER_PAGE = 300;

const NBSP = " ";

function group(n: number, separator: string): string {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}

/** "2 000", "12 500": thousands grouped with a no-break space, as in the design. */
export function groupHr(n: number): string {
  return group(n, NBSP);
}

/** Thousands grouping by interface language: "2 000" and "2,000". */
const GROUP: Readonly<Record<InterfaceLocale, (n: number) => string>> = {
  hr: groupHr,
  en: (n) => group(n, ","),
};

/** The noun that agrees with a count: "riječ / riječi", "word / words". */
const WORD_NOUN: Readonly<Record<InterfaceLocale, (n: number) => string>> = {
  hr: (n) => pluralHr(n, "riječ", "riječi", "riječi"),
  en: (n) => (Math.abs(Math.trunc(n)) === 1 ? "word" : "words"),
};

/** The same range label in the teacher preview, S3 notice and editor. */
export function wordRange(
  range: WordRange | null,
  locale: InterfaceLocale = DEFAULT_INTERFACE_LOCALE,
): string | null {
  const t = messagesFor(locale);
  const grouped = GROUP[locale];
  const noun = WORD_NOUN[locale];
  if (range?.min != null && range.max != null) {
    return `${grouped(range.min)}–${grouped(range.max)} ${noun(range.max)}`;
  }
  if (range?.min != null) {
    return `${t.workspace.wordMinimum.replace("{words}", grouped(range.min))} ${noun(range.min)}`;
  }
  if (range?.max != null) {
    return `${t.workspace.wordMaximum.replace("{words}", grouped(range.max))} ${noun(range.max)}`;
  }
  return null;
}

/** The Croatian range label (teacher preview and S3 notice). */
export function wordRangeHr(range: WordRange | null): string | null {
  return wordRange(range, "hr");
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

export function lengthLine(
  words: number,
  selectedWords: number,
  range: WordRange | null,
  locale: InterfaceLocale = DEFAULT_INTERFACE_LOCALE,
): LengthLine {
  const t = messagesFor(locale);
  const target = wordRange(range, locale);
  const noun = target ? ` / ${target}` : ` ${WORD_NOUN[locale](words)}`;
  const pages = pagesOf(words);
  const selected = `${selectedWords} ${WORD_NOUN[locale](selectedWords)}`;
  return {
    selected: selectedWords > 0 ? t.workspace.selectedWords.replace("{words}", selected) : null,
    count: GROUP[locale](words),
    rest: pages > 0 ? `${noun} · ${t.workspace.pagesApprox.replace("{pages}", String(pages))}` : noun,
  };
}
