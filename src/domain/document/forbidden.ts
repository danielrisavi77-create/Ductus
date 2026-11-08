/**
 * The FORBIDDEN set of document v2 (docs/contracts/document-schema-v2.md
 * §3.2) and the text rules built on it (§2.3, §3.1).
 *
 * A closed list of code points, not a Unicode property, so the outcome does
 * not depend on the Unicode tables of Node, the browser or PostgreSQL. One
 * constant serves the citation locator and the text fields of a source, in
 * the validator and, from the v2 edit steps, in the step parser.
 *
 * Lengths are counted in code points, never in UTF-16 units: an astral
 * character is one, and a lone surrogate is never counted but refused.
 */

/** Inclusive code point ranges. U+2028 and U+2029 are deliberately absent. */
export const FORBIDDEN_CODE_POINT_RANGES: readonly (readonly [number, number])[] = [
  [0x0000, 0x001f],
  [0x007f, 0x009f],
  [0x00ad, 0x00ad],
  [0x061c, 0x061c],
  [0x180e, 0x180e],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x206f],
  [0xfeff, 0xfeff],
];

/**
 * Unicode `White_Space`, as a closed list for the same reason. A text field
 * may not start or end with one (§2.3); the validator refuses, never trims.
 */
export const WHITE_SPACE_CODE_POINT_RANGES: readonly (readonly [number, number])[] = [
  [0x0009, 0x000d],
  [0x0020, 0x0020],
  [0x0085, 0x0085],
  [0x00a0, 0x00a0],
  [0x1680, 0x1680],
  [0x2000, 0x200a],
  [0x2028, 0x2029],
  [0x202f, 0x202f],
  [0x205f, 0x205f],
  [0x3000, 0x3000],
];

function inRanges(codePoint: number, ranges: readonly (readonly [number, number])[]): boolean {
  return ranges.some(([low, high]) => codePoint >= low && codePoint <= high);
}

export function isForbiddenCodePoint(codePoint: number): boolean {
  return inRanges(codePoint, FORBIDDEN_CODE_POINT_RANGES);
}

export function isWhiteSpaceCodePoint(codePoint: number): boolean {
  return inRanges(codePoint, WHITE_SPACE_CODE_POINT_RANGES);
}

/**
 * Number of code points in `value`, or `null` when it holds a lone surrogate
 * or a FORBIDDEN code point. A loop over UTF-16 units, so a string of any
 * length is read without recursion and without building an array.
 */
export function allowedCodePointLength(value: string): number | null {
  let count = 0;
  for (let i = 0; i < value.length; i += 1) {
    const unit = value.charCodeAt(i);
    let codePoint = unit;
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return null;
      codePoint = (unit - 0xd800) * 0x400 + (next - 0xdc00) + 0x10000;
      i += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return null;
    }
    if (isForbiddenCodePoint(codePoint)) return null;
    count += 1;
  }
  return count;
}

/** Citation locator rule (§3.1): 1 to `max` code points, none FORBIDDEN. */
export function isAllowedText(value: unknown, max: number): value is string {
  if (typeof value !== "string") return false;
  const length = allowedCodePointLength(value);
  return length !== null && length >= 1 && length <= max;
}

/**
 * Source text field rule (§2.3): the locator rule, and no `White_Space` at
 * either end. Every white space code point is in the BMP, so the first and
 * last UTF-16 units are the edge code points whenever the string is allowed.
 */
export function isAllowedTrimmedText(value: unknown, max: number): value is string {
  return (
    isAllowedText(value, max) &&
    !isWhiteSpaceCodePoint(value.charCodeAt(0)) &&
    !isWhiteSpaceCodePoint(value.charCodeAt(value.length - 1))
  );
}
