/**
 * Interface vocabulary that the product never uses (docs/PRODUCT.md 5,
 * "Rječnik sučelja"). Matching runs on folded text: NFKC, Croatian lower case,
 * diacritics removed, invisible characters dropped, punctuation and white
 * space of any kind turned into single spaces. Patterns are written against that folded form, so `autentica?n`
 * catches "autentičnost", "AUTENTICNOST" and "autentičan". The two contextual
 * entries are matched on a form that also keeps where a phrase ends
 * (`foldPhrases`). A pattern covers
 * the gender, number and case of the word the entry lists, and the compounds
 * and prefixed forms its comment names (`sumnj` and `rizik` anywhere in a word).
 * It does not cover other forms of a listed participle (the active participle
 * "kopirao" and "prepisao" or the noun "prepisivanje" are not "kopirano" and
 * "prepisano"), another word order or synonyms: the dictionary is read
 * narrowly, and widening it is the owner's decision (DAN-134).
 */
export type Language = "hr" | "en";

export interface ForbiddenTerm {
  /** Entry from the dictionary table, as written in PRODUCT.md. */
  readonly entry: string;
  /** What the dictionary says to use instead. */
  readonly instead: string;
  /**
   * Language of the forms the pattern matches. Croatian patterns match no
   * English word, so they can also be run over code, where every identifier,
   * SQL statement and log line is in English.
   */
  readonly lang: Language;
  readonly pattern: RegExp;
  /**
   * Set when the pattern allows the word in front of certain words
   * ("spremljeno na uređaju"), so whether it matches depends on what follows.
   * Such a pattern is matched on `foldPhrases`, where only white space of one
   * line keeps the following words in the phrase of the word.
   * `word` is the same word whatever follows it, a literal like `pattern`.
   * See `findForbiddenTermsInMarkup`.
   */
  readonly contextual?: { readonly word: RegExp };
}

// Patterns are literals (no RegExp built from strings). Most start with
// (?<![\p{L}\p{N}]) and may end with (?![\p{L}\p{N}]): a letter or digit may
// not touch the term, so "vjerojatnost" does not match inside another word. The
// exceptions are `sumnj`, which matches anywhere in a word so that derived forms
// ("posumnjati", "osumnjičen") are caught (no unrelated word contains it), and
// `rizik`, below.
// `rizik` is the same kind of entry: the root is matched wherever it stands in a
// word, so a compound with any prefix ("srednjerizičan", "bezrizično",
// "visokorizičan", "nerizičan") is caught and the list of prefixes cannot go
// stale. The one common word that contains the letters is "križić" (folded
// "krizic", a small cross), so a "k" in front of the root is the only exception.
// Surnames and other words that end in "-rizić" or "-rizik" after another letter
// (an invented "Brizić", "Parizić", "Grizić") are matched too and are false
// positives; they do not belong in interface text and are handled one by one.
// The two contextual patterns only keep letters away from the word: a digit
// that touches it (a footnote mark or a counter set next to the word by an
// element, `Spremljeno<sup>1</sup>`) does not make it another word, and it
// does not say where the work was saved.
const NOTHING = "(ništa; činjenice se prikazuju bez oznake)";
const AI_ORIGIN = "iz AI pomoćnika (model, vrijeme)";
const INTACT = "zapis je cjelovit i neizmijenjen od primitka";
const PASTED = "zalijepljeno (izvor nije opažen)";
const GAP = "praznina u zapisu";

