import { REVISION_TEXT_MAX } from "@/domain/collaboration/revision-input";

/**
 * Shared by the unit test of isRevisionText and the agreement test against
 * collaboration.is_revision_text on a real database (#1506 class 8). All text
 * here is invented.
 */
// The White_Space and zero-width set of collaboration.is_revision_text.
export const BLANKS = [
  "\t", "\n", "\u000B", "\u000C", "\r", " ", "\u0085", "\u00A0", "\u1680",
  "\u2000", "\u2001", "\u2002", "\u2003", "\u2004", "\u2005", "\u2006", "\u2007", "\u2008", "\u2009", "\u200A",
  "\u200B", "\u200C", "\u200D", "\u2028", "\u2029", "\u202F", "\u205F", "\u2060", "\u3000", "\uFEFF",
];

/** Class 8 of #1506: each text with the answer of the CHECK. Shared with the agreement test. */
export const TEXT_CASES: [name: string, text: string, ok: boolean][] = [
  ["empty", "", false],
  ["spaces", "   ", false],
  ["nbsp only", "\u00A0\u00A0", false],
  ["zero width only", "\u200B\u2060\uFEFF", false],
  ["newline and tab only", "\n\t\n", false],
  ["nfd", "Dora\u0301", false],
  ["nfc", "Dor\u00E1", true],
  ["length 1", "a", true],
  ["length 2000", "a".repeat(REVISION_TEXT_MAX), true],
  ["length 2001", "a".repeat(REVISION_TEXT_MAX + 1), false],
  ["2000 astral code points", "\u{1F600}".repeat(REVISION_TEXT_MAX), true],
  ["2001 astral code points", "\u{1F600}".repeat(REVISION_TEXT_MAX + 1), false],
  ["U+0000", "a\u0000b", false],
  ["U+0007", "a\u0007b", false],
  ["carriage return inside", "a\rb", false],
  ["crlf line end", "Uvod\r\nkraj", false],
  ["U+000B inside", "a\u000Bb", false],
  ["U+000C inside", "a\u000Cb", false],
  ["U+007F", "a\u007Fb", false],
  ["U+009F", "a\u009Fb", false],
  ["U+0085 with text", "a\u0085b", false],
  ["U+202A", "a\u202Ab", false],
  ["U+202E", "a\u202Eb", false],
  ["U+2066", "a\u2066b", false],
  ["U+2069", "a\u2069b", false],
  ["newline and tab inside", "Uvod:\n\tprepravi drugi odlomak.", true],
  ["nbsp around text", "\u00A0x\u00A0", true],
  ["zero width joiner inside text", "a\u200Db", true],
  ["html is plain text", "<b>podebljano</b><script>x</script>", true],
  ["markdown is plain text", "**naglasi** zaklju\u010Dak", true],
];
