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
    signedOut: "Prijavi se nastavničkim računom.",
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
      // create_course returns the existing id for an identical repeat.
      created: "Kolegij je spreman.",
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
    // Verbatim text of the FPZG Smjernice, čl. 8 (owner decision on #87,
    // 6236852400; text from #314, 6236916582). Words and punctuation are not
    // edited, except the two places marked below. The keys of `purposes` are
    // the database list (D-80).
    tools: {
      heading: "Uporaba alata (FPZG Smjernice, čl. 8)",
      narrowOnly: "Popis možeš samo suziti.",
      allowed: "Dopušteno u ovom zadatku",
      banned: "Nije dopušteno",
      courseProhibits: "Pravila kolegija ne dopuštaju AI pomoć, pa ni ovaj zadatak.",
      source:
        "Izvor: Smjernice za uporabu generativne umjetne inteligencije u nastavi i izradi studentskih radova, Fakultetsko vijeće FPZG-a, 21. 5. 2026., članak 8. Treća natuknica stavka 1 skraćena je, a stavak 3 nije prikazan; puni tekst je u Smjernicama.",
      purposes: {
        formatting: "korištenje za formatiranje vlastitih pisanih radova;",
        proofreading: "korištenje za lektoriranje i jezičnu provjeru vlastitih pisanih radova;",
        // Not verbatim: the article's wording uses a word from the forbidden
        // vocabulary (PRODUCT §5), as does stavak 3. Question on #314.
        literature_search: "pronalaženje znanstvene i stručne literature (stavak 1, treća natuknica)",
        transcription:
          "transkribiranje intervjua te audiozapisa ili videozapisa, uz obveznu provjeru točnosti transkribiranog sadržaja i brigu o zaštiti osobnih podataka;",
        translation:
          "prevođenje sa stranih jezika na hrvatski jezik ili s hrvatskog jezika na strani jezik, uz obveznu provjeru značenja i terminologije.",
      },
      conditions: {
        own: "2) U svim navedenim slučajevima, konačni sadržaj mora proizaći iz individualnog promišljanja i rada studenta.",
      },
      alwaysBannedHead: "4) Neprimjerenom uporabom GenUI-ja smatra se:",
      alwaysBanned: {
        texts: "generiranje dijelova ili cijelih usmenih izlaganja, podnesaka, eseja, seminarskih, završnih ili diplomskih radova;",
        media:
          "generiranje dijelova ili cijelih medijskih sadržaja, osim ako to nastavnik nije izričito zadao kao dio studentskog zadatka i samo u onom obliku u kojemu je to eksplicitno zadao;",
        data:
          "generiranje i kodiranje kvalitativnih i kvantitativnih podataka, osim ako to nastavnik nije izričito zadao kao dio studentskog zadatka i samo u onom obliku u kojemu je to eksplicitno zadao;",
        graded:
          "korištenje GenUI-ja za savladavanje i rješavanje ocjenskih problemskih i analitičkih zadataka, osim ako to nastavnik nije izričito zadao kao dio studentskog zadatka i samo u onom obliku u kojemu je to eksplicitno zadao;",
        arguments: "preuzimanje argumenata, interpretacija ili zaključaka;",
        asOwn:
          "prikazivanje sadržaja generiranog GenUI-jem u pisanim radovima, usmenim izlaganjima i drugim oblicima radova i njihovo iznošenje kao svojih radova;",
        unverified:
          "korištenje neprovjerenih izvora, citata ili empirijskih podataka koji su nastali GenUI-jem te su dijelom ili u potpunosti izmišljeni;",
        exams:
          "korištenje GenUI-ja tijekom ispita ili provjera znanja ako to nije izrijekom dopušteno i samo u onom obliku u kojemu je to eksplicitno dopušteno;",
        notes: "izrada sažetaka i vlastitih bilješki bez čitanja radova iz kojih se bilješke rade;",
        ideas: "generiranje ideja za studentske radove bez aktivnog sudjelovanja studenta u razvoju argumentacije.",
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
