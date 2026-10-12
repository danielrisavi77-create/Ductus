/**
 * Interface text, Croatian (D-84: demo interface text in keys).
 *
 * Components read text from here, so `messages.en.ts` (D-70) is a second
 * table of the same shape and nothing else. Tidying direct Croatian text
 * outside this catalogue waits for English (D-70, 11 Oct 2026) and is not a
 * separate task until then. Words from the
 * forbidden vocabulary in docs/PRODUCT.md §5 never appear here;
 * `messages.test.ts` checks that.
 *
 * This is the one catalogue of screen text. Two neighbours hold text that is
 * not repeated here, and `messages.test.ts` checks that as well:
 *   - `./hr.ts`: Croatian dates and counted nouns ("2 riječi"), built by rule;
 *   - `@/domain/sync/labels`: the wording of the eight save states, kept next
 *     to the state machine it describes.
 */

export const hr = {
  app: {
    name: "Ductus",
    tagline: "Kako je rad nastao, bez presude o autorstvu.",
  },
  shell: {
    skipToContent: "Preskoči na sadržaj",
    demoBadge: "Demo · izmišljeni podaci",
  },
  home: {
    lead: "Ductus ne procjenjuje autorstvo ni korištenje AI-ja. Prije početka vidiš što nastavnik vidi i od kada.",
    openWorkspace: "Otvori radni prostor",
    openTeacherCourses: "Kolegiji za nastavnike",
  },
  teacherCourses: {
    title: "Stvaranje kolegija",
    lead: "Kolegij može stvoriti samo nastavnik s potvrđenom ulogom na svojoj ustanovi.",
    denied: "Za ovaj račun nije dopušteno stvaranje kolegija.",
    unavailable: "Provjera nastavničke uloge trenutačno nije dostupna. Pokušaj ponovno.",
    signIn: "Prijavi se",
    backHome: "Na početnu",
    nameLabel: "Naziv kolegija",
    yearLabel: "Akademska godina",
    policyLabel: "Pravila uporabe AI-ja",
    policyProhibited: "AI pomoć nije dopuštena",
    policyPartial: "AI pomoć je djelomično dopuštena",
    policyEncouraged: "AI pomoć je dopuštena uz pravila zadatka",
    submit: "Stvori kolegij",
    pending: "Stvaranje kolegija…",
    created: "Kolegij je zabilježen. Identifikator:",
    errors: {
      invalid: "Provjeri naziv, akademsku godinu i pravila kolegija.",
      unauthorized: "Prijava nije valjana. Prijavi se ponovno.",
      forbidden: "Za ovaj račun nije dopušteno stvaranje kolegija.",
      conflict: "Kolegij s tim nazivom već postoji uz druga pravila.",
      unavailable: "Stvaranje kolegija nije potvrđeno. Pokušaj ponovno.",
    },
  },
  workspace: {
    title: "Radni prostor",
    viewModes: "Prikaz",
    modeWriting: "Pisanje",
    modeTeacherView: "Kako vidi nastavnik",
    soon: "uskoro",
    structure: "Struktura",
    structureLabel: "Struktura rada",
    structureEmpty: "Naslovi će se pojaviti ovdje.",
    tables: "Popis tablica",
    tablesEmpty: "Nema tablica.",
    footnotes: "Fusnote",
    footnotesEmpty: "Nema fusnota.",
    progress: "Napredak",
    sidePanel: "Upute, literatura i komentari",
    sidePanelEmpty: "Upute zadatka, literatura i komentari nastavnika prikazuju se ovdje.",
    documentUntitled: "Bez naslova",
    documentLabel: "Tekst rada",
    documentNotEditable: "Pisanje ovdje još nije moguće.",
    status: "Stanje rada",
  },
  editor: {
    placeholder: "Počni pisati…",
    blockedHint: "Ova kartica ništa ne sprema dok je druga otvorena. Kad je zatvoriš, tekst se ovdje ponovno učitava.",
    failureQuota: "Na uređaju nema dovoljno prostora, pa se promjene više ne spremaju. Izvezi tekst da ga ne izgubiš.",
    failureUnavailable: "Spremanje na ovom uređaju nije dostupno. Izvezi tekst da ga ne izgubiš.",
    failureLimit: "Lokalni zapis je dosegao granicu, pa se promjene više ne spremaju. Izvezi tekst da ga ne izgubiš.",
    failureStale: "Dokument je u međuvremenu promijenjen na drugom mjestu, pa ova kartica više ne sprema. Izvezi tekst, zatim ponovno učitaj stranicu.",
    failureUnknown: "Spremanje nije uspjelo. Izvezi tekst da ga ne izgubiš.",
    failureInvalid: "Ovaj tekst nije moguće spremiti. Izvezi ga da ga ne izgubiš.",
    recovery: "Lokalni zapis nije moguće pouzdano pročitati. Ostaje netaknut, a ova kartica ništa ne sprema.",
    exportText: "Izvezi tekst",
  },
  auth: {
    failedTitle: "Prijava nije dovršena",
    failedBody: "Prijavu nije bilo moguće dovršiti. Pokušaj ponovno; ako se ponovi, javi se koordinatoru na svojoj ustanovi.",
    unavailableBody: "Prijava preko AAI@EduHr trenutačno ne odgovara. Pokušaj ponovno za nekoliko minuta.",
    retry: "Pokušaj ponovno",
    home: "Na početnu",
  },
} as const;

type Widen<T> = { readonly [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };

/** The shape every language table has to fill. */
export type Messages = Widen<typeof hr>;

export const messagesHr: Messages = hr;
