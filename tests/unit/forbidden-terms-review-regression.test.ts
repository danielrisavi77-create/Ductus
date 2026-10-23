import { describe, expect, it } from "vitest";

import { findForbiddenTerms, findForbiddenTermsInMarkup } from "../../scripts/forbidden-terms/terms";

// #297 advisory findings 1, 2 and the superlative part of 4; PRODUCT §5.
// Keep both directions of a text-ownership phrase. Do not change the
// deferred bare adverb. B8 (missing/lost data) is left out of the scan.
describe("dictionary review regressions (DAN-134)", () => {
  it.each([
    "Copied to clipboard",
    "Copied to the clipboard.",
    "COPIED TO THE CLIPBOARD",
    "Copied\u00a0to\u00a0clipboard",
    "Cop\u200bied to clipboard",
    "Copy citation",
    "Kopirano u međuspremnik",
    "Nije njegov red",
    "Nije njezin red",
    "Nije njen uređaj",
    "Za ovo nije vlastiti uređaj",
    "Nije njihova mapa",
    "Nije njegov radni uređaj",
    "Nije njegov radni prostor",
    "Nije njegov tekstualni uređivač",
    "Nije njezin odlomačni prikaz",
    "Nije njen riječnik",
    "Povratak prepisci",
    "U ovoj prepisci nema poruka",
    "This is not their own device",
    "This is not his own account",
    "This is not her own folder",
    "Nevjerojatno iskustvo",
  ])("allows neutral UI action or phrase %j", (text) => {
    expect(findForbiddenTerms(text)).toEqual([]);
    expect(findForbiddenTermsInMarkup(text, text)).toEqual([]);
  });

  it.each([
    ["Copied", "copied"],
    ["Copied from a document", "copied"],
    ["Copying detected", "copied"],
    ["Copy-paste", "copied"],
    ["Copied to clipboardX", "copied"],
    ["Copied to the clipboard2", "copied"],
    ["Copied to clipboard; copied", "copied"],
    ["Copied. To clipboard settings.", "copied"],
    ["Copied\nTo clipboard settings", "copied"],
    ["Kopirano. U međuspremniku nema sadržaja.", "kopirano"],
    ["Kopirano\nU međuspremnik", "kopirano"],
    ["Kopiranje. Navoda nema.", "kopirano"],
    ["This is not their own text", "someone else's text"],
    ["This is not his own words", "someone else's text"],
    ["Nije njegov tekst", "tuđi tekst"],
    ["Tekst nije njegov rad", "tuđi tekst"],
    ["Nije njegovog rada", "tuđi tekst"],
    ["Nije njegov odlomak", "tuđi tekst"],
    ["Nije njezina odlomka", "tuđi tekst"],
    ["Nije njegov tekst.", "tuđi tekst"],
    ["Nije njegova riječ", "tuđi tekst"],
    ["Nije njegovim riječima", "tuđi tekst"],
    ["Odlomci nisu njegovi. Nije njegov odlomak", "tuđi tekst"],
    ["Nije njezin tekst", "tuđi tekst"],
    ["Nije njen tekst", "tuđi tekst"],
    ["Nije vlastiti rad", "tuđi tekst"],
    ["Tekst nije njegov", "tuđi tekst"],
    ["Odlomak nije vlastiti", "tuđi tekst"],
    ["Riječi nisu njegove. Tuđe riječi.", "tuđi tekst"],
    ["Najvjerojatnije", "vjerojatnost"],
    ["Najvjerojatniji", "vjerojatnost"],
    ["Najvjerojatnija", "vjerojatnost"],
    ["Najvjerojatnijeg", "vjerojatnost"],
    ["Najvjerojatnijima", "vjerojatnost"],
    ["Naj\u200bvjerojatnije", "vjerojatnost"],
    ["Vjerojatnije", "vjerojatnost"],
    ["Vjerojatnost", "vjerojatnost"],
  ])("still flags %j as %s", (text, entry) => {
    expect(findForbiddenTerms(text).map((term) => term.entry)).toContain(entry);
    expect(findForbiddenTermsInMarkup(text, text).map((term) => term.entry)).toContain(entry);
  });
});
