/*
 * The Croatian alphabet, written out (as `hr.ts` writes out the months), so
 * the order does not depend on the ICU data of the host. dž, lj and nj are
 * one letter each. Letters outside it (q, w, x, y) take the place they have
 * in the Latin alphabet; anything else sorts after, by code point.
 */
const ALPHABET = [
  "a", "b", "c", "č", "ć", "d", "dž", "đ", "e", "f", "g", "h", "i", "j", "k", "l", "lj", "m",
  "n", "nj", "o", "p", "q", "r", "s", "š", "t", "u", "v", "w", "x", "y", "z", "ž",
];
const RANK = new Map(ALPHABET.map((letter, index) => [letter, index]));
const DIGRAPHS = new Set(["dž", "lj", "nj"]);

function letters(word: string): number[] {
  const lower = word.normalize("NFC").toLocaleLowerCase("hr");
  const out: number[] = [];
  for (let i = 0; i < lower.length; i += 1) {
    const pair = lower.slice(i, i + 2);
    if (DIGRAPHS.has(pair)) {
      out.push(RANK.get(pair)!);
      i += 1;
      continue;
    }
    const ch = lower[i]!;
    out.push(RANK.get(ch) ?? ALPHABET.length + ch.codePointAt(0)!);
  }
  return out;
}

/** Compares two words by the Croatian alphabet; case does not count. */
export function compareHr(a: string, b: string): number {
  const x = letters(a);
  const y = letters(b);
  for (let i = 0; i < Math.min(x.length, y.length); i += 1) {
    if (x[i] !== y[i]) return x[i]! - y[i]!;
  }
  return x.length - y.length;
}
