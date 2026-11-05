/**
 * Literal search over one run of text (DAN-507, M5.10-P02; contract #1091
 * c.6587093852). Pure, no I/O, no logging: the text and the query never
 * leave the function.
 *
 * - The query is literal text, never a pattern, so there is no regular
 *   expression that could backtrack: the search is `indexOf` over the text.
 * - Matches do not overlap; each search starts after the previous match.
 * - With case off, each code point is lowercased on its own, and only when
 *   that keeps its UTF-16 length (`İ` stays `İ`), so offsets in the folded
 *   text are offsets in the text.
 * - A query that cannot be typed or stored (a lone surrogate, NUL, a control
 *   or line separator, more than `MAX_SEARCH_TEXT_LENGTH` units) finds nothing.
 */

export const MAX_SEARCH_TEXT_LENGTH = 200;

export type LiteralQuery = Readonly<{ text: string; matchCase: boolean }>;
export type TextRange = Readonly<{ from: number; to: number }>;

// With the `u` flag a valid pair is one code point outside the surrogate
// range, so the class matches only surrogates that stand alone.
const UNSEARCHABLE = /[\u0000-\u001F\u007F-\u009F\u2028\u2029\uD800-\uDFFF]/u;

/** Whether `text` can be a query or a replacement. The empty text can. */
export function isSearchableText(text: string): boolean {
  return text.length <= MAX_SEARCH_TEXT_LENGTH && !UNSEARCHABLE.test(text);
}

function fold(text: string): string {
  let folded = "";
  for (const char of text) {
    const lower = char.toLowerCase();
    folded += lower.length === char.length ? lower : char;
  }
  return folded;
}

const isHigh = (unit: number) => unit >= 0xd800 && unit <= 0xdbff;
const isLow = (unit: number) => unit >= 0xdc00 && unit <= 0xdfff;

/**
 * Non-overlapping matches of `query` in `text`, left to right, as UTF-16
 * offsets; at most `limit` of them. A match never cuts a surrogate pair.
 */
export function findLiteral(text: string, query: LiteralQuery, limit = Number.POSITIVE_INFINITY): TextRange[] {
  if (query.text === "" || !isSearchableText(query.text)) return [];
  const haystack = query.matchCase ? text : fold(text);
  const needle = query.matchCase ? query.text : fold(query.text);
  const found: TextRange[] = [];
  let at = haystack.indexOf(needle);
  while (at !== -1 && found.length < limit) {
    const to = at + needle.length;
    const cuts =
      (isLow(text.charCodeAt(at)) && at > 0 && isHigh(text.charCodeAt(at - 1))) ||
      (isHigh(text.charCodeAt(to - 1)) && isLow(text.charCodeAt(to)));
    if (cuts) {
      at = haystack.indexOf(needle, at + 1);
      continue;
    }
    found.push({ from: at, to });
    at = haystack.indexOf(needle, to);
  }
  return found;
}
