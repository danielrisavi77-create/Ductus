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
 * Owner decision on #179 (DAN-134, 12. 10. 2026.): an entry covers every form
 * of the same root ("kopirao", "prepisivanje", "vjerojatan"), the word orders
 * and synonyms of tables A and B of #179, and its English equivalents one by
 * one. The allowed actions of section C ("Kopiraj navod", "Kopirano u
 * međuspremnik", "Sakrij …", progress percentages) stay out of every pattern.
 * A percentage sign is folded away, so a share by origin is caught by its
 * words and by a number next to "AI" or "ljudski", not by the sign itself.
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
  /**
   * Set when the pattern allows a phrase ("copied to clipboard") that must not
   * be put together across the end of a sentence. The pattern is matched on
   * `foldPhrases`, where the end of a phrase is `PHRASE_BREAK`, not a space.
   * Unlike a contextual entry it has no word of its own to judge: it is
   * reported wherever the pattern matches.
   */
  readonly readsPhrases?: true;
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
  {
    entry: "upozorenje o studentu",
    instead: NOTHING,
    lang: "hr",
    pattern: /(?<![\p{L}\p{N}])upozoren\p{L}* o (?:\p{L}+ ){0,2}student/u,
  },
  {
    entry: "AI postotak",
    instead: AI_ORIGIN,
    lang: "hr",
    // A share by origin with or without the word (#179 A7): "udio AI-ja", "ljudski udio", "AI: 78 %", "78 % AI".
    pattern:
      /(?<![\p{L}\p{N}])(?:posto[tc]\p{L}* (?:ai(?![\p{L}\p{N}])|umjetn|ljudsk)|ai posto[tc]|(?:udio|udjel\p{L}*) (?:ai(?![\p{L}\p{N}])|umjetn|ljudsk|podrijetl|izvor)|(?:ai|ljudsk\p{L}*) (?:udio|udjel)|ai \d|\d+ (?:ai(?![\p{L}\p{N}])|ljudsk))/u,
  },
  // The adjective and the noun. The adverb "vjerojatno" (owner decision 4 on #179) waits for the word list
  // MODALS in src/domain/diff/diff.ts, data that every string check would read as interface text.
  { entry: "vjerojatnost", instead: AI_ORIGIN, lang: "hr", pattern: /(?<![\p{L}\p{N}])(?:naj)?vjerojat(?:nos[tc]|an(?![\p{L}\p{N}])|n(?:[aeiu]|o[gmj]))/u },
  { entry: "autentičnost", instead: AI_ORIGIN, lang: "hr", pattern: /(?<![\p{L}\p{N}])(?:(?:ne)?autentica?n|autenticitet)/u },
  {
    entry: "napisao AI",
    instead: AI_ORIGIN,
    lang: "hr",
    pattern:
      /(?<![\p{L}\p{N}])(?:napisa\p{L}* (?:(?:ga|je) ){0,2}(?:ai(?![\p{L}\p{N}])|umjetn)|(?:ai|umjetn\p{L}* inteligencij\p{L}*) (?:(?:ga|je) ){0,2}napisa)/u,
  },
  {
    entry: "verificirano autorstvo",
    instead: INTACT,
    lang: "hr",
    pattern: /(?<![\p{L}\p{N}])(?:verificiran\p{L}* autorstv|autorstv\p{L}* (?:\p{L}+ ){0,2}verificiran)/u,
  },
  { entry: "dokaz autorstva", instead: INTACT, lang: "hr", pattern: /(?<![\p{L}\p{N}])dokaz\p{L}* (?:o )?autorstv/u },
  // Every form of the root (#179 A1), but the imperative "Kopiraj", "kopiranje navoda" and "Kopirano u međuspremnik" (D-59, owner decision 2).
  {
    entry: "kopirano",
    instead: PASTED,
    lang: "hr",
    pattern:
      /(?<![\p{L}\p{N}])(?:is|pre)?kopir(?!aj(?:te|mo)?(?![\p{L}\p{N}]))(?!anj\p{L}* navod)(?!an\p{L}* u meduspremnik)/u,
    readsPhrases: true,
  },
  // Every form of the root (#179 A3), "prepiši" in a sync conflict included; not "prepiska" or "prepisci" (correspondence).
  { entry: "prepisano", instead: PASTED, lang: "hr", pattern: /(?<![\p{L}\p{N}])prepis(?!k|ci(?![\p{L}\p{N}]))/u },
  // B8 of #179 ("nedostajući / izgubljeni podaci", "lost data") applies only to the record of the process in the teacher view
  // and the summary. The scan cannot tell that from a recovery message on the student's device (F-3/F-8), so it is left out
  // (owner, 23. 10. 2026.).
  {
    entry: "nestali podaci",
    instead: GAP,
    lang: "hr",
    pattern:
      /(?<![\p{L}\p{N}])(?:nesta\p{L}* poda[tc]|poda[tc]\p{L}* (?:\p{L}+ ){0,2}nesta(?:l\p{L}*|o|j\p{L}*|n(?:ak|e|u|em)?)(?![\p{L}\p{N}]))/u,
  },
  // The adjective and participle only (#179 A5): the imperative "Sakrij …" stays (owner decision 6).
  { entry: "skriveno", instead: GAP, lang: "hr", pattern: /(?<![\p{L}\p{N}])(?:sakriv|prikriv|skriv)en/u },
  // New rows of #179 table B. The adjectives "izvorni / originalni" and "nepravilan format" stay allowed.
  { entry: "plagijat", instead: NOTHING, lang: "hr", pattern: /(?<![\p{L}\p{N}])plagi[jr]/u },
  { entry: "izvornost", instead: INTACT, lang: "hr", pattern: /(?<![\p{L}\p{N}])(?:izvornos[tc]|originalnos[tc])/u },
  { entry: "integritet", instead: "cjelovitost zapisa", lang: "hr", pattern: /(?<![\p{L}\p{N}])integritet/u },
  { entry: "neobično", instead: NOTHING, lang: "hr", pattern: /(?<![\p{L}\p{N}])(?:neobic|neuobicajen)/u },
  { entry: "nepravilnost", instead: NOTHING, lang: "hr", pattern: /(?<![\p{L}\p{N}])nepravilnos[tc]/u },
  {
    entry: "tuđi tekst",
    instead: PASTED,
    lang: "hr",
    pattern: /(?<![\p{L}\p{N}])(?:tud\p{L}* (?:tekst(?:a|u|om|ovi|ova|ovima|e)?|rijec(?:i|ju|ima)?)(?![\p{L}\p{N}])|(?:nije|nisu) (?:vlastit|njegov|njezin|njen)\p{L}* (?:tekst(?:a|u|om|ovi|ova|ovima|e)?|rijec(?:i|ju|ima)?|odlom(?:ak|ka|ku|kom|ke|ci|aka|cima)|rad(?:a|u|om|e|ovi|ova|ovima)?)(?![\p{L}\p{N}])|(?:tekst(?:a|u|om|ovi|ova|ovima|e)?|rijec(?:i|ju|ima)?|odlom(?:ak|ka|ku|kom|ke|ci|aka|cima)|rad(?:a|u|om|e|ovi|ova|ovima)?)(?![\p{L}\p{N}]) (?:nije|nisu) (?:vlastit|njegov|njezin|njen)\p{L}*)/u,
  },
  {
    entry: "napisao čovjek",
    instead: "opaženo pisanje u uređivaču",
    lang: "hr",
    pattern:
      /(?<![\p{L}\p{N}])(?:ljudsk\p{L}* napisa|napisa\p{L}* (?:(?:ga|je) ){0,2}covjek|covjek\p{L}* (?:(?:ga|je) ){0,2}napisa)/u,
  },
  {
    entry: "spremljeno (bez pojašnjenja)",
    instead: "spremljeno na uređaju / spremljeno na poslužitelju / predano",
    lang: "hr",
    pattern: /(?<!\p{L})spremljen\p{L}*(?!\p{L})(?! na (?:uredaju|posluzitelju)(?![\p{L}\p{N}]))/u,
    contextual: { word: /(?<![\p{L}\p{N}])spremljen\p{L}*(?![\p{L}\p{N}])/u },
  },
  // The same entries in the English interface (D-90, point 3).
  { entry: "suspicious", instead: NOTHING, lang: "en", pattern: /(?<![\p{L}\p{N}])(?:suspic|suspect|doubt)/u },
  { entry: "risk", instead: NOTHING, lang: "en", pattern: /(?<![\p{L}\p{N}])(?:low|high|zero|no)?risk/u },
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
    pattern:
      /(?<![\p{L}\p{N}])(?:ai percent|percent\p{L}* (?:of )?(?:ai(?![\p{L}\p{N}])|artificial|human)|(?:ai|human) (?:share|percent|proportion)|humanness|\d+ (?:ai|human)(?![\p{L}\p{N}]))/u,
  },
  { entry: "probability", instead: AI_ORIGIN, lang: "en", pattern: /(?<![\p{L}\p{N}])(?:probab(?:il|l)|likelihood)/u },
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
  {
    entry: "copied",
    instead: PASTED,
    lang: "en",
    pattern: /(?<![\p{L}\p{N}])cop(?:ied(?! to (?:the )?clipboard(?![\p{L}\p{N}]))|ying|y[ \uFFFF]?past)/u,
    readsPhrases: true,
  },
  { entry: "missing data", instead: GAP, lang: "en", pattern: /(?<![\p{L}\p{N}])missing data/u },
  { entry: "hidden", instead: GAP, lang: "en", pattern: /(?<![\p{L}\p{N}])(?:hidden|concealed)/u },
  { entry: "plagiarism", instead: NOTHING, lang: "en", pattern: /(?<![\p{L}\p{N}])plagiar/u },
  { entry: "originality", instead: INTACT, lang: "en", pattern: /(?<![\p{L}\p{N}])(?:originality|unoriginal)/u },
  { entry: "integrity", instead: "completeness of the record", lang: "en", pattern: /(?<![\p{L}\p{N}])integrity/u },
  { entry: "unusual", instead: NOTHING, lang: "en", pattern: /(?<![\p{L}\p{N}])(?:unusual|atypical)/u },
  { entry: "irregularity", instead: NOTHING, lang: "en", pattern: /(?<![\p{L}\p{N}])irregularit/u },
  {
    entry: "someone else's text",
    instead: PASTED,
    lang: "en",
    pattern: /(?<![\p{L}\p{N}])(?:someone else s (?:text|words)|not (?:their|his|her) own (?:text|words?|writing|paragraph|passage))(?![\p{L}\p{N}])/u,
  },
  {
    entry: "written by a human",
    instead: "observed writing in the editor",
    lang: "en",
    pattern: /(?<![\p{L}\p{N}])(?:human written|written by (?:a )?human)/u,
  },
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
 *
 * It is U+FFFF, a code point that is no character, and not a line feed: the
 * text is also read with every mark taken out (`findForbiddenTermsInMarkup`),
 * and a line break that is written in a string is white space between two
 * words, not a boundary to close up. A source that writes U+FFFF itself is
 * reported for it (`unreadableCharacters`), so the mark cannot be mistaken
 * for text that passes.
 */
