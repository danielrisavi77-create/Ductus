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

// Word edges for the folded text: a letter or digit may not touch the term.
const START = String.raw`(?<![\p{L}\p{N}])`;
const END = String.raw`(?![\p{L}\p{N}])`;

function term(entry: string, instead: string, source: string): ForbiddenTerm {
  return { entry, instead, pattern: new RegExp(source, "u") };
}

const NOTHING = "(ništa; činjenice se prikazuju bez oznake)";
const AI_ORIGIN = "iz AI pomoćnika (model, vrijeme)";
const INTACT = "zapis je cjelovit i neizmijenjen od primitka";
const PASTED = "zalijepljeno (izvor nije opažen)";
const GAP = "praznina u zapisu";

export const FORBIDDEN_TERMS: readonly ForbiddenTerm[] = [
  term("sumnjivo", NOTHING, `${START}(?:ne)?sumnj`),
  term("rizik", NOTHING, `${START}rizi[kcč]`),
  term("anomalija, anomaly", NOTHING, `${START}anomal`),
  term("upozorenje o studentu", NOTHING, `${START}upozoren\\p{L}* o student`),
  term("AI postotak", AI_ORIGIN, `${START}(?:postot\\p{L}* ai${END}|ai postot)`),
  term("vjerojatnost", AI_ORIGIN, `${START}vjerojatnost`),
  term("autentičnost", AI_ORIGIN, `${START}autenticn`),
  term(
    "napisao AI",
    AI_ORIGIN,
    `${START}(?:napisa\\p{L}* (?:ga |je )?(?:ai${END}|umjetn)|ai (?:ga |je )?napisa)`,
  ),
  term("verificirano autorstvo", INTACT, `${START}verificiran\\p{L}* autorstv`),
  term("dokaz autorstva", INTACT, `${START}dokaz\\p{L}* autorstv`),
  term("kopirano", PASTED, `${START}kopiran`),
  term("prepisano", PASTED, `${START}prepisan`),
  term("nestali podaci", GAP, `${START}nesta\\p{L}* poda[tc]`),
  term("skriveno", GAP, `${START}skriven`),
  term(
    "spremljeno (bez pojašnjenja)",
    "spremljeno na uređaju / spremljeno na poslužitelju / predano",
    `${START}spremljen\\p{L}*${END}(?! na (?:uredaju|posluzitelju)${END})`,
  ),
  // The same entries in the English interface (D-67, D-70).
  term("suspicious", NOTHING, `${START}suspic`),
  term("risk", NOTHING, `${START}risk`),
  term("AI percentage", AI_ORIGIN, `${START}(?:ai percent|percent\\p{L}* (?:of )?ai${END})`),
  term("probability", AI_ORIGIN, `${START}probabilit`),
  // "authentic" and "authenticity", not "authentication".
  term("authenticity", AI_ORIGIN, `${START}authentic(?:ity|${END})`),
  term("written by AI", AI_ORIGIN, `${START}(?:written|generated) by (?:ai${END}|artificial)`),
  term("verified authorship", INTACT, `${START}verified authorship`),
  term("proof of authorship", INTACT, `${START}proof of authorship`),
  term("copied", PASTED, `${START}cop(?:ied|y pasted)`),
  term("missing data", GAP, `${START}missing data`),
  term("hidden", GAP, `${START}hidden`),
];

/** Invisible characters that would otherwise split a word unnoticed. */
const INVISIBLE = /[­͏؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁤﻿]/gu;

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
