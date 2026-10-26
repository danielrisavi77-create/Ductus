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
const NOTICE_STEP_COUNT = "1 od 2";

export const hr = {
  app: {
    name: APP_NAME,
    tagline: "Kako je rad nastao, bez presude o autorstvu.",
  },
  shell: {
    skipToContent: "Preskoči na sadržaj",
    demoBadge: "Demo · izmišljeni podaci",
    // Design v3 shell (#476 6314969336): only static labels and the role the
    // server read; no names or counts the app does not have.
    sideNav: "Bočna navigacija",
    workNav: "Radni prostor",
    home: `${APP_NAME}, početna`,
    space: { teacher: "Nastavnički prostor", student: "Studentski prostor" },
    nav: {
      assignments: "Moji zadaci",
      courses: "Moji kolegiji",
      newCourse: "Novi kolegij i zadatak",
      fastPath: "Brz put",
      workspace: "Radni prostor",
      enroll: "Upis u kolegij",
    },
    role: { teacher: "Nastavnik", student: "Student" },
    demoNote: "Nijedan stvarni osobni podatak.",
    signOut: "Odjava",
    openNav: "Otvori navigaciju",
    closeNav: "Zatvori navigaciju",
    theme: "Promijeni svijetlu ili tamnu temu",
    breadcrumb: "Put",
    homeCrumb: "Početna",
  },
  home: {
    lead: `${APP_NAME} ne procjenjuje autorstvo ni korištenje AI-ja. Prije početka vidiš što nastavnik vidi i od kada.`,
    openWorkspace: "Otvori radni prostor",
    openTeacher: "Otvori kolegije",
    // #802 part B: the signed-in home (pocetna.dc.html: greeting, cards).
    title: "Početna",
    // Locative of the app name ("u Ducturu").
    welcome: "Dobro došli u Ducturu",
    spaces: "Prostori",
    workTitle: "Moj rad",
    workBody: "Pisanje i predaja seminarskih i završnih radova.",
    coursesTitle: "Moji kolegiji",
    coursesBody: "Za nastavnike: kolegiji, zadaci i radovi studenata.",
    enrollQuestion: "Imaš kod novog kolegija?",
    enroll: "Upiši",
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
    // FE-H2a (#476): ten announcements of the full flow. Steps the app does not
    // have yet carry "Uskoro" and stay neutral, never a promise (PRODUCT §5).
    flow: {
      link: "Tijek rada",
      title: "Cijeli tijek rada u deset koraka.",
      lead: "Od zadatka do ustanove. Koraci s oznakom „Uskoro” su u pripremi i još nisu dio aplikacije.",
      soon: "Uskoro",
      steps: {
        assignment: {
          name: "Zadatak",
          title: "Student zna što se od njega očekuje.",
          body: "Nastavnik objavi zadatak s rokom, oblikom, opsegom i pravilima kolegija. Student ih vidi na jednom mjestu prije prve rečenice.",
        },
        writing: {
          name: "Pisanje",
          title: "Nacrt postaje akademski rad.",
          body: "Student piše u uređivaču zadatka, s naslovima i navodima. Nastavnik vidi rad uživo dok nastaje, a student to zna unaprijed.",
        },
        sources: {
          name: "Literatura",
          title: "Od navoda do izvora.",
          body: "Navod u tekstu vezan je uz izvor u popisu literature, u stilu koji propisuje fakultet.",
        },
        mentoring: {
          name: "Mentorstvo",
          title: "Komentar uz točan odlomak.",
          body: "Nastavnik ostavlja komentar uz odlomak na koji se odnosi. Student ga vidi na istom mjestu.",
        },
        reply: {
          name: "Odgovor",
          title: "Student odgovara na komentar.",
          body: "Odgovor stoji uz komentar, pa razgovor o odlomku ostaje na jednom mjestu. Kako će doraditi tekst, odlučuje student.",
        },
        versionReview: {
          name: "Pregled verzije",
          title: "Pregled vezan uz određenu verziju.",
          body: "Nastavnik označi koju je verziju rada pregledao, pa oboje znaju o kojem se tekstu razgovaralo.",
        },
        laterChange: {
          name: "Kasnija promjena",
          title: "Promjena nakon pregleda traži novi pregled.",
          body: "Kad se pregledani odlomak kasnije promijeni, nastavnik vidi da ga može ponovno pregledati.",
        },
        submission: {
          name: "Predaja",
          title: "Student zna što predaje.",
          body: "Prije predaje student vidi točno ono što predaje, a nakon predaje dobiva potvrdu. Sažetak nastanka rada isti je za studenta i nastavnika.",
        },
        defence: {
          name: "Obrana",
          title: "Za obranu točno određena verzija.",
          body: "Oni koji sudjeluju u obrani rada dobivaju upravo predanu verziju.",
        },
        institution: {
          name: "Ustanova",
          title: "Okvir i uloge, bez čitanja radova.",
          body: "Ustanova postavlja pravila i uloge za svoje kolegije. Sadržaj radova pritom ne čita.",
        },
      },
    },
    closingTitle: `${APP_NAME} pokazuje kako je rad nastao.`,
    closingAccent: "Zaključak donosi čovjek.",
    footerNote: "Prostor za akademsko pisanje.",
    wow: {
      sidesEyebrow: "Isprobaj",
      sidesTitle: "Piši lijevo. Mentor vidi isto desno.",
      sidesLead:
        "Probni prostor: tekst ostaje u ovom pregledniku i nikamo se ne šalje. U stvarnom radu mentor vidi tvoj rad uživo, uz odlomak s komentarom.",
      studentPane: "Student piše",
      mentorPane: "Mentor vidi",
      editorLabel: "Probni tekst studenta",
      mentorLabel: "Isti tekst u prikazu mentora, samo za čitanje",
      placeholder: "Počni pisati prvu rečenicu…",
      sampleText: "Gradovi sve češće mijenjaju pravila prometa.",
      sampleComment: "Suzi na jedan grad i navedi razdoblje.",
      sampleCommentPlace: "uz odlomak 1 · mentor (izmišljen)",
      loading: "Učitavam probni prostor…",
    },
    replay: {
      eyebrow: "Premotavanje",
      title: "Vrati se kroz nastanak odlomka.",
      lead: "Mentor zadatka i student mogu premotati kako je tekst nastajao, korak po korak. Ovo je izmišljen primjer, nitko ga nije napisao.",
      empty: "Odlomak je na početku prazan.",
      start: "Početak",
      during: "Tijekom pisanja",
      end: "Završni tekst",
      play: "Reproduciraj",
      pause: "Pauza",
      sliderLabel: "Korak premotavanja",
      stepOf: "korak {step} od {last}",
      note: "Premotavanje prikazuje redoslijed promjena, ne ocjenu ni procjenu. Ritam pisanja ne govori ništa o autorstvu ni o trudu.",
      // Invented edits, one per step: "+text" appends, "from>>to" replaces (see rewind-frames.ts).
      edits: [
        "+Gradovi",
        "+ sve",
        "+ češće",
        "+ mijenjaju",
        "+ pravila",
        "+ prometa.",
        "sve češće>>sve češće, ali neujednačeno,",
        "+ Najviše",
        "+ se",
        "+ mijenja",
        "+ parkiranje.",
        "Najviše se mijenja parkiranje.>>Najčešće se mijenja parkiranje u središtu.",
        "Gradovi>>Europski gradovi",
      ],
    },
    access: {
      eyebrow: "Tko što vidi",
      title: "Isti rad, jasne uloge.",
      lead: "Pogledaj što koja uloga vidi, a što ne vidi. Pravila su ista za sve zadatke.",
      tablistLabel: "Uloga",
      sees: "Vidi",
      doesNot: "Ne vidi",
      note: "Mentor i nastavnik zadatka jedna su uloga. Nitko drugi ne može premotati nastanak rada.",
      roles: {
        student: {
          name: "Student",
          sees: [
            "Obavijest o praćenju kao prvi ekran zadatka, prije prve rečenice.",
            "Točno ono što o njegovu radu vidi mentor, istim prikazom.",
            "Premotavanje nastanka vlastitog rada, isto kakvo ima mentor.",
            "Tko je i kada otvorio njegov rad.",
          ],
          not: [
            "Mentorove privatne radne zapise. Može ih zatražiti pravom pristupa.",
            "Ocjenu i obrazloženje prije nego ih mentor objavi.",
          ],
        },
        mentor: {
          name: "Mentor i nastavnik zadatka",
          sees: [
            "Rad uživo, dok nastaje.",
            "Premotavanje nastanka rada, znak po znak.",
            "Komentare uz odlomak i studentove odgovore.",
          ],
          not: [
            "Ocjenu ni procjenu studenta: prikaz služi praćenju i komentarima.",
            "Povijest međustanja u sažetku, usporedbi ili izvozu. Postoji samo u prikazu uživo i premotavanju.",
          ],
        },
        institution: {
          name: "Ustanova",
          sees: [
            "Pravila i uloge za svoje kolegije, koje sama postavlja.",
            "Tko je kada pristupio kojem radu.",
          ],
          not: [
            "Sadržaj radova.",
            "Premotavanje nastanka rada: nije dostupno ostalim ulogama.",
          ],
        },
      },
    },
    faq: {
      eyebrow: "Pitanja",
      title: "Kratki odgovori.",
      items: {
        authorship: {
          q: `Tvrdi li ${APP_NAME} tko je napisao rad?`,
          a: `Ne. ${APP_NAME} prikazuje što je opaženo u uređivaču i ne računa nikakve mjere o studentu. Zaključak donosi čovjek.`,
        },
        beforeWriting: {
          q: "Što student zna prije pisanja?",
          a: "Prvi ekran svakog zadatka kaže što nastavnik vidi i od kada. Student to pročita prije prve rečenice.",
        },
        ai: {
          q: "Mora li student koristiti AI?",
          a: "Ne. Ništa u zadatku ne traži AI od studenta, a pomoćnik je moguć samo ako ga zadatak dopušta.",
        },
        signIn: {
          q: "Kako se student prijavljuje?",
          a: "Isključivo svojim računom AAI@EduHr. Drugog načina prijave nema.",
        },
        offline: {
          q: "Što ako veza pukne tijekom pisanja?",
          a: "Tekst se sprema na uređaju, a oznaka kaže je li stigao na poslužitelj. Rad napisan bez veze ostaje označen kao takav i nakon usklađivanja.",
        },
        tryOut: {
          q: "Šalje li se išta iz probnog prostora?",
          a: "Ne. Tekst koji upišeš ostaje u ovom pregledniku i nikamo se ne šalje.",
        },
      },
    },
  },
  // F-6 (DAN-35): text of screen 2 of the design handoff (docs/design/ductura).
  teacher: {
    title: "Novi kolegij i zadatak",
    signedOut: "Prijavi se nastavničkim računom.",
    denied: "Za ovaj račun nije dopušteno stvaranje kolegija.",
    unavailable: "Provjera nastavničke uloge trenutačno nije dostupna. Pokušaj ponovno.",
    signIn: "Prijavi se",
    backHome: "Na početnu",
    backCourses: "Moji kolegiji",
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
      // FE-D10: only a code the route returned is shown (#576); never an invented one.
      code: "Kod za upis",
      nameMissing: "Upiši naziv kolegija.",
      errors: {
        invalid: "Provjeri naziv, akademsku godinu i pravila kolegija.",
        unauthorized: "Prijava nije valjana. Prijavi se ponovno.",
        forbidden: "Za ovaj račun nije dopušteno stvaranje kolegija.",
        conflict: "Kolegij s tim nazivom već postoji uz druga pravila.",
        unavailable: "Stvaranje kolegija nije potvrđeno. Pokušaj ponovno.",
      },
    },
    // DAN-36 (#576 6362017778): the teacher picks the deadline; there is no default.
    enrollmentCode: {
      validUntil: "Kod vrijedi do",
      expiryHelp: "Obavezno. Odaberi datum i vrijeme do kojih studenti mogu upisati kolegij ovim kodom, najviše godinu dana unaprijed.",
      selected: "Odabrano:",
      pending: "Izdavanje koda…",
      retry: "Ponovno izdaj kod",
      replace: "Izdaj novi kod",
      shownOnce: "Kod se prikazuje samo sada. Zapiši ga i daj studentima. Novi kod zamjenjuje ovaj.",
      courseKept: "Kolegij postoji. Ponovni pokušaj izdaje samo kod, ne stvara novi kolegij.",
      errors: {
        missing: "Odaberi do kada kod vrijedi.",
        invalid: "Odaberi datum i vrijeme koji postoje, u budućnosti i najviše godinu dana unaprijed.",
        unauthorized: "Kod nije izdan. Prijava nije valjana. Prijavi se ponovno.",
        forbidden: "Za ovaj račun nije dopušteno izdavanje koda za ovaj kolegij.",
        unavailable: "Nije potvrđeno je li kod izdan. Ponovni pokušaj izdaje novi kod koji zamjenjuje svaki prethodni.",
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
      wordMin: "Najmanji broj riječi (neobvezno)",
      wordMax: "Najveći broj riječi (neobvezno)",
      wordRangeHint: "Upiši cijeli broj od 1 do 1 000 000. Najmanji broj ne smije biti veći od najvećeg.",
      publish: "Objavi zadatak",
      pending: "Objavljivanje…",
      published: "Objavljeno",
      publishedNotice: "Zadatak je objavljen. Studenti s kodom vide obavijest prije prve rečenice.",
      needCourse: "Prvo stvori kolegij.",
      studentsNotified: "Studenti dobivaju obavijest kad upišu kolegij.",
      newVersion: "Izmjena zadatka nakon objave stvara novu verziju; studenti je ponovno potvrđuju.",
      errors: {
        invalid: "Provjeri naslov, vrstu rada, otvaranje, rok i raspon riječi. Rok mora biti nakon otvaranja.",
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
      bannedNone: "Sve uporabe s popisa iznad dopuštene su u ovom zadatku.",
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
      step: `Korak ${NOTICE_STEP_COUNT}`,
      untitled: "Naslov zadatka",
      opensFrom: "otvoreno od",
      due: "rok",
      rest: "Ostatak obavijesti (što se bilježi, što nastavnik vidi, čuvanje) jednak je za sve zadatke.",
    },
  },
  // Screen 11, the teacher's fast path (F-11, D-80 point 2). Lines are facts in words (PRODUCT §5 rule 2).
  // Z3 (A), #476 6289158306: the teacher's entry at /nastavnik. The order is
  // the route's (year, name; assignments by due time) and nothing reorders it.
  teacherCourses: {
    title: "Moji kolegiji",
    lead: "Kolegiji u kojima predaješ i njihovi zadaci. Poredak: akademska godina, pa naziv; zadaci po roku.",
    newCourse: "Novi kolegij i zadatak",
    empty: "Nemaš kolegija u kojima predaješ.",
    emptyLead: "Stvori kolegij i objavi prvi zadatak.",
    noAssignments: "Još nema zadataka.",
    unavailable: "Kolegiji trenutačno nisu dostupni. Pokušaj ponovno.",
    retry: "Pokušaj ponovno",
    due: "rok",
    at: "u",
    students: { one: "student", few: "studenta", many: "studenata" },
    countNote: "Broj studenata služi samo za pregled; po njemu se ništa ne poreda.",
    // F2 (#711): links to the students' works; numbered, since names arrive with B-11.
    worksLabel: "Radovi studenata",
    work: "Rad",
    noWorks: "Nijedan student još nije otvorio rad.",
    worksUnavailable: "Radovi trenutačno nisu dostupni. Pokušaj ponovno.",
  },
  fastPath: {
    title: "Brz put",
    intro: "Radovi jednog zadatka, jedan za drugim. Prikaz samo čita; ništa ne mijenja.",
    denied: "Ovaj prikaz vidi samo nastavnik.",
    loading: "Učitavanje radova…",
    unavailable: "Radovi trenutačno nisu dostupni. Pokušaj ponovno.",
    // F-11 (#757, contract c.6397637802 §3; owner c.6397679688).
    pickAssignment: "Odaberi zadatak u svojim kolegijima.",
    empty: "Za ovaj zadatak nema radova za prikaz.",
    refresh: "Stanje spremljeno na poslužitelju. Osvježava se najviše svakih 5 minuta.",
    stale: "Stanje nije osvježeno. Prikazano je zadnje učitano stanje; sljedeći pokušaj za najviše 5 minuta.",
    // #757 D1, za potvrdu: a student whose account has no name; never a number or an address.
    unnamed: "Ime nije dostupno",
    studentsLabel: "Studenti",
    studentsTitle: "Studenti · po prezimenu",
    // #732 item 18, design pregled-radova-v2 (D-80): the list has no order by numbers.
    orderNote: "Popis se ne može poredati po brojevima.",
    work: {
      notice_pending: "Obavijest još nije potvrđena",
      writing: "U pisanju",
      submitted: "Predano",
    },
    noRecord: "nema zapisa",
    noRecordYet: "Student još nije potvrdio obavijest. Nema zapisa.",
    at: "u",
    viewLabel: "Prikaz rada",
    views: { text: "Tekst rada", summary: "Sažetak procesa" },
    textLabel: "Tekst rada, samo za čitanje",
    lines: {
      lastChange: "Zadnja promjena",
      pastes: "Lijepljenja bez izvora",
    },
    none: "nema",
    openWork: "Otvori rad",
    soon: "uskoro",
  },
  workspace: {
    title: "Radni prostor",
    viewModes: "Prikaz",
    // #711 F1, za potvrdu: the name of the top bar region (course, assignment, view, submission).
    barLabel: "Zadatak i prikaz",
    modeWriting: "Pisanje",
    modeTeacherView: "Kako vidi nastavnik",
    // #732 item 7 (owner 6397193676): the line above the teacher's view, and why the switch is off.
    teacherViewLead: "Ovako nastavnik vidi tvoj rad: zadnji tekst koji je tvoj preglednik poslao, komentare i sažetak procesa. Ovdje se ne piše.",
    teacherViewOff: "samo uz zadatak",
    // F-10: a link to the submission screen, not the act of submitting (#653 contract 6385776645).
    submitLink: "Predaja",
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
    // FE-D9 (06c): "Upute" and "Rad" of the right panel, design editor-v11 §5.1.
    tabWork: "Rad",
    workEmpty: "Etape i prilozi rada prikazuju se ovdje.",
    panelLoading: "Učitavanje…",
    panelUnavailable: "Sadržaj trenutačno nije moguće učitati. Osvježi stranicu.",
    upute: {
      task: "Zadatak",
      due: "Rok: {date} u {time}",
      toolsAllowed: "Dopuštena uporaba alata (FPZG Smjernice, čl. 8)",
      toolsNone: "U ovom zadatku uporaba alata generativne umjetne inteligencije nije dopuštena.",
      checks: "Provjera oblika · FPZG",
      checksNote: "Provjera pomaže; ništa ne blokira predaju.",
    },
    rad: {
      stages: "Etape",
      stagesEmpty: "Mentor još nije zadao etape.",
      stageState: {
        notStarted: "nije započeto",
        inProgress: "u radu",
        submitted: "kod mentora",
        approved: "odobreno",
        returned: "vraćeno s napomenom",
      },
      mentorNote: "Mentor: {note}",
      attachments: "Uz rad",
      aiStatement: "Izjava o korištenju AI-ja",
      package: "Predajni paket",
    },
    documentUntitled: "Bez naslova",
    documentLabel: "Tekst rada",
    documentNotEditable: "Pisanje ovdje još nije moguće.",
    // #711 F1 (contract 6391402093 §3, §5, §6): /rad with and without an assignment.
    freeNote: "Ovaj tekst nije vezan uz zadatak i ne predaje se. Zadatak otvaraš s njegove obavijesti.",
    unavailable: "Ovaj zadatak nije dostupan ovom računu.",
    openLoading: "Otvaram rad…",
    openNotYet: "Zadatak se otvara {time}.",
    openOffline: "Za prvo otvaranje rada potrebna je veza.",
    openError: "Rad trenutačno nije moguće otvoriti.",
    openRetry: "Pokušaj ponovno",
    openNotAccepting: "Obavijest zadatka se promijenila ili zadatak trenutačno ne prima rad.",
    openNoticeLink: "Otvori obavijest zadatka",
    openReload: "Ova verzija stranice više ne može otvoriti rad. Učitaj je ponovno.",
    openReloadButton: "Učitaj ponovno",
    lateNote: "Rok zadatka je prošao. Pisati možeš i dalje, a predaja će biti označena kao predaja nakon roka.",
    // #711 F1b (contract §4): the earlier draft of this device, offered only to read and copy.
    earlierDraftSummary: "Na ovom uređaju čuva se tvoj raniji tekst koji nije u ovom radu.",
    // Owner (#711, O3 and amendment c): since 3d-2c2b a paste is an evidence step of the work, so the sentence that says so is back.
    earlierDraftExplain: "Tekst ostaje gdje je i ne briše se. Ako ga želiš u ovom radu, kopiraj ga i zalijepi; zapis rada tada to bilježi kao lijepljenje.",
    earlierDraftCopy: "Kopiraj tekst",
    // Owner accepted (#711 c.6396392080, b): the contract text "Kopirano u međuspremnik." fails the stem list of messages.test.ts (kopiran).
    earlierDraftCopied: "Tekst je u međuspremniku.",
    // Owner accepted (#711 c.6396392080, a): the contract text "Tekst nije moguće kopirati." is a forbidden term (kopir-, PRODUCT §5).
    earlierDraftCopyFailed: "Tekst nije moguće staviti u međuspremnik. Izvezi ga kao datoteku.",
    earlierDraftOpen: "Otvori raniji tekst",
    status: "Stanje rada",
    // FE-D6 (design editor-v11): the status bar.
    statusLoading: "Učitavanje rada…",
    statusNoJournal: "Ovdje se ništa ne sprema.",
    selectedWords: "označeno {words}",
    wordMinimum: "najmanje {words}",
    wordMaximum: "najviše {words}",
    pagesApprox: "≈ {pages} str.",
  },
  editor: {
    placeholder: "Počni pisati…",
    // 3d-2c2b, owner approved 25 Oct (contract #476 c.6391714810 §3): the
    // server's work differs (CONFLICT, RECOVERY_REQUIRED).
    evidenceConflict:
      "Rad na poslužitelju razlikuje se od teksta na ovom uređaju. Tekst ostaje na uređaju i ništa se ne šalje dok ne odlučiš kako dalje.",
    // 3d-2c2b, owner approved 25 Oct (#87 c.6397773534): a send refused for
    // good. The contract's "spremljen na ovom uređaju" fails the PRODUCT §5
    // scan, so "ovom" is dropped.
    sendRefused: "Tekst je spremljen na uređaju, ali ga poslužitelj nije primio. Ponovno učitaj stranicu.",
    // 3d-2c2b, owner approved 25 Oct: the package was closed by the submission (DAN-289 A1).
    submittedReadOnly:
      "Rad je predan, pa se ovdje više ne može pisati. Izmjene napravljene nakon predaje nisu u predanom radu i ostaju samo na ovom uređaju.",
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
    bulletItem: "Popis",
    quote: "Blok-citat",
    heading1: "Naslov 1",
    heading2: "Naslov 2",
    heading3: "Naslov 3",
    bold: "Podebljano",
    italic: "Kurziv",
    undo: "Poništi",
    redo: "Ponovi",
    // FE-D5, editor-v11: tools that do not fit, and the sheet theme.
    more: "Više",
    moreMenu: "Više alata",
    view: "Prikaz",
    viewMenu: "Prikaz",
    sheet: "List",
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
  // DAN-86 step 2b: the teacher's live view of a work (D-142, BACKEND 4.12).
  // The connection line is about this page's own requests, never the student.
  liveView: {
    context: "Rad uživo",
    documentLabel: "Tekst rada",
    sidePanel: "Komentari i granice zapisa",
    loading: "Učitavanje rada…",
    empty: "Student još nije poslao tekst.",
    note: "Prikazan je zadnji tekst koji je studentov preglednik poslao. To nije zapis rada i može kasniti ili zastati.",
    // DAN-332 (#826 PR 3): the route sent the bytes of the submitted revision.
    // These two replace the connection line and the note beside that text.
    submitted: "Predani rad",
    submittedNote: "Prikazana je verzija rada koju je student predao. Ova se verzija više ne mijenja.",
    signIn: "Prijavi se",
    signInFirst: "Prijavi se da vidiš rad.",
    invalid: "Ova poveznica ne vodi do rada.",
    connection: {
      loading: "Povezivanje…",
      live: "Veza radi",
      retrying: "Veza je prekinuta. Prikazan je zadnji primljeni tekst. Ponovno povezivanje…",
      paused: "Prikaz miruje dok je kartica u pozadini.",
      signedOut: "Prijava je završila.",
      notFound: "Ovaj rad nije dostupan ovom računu.",
    },
  },
  // DAN-86 step 2c: the teacher's comment on a marked passage of the live view
  // (design pregled-radova-v2 "Novi komentar"; B-10, BACKEND 4.11).
  // F-10 PR4: the state line of the summary card on the teacher's view of a
  // work. The summary's own text is `summary`, the same for every reader.
  summaryCard: {
    loading: "Učitavanje sažetka…",
    signedOut: "Prijava je istekla. Prijavi se ponovno da vidiš sažetak.",
    notFound: "Sažetak ovog rada nije dostupan ovom računu.",
    unavailable: "Sažetak trenutačno nije dostupan. Pokušaj ponovno.",
    refresh: "Osvježi sažetak",
  },
  // F-10 (#476 contract 6384297464): the student's submission, Ductura screen 4.
  submission: {
    title: "Predaja rada",
    invalid: "Ova poveznica ne vodi do zadatka.",
    signedOut: "Prijavi se da predaš rad.",
    signIn: "Prijavi se",
    backToWork: "Natrag na rad",
    steps: { check: "1 Provjera zapisa", submit: "2 Predaja", receipt: "3 Potvrda" },
    loading: "Učitavanje teksta s poslužitelja…",
    textTitle: "Ovo je tekst koji predaješ.",
    textLabel: "Tekst koji se predaje",
    serverNote: "Predaje se tekst spremljen na poslužitelju. Izmjene koje još nisu stigle na poslužitelj nisu u predaji.",
    noEvidence: "Na poslužitelju još nema teksta ovog rada. Predaja nije moguća dok tekst ne stigne na poslužitelj.",
    unreadable: "Tekst s poslužitelja nije moguće prikazati. Predaja nije moguća s ove stranice.",
    reload: "Učitaj ponovno",
    submit: "Predaj rad",
    sending: "Predaja u tijeku…",
    offline: "Za predaju je potrebna veza s poslužiteljem.",
    receiptTitle: "Potvrda o predaji",
    receiptLead: "Poslužitelj je zabilježio predaju i izdao ovu potvrdu.",
    receiptNote: "Preglednik ne provjerava potpis ove potvrde.",
    requestedAt: "Vrijeme predaje (sat poslužitelja)",
    dueAt: "Rok",
    afterDeadline: "Predano nakon roka.",
    record: "Stanje zapisa",
    records: { continuous: "Zapis je cjelovit", with_gaps: "Zapis ima praznine; vidi sažetak procesa" },
    textHash: "Otisak predanog teksta (SHA-256)",
    revision: "Verzija teksta na poslužitelju",
    outcome: {
      recordMismatch: "Predaja nije moguća: tekst sastavljen iz zapisa ne podudara se s tekstom na poslužitelju.",
      blocked: "Predaja nije moguća dok poslužitelj ne potvrdi cijeli zapis ove verzije teksta.",
      staleRevision: "Na poslužitelju je novija verzija teksta. Učitaj je ponovno prije predaje.",
      alreadyRequested: "Predaja je već zatražena za drugu verziju teksta.",
      notOpen: "Predaja za ovaj zadatak trenutačno nije otvorena.",
      notFound: "Rad nije dostupan ovom računu.",
      signedOut: "Prijava je istekla. Prijavi se ponovno.",
      // No receipt came back: the server may have recorded the submission or not (Codex 4367324506).
      unavailable: "Potvrda nije stigla, pa ishod predaje nije poznat. Pokušaj ponovno.",
    },
    openUnavailable: "Rad trenutačno nije moguće učitati s poslužitelja. Pokušaj ponovno.",
  },
  teacherComments: {
    hint: "Označi tekst u radu za komentar.",
    empty: "Nema komentara. Označi tekst u radu.",
    newTitle: "Novi komentar",
    bodyLabel: "Tekst komentara",
    publish: "Objavi",
    publishing: "Objavljivanje…",
    cancel: "Odustani",
    resolve: "Označi riješenim",
    reopen: "Ponovno otvori",
    errors: {
      signedOut: "Prijava je istekla. Prijavi se ponovno.",
      forbidden: "Ovaj račun ne može komentirati ovaj rad.",
      invalid: "Komentar nije prihvaćen. Napiši od 1 do 2000 znakova.",
      unavailable: "Komentar nije objavljen. Pokušaj ponovno.",
    },
  },
  // K-3 text (PLAN-DEMO point 8, D-80 point 3; owner on #87, 6266445027 point 3):
  // the limits of the record, with the two invented histories of the demo.
  recordLimits: {
    title: "Što zapis ne može pokazati",
    lead: "Zapis pokazuje kako je tekst ušao u rad u Ducturi: utipkan, zalijepljen ili uvezen. Ne pokazuje tko je tekst smislio ni gdje je nastao prije nego što je ušao u Ducturu.",
    exampleTitle: "Dvije izmišljene povijesti",
    exampleA: "Student A napisao je svoj tekst izvan Ducture i uvezao ga odjednom. Zapis pokazuje jedan uvoz.",
    exampleB: "Student B postupno je utipkao tekst koji je napisala druga osoba. Zapis pokazuje postupno pisanje u Ducturi.",
    conclusion: "Iz zapisa se ne vidi koji je od ta dva teksta student sam napisao. Ductura zato ne procjenjuje autorstvo: zapis olakšava razgovor o radu, a zaključak donosi čovjek.",
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
    // #711 contract 6404612273: the student's own courses and assignments.
    assignments: {
      title: "Moji zadaci",
      heading: "Moji zadaci",
      signedOut: "Prijavi se da vidiš svoje zadatke.",
      unavailable: "Popis trenutačno nije dostupan.",
      empty: "Zasad nisi upisan/a ni u jedan kolegij.",
      enroll: "Upiši kolegij kodom",
      noAssignments: "U ovom kolegiju zasad nema zadatka.",
      due: "Rok {time}",
      noticeFirst: "Prvo pročitaj obavijest",
    },
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
    // FE-D8 (#476 row 05): the states around the notice; the notice text itself is unchanged.
    loading: "Učitavanje zadatka…",
    notOpen: "Zadatak se otvara {time}. Obavijest potvrđuješ kad se zadatak otvori.",
    pastDue: "Rok zadatka je prošao {time}.",
    step: `Obavijest prije prve rečenice · korak ${NOTICE_STEP_COUNT}`,
    opensFrom: "otvoreno od",
    due: "rok",
    toolsHeading: "Uporaba alata u ovom zadatku (FPZG čl. 8)",
    noTools: "U ovom zadatku uporaba alata generativne umjetne inteligencije nije dopuštena.",
    recordedHeading: "Što se bilježi",
    recorded: {
      steps: "Promjene teksta, sažete u odsječke od najviše 30 sekundi. Odsječak nosi jedno vrijeme, zaokruženo na minutu.",
      live: "U ovom zadatku bilježit će se svaka promjena teksta, znak po znak, s redoslijedom i vremenom: unos i brisanje, lijepljenje, uvoz, prijenos iz AI pomoćnika i izmjene nastavnika. To će služiti samo prikazu uživo i reprodukciji.",
      chain: "Svaki korak spremanja dobiva digitalni otisak povezan s prethodnim, pa se svaka kasnija izmjena zapisa vidi.",
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
      noVerdict: `${APP_NAME} ne procjenjuje autorstvo ni korištenje AI-ja.`,
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
      threshold: "prag: nova sesija počinje nakon stanke dulje od",
      none: "Nema zabilježenih sesija.",
    },
    pastes: {
      heading: "Lijepljenja",
      listedThreshold: "prag: zasebno se navodi lijepljenje veće od",
      size: "Veličina",
      origins: { not_observed: "izvor nije opažen" },
      noneListed: "Nema lijepljenja većih od praga.",
      smaller: "Manja lijepljenja, samo broj",
      smallerThreshold: "prag: najviše",
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
    // 3d-2c2b O3, owner approved 25 Oct: steps held after the submission are never sent.
    logoutAfterSubmission: {
      one: "{n} izmjena nakon predaje postoji samo na ovom uređaju i ne šalje se. Odjava zatvara sesiju.",
      few: "{n} izmjene nakon predaje postoje samo na ovom uređaju i ne šalju se. Odjava zatvara sesiju.",
      many: "{n} izmjena nakon predaje postoji samo na ovom uređaju i ne šalje se. Odjava zatvara sesiju.",
    },
    logoutKept:
      "Zapis ostaje vezan uz tebe na ovom uređaju i nastavljaš ga kad se ponovno prijaviš. Osoba koja se nakon tebe prijavi na ovom uređaju ne vidi tvoj rad.",
    // 3d-2c, P3 and P4 (a): a copy kept outside the work stays on sign-out.
    logoutCopy: {
      one: "Na ovom uređaju čuva se {n} kopija teksta koja nije u radu.",
      few: "Na ovom uređaju čuvaju se {n} kopije teksta koje nisu u radu.",
      many: "Na ovom uređaju čuva se {n} kopija teksta koje nisu u radu.",
    },
    logoutCopyKept:
      "Odjava kopiju ne briše. Ostaje vezana uz tebe na ovom uređaju i ponovno je vidiš kad se prijaviš.",
    copyTitle: "Kopija teksta",
    copyNewestOnly: "Radnje se odnose na najnoviju kopiju.",
    copyRestore: "Vrati tekst u rad",
    copyDiscard: "Odbaci kopiju",
    copyDiscardAsk: "Odbačena kopija ne može se vratiti. Odbaciti je?",
    copyDiscardConfirm: "Da, odbaci kopiju",
    copyKeep: "Zadrži kopiju",
    copyDiscardFailed: "Kopija nije odbačena i ostaje na ovom uređaju. Pokušaj ponovno.",
    logoutFailed: "Odjava nije dovršena jer poslužitelj nije odgovorio. Ništa nije izbrisano. Provjeri vezu i pokušaj ponovno.",
    signedOutElsewhere:
      "Prijava s kojom je ova kartica otvorena više ne vrijedi: u drugoj kartici provedena je odjava ili nova prijava. Ova kartica više ništa ne prikazuje ni ne sprema. Ponovno učitaj stranicu.",
  },
  // FE-D3 (DAN-222): /prijava, Prijava v5 of the design handoff without the
  // e-mail sign-in and the "Što Ductura čuva" panel (D-09, #476). AAI@EduHr is
  // the one way in; nothing here describes what is recorded (the notice of
  // each assignment does, PRODUCT §5 rule 6).
  prijava: {
    title: "Prijava",
    titleAccent: "u radni prostor",
    lead: `${APP_NAME} je prostor u kojem pišeš seminarske, završne i diplomske radove, a mentor ih prati od prve rečenice do predaje.`,
    motto: `${APP_NAME} ne piše umjesto tebe. Pomaže ti da napišeš svoj rad i pokažeš kako je nastao.`,
    cardTitle: "Za studente i nastavnike",
    cardBody: "Prijavi se korisničkim računom AAI@EduHr, istim kojim se prijavljuješ u Studomat i Merlin.",
    button: "Prijava sustavom AAI@EduHr",
    passwordNote: "Lozinku upisuješ samo kod AAI@EduHr.",
    codeNote: "Kod zadatka od nastavnika upisuješ nakon prijave.",
    help: "Ako prijava ne uspije, javi se koordinatoru na svojoj ustanovi.",
  },
  // #732 item 3: Next.js error and not-found pages in Croatian (D-84).
  errorPage: {
    notFoundTitle: "Stranica ne postoji",
    notFoundBody: "Na ovoj adresi nema stranice. Provjeri adresu ili se vrati na početnu.",
    errorTitle: "Stranicu nije bilo moguće prikazati",
    errorBody: "Dogodila se neočekivana greška. Pokušaj ponovno; ako se ponovi, vrati se na početnu.",
  },
} as const;

type Widen<T> = { readonly [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };

/** The shape every language table has to fill. */
export type Messages = Widen<typeof hr>;

export const messagesHr: Messages = hr;
