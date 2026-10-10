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
// stale. The one Croatian word that contains the letters is "križić" (folded
// "krizic", a small cross), so a "k" in front of the root is the only exception.
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
 */
export function findForbiddenTermsInMarkup(joined: string, spaced: string): ForbiddenTerm[] {
  const shown = foldText(joined);
  const apart = foldText(spaced);
  const shownPhrases = foldPhrases(joined);
  const apartPhrases = foldPhrases(spaced);
  return FORBIDDEN_TERMS.filter((entry) => {
    if (!entry.contextual) return entry.pattern.test(shown) || entry.pattern.test(apart);
    return entry.pattern.test(shownPhrases) && (entry.pattern.test(apartPhrases) || !entry.contextual.word.test(apartPhrases));
  });
}