export const PHRASE_BREAK = "\uFFFF";

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
    .replace(/^[ \uFFFF]+|[ \uFFFF]+$/g, "");
}

/** Dictionary entries that occur in `text`, in dictionary order; with `lang`, only the entries of that language. */
export function findForbiddenTerms(text: string, lang?: Language): ForbiddenTerm[] {
  const folded = foldText(text);
  const phrases = foldPhrases(text);
  return FORBIDDEN_TERMS.filter(
    (entry) => (lang === undefined || entry.lang === lang) && entry.pattern.test(entry.contextual || entry.readsPhrases ? phrases : folded),
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
 * so a boundary does not keep an entry from being found. The parts next to
 * each other are read closed up by themselves as well (`inWindows`), so that
 * what stands before or after an entry does not touch it. What this covers
 * is one run of boundaries inside an entry. A contextual entry is read
 * closed up only where its word is not whole otherwise: a place where the
 * word stands whole is judged as written, and every other place is read
 * closed up without it (`withoutWholeWords`).
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
  const windows = closedUp ? inWindows(joined) : NO_TERMS;
  return FORBIDDEN_TERMS.filter((entry) => {
    if (entry.readsPhrases) return entry.pattern.test(shownPhrases) || entry.pattern.test(apartPhrases) || (closedUp && (entry.pattern.test(closedPhrases) || entry.pattern.test(tightPhrases) || windows.has(entry)));
    if (!entry.contextual) return entry.pattern.test(shown) || entry.pattern.test(apart) || (closedUp && (entry.pattern.test(closed) || entry.pattern.test(tight) || windows.has(entry)));
    if (entry.pattern.test(shownPhrases) && (entry.pattern.test(apartPhrases) || !entry.contextual.word.test(apartPhrases))) return true;
    if (!closedUp) return false;
    // The word itself put together across something unknown: there is no whole word to judge without closing it.
    if (!entry.contextual.word.test(shownPhrases)) return entry.pattern.test(closedPhrases) || entry.pattern.test(tightPhrases) || windows.has(entry);
    // The word stands whole somewhere, and that place was judged above. It says nothing about another place where the word is cut.
    const cut = withoutWholeWords(joined, entry.contextual.word);
    return entry.pattern.test(foldPhrases(cut.replaceAll(PHRASE_BREAK, ""))) || entry.pattern.test(foldPhrases(closedUpPastQuotes(cut))) || inWindows(cut).has(entry);
  });
}

/** Letters and digits written in a row, with what `foldLetters` drops between them. */
const WRITTEN_WORD = /[\p{L}\p{N}\p{M}\p{Cf}\u115F\u1160\u3164\uFFA0]+/gu;
/** Stands where a whole word was taken out: it ends the phrase and no boundary is closed up over it. */
const TAKEN_OUT = ".";

/**
 * `joined` without the places where `word` is written whole. Closed up, a
 * whole word that says where it was saved would run into the next part and
 * read as one that does not, so the whole words are judged as written and
 * only what is left is read closed up: the places where a boundary cuts the
 * word. One acceptable place does not clear another.
 */
function withoutWholeWords(joined: string, word: RegExp): string {
  return joined.replace(WRITTEN_WORD, (written) => {
    const folded = foldLetters(written);
    return word.exec(folded)?.[0] === folded ? TAKEN_OUT : written;
  });
}

/**
 * The most letters, digits and spaces that the parts strictly inside a window
 * may hold. An entry that starts in the first part of a window and ends in
 * its last one has all of them inside it, and the longest text a pattern is
 * written for has 34 characters ("umjetne inteligencije ga je napisao"); the
 * rest is room for longer endings. A pattern keeps letters away from its ends
 * and never asks for one there, so what a window finds, the narrowest window
 * around the entry finds as well. A pattern that lets a word run on has no
 * longest text, so this is a bound and not a proof: text cut by boundaries
 * that is longer than the bound is not read in a window.
 */
const WINDOW = 48;
/**
 * The most parts in a window. Parts without a letter or a digit (a dot, a
 * picture, white space) have no length, so `WINDOW` alone would let a run of
 * them widen a window without end, and the time with it. A text that this
 * bound cuts a window in is reported by the guard (`windowsCutShort`).
 */
export const MAX_WINDOW_PARTS = 64;
/** Parts kept on each side of a window, apart from it: the other words of a phrase, at most four. */
const CONTEXT = 4;
const NO_TERMS: ReadonlySet<ForbiddenTerm> = new Set();
/** What was found in a piece of text; the same pieces come back for every element around them. */
const foundInPiece = new Map<string, readonly ForbiddenTerm[]>();

/**
 * Entries in `joined` read in windows. With every `PHRASE_BREAK` taken out at
 * once, the part before an entry touches it, and most patterns do not match
 * a word that a letter touches. So every run of parts next to each other
 * that an entry can reach across (`WINDOW`) is also read closed up by
 * itself, with a few parts around it kept apart. Parts are measured as the
 * dictionary reads them, so a part of invisible characters has no length.
 * A window has at most `MAX_WINDOW_PARTS` parts, so the number of readings
 * grows with the number of parts, not with its square.
 */
function inWindows(joined: string): ReadonlySet<ForbiddenTerm> {
  const parts = joined.split(PHRASE_BREAK).filter((part) => part !== "");
  if (parts.length < 3) return NO_TERMS;
  const lengths = parts.map((part) => foldText(part).length);
  const quoted = [...joined].some((char) => QUOTATION_MARKS.has(char.codePointAt(0)!));
  const found = new Set<ForbiddenTerm>();
  for (let start = 0; start < parts.length - 1; start += 1) {
    const before = parts.slice(Math.max(0, start - CONTEXT), start);
    for (let end = start + 2, widest = widestWindow(lengths, start).end; end <= widest; end += 1) {
      const inside = parts.slice(start, end);
      const after = parts.slice(end, end + CONTEXT);
      for (const closed of new Set([inside.join(""), quoted ? closedUpPastQuotes(inside.join(PHRASE_BREAK)) : inside.join("")])) {
        const piece = [...before, closed, ...after].join(PHRASE_BREAK);
        let terms = foundInPiece.get(piece);
        if (!terms) {
          const [words, phrases] = [foldText(piece), foldPhrases(piece)];
          terms = FORBIDDEN_TERMS.filter((entry) => entry.pattern.test(entry.contextual || entry.readsPhrases ? phrases : words));
          if (foundInPiece.size >= 200_000) foundInPiece.clear();
          foundInPiece.set(piece, terms);
        }
        for (const term of terms) {
          // A contextual word that is whole without the last part is judged there: that part, closed up after the place, would hide the place.
          const narrower = foldPhrases(closedUpPastQuotes(inside.slice(0, -1).join(PHRASE_BREAK)));
          if (!term.contextual?.word.test(narrower)) found.add(term);
        }
      }
    }
  }
  return found;
}

/**
 * The end of the widest window that starts at `start`, by the lengths of the
 * parts strictly inside it, and whether `MAX_WINDOW_PARTS` stopped it while
 * `WINDOW` would have let it grow.
 */
function widestWindow(lengths: readonly number[], start: number): { end: number; cut: boolean } {
  let end = start + 1;
  for (let within = 0; end < lengths.length && within <= WINDOW; end += 1, within += lengths[end - 1]!) {
    if (end + 1 - start > MAX_WINDOW_PARTS) return { end, cut: true };
  }
  return { end, cut: false };
}

/**
 * Whether `joined` has a run of parts that `inWindows` did not read as far as
 * an entry can reach, because the run has more parts than a window takes. An
 * entry cut over such a run would not be found, so the guard reports the text.
 */
export function windowsCutShort(joined: string): boolean {
  const lengths = joined.split(PHRASE_BREAK).filter((part) => part !== "").map((part) => foldText(part).length);
  return lengths.length >= 3 && lengths.some((_, start) => widestWindow(lengths, start).cut);
}

/** The quotation marks of Croatian and English outside ASCII. */
const QUOTATION_MARKS: ReadonlySet<number> = new Set([0xab, 0xbb, 0x2018, 0x2019, 0x201a, 0x201c, 0x201d, 0x201e]);
/** What stands between two words around a `PHRASE_BREAK`, the break included. */
const AROUND_A_BREAK = /[^\p{L}\p{N}]*\uFFFF[^\p{L}\p{N}]*/gu;

/**
 * `joined` closed up, and without the quotation marks that stand between two
 * words where a `PHRASE_BREAK` stands. A paragraph that ends
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
/**
 * The line separator and the paragraph separator (U+2028, U+2029). The
 * dictionary reads them as a space, and a page may show nothing for them.
 */
const SEPARATOR = /[\p{Zl}\p{Zp}]/gu;
/**
 * Format characters, but for the four that are left to the dictionary
 * (the soft hyphen and the three of zero width). The dictionary
 * drops every one of them before it matches, which is right for a character
 * that shows nothing and changes nothing. It is wrong for one that changes
 * the order in which the letters are shown (the marks, embeddings, overrides
 * and isolates of text direction: U+061C, U+200E, U+200F, U+202A to U+202E,
 * U+2066 to U+2069) and for one that is drawn (the number signs of other
 * scripts). The rest (invisible operators, annotation and shaping controls,
 * tags, a byte order mark) has no place in Croatian or English text, so the
 * whole category is reported and no list of it is kept that could go stale.
 */
const FORMAT = /(?![\u00AD\u200B\u200C\u200D])\p{Cf}/gu;
/** Every character that `unreadableCharacters` reports wherever it stands. */
const NOT_SHOWN = new RegExp(`${NEVER_TEXT.source}|${SEPARATOR.source}|${FORMAT.source}`, "gu");

/**
 * `text` as a finding or an error may show it: every character that the guard
 * reports wherever it stands is written by its escape, `\uXXXX` or
 * `\u{XXXXX}`. Such a character shows as nothing in a log, breaks its line or
 * turns the text around it, and the mark of a boundary (`PHRASE_BREAK`) is one
 * of them. White space, letters and everything a reader can see stay as they
 * are, so the text can still be found in the source.
 */
export function shownText(text: string): string {
  return text.replace(NOT_SHOWN, (char) => {
    const code = char.codePointAt(0)!;
    const hex = code.toString(16).toUpperCase();
    return code > 0xffff ? `\\u{${hex}}` : `\\u${hex.padStart(4, "0")}`;
  });
}

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
 * - a line or paragraph separator (`SEPARATOR`) and a format character
 *   (`FORMAT`), wherever it stands. Four format characters are left to the
 *   dictionary, which reads a word past them: the soft hyphen, the zero
 *   width space, the zero width non-joiner and the zero width joiner (U+00AD,
 *   U+200B, U+200C, U+200D). They show nothing inside a word and change
 *   nothing around it;
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
  const found: string[] = [...(text.match(NEVER_TEXT) ?? []), ...(text.match(SEPARATOR) ?? []), ...(text.match(FORMAT) ?? [])];
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
