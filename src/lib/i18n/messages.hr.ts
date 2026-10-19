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

/** The product name on screen (D-124): one value, read through `app.name`. */
const APP_NAME = "Ductura";

export const hr = {
  app: {
    name: APP_NAME,
    tagline: "Kako je rad nastao, bez presude o autorstvu.",
  },
  shell: {
    skipToContent: "Preskoči na sadržaj",
    demoBadge: "Demo · izmišljeni podaci",
  },
  home: {
    lead: `${APP_NAME} ne procjenjuje autorstvo ni korištenje AI-ja. Prije početka vidiš što nastavnik vidi i od kada.`,
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
        // Accepted by the server (create-assignment.ts), not offered by the form yet.
        short_paper: "Podnesak",
        specialist_thesis: "Specijalistički rad",
        doctoral_thesis: "Doktorski rad",
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
    sheetTheme: "Tema lista",
    sheetThemeLight: "Bijeli list",
    sheetThemeDark: "Tamni list",
    structure: "Struktura",
    structureLabel: "Struktura rada",
    structureEmpty: "Naslovi će se pojaviti ovdje.",
    tables: "Popis tablica",
    tablesEmpty: "Nema tablica.",
    footnotes: "Fusnote",
    footnotesEmpty: "Nema fusnota.",
    progress: "Napredak",
    sidePanel: "Upute, literatura i komentari",
    panelTabs: "Bočni panel",
    tabSources: "Literatura",
    tabInstructions: "Upute",
    tabComments: "Komentari",
    sourcesEmpty: "Literatura rada prikazuje se ovdje.",
    instructionsEmpty: "Upute zadatka prikazuju se ovdje.",
    commentsEmpty: "Komentari nastavnika prikazuju se ovdje.",
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
  // F-8 (DAN-211): the browser reports no network. Says nothing about the
  // server; the save chip alone tells where the text is.
  network: {
    offline: "Bez mreže",
    offlineSaving: "Bez mreže. Tekst se i dalje sprema na ovom uređaju.",
    offlineNotSaving: "Bez mreže.",
  },
  toolbar: {
    label: "Oblikovanje teksta",
    paragraph: "Odlomak",
    heading1: "Naslov 1",
    heading2: "Naslov 2",
    heading3: "Naslov 3",
    bold: "Podebljano",
    italic: "Kurziv",
    undo: "Poništi",
    redo: "Ponovi",
  },
  outline: {
    label: "Naslovi u radu",
    untitledHeading: "Naslov bez teksta",
  },
  // F-9 step 1: the teacher's comments next to a paragraph (B-10, BACKEND 4.11).
  comments: {
    title: "Komentari",
    loading: "Učitavanje komentara…",
    empty: "Nema komentara.",
    note: "Komentari su odvojeni od teksta rada i ne ulaze u broj riječi.",
    notAvailable: "Komentari za ovaj rad nisu dostupni.",
    unavailable: "Komentare trenutačno nije moguće učitati.",
    signedOut: "Prijava je istekla. Prijavi se ponovno da vidiš komentare.",
    refresh: "Osvježi komentare",
    number: "Komentar {n}",
    teacher: "Nastavnik",
    student: "Student",
    own: "Ti",
    state: { open: "otvoreno", answered: "odgovoreno", resolved: "riješeno" },
    showInText: "Pokaži u tekstu",
    notPlaced: "Mjesto u tekstu nije moguće pouzdano pronaći. Komentar ostaje ovdje.",
    replyLabel: "Odgovor",
    replyPlaceholder: "Odgovor…",
    reply: "Odgovori",
    replying: "Slanje…",
    resolvedNote: "Nastavnik je označio komentar riješenim.",
    replyErrors: {
      signedOut: "Prijava je istekla. Prijavi se ponovno.",
      forbidden: "Ovaj račun ne može odgovoriti na ovaj komentar.",
      conflict: "Komentar je u međuvremenu označen riješenim.",
      invalid: "Odgovor nije prihvaćen. Napiši od 1 do 2000 znakova.",
      unavailable: "Odgovor nije poslan. Pokušaj ponovno.",
    },
  },
  // F-7 (#336): the S3 notice before the first sentence. What is recorded
  // follows D-142, D-143 and D-154 (live view, per-change time, replay for the
  // mentor, i.e. the teacher of the assignment, and the same replay for the student)
  // and PRODUCT §5 rules 4 and 7; D-24 and D-81 for the 30-second steps.
  // AssignmentNotice renders recorded, notRecorded and teacher in key order.
  student: {
    title: "Zadatak",
    signedOut: "Prijavi se da vidiš zadatak.",
    signIn: "Prijavi se",
    enroll: {
      title: "Upis u kolegij",
      signedOut: "Prijavi se da upišeš kolegij.",
      label: "Kod kolegija",
      hint: "Kod ti daje nastavnik. Razmaci, crtice i velika ili mala slova nisu bitni.",
      submit: "Upiši kolegij",
      sending: "Upisivanje…",
      enrolled: "Upisan/a si u kolegij. Zadatke kolegija otvaraš poveznicom koju ti daje nastavnik.",
      errors: {
        malformed: "Kod ima od 8 do 32 slova i brojke. Provjeri ga i upiši ponovno.",
        refused: "Kod nije prihvaćen. Provjeri ga s nastavnikom.",
        tooManyAttempts: "Previše pokušaja. Pokušaj ponovno kasnije.",
        unauthorized: "Prijava nije valjana. Prijavi se ponovno.",
        forbidden: "Ovaj račun ne može upisati kolegij.",
        invalid: "Upis nije prihvaćen. Ponovno učitaj stranicu.",
        unavailable: "Upis trenutačno nije moguć. Pokušaj ponovno.",
      },
    },
    notFound: "Ovaj zadatak nije dostupan ovom računu. Upiši kolegij kodom koji ti daje nastavnik.",
    unavailable: "Zadatak trenutačno nije moguće učitati. Pokušaj ponovno.",
    step: "Obavijest prije prve rečenice · korak 2 od 2",
    opensFrom: "otvoreno od",
    due: "rok",
    toolsHeading: "Uporaba alata u ovom zadatku (FPZG čl. 8)",
    noTools: "U ovom zadatku uporaba alata generativne umjetne inteligencije nije dopuštena.",
    recordedHeading: "Što se bilježi",
    recorded: {
      steps: "Promjene teksta, sažete u odsječke od najviše 30 sekundi. Odsječak nosi jedno vrijeme, zaokruženo na minutu.",
      live: "Svaka promjena teksta, znak po znak, s redoslijedom i vremenom: unos i brisanje, lijepljenje, uvoz, prijenos iz AI pomoćnika i izmjene nastavnika. To služi samo prikazu uživo i reprodukciji.",
      chain: "Svaki korak spremanja dobiva hash i ulazi u lanac, pa se svaka kasnija izmjena zapisa vidi.",
      versions: "Verzije, predaja i napomene koje dodaš.",
    },
    notRecordedHeading: "Što se ne bilježi",
    notRecorded: {
      inputs: "Koja je tipka pritisnuta i koliko je držana. Iz vremena promjena nikad se ne računaju brzina, pauze, ritam ni bilo kakva mjera.",
      outside: "Druge aplikacije i kartice preglednika, kamera, mikrofon i zaslon.",
      device: "IP adresa i podaci o uređaju.",
    },
    teacherHeading: "Što vidi nastavnik (mentor)",
    teacher: {
      state: "Od prvog dana tvoj rad uživo, dok nastaje, pa i tekst koji ćeš kasnije možda obrisati.",
      // D-154, PRODUCT §5 rules 5 and 7: the student sees the same replay of their own work.
      replay: "Nastavnik (mentor) zadatka može reproducirati nastanak rada znak po znak, pa i obrisani tekst. Istu reprodukciju svog rada vidiš i ti.",
      purpose: "Prikaz uživo i reprodukcija služe praćenju nastanka rada i komentarima, nikad ocjeni ni rangiranju.",
      history: "Povijest verzija i sažetak procesa, isti kao što ga vidiš ti.",
      noVerdict: "Ductus ne procjenjuje autorstvo ni korištenje AI-ja.",
    },
    // D-05, PRODUCT §6 "Profili evidencije": only for the extended profile.
    teacherExtended: "Usporedbu verzija na kraju sesija i poslanih verzija.",
    retention: "Zapis se čuva uz rad do isteka roka koji propisuje fakultet.",
    note: "Prije konačne predaje uz rad možeš dodati napomenu. Napomene se samo dodaju.",
    checkbox: "Pročitao/la sam obavijest. Znam što se bilježi i što vidi nastavnik (mentor).",
    confirm: "Potvrdi i otvori editor",
    confirming: "Potvrđivanje…",
    notConsent: "Potvrda nije privola. Prije potvrde ništa se ne šalje na poslužitelj.",
    confirmed: "Potvrđeno {time}. Zapis počinje s prvom izmjenom.",
    openEditor: "Otvori editor",
    errors: {
      stale: "Nastavnik je u međuvremenu objavio novu verziju zadatka. Ponovno učitaj stranicu i pročitaj je.",
      unauthorized: "Prijava nije valjana. Prijavi se ponovno.",
      forbidden: "Ovaj račun ne može potvrditi obavijest za ovaj zadatak.",
      invalid: "Potvrda nije prihvaćena. Ponovno učitaj stranicu.",
      unavailable: "Potvrda nije zabilježena. Pokušaj ponovno.",
    },
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