export const FORBIDDEN_TERMS: readonly ForbiddenTerm[] = [
  { entry: "sumnjivo", instead: NOTHING, lang: "hr", pattern: /sumnj/u },
  { entry: "rizik", instead: NOTHING, lang: "hr", pattern: /(?<!k)rizi[kc]/u },
  // The English forms of this entry are the entry "anomaly" below.
  {
    entry: "anomalija, anomaly",
    instead: NOTHING,
    lang: "hr",
    pattern: /(?<![\p{L}\p{N}])anomal(?:ij|n|an(?![\p{L}\p{N}]))/u,
  },
  { entry: "upozorenje o studentu", instead: NOTHING, lang: "hr", pattern: /(?<![\p{L}\p{N}])upozoren\p{L}* o student/u },
  {
    entry: "AI postotak",
    instead: AI_ORIGIN,
    lang: "hr",
    pattern: /(?<![\p{L}\p{N}])(?:posto[tc]\p{L}* (?:ai(?![\p{L}\p{N}])|umjetn)|ai posto[tc])/u,
  },
  { entry: "vjerojatnost", instead: AI_ORIGIN, lang: "hr", pattern: /(?<![\p{L}\p{N}])vjerojatnos[tc]/u },
  { entry: "autentičnost", instead: AI_ORIGIN, lang: "hr", pattern: /(?<![\p{L}\p{N}])(?:ne)?autentica?n/u },
  {
    entry: "napisao AI",
    instead: AI_ORIGIN,
    lang: "hr",
    pattern:
      /(?<![\p{L}\p{N}])(?:napisa\p{L}* (?:(?:ga|je) ){0,2}(?:ai(?![\p{L}\p{N}])|umjetn)|(?:ai|umjetn\p{L}* inteligencij\p{L}*) (?:(?:ga|je) ){0,2}napisa)/u,
  },
  { entry: "verificirano autorstvo", instead: INTACT, lang: "hr", pattern: /(?<![\p{L}\p{N}])verificiran\p{L}* autorstv/u },
  { entry: "dokaz autorstva", instead: INTACT, lang: "hr", pattern: /(?<![\p{L}\p{N}])dokaz\p{L}* (?:o )?autorstv/u },
  { entry: "kopirano", instead: PASTED, lang: "hr", pattern: /(?<![\p{L}\p{N}])(?:is|pre)?kopiran/u },
  { entry: "prepisano", instead: PASTED, lang: "hr", pattern: /(?<![\p{L}\p{N}])prepisan/u },
  { entry: "nestali podaci", instead: GAP, lang: "hr", pattern: /(?<![\p{L}\p{N}])nesta\p{L}* poda[tc]/u },
  { entry: "skriveno", instead: GAP, lang: "hr", pattern: /(?<![\p{L}\p{N}])skriven/u },
  {
    entry: "spremljeno (bez pojašnjenja)",
    instead: "spremljeno na uređaju / spremljeno na poslužitelju / predano",
    lang: "hr",
    pattern: /(?<!\p{L})spremljen\p{L}*(?!\p{L})(?! na (?:uredaju|posluzitelju)(?![\p{L}\p{N}]))/u,
    contextual: { word: /(?<![\p{L}\p{N}])spremljen\p{L}*(?![\p{L}\p{N}])/u },
  },
  // The same entries in the English interface (D-90, point 3).
  { entry: "suspicious", instead: NOTHING, lang: "en", pattern: /(?<![\p{L}\p{N}])(?:suspic|suspect)/u },
  { entry: "risk", instead: NOTHING, lang: "en", pattern: /(?<![\p{L}\p{N}])risk/u },
  { entry: "anomaly", instead: NOTHING, lang: "en", pattern: /(?<![\p{L}\p{N}])anomal(?:y|ies|ous|istic)/u },
  {
    entry: "warning about the student",
    instead: NOTHING,
    lang: "en",
    pattern:
      /(?<![\p{L}\p{N}])(?:(?:warning|alert)s? (?:about|on|regarding|concerning) (?:the |a |this |these |that |those )?student|student\p{L}* (?:warning|alert))/u,
  },
  {
    entry: "AI percentage",
    instead: AI_ORIGIN,
    lang: "en",
    pattern: /(?<![\p{L}\p{N}])(?:ai percent|percent\p{L}* (?:of )?(?:ai(?![\p{L}\p{N}])|artificial))/u,
  },
  { entry: "probability", instead: AI_ORIGIN, lang: "en", pattern: /(?<![\p{L}\p{N}])(?:probabilit|likelihood)/u },
  // "authentic", "authentically", "authenticity" and "inauthentic", not "authenticate" or "authentication".
  {
    entry: "authenticity",
    instead: AI_ORIGIN,
    lang: "en",
    pattern: /(?<![\p{L}\p{N}])(?:in|un)?authentic(?!at)/u,
  },
  {
    entry: "written by AI",
    instead: AI_ORIGIN,
    lang: "en",
    pattern:
      /(?<![\p{L}\p{N}])(?:(?:written|generated) by (?:ai(?![\p{L}\p{N}])|artificial)|ai (?:written|generated|wrote)(?![\p{L}\p{N}]))/u,
  },
  { entry: "verified authorship", instead: INTACT, lang: "en", pattern: /(?<![\p{L}\p{N}])verified authorship/u },
  { entry: "proof of authorship", instead: INTACT, lang: "en", pattern: /(?<![\p{L}\p{N}])proofs? of authorship/u },
  { entry: "copied", instead: PASTED, lang: "en", pattern: /(?<![\p{L}\p{N}])cop(?:ied|y pasted)/u },
  { entry: "missing data", instead: GAP, lang: "en", pattern: /(?<![\p{L}\p{N}])missing data/u },
  { entry: "hidden", instead: GAP, lang: "en", pattern: /(?<![\p{L}\p{N}])hidden/u },
  {
    entry: "saved (without saying where)",
    instead: "saved on this device / saved on the server / submitted",
    lang: "en",
    pattern:
      /(?<!\p{L})saved(?!\p{L})(?! (?:on|to) (?:the |this |your )?(?:device|server)(?![\p{L}\p{N}]))/u,
    contextual: { word: /(?<![\p{L}\p{N}])saved(?![\p{L}\p{N}])/u },
  },
];

