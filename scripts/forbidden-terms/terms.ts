/**
 * Interface vocabulary that the product never uses (docs/PRODUCT.md 5,
 * "Rječnik sučelja"). Matching runs on folded text: NFC, Croatian lower case,
 * diacritics removed, punctuation and invisible characters turned into single
 * spaces. Patterns are written against that folded form, so `autenticn` also
 * catches "autentičnost" and "AUTENTICNOST".
 */
export interface ForbiddenTerm {
  /** Entry from the dictionary table, as written in PRODUCT.md. */
  readonly entry: string;
  /** What the dictionary says to use instead. */
  readonly instead: string;
  readonly pattern: RegExp;
}

// Patterns are literals (no RegExp built from strings). Each one starts with
// (?<![\p{L}\p{N}]) and may end with (?![\p{L}\p{N}]): a letter or digit may
// not touch the term, so "rizik" does not match inside another word.
const NOTHING = "(ništa; činjenice se prikazuju bez oznake)";
const AI_ORIGIN = "iz AI pomoćnika (model, vrijeme)";
const INTACT = "zapis je cjelovit i neizmijenjen od primitka";
const PASTED = "zalijepljeno (izvor nije opažen)";
const GAP = "praznina u zapisu";

export const FORBIDDEN_TERMS: readonly ForbiddenTerm[] = [
  { entry: "sumnjivo", instead: NOTHING, pattern: /(?<![\p{L}\p{N}])(?:ne)?sumnj/u },
  { entry: "rizik", instead: NOTHING, pattern: /(?<![\p{L}\p{N}])rizi[kc]/u },
  { entry: "anomalija, anomaly", instead: NOTHING, pattern: /(?<![\p{L}\p{N}])anomal/u },
  { entry: "upozorenje o studentu", instead: NOTHING, pattern: /(?<![\p{L}\p{N}])upozoren\p{L}* o student/u },
  {
    entry: "AI postotak",
    instead: AI_ORIGIN,
    pattern: /(?<![\p{L}\p{N}])(?:postot\p{L}* ai(?![\p{L}\p{N}])|ai postot)/u,
  },
  { entry: "vjerojatnost", instead: AI_ORIGIN, pattern: /(?<![\p{L}\p{N}])vjerojatnost/u },
  { entry: "autentičnost", instead: AI_ORIGIN, pattern: /(?<![\p{L}\p{N}])autenticn/u },
  {
    entry: "napisao AI",
    instead: AI_ORIGIN,
    pattern: /(?<![\p{L}\p{N}])(?:napisa\p{L}* (?:ga |je )?(?:ai(?![\p{L}\p{N}])|umjetn)|ai (?:ga |je )?napisa)/u,
  },
  { entry: "verificirano autorstvo", instead: INTACT, pattern: /(?<![\p{L}\p{N}])verificiran\p{L}* autorstv/u },
  { entry: "dokaz autorstva", instead: INTACT, pattern: /(?<![\p{L}\p{N}])dokaz\p{L}* autorstv/u },
  { entry: "kopirano", instead: PASTED, pattern: /(?<![\p{L}\p{N}])kopiran/u },
  { entry: "prepisano", instead: PASTED, pattern: /(?<![\p{L}\p{N}])prepisan/u },
  { entry: "nestali podaci", instead: GAP, pattern: /(?<![\p{L}\p{N}])nesta\p{L}* poda[tc]/u },
  { entry: "skriveno", instead: GAP, pattern: /(?<![\p{L}\p{N}])skriven/u },
  {
    entry: "spremljeno (bez pojašnjenja)",
    instead: "spremljeno na uređaju / spremljeno na poslužitelju / predano",
    pattern: /(?<![\p{L}\p{N}])spremljen\p{L}*(?![\p{L}\p{N}])(?! na (?:uredaju|posluzitelju)(?![\p{L}\p{N}]))/u,
  },
  // The same entries in the English interface (D-67, D-70).
  { entry: "suspicious", instead: NOTHING, pattern: /(?<![\p{L}\p{N}])suspic/u },
  { entry: "risk", instead: NOTHING, pattern: /(?<![\p{L}\p{N}])risk/u },
  {
    entry: "AI percentage",
    instead: AI_ORIGIN,
    pattern: /(?<![\p{L}\p{N}])(?:ai percent|percent\p{L}* (?:of )?ai(?![\p{L}\p{N}]))/u,
  },
  { entry: "probability", instead: AI_ORIGIN, pattern: /(?<![\p{L}\p{N}])probabilit/u },
  // "authentic" and "authenticity", not "authentication".
  {
    entry: "authenticity",
    instead: AI_ORIGIN,
    pattern: /(?<![\p{L}\p{N}])authentic(?:ity|(?![\p{L}\p{N}]))/u,
  },
  {
    entry: "written by AI",
    instead: AI_ORIGIN,
    pattern: /(?<![\p{L}\p{N}])(?:written|generated) by (?:ai(?![\p{L}\p{N}])|artificial)/u,
  },
  { entry: "verified authorship", instead: INTACT, pattern: /(?<![\p{L}\p{N}])verified authorship/u },
  { entry: "proof of authorship", instead: INTACT, pattern: /(?<![\p{L}\p{N}])proof of authorship/u },
  { entry: "copied", instead: PASTED, pattern: /(?<![\p{L}\p{N}])cop(?:ied|y pasted)/u },
  { entry: "missing data", instead: GAP, pattern: /(?<![\p{L}\p{N}])missing data/u },
  { entry: "hidden", instead: GAP, pattern: /(?<![\p{L}\p{N}])hidden/u },
];

/**
 * Invisible characters that would otherwise split a word unnoticed: format
 * characters (soft hyphen, zero-width, bidi controls, BOM) and Hangul fillers.
 * Combining marks such as U+034F go with the diacritics below.
 */
const INVISIBLE = /[\p{Cf}\u115F\u1160\u3164\uFFA0]/gu;

/** Folds text for matching; see the module comment. */
export function foldText(text: string): string {
  return text
    .normalize("NFC")
    .replace(INVISIBLE, "")
    .toLocaleLowerCase("hr")
    .replaceAll("đ", "d")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Dictionary entries that occur in `text`, in dictionary order. */
export function findForbiddenTerms(text: string): ForbiddenTerm[] {
  const folded = foldText(text);
  return FORBIDDEN_TERMS.filter((entry) => entry.pattern.test(folded));
}
