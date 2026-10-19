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
  // FE-H1 (#476): public home page for a visitor without a session. Every
  // entry leads to /prijava; sign-in is AAI@EduHr only (D-09). Live view and
  // replay as decided in D-142..D-144 and D-154; one summary for both roles (PRODUCT §5, 5).
  landing: {
    sectionsNav: "Odjeljci početne stranice",
    howItWorksLink: "Kako radi",
    forWhomLink: "Za koga",
    eyebrow: "Prostor za akademsko pisanje",
    title: "Od prve rečenice do predaje,",
    titleAccent: "uz svog nastavnika.",
    intro: `${APP_NAME} je mjesto na kojem student piše seminarski ili završni rad, a nastavnik prati kako rad nastaje i komentira ga uz odlomke.`,
    enter: "Prijavi se i počni",
    aaiOnly: "Prijava isključivo preko AAI@EduHr.",
    previewLabel: "Primjer radnog prostora: list rada i komentar nastavnika, izmišljeni podaci",
    previewCourse: "Javne politike · seminarski rad",
    previewTitle: "Gradski promet i održiva mobilnost",
    previewSection: "1. Uvod",
    previewParagraph1:
      "Gradovi sve češće mijenjaju pravila prometa kako bi smanjili gužve i onečišćenje zraka. Ovaj rad prati kako se takve odluke donose na razini grada.",
    previewParagraph2Start: "Istraživačko pitanje glasi: ",
    previewParagraph2Marked: "kako javne politike oblikuju izbor prijevoza",
    previewParagraph2End: " u gradu srednje veličine?",
    previewCommentAuthor: "Komentar nastavnice",
    previewCommentPlace: "uz odlomak 2",
    previewComment: "Dobar smjer. Pitanje suzi na jedan grad i navedi razdoblje koje promatraš.",
    previewNote: "Izmišljeni primjer",
    forWhomTitle: "Dvije uloge, isti prikaz rada.",
    forWhomLead: `Sažetak nastanka rada isti je za studenta i nastavnika. ${APP_NAME} ne ocjenjuje proces pisanja.`,
    studentEyebrow: "Za studente",
    studentTitle: "Piši u miru i znaj što se vidi.",
    studentBody:
      "Zadatak, rok i pravila su na jednom mjestu. Prije prve rečenice piše što nastavnik vidi i od kada, a komentari stižu uz odlomak na koji se odnose.",
    studentPoints: {
      notice: "Obavijest o zadatku prije početka pisanja",
      comments: "Komentari nastavnika uz odlomke",
      replay: "Ista reprodukcija nastanka rada koju vidi nastavnik",
    },
    teacherEyebrow: "Za nastavnike i mentore",
    teacherTitle: "Prati rad dok nastaje.",
    teacherBody:
      "Rad vidiš uživo dok student piše i komentiraš ga dok se još može doraditi. Nastanak rada možeš reproducirati znak po znak, za razgovor sa studentom, ne za ocjenu.",
    teacherPoints: {
      assignment: "Zadatak s rokom i pravilima kolegija",
      live: "Prikaz rada uživo i komentari uz odlomak",
      summary: "Sažetak nastanka rada pri predaji, isti kao studentov",
    },
    howTitle: "Četiri koraka od zadatka do predaje.",
    steps: {
      assignmentTitle: "Zadatak i obavijest",
      assignmentBody:
        "Nastavnik objavi zadatak s rokom i pravilima. Prije pisanja student vidi obavijest: što nastavnik vidi, od kada i što se čuva.",
      writingTitle: "Pisanje",
      writingBody:
        "Student piše u uređivaču zadatka. Nastavnik i mentor vide rad uživo dok nastaje, a student to zna prije prve rečenice.",
      commentsTitle: "Komentari",
      commentsBody:
        "Nastavnik ostavlja komentar uz odlomak. Student ga vidi na istom mjestu i sam odlučuje kako će doraditi tekst.",
      submitTitle: "Predaja s potvrdom i sažetkom",
      submitBody:
        "Student predaje rad i dobiva potvrdu predaje. Sažetak nastanka rada isti je za oba pogleda i nije presuda o autorstvu.",
    },
    closingTitle: `${APP_NAME} pokazuje kako je rad nastao.`,
    closingAccent: "Zaključak donosi čovjek.",
    footerNote: "Prostor za akademsko pisanje.",
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
  // Live view and replay are not built yet, so the notice says what will happen
  // in this assignment; D-63 for the skipped long pauses of the replay.
  student: {
    title: "Zadatak",
    signedOut: "Prijavi se da vidiš zadatak.",
    signIn: "Prijavi se",
    enroll: {
      title: "Upis u kolegij",
      heading: "Upiši kolegij",
      signedOut: "Prijavi se da upišeš kolegij.",
      label: "Kod kolegija",
      hint: "Kod ti daje nastavnik. Razmaci, crtice i velika ili mala slova nisu bitni.",
      submit: "Upiši",
      sending: "Upisivanje…",
      opening: "Upisan/a si u kolegij. Otvaram obavijest zadatka…",
      errors: {
        malformed: "Kod ima od 8 do 32 slova i brojke. Provjeri ga i upiši ponovno.",
        refused: "Kod ne postoji ili je istekao. Provjeri ga s nastavnikom.",
        tooManyAttempts: "Previše pokušaja. Pokušaj ponovno kasnije.",
        unauthorized: "Prijava nije valjana. Prijavi se ponovno.",
        forbidden: "Ovaj račun ne može upisati kolegij.",
        invalid: "Upis nije prihvaćen. Ponovno učitaj stranicu.",
        unavailable: "Upis trenutačno nije moguć. Pokušaj ponovno.",
        offline: "Nema veze s poslužiteljem. Provjeri mrežu i pokušaj ponovno.",
      },
      course: {
        none: "Upisan/a si u kolegij, ali u njemu zasad nema otvorenog zadatka. Kad ga nastavnik objavi, vrati se na ovu stranicu.",
        notFound: "Ovaj kolegij nije dostupan ovom računu. Upiši ga kodom koji ti daje nastavnik.",
        unavailable: "Zadatke kolegija trenutačno nije moguće učitati. Pokušaj ponovno.",
        retry: "Pokušaj ponovno",
        another: "Upiši drugi kolegij",
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
      live: "U ovom zadatku bilježit će se svaka promjena teksta, znak po znak, s redoslijedom i vremenom: unos i brisanje, lijepljenje, uvoz, prijenos iz AI pomoćnika i izmjene nastavnika. To će služiti samo prikazu uživo i reprodukciji.",
      chain: "Svaki korak spremanja dobiva hash i ulazi u lanac, pa se svaka kasnija izmjena zapisa vidi.",
      versions: "Verzije, predaja i napomene koje dodaš.",
    },
    notRecordedHeading: "Što se ne bilježi",
    notRecorded: {
      inputs: "Koja je tipka pritisnuta i koliko je držana. Iz vremena promjena nikad se ne računaju brzina, ritam ni bilo kakva mjera. Reprodukcija preskače duge stanke i ne navodi koliko su trajale.",
      outside: "Druge aplikacije i kartice preglednika, kamera, mikrofon i zaslon.",
      device: "IP adresa i podaci o uređaju.",
    },
    teacherHeading: "Što vidi nastavnik (mentor)",
    teacher: {
      state: "Od prvog dana pratit će tvoj rad uživo, dok nastaje, pa i tekst koji ćeš kasnije možda obrisati. Ono što napišeš bez mreže vidjet će tek kad se veza vrati.",
      // D-154, PRODUCT §5 rules 5 and 7: the student sees the same replay of their own work.
      replay: "Nastavnik (mentor) zadatka moći će reproducirati nastanak rada znak po znak, pa i obrisani tekst. Istu reprodukciju svog rada vidjet ćeš i ti.",
      purpose: "Prikaz uživo i reprodukcija služit će praćenju nastanka rada i komentarima, nikad ocjeni ni rangiranju.",
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
  // F-10 (DAN-87): process summary, one text for every reader (PRODUCT §5
  // rule 5, §7). Thresholds stand next to the numbers they decide (rule 12).
  summary: {
    title: "Sažetak procesa",
    sameForEveryone: "Isti sažetak vide student i nastavnik.",
    timeNote: "Vremena su po zagrebačkom vremenu, zaokružena na minutu.",
    evidenceKind: "Vrsta dokaza",
    evidenceKinds: { observed: "opaženo", imported: "uvezeno", declared: "izjavljeno" },
    from: "od",
    to: "do",
    at: "u",
    recordState: {
      label: "Stanje zapisa",
      complete: "Zapis je cjelovit",
      has_gaps: "Zapis ima praznine (vidi popis)",
    },
    sessions: {
      heading: "Sesije pisanja",
      count: "Broj sesija",
      threshold: "prag P-01: nova sesija počinje nakon stanke dulje od",
      none: "Nema zabilježenih sesija.",
    },
    pastes: {
      heading: "Lijepljenja",
      listedThreshold: "prag P-02: zasebno se navodi lijepljenje veće od",
      size: "Veličina",
      origins: { not_observed: "izvor nije opažen" },
      noneListed: "Nema lijepljenja većih od praga.",
      smaller: "Manja lijepljenja, samo broj",
      smallerThreshold: "prag P-02: najviše",
    },
    gaps: {
      heading: "Praznine u zapisu",
      explanation:
        "Praznina u zapisu je razdoblje između dvaju dijelova zapisa koje je poslužitelj primio, za koje izmjene nisu stigle na poslužitelj. Ne govori ništa o tome kako je rad pisan.",
      item: "Praznina u zapisu",
      none: "Nema praznina u zapisu.",
    },
    // Forms after a number: nominative, and genitive after "od".
    units: {
      minutesGenitive: { one: "minute", few: "minute", many: "minuta" },
      characters: { one: "znak", few: "znaka", many: "znakova" },
      charactersGenitive: { one: "znaka", few: "znaka", many: "znakova" },
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
      "Ovaj uređaj nije mogao pohraniti dio teksta, pa bi se odjavom izgubio. Izvezi tekst prije odjave.",
    // FE-D7 (D-118): the sign-out dialog. It speaks only of this device: the
    // app sends nothing to the server yet, so it promises no sending (#476).
    logoutTitle: "Odjava",
    logoutConfirm: "Odjavi se",
    logoutStay: "Ostani",
    logoutPlain: "Odjava zatvara sesiju na ovom uređaju.",
    logoutPending: {
      one: "{n} izmjena postoji samo na ovom uređaju. Odjava zatvara sesiju.",
      few: "{n} izmjene postoje samo na ovom uređaju. Odjava zatvara sesiju.",
      many: "{n} izmjena postoji samo na ovom uređaju. Odjava zatvara sesiju.",
    },
    logoutKept:
      "Zapis ostaje vezan uz tebe na ovom uređaju i nastavljaš ga kad se ponovno prijaviš. Osoba koja se nakon tebe prijavi na ovom uređaju ne vidi tvoj rad.",
    logoutFailed: "Odjava nije dovršena jer poslužitelj nije odgovorio. Ništa nije izbrisano. Provjeri vezu i pokušaj ponovno.",
    signedOutElsewhere:
      "Prijava s kojom je ova kartica otvorena više ne vrijedi: u drugoj kartici provedena je odjava ili nova prijava. Ova kartica više ništa ne prikazuje ni ne sprema. Ponovno učitaj stranicu.",
  },
} as const;

type Widen<T> = { readonly [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };

/** The shape every language table has to fill. */
export type Messages = Widen<typeof hr>;

export const messagesHr: Messages = hr;
