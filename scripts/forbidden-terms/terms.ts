/**
 * Interface vocabulary that the product never uses (docs/PRODUCT.md 5,
 * "Rječnik sučelja"). Matching runs on folded text: NFKC, Croatian lower case,
 * diacritics removed, invisible characters dropped, punctuation and white
 * space of any kind turned into single spaces. Patterns are written against that folded form, so `autentica?n`
 * catches "autentičnost", "AUTENTICNOST" and "autentičan". A pattern covers
 * the gender, number and case of its entry and the forms derived from it; it
 * does not add synonyms the dictionary does not list.
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
   * `word` is the same word whatever follows it, a literal like `pattern`.
   * See `findForbiddenTermsInMarkup`.
   */
  readonly contextual?: { readonly word: RegExp };
}

// Patterns are literals (no RegExp built from strings). Each one starts with
// (?<![\p{L}\p{N}]) and may end with (?![\p{L}\p{N}]): a letter or digit may
// not touch the term, so "rizik" does not match inside another word. The one
// exception is `sumnj`, which matches anywhere in a word so that derived forms
// ("posumnjati", "osumnjičen") are caught; no unrelated word contains it.
const NOTHING = "(ništa; činjenice se prikazuju bez oznake)";
const AI_ORIGIN = "iz AI pomoćnika (model, vrijeme)";
const INTACT = "zapis je cjelovit i neizmijenjen od primitka";
const PASTED = "zalijepljeno (izvor nije opažen)";
const GAP = "praznina u zapisu";

export const FORBIDDEN_TERMS: readonly ForbiddenTerm[] = [
  { entry: "sumnjivo", instead: NOTHING, lang: "hr", pattern: /sumnj/u },
  { entry: "rizik", instead: NOTHING, lang: "hr", pattern: /(?<![\p{L}\p{N}])(?:ne|visoko|nisko)?rizi[kc]/u },
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
    pattern: /(?<![\p{L}\p{N}])spremljen\p{L}*(?![\p{L}\p{N}])(?! na (?:uredaju|posluzitelju)(?![\p{L}\p{N}]))/u,
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
      /(?<![\p{L}\p{N}])saved(?![\p{L}\p{N}])(?! (?:on|to) (?:the |this |your )?(?:device|server)(?![\p{L}\p{N}]))/u,
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
  return text
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .toLocaleLowerCase("hr")
    .replaceAll("đ", "d")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Dictionary entries that occur in `text`, in dictionary order; with `lang`, only the entries of that language. */
export function findForbiddenTerms(text: string, lang?: Language): ForbiddenTerm[] {
  const folded = foldText(text);
  return FORBIDDEN_TERMS.filter((entry) => (lang === undefined || entry.lang === lang) && entry.pattern.test(folded));
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
 * itself (`<b>S</b>premljeno`) and there is nothing to clear it with.
 */
export function findForbiddenTermsInMarkup(joined: string, spaced: string): ForbiddenTerm[] {
  const shown = foldText(joined);
  const apart = foldText(spaced);
  return FORBIDDEN_TERMS.filter((entry) => {
    if (!entry.contextual) return entry.pattern.test(shown) || entry.pattern.test(apart);
    return entry.pattern.test(shown) && (entry.pattern.test(apart) || !entry.contextual.word.test(apart));
  });
}
