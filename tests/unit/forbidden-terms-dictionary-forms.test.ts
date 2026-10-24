import { describe, expect, it } from "vitest";

import { findForbiddenTerms } from "../../scripts/forbidden-terms/terms";

// Owner decisions on #179 (DAN-134), 12. 10. 2026.: the dictionary covers every
// form of the same root except the allowed actions, the A and B tables of #179
// are accepted as written, and the English equivalents are listed one by one.
const entries = (text: string) => findForbiddenTerms(text).map((term) => term.entry);

describe("dictionary forms and synonyms (#179)", () => {
  it.each([
    // A1: every form of "kopirati" that describes the text.
    ["Student je kopirao odlomak", "kopirano"],
    ["Kopirala je uvod", "kopirano"],
    ["Kopirali su tablicu", "kopirano"],
    ["Tekst se ne smije kopirati", "kopirano"],
    ["Kopira iz izvora", "kopirano"],
    ["Kopirani tekst", "kopirano"],
    ["Kopiranje teksta", "kopirano"],
    // A3: every form of "prepisati".
    ["Prepisao je odlomak", "prepisano"],
    ["Prepisivanje iz izvora", "prepisano"],
    ["Prepisuje tuđi rad", "prepisano"],
    ["Prepisati verziju na poslužitelju", "prepisano"],
    ["Prepiši verziju", "prepisano"],
    // A4
    ["Autenticitet rada", "autentičnost"],
    // A5
    ["Sakriveni dio", "skriveno"],
    ["Prikriveno lijepljenje", "skriveno"],
    // A6. The adverb "vjerojatno" is not caught yet: see the comment on the entry in terms.ts.
    ["Vjerojatan izvor", "vjerojatnost"],
    ["Vjerojatna greška", "vjerojatnost"],
    // A7: a share by origin, with or without the word "postotak".
    ["Udio AI-ja", "AI postotak"],
    ["AI: 78 %", "AI postotak"],
    ["78 % AI", "AI postotak"],
    ["Postotak ljudskosti", "AI postotak"],
    ["Ljudski udio", "AI postotak"],
    ["Udio izvora X", "AI postotak"],
    // A8: other word order and words in between.
    ["Podaci su nestali", "nestali podaci"],
    ["Autorstvo je verificirano", "verificirano autorstvo"],
    ["Upozorenje o ovom studentu", "upozorenje o studentu"],
    // B1-B5, B8, B10, B11 (new rows).
    ["Plagijat", "plagijat"],
    ["Plagiranje", "plagijat"],
    ["Plagirano poglavlje", "plagijat"],
    ["Izvornost rada", "izvornost"],
    ["Originalnost teksta", "izvornost"],
    ["Akademski integritet", "integritet"],
    ["Provjera integriteta", "integritet"],
    ["Neobično brzo pisanje", "neobično"],
    ["Neuobičajeni obrasci", "neobično"],
    ["Nepravilnost u radu", "nepravilnost"],
    ["Tuđi tekst", "tuđi tekst"],
    ["Tuđe riječi", "tuđi tekst"],
    ["Tekst nije njegov", "tuđi tekst"],
    ["Odlomak nije vlastiti", "tuđi tekst"],
    ["Ljudski napisano", "napisao čovjek"],
    ["Napisao ga je čovjek", "napisao čovjek"],
    // English, listed one by one (owner decision 8).
    ["Copying detected", "copied"],
    ["Copy-paste", "copied"],
    ["Doubtful passage", "suspicious"],
    ["Low-risk", "risk"],
    ["Riskless", "risk"],
    ["Probably offline", "probability"],
    ["AI share", "AI percentage"],
    ["78 % human", "AI percentage"],
    ["Plagiarism", "plagiarism"],
    ["Plagiarized", "plagiarism"],
    ["Originality", "originality"],
    ["Unoriginal", "originality"],
    ["Integrity check", "integrity"],
    ["Unusual pattern", "unusual"],
    ["Atypical", "unusual"],
    ["Irregularity", "irregularity"],
    ["Concealed", "hidden"],
    ["Human-written", "written by a human"],
    ["Written by a human", "written by a human"],
    ["Someone else's text", "someone else's text"],
  ])("flags %j as %s", (text, entry) => {
    expect(entries(text)).toContain(entry);
  });

  // Section C of #179 and owner decisions 2 and 6.
  it.each([
    "Kopiraj navod",
    "Kopirajte navod",
    "Kopiranje navoda",
    "Kopirano u međuspremnik",
    "Navod je u međuspremniku",
    "Kopija rada",
    "Copy citation",
    "Copy",
    "Sakrij panel",
    "Sakrij bilješke",
    "Preuzmi PDF",
    "Preuzeto",
    "Odstupanje od pravila citatnog stila",
    "Izvorni oblik",
    "Originalna datoteka",
    "Izvorni tekst navoda",
    "Napredak 40 %",
    "Učitavanje 80 %",
    "3 izvora",
    "Nedostaje naslov",
    // B8 is not in the scan: a recovery message on the student's device must be writable.
    "Nedostajući podaci za oporavak na uređaju",
    "Izgubljeni podaci mogu se vratiti na ovom uređaju",
    "Lost data can be recovered on this device",
    "Nedostaje izvor",
    "Prijepis razgovora",
    "Propisano pravilnikom",
    "Nepravilan format datoteke",
    "Kako je rad nastao, bez presude o autorstvu.",
    "Ductus ne procjenjuje autorstvo ni korištenje AI-ja.",
    "Cjelovitost zapisa",
    "Original file",
    "Transcript",
  ])("allows %j", (text) => {
    expect(entries(text)).toEqual([]);
  });
});