/**
 * Invisible characters that would otherwise split a word unnoticed: format
 * characters (soft hyphen, zero-width, bidi controls, BOM) and Hangul fillers.
 * Combining marks such as U+034F go with the diacritics below.
 */
const INVISIBLE = /[\p{Cf}\u115F\u1160\u3164\uFFA0]/gu;

/**
 * Folds text for matching; see the module comment. NFKC also turns the
 * compatibility forms of a letter (full width, mathematical, ligatures) into
 * the letter itself.
 */
export function foldText(text: string): string {
  return foldLetters(text)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** The letters and digits of `text` as the patterns expect them; everything between them is left as written. */
function foldLetters(text: string): string {
  return text
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .toLocaleLowerCase("hr")
    .replaceAll("đ", "d")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/**
 * Stands in folded text wherever a phrase ends. It is not a space, so the
 * spaces written in a pattern do not match it, and it is not a letter or a
 * digit, so a word still ends at it. Markup readers put it into the text they
 * hand over wherever the phrase cannot go on (see `scan.ts`).
 */
export const PHRASE_BREAK = "\n";

/**
 * White space that keeps two words in one phrase on one line: spaces of every
 * width and the tab. U+2028 (line separator) is on this side only because the
 * tests of the earlier QA round hold it as a space.
 */
const SPACES_ONLY = /^[\p{Zs}\t\p{Zl}]+$/u;

/**
 * Folds text like `foldText`, but keeps where a phrase ends. Between two words
 * of one phrase there is white space of one line and nothing else. Any other
 * run of characters that are not letters or digits becomes `PHRASE_BREAK`:
 * sentence punctuation, a comma, a dash or hyphen, a bracket, a quotation
 * mark, a symbol, an emoji or a line break, with or without spaces around it.
 *
 * Contextual entries are matched on this form, so the words that make
 * "spremljeno" acceptable must follow it in the same phrase: "Spremljeno na
 * uređaju." is acceptable, "Spremljeno. Na uređaju nema promjena." is not.
 */
export function foldPhrases(text: string): string {
  return foldLetters(text)
    .replace(/[^\p{L}\p{N}]+/gu, (run) => (SPACES_ONLY.test(run) ? " " : PHRASE_BREAK))
    .trim();
}

/** Dictionary entries that occur in `text`, in dictionary order; with `lang`, only the entries of that language. */
export function findForbiddenTerms(text: string, lang?: Language): ForbiddenTerm[] {
  const folded = foldText(text);
  const phrases = foldPhrases(text);
  return FORBIDDEN_TERMS.filter(
    (entry) => (lang === undefined || entry.lang === lang) && entry.pattern.test(entry.contextual ? phrases : folded),
  );
}

/**
 * Dictionary entries in text that markup puts together from several pieces,
 * such as `Nestali <strong>podaci</strong>`. The same text is given twice:
 * `joined` has the pieces as the browser joins them, `spaced` has a space at
 * every element boundary. An entry found in either reading is reported, so
 * both a word split by an element and a phrase spread over elements are
 * caught.
 *
 * A contextual entry is decided by the joined reading, which is what a person
 * sees, and must be found there. The spaced reading can only clear it: when
 * the word stands whole in the spaced reading and is acceptable there, the
 * match came from two texts running together
 * (`<span>Spremljeno na uređaju</span><span>Predano</span>`). When the spaced
 * reading does not hold the whole word at all, an element split the word
 * itself (`<b>S</b>premljeno`) and there is nothing to clear it with. Both
 * readings of a contextual entry keep where a phrase ends (`foldPhrases`).
 *
 * A third reading closes the text up: every `PHRASE_BREAK` is taken out, so
 * what stands on the two sides of an unknown part or of an element boundary
 * is read as one word. The scan cannot know that such a part shows anything
 * (`Sum<span />njivo`) or that an element is set apart from its neighbours,
 * so no boundary keeps an entry from being found. A contextual entry is read
 * closed up only when its word is not whole otherwise.
 *
 * This is the stricter side on purpose. Two elements that do stand apart
 * (two items of a list) are read closed up as well, because a class or a
 * style the scan does not read can set any two elements in one line, so the
 * end of one and the start of the next can make an entry nobody sees as one
 * word. `closedUp: false` leaves this reading out; the scan uses it to tell
 * such a finding apart and to say so where it reports it (`findingsIn`).
 */
export function findForbiddenTermsInMarkup(joined: string, spaced: string, closedUp = true): ForbiddenTerm[] {
  const shown = foldText(joined);
  const apart = foldText(spaced);
  const closed = foldText(joined.replaceAll(PHRASE_BREAK, ""));
  const closedPhrases = foldPhrases(joined.replaceAll(PHRASE_BREAK, ""));
  // Closed up past the quotation marks at a boundary too: see `closedUpPastQuotes`.
  const tight = foldText(closedUpPastQuotes(joined));
  const tightPhrases = foldPhrases(closedUpPastQuotes(joined));
  const shownPhrases = foldPhrases(joined);
  const apartPhrases = foldPhrases(spaced);
  return FORBIDDEN_TERMS.filter((entry) => {
    if (!entry.contextual) return entry.pattern.test(shown) || entry.pattern.test(apart) || (closedUp && (entry.pattern.test(closed) || entry.pattern.test(tight)));
    if (entry.pattern.test(shownPhrases) && (entry.pattern.test(apartPhrases) || !entry.contextual.word.test(apartPhrases))) return true;
    // The word itself put together across something unknown: there is no whole word to judge without closing it.
    return closedUp && !entry.contextual.word.test(shownPhrases) && (entry.pattern.test(closedPhrases) || entry.pattern.test(tightPhrases));
  });
}

/** The quotation marks of Croatian and English outside ASCII. */
const QUOTATION_MARKS: ReadonlySet<number> = new Set([0xab, 0xbb, 0x2018, 0x2019, 0x201a, 0x201c, 0x201d, 0x201e]);
/** What stands between two words around a `PHRASE_BREAK`, the break included. */
const AROUND_A_BREAK = /[^\p{L}\p{N}]*\n[^\p{L}\p{N}]*/gu;

/**
 * `joined` closed up, and without the quotation marks that stand between two
 * words where a `PHRASE_BREAK` stands between them. A paragraph that ends
 * with a quotation mark, or begins with one, is ordinary text, so
 * `findUnreadableText` does not report such a mark there. It may leave it out
 * only because the dictionary reads the text without it as well: an entry cut
 * at a boundary with a quotation mark at the cut is found here.
 */
export function closedUpPastQuotes(joined: string): string {
  return joined.replace(AROUND_A_BREAK, (run) => [...run].filter((char) => char !== PHRASE_BREAK && !QUOTATION_MARKS.has(char.codePointAt(0)!)).join(""));
}

/**
 * White space that may stand between two letters of one text without being
 * reported. The narrow no-break space (U+202F) is left out on purpose: it is
 * thin enough to cut a word without showing, and where typography wants it,
 * between a number and its unit, it does not stand between two letters.
 */
const PLAIN_SPACE = /[ \u00A0]/u;
/** A run of anything but letters and digits that touches a letter on both sides. */
const BETWEEN_LETTERS = /(?<=\p{L})[^\p{L}\p{N}]+(?=\p{L})/gu;
/** A symbol, a space or a punctuation mark, of any kind. */
const SYMBOL_SPACE_OR_MARK = /[\p{S}\p{Zs}\p{P}]/u;
/**
 * The punctuation marks outside ASCII that Croatian and English write between
 * two letters with no space: the hyphen and the non-breaking hyphen (U+2010,
 * U+2011), the en dash and the em dash (U+2013, U+2014), the apostrophe
 * (U+2019) and the ellipsis (U+2026). None of them is drawn like a letter.
 * Every other mark outside ASCII is reported there, because some are (an
 * upright bar, a dot at the height of a letter) and nobody can tell them
 * apart in a review. That holds for quotation marks and brackets too, and
 * ASCII punctuation next to them does not change it: only a plain space sets
 * two words apart. `findUnreadableText` leaves out the quotation marks next
 * to an element boundary (`closedUpPastQuotes`).
 */
const MARKS_INSIDE_A_WORD: ReadonlySet<number> = new Set([0x2010, 0x2011, 0x2013, 0x2014, 0x2019, 0x2026]);
/** A mathematical, currency or modifier symbol that touches a letter. */
const SYMBOL_AT_A_LETTER = /(?<=\p{L})[\p{Sm}\p{Sc}\p{Sk}]|[\p{Sm}\p{Sc}\p{Sk}](?=\p{L})/gu;
/**
 * Private use, unassigned and surrogate code points, and control characters.
 * The five controls that are white space (tab, line feed, vertical tab, form
 * feed, carriage return) are text: code that reads white space names them.
 */
const NEVER_TEXT = /[\p{Co}\p{Cn}\p{Cs}]|(?![\t\n\v\f\r])\p{Cc}/gu;
/** A character typed on a keyboard; what it looks like is for the reader of the source to judge. */
const isAscii = (char: string): boolean => char.codePointAt(0)! < 0x80;

/**
 * Characters that interface text may not hold, each once, as `U+XXXX`. The
 * dictionary is matched on letters, so a character that only looks
 * like a letter, or like nothing at all, would take a word past it. Such a
 * character is reported for what it is, whatever word it stands in:
 *
 * - a letter that does not fold to `a`-`z` (`foldLetters`): Cyrillic, Greek,
 *   a dotless i, an IPA letter. Croatian letters and other Latin letters with
 *   a diacritic fold, and so do the compatibility forms NFKC knows;
 * - a digit or number that does not fold to ASCII digits and Latin letters:
 *   the digits of other scripts, some of which are drawn like a Latin letter;
 * - a private use, unassigned or surrogate code point and a control character
 *   that is not white space, wherever it stands;
 * - between two letters with no `PLAIN_SPACE` between them: every symbol,
 *   every space and every punctuation mark that is not ASCII, except the
 *   marks on `MARKS_INSIDE_A_WORD`. That is a symbol with no ink (a Braille
 *   blank), a space of another width, a symbol or a mark drawn like a letter
 *   (a mathematical operator, a currency sign, an upright bar) and also an
 *   emoji, which is reported on purpose: two words with only a symbol
 *   between them are set apart with a space;
 * - a mathematical, currency or modifier symbol that is not ASCII and touches
 *   a letter on either side, since it can stand for the first or the last
 *   letter of a word. Other symbols at the edge of a word (a degree sign, a
 *   trade mark) are left alone, because that is where they are written.
 *
 * ASCII symbols and digits are not reported whatever they resemble.
 */
export function unreadableCharacters(text: string): string[] {
  const found: string[] = [...(text.match(NEVER_TEXT) ?? [])];
  for (const char of text) {
    const folded = foldLetters(char);
    if (/\p{L}/u.test(char) ? !/^[a-z]*$/.test(folded) : /\p{N}/u.test(char) && /[^a-z0-9]/.test(folded.replace(/[^\p{L}\p{N}]/gu, ""))) found.push(char);
  }
  // Without what the dictionary matching drops anyway, so that such a character next to the run does not hide it.
  const bare = text.replace(INVISIBLE, "").replace(/\p{M}/gu, "");
  for (const run of bare.match(BETWEEN_LETTERS) ?? []) {
    if (PLAIN_SPACE.test(run)) continue;
    found.push(...[...run].filter((char) => SYMBOL_SPACE_OR_MARK.test(char) && !isAscii(char) && !MARKS_INSIDE_A_WORD.has(char.codePointAt(0)!)));
  }
  found.push(...(bare.match(SYMBOL_AT_A_LETTER) ?? []).filter((char) => !isAscii(char)));
  const codes = found.map((char) => `U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`);
  return [...new Set(codes)];
}
