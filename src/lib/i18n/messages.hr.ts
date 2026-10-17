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
    openTeacher: "Novi kolegij i zadatak",
  },
  // F-6 (DAN-35): text of screen 2 of the design handoff (docs/design/ductura).
  teacher: {
    title: "Novi kolegij i zadatak",
    denied: "Za ovaj račun nije dopušteno stvaranje kolegija.",
    unavailable: "Provjera nastavničke uloge trenutačno nije dostupna. Pokušaj ponovno.",
    signIn: "Prijavi se",
    backHome: "Na početnu",
    course: {
      heading: "Kolegij",
      name: "Naziv",
      year: "Akademska godina",
      years: { "2026/2027": "2026./2027.", "2025/2026": "2025./2026." },
      policy: "Pravila uporabe AI-ja",
      policies: {
        prohibited: "AI pomoć nije dopuštena",
        partially_allowed: "AI pomoć je djelomično dopuštena",
        encouraged: "AI pomoć se potiče uz pravila kolegija",
      },
      submit: "Stvori kolegij",
      pending: "Stvaranje kolegija…",
      created: "Kolegij je stvoren.",
      nameMissing: "Upiši naziv kolegija.",
      errors: {
        invalid: "Provjeri naziv, akademsku godinu i pravila kolegija.",
        unauthorized: "Prijava nije valjana. Prijavi se ponovno.",
        forbidden: "Za ovaj račun nije dopušteno stvaranje kolegija.",
        conflict: "Kolegij s tim nazivom već postoji uz druga pravila.",
        unavailable: "Stvaranje kolegija nije potvrđeno. Pokušaj ponovno.",
      },
    },
    assignment: {
      heading: "Zadatak",
      title: "Naslov",
      workType: "Vrsta rada",
      workTypes: {
        seminar_paper: "Seminarski rad",
        bachelor_thesis: "Završni rad",
        master_thesis: "Diplomski rad",
        essay: "Esej",
      },
      opensAt: "Otvaranje",
      dueAt: "Rok",
      instructions: "Upute studentima",
      publish: "Objavi zadatak",
      pending: "Objavljivanje…",
      published: "Objavljeno",
      publishedNotice: "Zadatak je objavljen. Studenti s kodom vide obavijest prije prve rečenice.",
      needCourse: "Prvo stvori kolegij.",
      studentsNotified: "Studenti dobivaju obavijest kad upišu kolegij.",
      newVersion: "Izmjena zadatka nakon objave stvara novu verziju; studenti je ponovno potvrđuju.",
      errors: {
        invalid: "Provjeri naslov, vrstu rada, otvaranje i rok. Rok mora biti nakon otvaranja.",
        unauthorized: "Prijava nije valjana. Prijavi se ponovno.",
        forbidden: "Za ovaj račun nije dopušteno objavljivanje zadatka u ovom kolegiju.",
        conflict: "Zadatak s istim ključem već postoji uz druge podatke. Provjeri zadatak i objavi ponovno.",
        unavailable: "Objava zadatka nije potvrđena. Pokušaj ponovno.",
      },
    },
    // Item labels are a summary and wait for the verbatim text of the FPZG
    // Pravilnik, čl. 8 (D-80); the keys of `purposes` are the database list.
    tools: {
      heading: "Uporaba alata (FPZG čl. 8)",
      narrowOnly: "Popis možeš samo suziti.",
      allowed: "Dopušteno u ovom zadatku",
      banned: "Nije dopušteno",
      courseProhibits: "Pravila kolegija ne dopuštaju AI pomoć, pa ni ovaj zadatak.",
      summaryNote: "Stavke su sažetak za demo. U aplikaciji se tekst preuzima doslovno iz Pravilnika FPZG-a.",
      purposes: {
        literature_search: "Pretraživanje i pronalaženje literature",
        proofreading: "Jezična i pravopisna dorada vlastitog teksta",
        translation: "Prijevod izvora za vlastito razumijevanje",
        formatting: "Oblikovanje i uređivanje izgleda teksta",
        transcription: "Prijepis vlastitih zvučnih zapisa",
      },
      alwaysBanned: {
        generated: "Generiranje teksta koji se predaje kao vlastiti",
        fabricated: "Izmišljanje ili preoblikovanje izvora i podataka",
        translationAsOwn: "Predaja prijevoda kao vlastitog teksta",
      },
    },
    preview: {
      heading: "Kako vidi student: obavijest prije prve rečenice",
      step: "Korak 1 od 2",
      untitled: "Naslov zadatka",
      opensFrom: "otvoreno od",
      due: "rok",
      rest: "Ostatak obavijesti (što se bilježi, što nastavnik vidi, čuvanje) jednak je za sve zadatke.",
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
    signIn: "Prijava",
    logout: "Odjava",
    loggingOut: "Odjava…",
    logoutUnsaved:
      "Ovaj uređaj nije mogao pohraniti dio teksta, pa bi se odjavom izgubio. Izvezi tekst, a zatim ponovno odaberi „Odjava”.",
    logoutFailed: "Odjava nije dovršena jer poslužitelj nije odgovorio. Ništa nije izbrisano. Provjeri vezu i pokušaj ponovno.",
    signedOutElsewhere:
      "Prijava s kojom je ova kartica otvorena više ne vrijedi: u drugoj kartici provedena je odjava ili nova prijava. Ova kartica više ništa ne prikazuje ni ne sprema. Ponovno učitaj stranicu.",
  },
} as const;

type Widen<T> = { readonly [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };

/** The shape every language table has to fill. */
export type Messages = Widen<typeof hr>;

export const messagesHr: Messages = hr;
