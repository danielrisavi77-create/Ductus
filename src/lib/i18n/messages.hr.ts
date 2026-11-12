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
    space: { teacher: "Nastavnički prostor", student: "Studentski prostor", admin: "Administracija ustanove" },
    nav: {
      assignments: "Moji zadaci",
      // DAN-309 (B2): the student's own works across courses, /zadaci/radovi.
      works: "Moji radovi",
      courses: "Moji kolegiji",
      newCourse: "Novi kolegij i zadatak",
      fastPath: "Brz put",
      // DAN-492 (N-16): the works a teacher mentors, outside any course.
      mentoredWorks: "Radovi uz mentora",
      workspace: "Radni prostor",
      enroll: "Upis u kolegij",
      institution: "Pregled ustanove",
      // DAN-581 (A-02): the institution's teachers and their roles, /ustanova/korisnici.
      users: "Korisnici",
      // DAN-591 (A-03): the institution's courses, teams and groups, /ustanova/kolegiji.
      institutionCourses: "Kolegiji",
      // DAN-590 (A-04): the faculty rule versions, /ustanova/pravila.
      facultyRules: "Pravila fakulteta",
    },
    role: { teacher: "Nastavnik", student: "Student", admin: "Administrator" },
    demoNote: "Nijedan stvarni osobni podatak.",
    signOut: "Odjava",
    openNav: "Otvori navigaciju",
    closeNav: "Zatvori navigaciju",
    theme: "Promijeni svijetlu ili tamnu temu",
    breadcrumb: "Put",
    homeCrumb: "Početna",
  },
  home: {
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
    enrollQuestion: "Imate kod novog kolegija?",
    enroll: "Upiši",
  },
  // FE-H1 (#476): public home page for a visitor without a session. Every
  // entry leads to /prijava; sign-in is AAI@EduHr only (D-09). Live view and
  // replay as decided in D-142..D-144 and D-154; one summary for both roles (PRODUCT §5, 5).
  landing: {
    sectionsNav: "Odjeljci početne stranice",
    howItWorksLink: "Kako radi",
    forWhomLink: "Za koga",
    eyebrow: "Dnevnik pisanja · seminarski i završni radovi",
    title: "Rad se vidi",
    titleAccent: "dok nastaje.",
    intro: `Student piše, a nastavnik prati kako rad nastaje i komentira uz odlomke. ${APP_NAME} ne procjenjuje autorstvo ni korištenje AI-ja, a prije početka vidite što nastavnik vidi i od kada.`,
    enter: "Prijavi se i počni",
    aaiOnly: "Prijava isključivo preko AAI@EduHr.",
    previewLabel: "Primjer radnog prostora: list rada i komentar nastavnika, izmišljeni podaci",
    previewSignature: "DUC · 371.3 · rad 07",
    previewTitle: "Gradski promet i održiva mobilnost",
    previewSection: "1. Uvod",
    previewParagraph1:
      "Gradovi sve češće mijenjaju pravila prometa kako bi smanjili gužve i onečišćenje zraka. Ovaj rad prati kako se takve odluke donose na razini grada.",
    previewParagraph2Start: "Istraživačko pitanje glasi: ",
    previewParagraph2Marked: "kako javne politike oblikuju izbor prijevoza",
    previewParagraph2End: " u gradu srednje veličine?",
    previewCommentAuthor: "Komentar nastavnice",
    previewCommentPlace: "uz odlomak 2",
    previewComment: "Dobar smjer. Pitanje suzite na jedan grad i navedite razdoblje koje promatrate.",
    previewNote: "Izmišljeni primjer",
    forWhomTitle: "Dvije uloge, isti prikaz rada.",
    forWhomLead: `Sažetak nastanka rada isti je za studenta i nastavnika. ${APP_NAME} ne ocjenjuje proces pisanja.`,
    studentEyebrow: "Za studente",
    studentTitle: "Pišite u miru i znajte što se vidi.",
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
      "Rad vidite uživo dok student piše i komentirate ga dok se još može doraditi. Nastanak rada možete reproducirati znak po znak, za razgovor sa studentom, ne za ocjenu.",
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
      sidesTitle: "Pišite lijevo. Mentor vidi isto desno.",
      sidesLead:
        "Probni prostor: tekst ostaje u ovom pregledniku i nikamo se ne šalje. U stvarnom radu mentor vidi Vaš rad uživo, uz odlomak s komentarom.",
      studentPane: "Student piše",
      mentorPane: "Mentor vidi",
      editorLabel: "Probni tekst studenta",
      mentorLabel: "Isti tekst u prikazu mentora, samo za čitanje",
      placeholder: "Počnite pisati prvu rečenicu…",
      sampleText: "Gradovi sve češće mijenjaju pravila prometa.",
      sampleComment: "Suzite na jedan grad i navedite razdoblje.",
      sampleCommentPlace: "uz odlomak 1 · mentor (izmišljen)",
      loading: "Učitavam probni prostor…",
    },
    replay: {
      eyebrow: "Premotavanje",
      title: "Vratite se kroz nastanak odlomka.",
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
      lead: "Pogledajte što koja uloga vidi, a što ne vidi. Pravila su ista za sve zadatke.",
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
          a: "Ne. Tekst koji upišete ostaje u ovom pregledniku i nikamo se ne šalje.",
        },
      },
    },
  },
  // F-6 (DAN-35): text of screen 2 of the design handoff (docs/design/ductura).
  teacher: {
    title: "Novi kolegij i zadatak",
    signedOut: "Prijavite se nastavničkim računom.",
    unavailable: "Provjera nastavničke uloge trenutačno nije dostupna. Pokušajte ponovno.",
    signIn: "Prijavi se",
    backHome: "Na početnu",
    backCourses: "Moji kolegiji",
    // DAN-310 (M2.4-P01): a further assignment in a course the teacher already has.
    existingCourse: {
      title: "Novi zadatak u kolegiju",
      link: "Novi zadatak u kolegiju",
      missing: "Kolegij nije dostupan ovom računu.",
      unavailable: "Kolegij trenutačno nije moguće učitati. Pokušajte ponovno.",
      codeKept: "Upisni kod kolegija ostaje isti.",
      studentsNotified: "Studenti upisani u kolegij vide zadatak među svojim zadacima.",
    },
    // DAN-310 (M2.4-P02): a new version of a published assignment.
    workLanguage: {
      heading: "Jezik rada",
      lead: "Jezik na kojem studenti pišu radove ovog zadatka. Sučelje Ducture ostaje na hrvatskom.",
      current: "Sada: {language}.",
      consequence: "Promjena jezika objavljuje verziju {n}. Studenti je potvrđuju prije nastavka pisanja. Već napisan tekst ostaje kakav jest.",
      save: "Promijeni jezik u {language}",
      saveIdle: "Promijeni jezik",
      pending: "Spremanje…",
      saved: "Jezik rada je promijenjen; na snazi je verzija {n}. Učitajte stranicu prije drugih izmjena zadatka.",
      reload: "Učitaj aktualnu verziju",
      errors: {
        invalid: "Jezik nije promijenjen. Odaberite hrvatski ili engleski.",
        unauthorized: "Prijava nije valjana. Prijavite se ponovno; jezik nije promijenjen.",
        forbidden: "Za ovaj račun nije dopuštena promjena jezika ovog zadatka.",
        conflict: "Jezik nije promijenjen. Zadatak je u međuvremenu dobio noviju verziju ili je predaja rada već zatražena, a tada se jezik više ne mijenja. Učitajte aktualnu verziju.",
        unavailable: "Promjena jezika nije potvrđena. Učitajte aktualnu verziju i provjerite jezik prije novog pokušaja.",
      },
    },
    newVersion: {
      title: "Nova verzija zadatka",
      link: "Nova verzija",
      current: "Na snazi je verzija {n}.",
      lead: "Izmjene se objavljuju kao verzija {n}. Verzija koja je sada na snazi ostaje zapisana, a studenti novu verziju potvrđuju prije nastavka pisanja.",
      fixed: "Vrsta rada, profil zapisa i uvoz ostaju kao u verziji na snazi.",
      purposesHint: "Možete samo ukloniti uporabu koju verzija na snazi dopušta, ne i dodati novu.",
      wordsHint: "Raspon se može samo ublažiti: najmanji broj smanjiti ili ukloniti, najveći povećati ili ukloniti.",
      previewHeading: "Što se mijenja",
      before: "Sada",
      after: "Nakon objave",
      empty: "nije zadano",
      noPurposes: "nijedna uporaba",
      consequence: "Objavom nastaje verzija {n}. Studenti upisani u kolegij vide je u obavijesti o zadatku i potvrđuju je prije nastavka pisanja. Već napisan tekst ostaje kakav jest.",
      publish: "Objavi verziju {n}",
      pending: "Objavljivanje…",
      published: "Objavljena je verzija {n}. Studenti je potvrđuju prije nastavka pisanja.",
      unchanged: "Nema promjena u odnosu na verziju na snazi, pa se ništa ne objavljuje.",
      widening: "Ovaj raspon riječi stroži je od onoga na snazi, pa se ne može objaviti. Najmanji broj smanjite ili uklonite, a najveći povećajte ili uklonite.",
      reload: "Učitaj aktualnu verziju",
      missing: "Zadatak nije dostupan ovom računu.",
      unavailable: "Zadatak trenutačno nije moguće učitati. Pokušajte ponovno.",
      fields: {
        title: "Naslov",
        instructions: "Upute studentima",
        opensAt: "Otvaranje",
        dueAt: "Rok",
        aiPurposes: "Dopuštene uporabe",
        wordRange: "Raspon riječi",
      },
      errors: {
        invalid: "Provjerite naslov, otvaranje, rok i raspon riječi. Rok mora biti nakon otvaranja. Ništa nije objavljeno.",
        unauthorized: "Prijava nije valjana. Prijavite se ponovno; ništa nije objavljeno.",
        forbidden: "Za ovaj račun nije dopušteno objavljivanje nove verzije ovog zadatka.",
        conflict: "Zadatak je u međuvremenu dobio noviju verziju. Vaše izmjene nisu objavljene i ostaju u obrascu. Učitajte aktualnu verziju pa ih ponovite.",
        unavailable: "Objava verzije nije potvrđena. Pokušajte ponovno.",
      },
    },
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
      nameMissing: "Upišite naziv kolegija.",
      errors: {
        invalid: "Provjerite naziv, akademsku godinu i pravila kolegija.",
        unauthorized: "Prijava nije valjana. Prijavite se ponovno.",
        forbidden: "Za ovaj račun nije dopušteno stvaranje kolegija.",
        conflict: "Kolegij s tim nazivom već postoji uz druga pravila.",
        unavailable: "Stvaranje kolegija nije potvrđeno. Pokušajte ponovno.",
      },
    },
    // DAN-36 (#576 6362017778): the teacher picks the deadline; there is no default.
    enrollmentCode: {
      validUntil: "Kod vrijedi do",
      expiryHelp: "Obavezno. Odaberite datum i vrijeme do kojih studenti mogu upisati kolegij ovim kodom, najviše godinu dana unaprijed, po zagrebačkom vremenu.",
      selected: "Odabrano:",
      pending: "Izdavanje koda…",
      retry: "Ponovno izdaj kod",
      replace: "Izdaj novi kod",
      shownOnce: "Kod se prikazuje samo sada. Zapišite ga i dajte studentima. Novi kod zamjenjuje ovaj.",
      courseKept: "Kolegij postoji. Ponovni pokušaj izdaje samo kod, ne stvara novi kolegij.",
      errors: {
        missing: "Odaberite do kada kod vrijedi.",
        invalid: "Odaberite datum i vrijeme koji postoje, u budućnosti i najviše godinu dana unaprijed.",
        unauthorized: "Kod nije izdan. Prijava nije valjana. Prijavite se ponovno.",
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
      timesHint: "Otvaranje i rok unose se po zagrebačkom vremenu.",
      instructions: "Upute studentima",
      wordMin: "Najmanji broj riječi (neobvezno)",
      wordMax: "Najveći broj riječi (neobvezno)",
      wordRangeHint: "Upišite cijeli broj od 1 do 1 000 000. Najmanji broj ne smije biti veći od najvećeg.",
      publish: "Objavi zadatak",
      pending: "Objavljivanje…",
      published: "Objavljeno",
      publishedNotice: "Zadatak je objavljen. Studenti s kodom vide obavijest prije prve rečenice.",
      needCourse: "Prvo stvorite kolegij.",
      studentsNotified: "Studenti dobivaju obavijest kad upišu kolegij.",
      newVersion: "Izmjena zadatka nakon objave stvara novu verziju; studenti je ponovno potvrđuju.",
      errors: {
        invalid: "Provjerite naslov, vrstu rada, otvaranje, rok i raspon riječi. Rok mora biti nakon otvaranja.",
        unauthorized: "Prijava nije valjana. Prijavite se ponovno.",
        forbidden: "Za ovaj račun nije dopušteno objavljivanje zadatka u ovom kolegiju.",
        conflict: "Zadatak s istim ključem već postoji uz druge podatke. Provjerite zadatak i objavite ponovno.",
        unavailable: "Objava zadatka nije potvrđena. Pokušajte ponovno.",
      },
    },
    // Verbatim text of the FPZG Smjernice, čl. 8 (owner decision on #87,
    // 6236852400; text from #314, 6236916582). Words and punctuation are not
    // edited, except the two places marked below. The keys of `purposes` are
    // the database list (D-80).
    tools: {
      heading: "Uporaba alata (FPZG Smjernice, čl. 8)",
      narrowOnly: "Popis možete samo suziti.",
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
  // DAN-313 (A-01): counts only, for the administrator's own institution;
  // never a person, a course name or an activity time.
  institutionOverview: {
    title: "Pregled ustanove",
    lead: "Brojke vrijede samo za vašu ustanovu i računaju se pri otvaranju stranice. Pojedine osobe i kolegiji ovdje se ne prikazuju.",
    unnamed: "Naziv ustanove nije upisan",
    countsLabel: "Brojke ustanove",
    counts: {
      confirmedTeachers: {
        label: "Potvrđeni nastavnici",
        note: "Uloga je potvrđena i nije opozvana.",
      },
      teacherCandidates: {
        label: "Čekaju potvrdu uloge",
        note: "Zadnja prijava preko AAI@EduHr dala je pravo nastavnika, a ulogu još niste potvrdili.",
      },
      teachersWithoutAffiliation: {
        label: "Nastavnici bez prava pri zadnjoj prijavi",
        note: "Uloga ostaje potvrđena; samo zadnja prijava nije dala pravo nastavnika.",
      },
      courses: { label: "Kolegiji", note: "Svi kolegiji ustanove." },
      students: { label: "Studenti", note: "Upisani u barem jedan kolegij, svaka osoba jednom." },
    },
    unavailable: "Pregled ustanove trenutačno nije dostupan. Pokušajte ponovno.",
    retry: "Pokušaj ponovno",
  },
  // DAN-581 (A-02, docs/design/ductura/m2-reference): the administrator
  // confirms and revokes the teacher role. "Za pregled" is D-200 P7: a lost
  // right at sign-in does not revoke the role. Names stay in the nominative
  // on their own line ("Osoba"), since a name cannot be declined reliably.
  teacherRoles: {
    title: "Korisnici i uloge",
    lead: "Nastavnici vaše ustanove i osobe koje čekaju potvrdu uloge. Ulogu nastavnika potvrđujete i opozivate vi; prijava preko AAI@EduHr daje samo pravo da vas osoba čeka na popisu.",
    person: "Osoba",
    // A person whose name the identity provider has not given (identity.person_name has no row).
    unnamed: "Ime nije upisano",
    pending: {
      heading: "Čekaju potvrdu uloge",
      note: "Zadnja prijava preko AAI@EduHr dala im je pravo nastavnika. Uloga počinje tek kad je potvrdite.",
      empty: "Nitko ne čeka potvrdu uloge.",
      emptyNote: "Osoba se pojavi ovdje nakon prijave preko AAI@EduHr koja joj da pravo nastavnika na ovoj ustanovi.",
      revokedOn: "uloga opozvana",
    },
    confirmed: {
      heading: "Potvrđeni nastavnici",
      empty: "Na ustanovi još nema potvrđenih nastavnika.",
      confirmedOn: "Potvrđeno",
    },
    review: {
      mark: "Za pregled",
      note: "Zadnja prijava nije dala pravo nastavnika. Uloga nije opozvana i ostaje dok ne odlučite.",
    },
    confirmAction: "Potvrdi ulogu",
    revokeAction: "Opozovi ulogu",
    cancel: "Odustani",
    close: "Zatvori",
    check: "Provjeri stanje",
    confirmDialog: {
      label: "Potvrda uloge",
      title: "Potvrditi ulogu nastavnika?",
      points: [
        "Moći će stvarati kolegije i zadatke na ovoj ustanovi.",
        "Ulogu možete kasnije opozvati.",
        "Potvrda se upisuje u revizijski trag, s vama kao izvršiteljem.",
      ],
    },
    revokeDialog: {
      label: "Opoziv uloge",
      title: "Opozvati ulogu nastavnika?",
      points: [
        "Od sljedećeg zahtjeva više ne može raditi kao nastavnik na ovoj ustanovi.",
        "Kolegiji i zadaci ostaju. Ako je nositelj kolegija, ostaje upisan kao nositelj dok ga nastavnik tog kolegija ne zamijeni.",
        "Ako mu kasnija prijava da pravo nastavnika, ponovno će čekati vašu potvrdu.",
        "Opoziv se upisuje u revizijski trag, s vama kao izvršiteljem.",
      ],
    },
    // One line per outcome of teacher-role-action.ts; "unknown" never claims either way.
    outcome: {
      confirmed: "Uloga nastavnika je potvrđena. Osoba je sada među potvrđenim nastavnicima.",
      revoked: "Uloga nastavnika je opozvana.",
      notCandidate: "Potvrda nije moguća. Ova osoba više ne čeka potvrdu na vašoj ustanovi. Popis je osvježen.",
      notConfirmed: "Opoziv nije potreban. Ova osoba više nema potvrđenu ulogu na vašoj ustanovi. Popis je osvježen.",
      unknownConfirm: "Ishod nije poznat. Veza s poslužiteljem prekinula se prije odgovora, pa nije sigurno je li uloga potvrđena. Provjerite stanje prije nego što pokušate ponovno.",
      unknownRevoke: "Ishod nije poznat. Veza s poslužiteljem prekinula se prije odgovora, pa nije sigurno je li uloga opozvana. Provjerite stanje prije nego što pokušate ponovno.",
      ended: "Radnja nije provedena. Prijava je istekla ili više nemate ovlast za ovu stranicu. Stranica je osvježena.",
      invalid: "Radnja nije provedena. Osvježite stranicu i pokušajte ponovno.",
    },
    unavailable: "Popis korisnika trenutačno nije dostupan. Pokušajte ponovno.",
    retry: "Pokušaj ponovno",
  },
  teacherCourses: {
    title: "Moji kolegiji",
    lead: "Kolegiji u kojima predajete i njihovi zadaci. Poredak: akademska godina, pa naziv; zadaci po roku.",
    newCourse: "Novi kolegij i zadatak",
    empty: "Nemate kolegija u kojima predajete.",
    emptyLead: "Stvorite kolegij i objavite prvi zadatak.",
    noAssignments: "Još nema zadataka.",
    unavailable: "Kolegiji trenutačno nisu dostupni. Pokušajte ponovno.",
    retry: "Pokušaj ponovno",
    due: "rok",
    at: "u",
    students: { one: "student", few: "studenta", many: "studenata" },
    countNote: "Broj studenata služi samo za pregled; po njemu se ništa ne poreda.",
    // F2 (#711): links to the students' works; numbered, since names arrive with B-11.
    worksLabel: "Radovi studenata",
    work: "Rad",
    noWorks: "Nijedan student još nije otvorio rad.",
    worksUnavailable: "Radovi trenutačno nisu dostupni. Pokušajte ponovno.",
    // DAN-332 PR 4 (#826 c.6427128741): the state of each work's submission, as text only, never a colour (D-128).
    submission: {
      onTime: "Predano",
      afterDeadline: "Predano nakon roka",
      none: "Nije predano",
    },
    // DAN-380 (M2.9-P02): only that the work is marked, never why (D-50, PRODUCT §5).
    accommodation: "Odobrena prilagodba",
    accommodationsUnavailable: "Oznake odobrene prilagodbe trenutačno nisu dostupne. Pokušajte ponovno.",
  },
  // DAN-492 (M2.6-P02, N-16), design pregled-radova-v2: only what the read gives (D-202).
  mentoredWorks: {
    title: "Radovi uz mentora",
    lead: "Završni, diplomski i drugi radovi kojima ste mentor. Prikaz samo čita; ništa ne mijenja.",
    listTitle: "Radovi · abecedno",
    orderNote: "Popis se ne može poredati po brojevima.",
    empty: "Nemate otvorenih mentorstava.",
    unavailable: "Radovi trenutačno nisu dostupni. Pokušajte ponovno.",
    retry: "Pokušaj ponovno",
    unnamed: "Ime nije dostupno",
    open: "Otvori rad",
    // The state as text only, never a colour (D-128).
    state: {
      not_started: "Student još nije započeo rad.",
      in_progress: "U pisanju",
      submitted: "Predano",
    },
  },
  fastPath: {
    title: "Brz put",
    intro: "Radovi jednog zadatka, jedan za drugim. Prikaz samo čita; ništa ne mijenja.",
    loading: "Učitavanje radova…",
    unavailable: "Radovi trenutačno nisu dostupni. Pokušajte ponovno.",
    // F-11 (#757, contract c.6397637802 §3; owner c.6397679688).
    pickAssignment: "Odaberite zadatak u svojim kolegijima.",
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
    teacherViewLead: "Ovako nastavnik vidi Vaš rad: zadnji tekst koji je Vaš preglednik poslao, komentare i sažetak procesa. Ovdje se ne piše.",
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
    // DAN-343 (contract on #866): the "Literatura" tab, design editor-v11 "Brzi izvor".
    sources: {
      add: "+ Izvor",
      formTitle: "Novi izvor",
      type: "Vrsta izvora",
      book: "Knjiga",
      article: "Članak u časopisu",
      family: "Prezime autora",
      given: "Ime autora",
      secondAuthor: "Drugi autor (neobavezno)",
      family2: "Prezime drugog autora",
      given2: "Ime drugog autora",
      year: "Godina",
      title: "Naslov",
      place: "Mjesto izdanja",
      publisher: "Izdavač",
      journal: "Časopis",
      volume: "Godište",
      issue: "Broj",
      pages: "Stranice",
      citePage: "Stranica navoda (neobavezno)",
      preview: "Ovako će biti upisano",
      addAndCite: "Dodaj i citiraj",
      addOnly: "Samo u Literaturu",
      cancel: "Odustani",
      cite: "Citiraj",
      listTitle: "Izvori dodani u ovom radu",
      empty: "Dodaj izvor; navod i unos u popisu literature upisuju se u stilu FPZG-a.",
      required: "Upiši: {field}.",
      yearInvalid: "Godina ima četiri znamenke.",
      tooLong: "{field} ima najviše {n} znakova.",
      pageTooLong: "Stranica navoda ima najviše {n} znakova.",
      unstorable: "{field} sadrži znak koji list ne prima; upiši polje ponovno.",
      pageUnstorable: "Stranica navoda sadrži znak koji list ne prima; upiši je ponovno.",
      readOnly: "List je samo za čitanje; izvori se ne mogu dodati.",
    },
    instructionsEmpty: "Upute zadatka prikazuju se ovdje.",
    commentsEmpty: "Komentari nastavnika prikazuju se ovdje.",
    // FE-D9 (06c): "Upute" and "Rad" of the right panel, design editor-v11 §5.1.
    tabWork: "Rad",
    workEmpty: "Etape i prilozi rada prikazuju se ovdje.",
    panelLoading: "Učitavanje…",
    panelUnavailable: "Sadržaj trenutačno nije moguće učitati. Osvježite stranicu.",
    upute: {
      task: "Zadatak",
      due: "Rok: {date} u {time}",
      toolsAllowed: "Dopuštena uporaba alata (FPZG Smjernice, čl. 8)",
      toolsNone: "U ovom zadatku uporaba alata generativne umjetne inteligencije nije dopuštena.",
      checks: "Provjera oblika · FPZG",
      checksNote: "Provjera pomaže; ništa ne blokira predaju.",
      // M2.10-P02 (DAN-386): the language of the student's work, not of the interface.
      workLanguage: "Jezik rada: {language}",
      workLanguages: { hr: "hrvatski", en: "engleski" },
      // M4 (DAN-506): S-11 "Upute i provjera oblika", states 1a-6 of the
      // approved reference (docs/design/ductura/m4-reference). Not rendered yet.
      shape: {
        title: "Upute i provjera oblika",
        loading: "Učitavam pravila za ovu vrstu rada.",
        loadFailed: "Pravila se trenutačno ne mogu učitati. Rad i dalje možete pisati i predati.",
        retry: "Pokušaj ponovno",
        disabled: "Provjera oblika trenutačno nije uključena na ovoj ustanovi. Predaja nije zbog toga ograničena.",
        disabledCause: "Uzrok vidi samo administrator, na zaslonu Pravila fakulteta.",
        checkedSummary: "Provjereno pravila: {count}, verzija paketa {version} · provjereno u {time}",
        findingsHeading: "Odstupanja od pravila",
        goTo: "Idi na: {place}",
        source: "Izvor: {source}",
        notChecked: "nije provjereno",
        staleHeader: "Provjereno u {time}, paket {version}",
        staleNote: "Dokument je promijenjen nakon provjere. Raniji nalazi ostaju vidljivi dok ne provjerite ponovno.",
        staleLabel: "Zastarjelo, dokument je promijenjen",
        recheck: "Provjeri ponovno",
        newerPackage: "Dostupna je verzija paketa {newer}. Ovaj rad i dalje koristi verziju {version}.",
        unavailable: "Provjera oblika za ovu vrstu rada nije dostupna.",
        officialRules: "Pravila pročitajte u službenom dokumentu:",
        partialCovered: "Za ovu vrstu rada paket pokriva ova pravila:",
        partialOthers: "Ostala pravila pročitajte u službenom dokumentu:",
        typeUnknown: "Vrsta rada još nije određena, pa nije poznato koja pravila vrijede.",
        scopeHeading: "Opseg: {min} do {max} riječi",
        scopeNarrowed: "Nastavnik je suzio unutar raspona {min} do {max} iz paketa.",
        scopeNow: "U radu sada:",
        scopeWords: "{count} riječi",
        scopeCounting: "Broje se riječi teksta rada, bez sažetka, popisa literature i priloga.",
        informative: "Informativno. Ne utječe na predaju.",
      },
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
    freeNote: "Ovaj tekst nije vezan uz zadatak i ne predaje se. Zadatak otvarate s njegove obavijesti.",
    unavailable: "Ovaj zadatak nije dostupan ovom računu.",
    // DAN-330: the work starts only on the student's click.
    startWork: "Započni rad",
    notStarted: "Rad još nije započet.",
    openLoading: "Otvaram rad…",
    openNotYet: "Zadatak se otvara {time}.",
    openOffline: "Za prvo otvaranje rada potrebna je veza.",
    openError: "Rad trenutačno nije moguće otvoriti.",
    openRetry: "Pokušaj ponovno",
    openNotAccepting: "Obavijest zadatka se promijenila ili zadatak trenutačno ne prima rad.",
    openNoticeLink: "Otvori obavijest zadatka",
    openReload: "Ova verzija stranice više ne može otvoriti rad. Učitajte je ponovno.",
    openReloadButton: "Učitaj ponovno",
    lateNote: "Rok zadatka je prošao. Pisati možete i dalje, a predaja će biti označena kao predaja nakon roka.",
    // #711 F1b (contract §4): the earlier draft of this device, offered only to read and copy.
    earlierDraftSummary: "Na ovom uređaju čuva se Vaš raniji tekst koji nije u ovom radu.",
    // Owner (#711, O3 and amendment c): since 3d-2c2b a paste is an evidence step of the work, so the sentence that says so is back.
    earlierDraftExplain: "Tekst ostaje gdje je i ne briše se. Ako ga želite u ovom radu, kopirajte ga i zalijepite; zapis rada tada to bilježi kao lijepljenje.",
    earlierDraftCopy: "Kopiraj tekst",
    // Owner accepted (#711 c.6396392080, b): the contract text "Kopirano u međuspremnik." fails the stem list of messages.test.ts (kopiran).
    earlierDraftCopied: "Tekst je u međuspremniku.",
    // Owner accepted (#711 c.6396392080, a): the contract text "Tekst nije moguće kopirati." is a forbidden term (kopir-, PRODUCT §5).
    earlierDraftCopyFailed: "Tekst nije moguće staviti u međuspremnik. Izvezite ga kao datoteku.",
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
    placeholder: "Počnite pisati…",
    // 3d-2c2b, owner approved 25 Oct (contract #476 c.6391714810 §3): the
    // server's work differs (CONFLICT, RECOVERY_REQUIRED).
    evidenceConflict:
      "Rad na poslužitelju razlikuje se od teksta na ovom uređaju. Tekst ostaje na uređaju i ništa se ne šalje dok ne odlučite kako dalje.",
    // 3d-2c2b, owner approved 25 Oct (#87 c.6397773534): a send refused for
    // good. The contract's "spremljen na ovom uređaju" fails the PRODUCT §5
    // scan, so "ovom" is dropped.
    sendRefused: "Tekst je spremljen na uređaju, ali ga poslužitelj nije primio. Ponovno učitajte stranicu.",
    // DAN-699 (#1876): the recorder stopped, so later changes stay only on
    // the device. Export keeps them; a reload does not resume sending. It
    // names no finished save: it shows while typing too (review c.6786923958).
    sendStopped:
      "Slanje na poslužitelj je zaustavljeno. Poslužitelj ne prima nove izmjene. Izvezite tekst i javite se podršci.",
    // Shown under the stop notice only once the local save has finished.
    sendStoppedSaved: "Tekst je spremljen na uređaju.",
    // 3d-2c2b, owner approved 25 Oct: the package was closed by the submission (DAN-289 A1).
    submittedReadOnly:
      "Rad je predan, pa se ovdje više ne može pisati. Izmjene napravljene nakon predaje nisu u predanom radu i ostaju samo na ovom uređaju.",
    blockedHint: "Ova kartica ništa ne sprema dok je druga otvorena. Kad je zatvorite, tekst se ovdje ponovno učitava.",
    failureQuota: "Na uređaju nema dovoljno prostora, pa se promjene više ne spremaju. Izvezite tekst da ga ne izgubite.",
    failureUnavailable: "Spremanje na ovom uređaju nije dostupno. Izvezite tekst da ga ne izgubite.",
    failureLimit: "Lokalni zapis je dosegao granicu, pa se promjene više ne spremaju. Izvezite tekst da ga ne izgubite.",
    failureStale: "Dokument je u međuvremenu promijenjen na drugom mjestu, pa ova kartica više ne sprema. Izvezite tekst, zatim ponovno učitajte stranicu.",
    failureUnknown: "Spremanje nije uspjelo. Izvezite tekst da ga ne izgubite.",
    failureInvalid: "Ovaj tekst nije moguće spremiti. Izvezite ga da ga ne izgubite.",
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
    signedOut: "Prijava je istekla. Prijavite se ponovno da vidite komentare.",
    refresh: "Osvježi komentare",
    number: "Komentar {n}",
    teacher: "Nastavnik",
    student: "Student",
    own: "Vi",
    state: { open: "otvoreno", answered: "odgovoreno", resolved: "riješeno" },
    showInText: "Pokaži u tekstu",
    notPlaced: "Mjesto u tekstu nije moguće pouzdano pronaći. Komentar ostaje ovdje.",
    replyLabel: "Odgovor",
    replyPlaceholder: "Odgovor…",
    reply: "Odgovori",
    replying: "Slanje…",
    resolvedNote: "Nastavnik je označio komentar riješenim.",
    replyErrors: {
      signedOut: "Prijava je istekla. Prijavite se ponovno.",
      forbidden: "Ovaj račun ne može odgovoriti na ovaj komentar.",
      conflict: "Komentar je u međuvremenu označen riješenim.",
      invalid: "Odgovor nije prihvaćen. Napišite od 1 do 2000 znakova.",
      unavailable: "Odgovor nije poslan. Pokušajte ponovno.",
    },
  },
  revisions: {
    title: "Zahtjevi za doradu",
    loading: "Učitavanje zahtjeva za doradu…",
    empty: "Nema zahtjeva za doradu.",
    notAvailable: "Zahtjevi za doradu za ovaj rad nisu dostupni.",
    unavailable: "Zahtjeve za doradu trenutačno nije moguće učitati.",
    retry: "Pokušaj ponovno",
    refresh: "Osvježi zahtjeve za doradu",
    signedOut: "Prijava je istekla. Prijavite se ponovno da vidite zahtjeve za doradu.",
    number: "Zahtjev za doradu {n}",
    teacher: "Nastavnik zadatka",
    student: "Student",
    own: "Vi",
    state: {
      open: "Otvoren",
      done: "Student navodi da je proveden",
      declined: "Student ne pristaje",
      accepted: "Prihvaćen",
      reopened: "Ponovno otvoren",
      withdrawn: "Povučen",
    },
    // {date} is formatDateHr, whose year already ends with a period.
    acceptedMeta: "Prihvaćeno {date} Zahtjev je zatvoren.",
    withdrawnMeta: "Povučeno {date} Zahtjev je zatvoren.",
    explanationLabel: "Obrazloženje",
    explanationHint: "Napišite što ste promijenili ili zašto ne pristajete, do 2000 znakova.",
    done: "Navedi da je provedeno",
    declined: "Ne pristajem, uz obrazloženje",
    sending: "Slanje…",
    sent: "Odgovor je poslan.",
    submittedNote: "Rad je predan. Na zahtjev se više ne odgovara.",
    // DAN-314: the answer names the server's current revision, which lacks changes still on the device.
    // DAN-314, c.6779628877: in ERROR, CONFLICT and RECOVERY_REQUIRED the buttons stay off, so say what to do.
    unconfirmedNote:
      "Odgovor se može poslati kad poslužitelj primi sve izmjene teksta. Ako je uz tekst javljena greška ili sukob, najprije postupite prema toj obavijesti; upisano objašnjenje ostaje ovdje.",
    keptLabel: "Neposlano obrazloženje",
    keptHint: "Ovo obrazloženje nije poslano jer se na zahtjev više ne odgovara. Kopirajte ga ako ga želite sačuvati.",
    keptForLabel: "Neposlano obrazloženje za zahtjev za doradu {n}",
    keptUnloadedHint: "Ovo obrazloženje nije poslano, a zahtjevi se trenutačno ne mogu učitati. Kopirajte ga ako ga želite sačuvati.",
    errors: {
      signedOut: "Prijava je istekla. Prijavite se ponovno.",
      forbidden: "Ovaj račun ne može odgovoriti na ovaj zahtjev.",
      conflict: "Zahtjev se u međuvremenu promijenio. Prikazano je trenutačno stanje.",
      invalid: "Odgovor nije prihvaćen. Napišite od 1 do 2000 znakova.",
      unavailable: "Odgovor nije poslan. Pokušajte ponovno.",
      unconfirmed: "Odgovor nije poslan jer poslužitelj još nije primio sve izmjene teksta.",
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
    signInFirst: "Prijavite se da vidite rad.",
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
    signedOut: "Prijava je istekla. Prijavite se ponovno da vidite sažetak.",
    notFound: "Sažetak ovog rada nije dostupan ovom računu.",
    unavailable: "Sažetak trenutačno nije dostupan. Pokušajte ponovno.",
    refresh: "Osvježi sažetak",
  },
  // F-10 (#476 contract 6384297464): the student's submission, Ductura screen 4.
  submission: {
    title: "Predaja rada",
    invalid: "Ova poveznica ne vodi do zadatka.",
    signedOut: "Prijavite se da predate rad.",
    signIn: "Prijavi se",
    backToWork: "Natrag na rad",
    notStarted: "Rad još nije započet. Započni ga u radnom prostoru.",
    steps: { check: "1 Provjera zapisa", submit: "2 Predaja", receipt: "3 Potvrda" },
    loading: "Učitavanje teksta s poslužitelja…",
    textTitle: "Ovo je tekst koji predajete.",
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
      staleRevision: "Na poslužitelju je novija verzija teksta. Učitajte je ponovno prije predaje.",
      alreadyRequested: "Predaja je već zatražena za drugu verziju teksta.",
      notOpen: "Predaja za ovaj zadatak trenutačno nije otvorena.",
      notFound: "Rad nije dostupan ovom računu.",
      signedOut: "Prijava je istekla. Prijavite se ponovno.",
      // No receipt came back: the server may have recorded the submission or not (Codex 4367324506).
      unavailable: "Potvrda nije stigla, pa ishod predaje nije poznat. Pokušajte ponovno.",
    },
    openUnavailable: "Rad trenutačno nije moguće učitati s poslužitelja. Pokušajte ponovno.",
    // DAN-699 (#1876): text of this work on this device that the server does not have.
    device: {
      checking: "Provjera ima li na ovom uređaju izmjena koje poslužitelj još nema…",
      held: "Na ovom uređaju ima izmjena ovog rada koje poslužitelj još nema. Predaja nije moguća dok ne stignu na poslužitelj. Vratite se na rad i provjerite stanje spremanja.",
      unknown: "Nije moguće provjeriti ima li na ovom uređaju izmjena koje poslužitelj još nema. Predaja nije moguća dok se to ne provjeri. Pokušajte ponovno.",
      recheck: "Provjeri ponovno",
    },
  },
  teacherComments: {
    hint: "Označite tekst u radu za komentar.",
    empty: "Nema komentara. Označite tekst u radu.",
    newTitle: "Novi komentar",
    bodyLabel: "Tekst komentara",
    publish: "Objavi",
    publishing: "Objavljivanje…",
    cancel: "Odustani",
    resolve: "Označi riješenim",
    reopen: "Ponovno otvori",
    errors: {
      signedOut: "Prijava je istekla. Prijavite se ponovno.",
      forbidden: "Ovaj račun ne može komentirati ovaj rad.",
      invalid: "Komentar nije prihvaćen. Napišite od 1 do 2000 znakova.",
      unavailable: "Komentar nije objavljen. Pokušajte ponovno.",
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
  // in this assignment. D-63 as corrected on 31. 10. 2026. (#87 c.6544361788,
  // PRODUCT §5 rule 4 exception): the replay neither skips nor marks pauses.
  // The notice names the P-01 sessions as the one measure taken from time.
  // recorded.live also names the input mark the mentor sees (D-54, D-127,
  // src/editor/source.ts).
  student: {
    title: "Zadatak",
    // DAN-344 (Archivum S03): the way back from the notice to /zadaci, verbatim from the package.
    backToAssignments: "Moji kolegiji i zadaci",
    // #711 contract 6404612273: the student's own courses and assignments.
    assignments: {
      title: "Moji zadaci",
      heading: "Moji zadaci",
      signedOut: "Prijavite se da vidite svoje zadatke.",
      unavailable: "Popis trenutačno nije dostupan.",
      empty: "Zasad niste upisani ni u jedan kolegij.",
      enroll: "Upiši kolegij kodom",
      noAssignments: "U ovom kolegiju zasad nema zadatka.",
      due: "Rok {time}",
      noticeFirst: "Prvo pročitajte obavijest",
    },
    // DAN-309 (M2.3-P02, B2): "Moji radovi" on /zadaci/radovi. Each state is
    // told only from what the server read returned; nothing about the text.
    works: {
      title: "Moji radovi",
      lede: "Vaši radovi na svim kolegijima i njihovo stanje.",
      search: "Traži po naslovu ili kolegiju",
      year: "Akademska godina",
      allYears: "Sve godine",
      apply: "Prikaži",
      reset: "Poništi odabir",
      noMatch: "Nijedan rad ne odgovara odabiru.",
      emptyHeading: "Još nemate radova.",
      emptyBody: "Radovi se ovdje prikazuju kad se upišete u kolegij sa zadatkom.",
      enroll: "Upiši kolegij kodom",
      list: "Popis radova",
      due: "Rok {time}",
      state: {
        newVersion: "Nova verzija uputa ({version}), još nije potvrđena",
        notice: "Upute još nisu potvrđene",
        notStarted: "Rad nije započet",
        inProgress: "Rad je započet, nije predan",
        submitted: "Predano {time}",
        afterDeadline: "Predano {time}, nakon roka",
      },
      readNotice: "Pročitaj upute",
      start: "Otvori zadatak",
      open: "Otvori rad",
    },
    // DAN-344: the Archivum S01 texts of /zadaci, verbatim from the owner's
    // package (26. 10. 2026.), in "Vi"; the subtitle without its mentoring
    // half, which this page does not have. Only what the own-assignments read
    // returns: courses, assignment titles, due times and the notice state.
    home: {
      heading: "Vaš studentski prostor",
      lede: "Zadaci na kolegijima.",
      courses: "Moji kolegiji",
      // S02 subtitle: chosen by the orchestrator (Daniel left it to them, 26. 10. 2026.),
      // not the PNG's, because the student has no course page to open.
      coursesLede: "Kolegiji na koje ste upisani i njihovi zadaci.",
      courseLabel: "Kolegij",
      due: "Rok: {time}",
      open: "Otvori zadatak",
      readNotice: "Pročitaj upute",
      unavailableHeading: "Prikaz trenutačno nije dostupan.",
      unavailableBody: "Podatke nije bilo moguće učitati. To ne znači da nema kolegija ili radova.",
      // S01_prazna: the first arrival, verbatim from the package's PNG.
      empty: {
        heading: "Još nemate kolegija.",
        body: "Ovdje će se prikazati vaši kolegiji i njihovi zadaci.",
        codeHeading: "Imate kod kolegija?",
        nextHeading: "Što slijedi nakon upisa?",
        steps: [
          { title: "Odaberite zadatak", body: "U svakom kolegiju nastavnik vam dodjeljuje zadatke." },
          { title: "Pročitajte upute", body: "Svaki zadatak dolazi s jasnim uputama i očekivanjima." },
          { title: "Otvorite rad", body: "Nakon što ste spremni, započinjete pisanje u uređivaču." },
        ],
      },
    },
    signedOut: "Prijavite se da vidite zadatak.",
    signIn: "Prijavi se",
    enroll: {
      title: "Upis u kolegij",
      heading: "Upiši kolegij",
      signedOut: "Prijavite se da upišete kolegij.",
      label: "Kod kolegija",
      hint: "Kod Vam daje nastavnik. Razmaci, crtice i velika ili mala slova nisu bitni.",
      submit: "Upiši",
      sending: "Upisivanje…",
      opening: "Upisani ste u kolegij. Otvaram obavijest zadatka…",
      errors: {
        malformed: "Kod ima od 8 do 32 slova i brojke. Provjerite ga i upišite ponovno.",
        refused: "Kod ne postoji ili je istekao. Provjerite ga s nastavnikom.",
        tooManyAttempts: "Previše pokušaja. Pokušajte ponovno kasnije.",
        unauthorized: "Prijava nije valjana. Prijavite se ponovno.",
        forbidden: "Ovaj račun ne može upisati kolegij.",
        invalid: "Upis nije prihvaćen. Ponovno učitajte stranicu.",
        unavailable: "Upis trenutačno nije moguć. Pokušajte ponovno.",
        offline: "Nema veze s poslužiteljem. Provjerite mrežu i pokušajte ponovno.",
      },
      course: {
        none: "Upisani ste u kolegij, ali u njemu zasad nema otvorenog zadatka. Kad ga nastavnik objavi, vratite se na ovu stranicu.",
        notFound: "Ovaj kolegij nije dostupan ovom računu. Upišite ga kodom koji Vam daje nastavnik.",
        unavailable: "Zadatke kolegija trenutačno nije moguće učitati. Pokušajte ponovno.",
        retry: "Pokušaj ponovno",
        another: "Upiši drugi kolegij",
      },
    },
    notFound: "Ovaj zadatak nije dostupan ovom računu. Upišite kolegij kodom koji Vam daje nastavnik.",
    unavailable: "Zadatak trenutačno nije moguće učitati. Pokušajte ponovno.",
    // FE-D8 (#476 row 05): the states around the notice; the notice text itself is unchanged.
    loading: "Učitavanje zadatka…",
    notOpen: "Zadatak se otvara {time}. Obavijest potvrđujete kad se zadatak otvori.",
    pastDue: "Rok zadatka je prošao {time}.",
    // DAN-344 (Archivum S03-a, #923 c.6545848868): the header verbatim from
    // S03_upute.png; "otvoreno od" is gone (owner, c.6435071376 point 2).
    step: "Prije pisanja",
    courseEyebrow: "Kolegij",
    dueAt: "Rok: {time}",
    toolsHeading: "Uporaba alata u ovom zadatku (FPZG čl. 8)",
    noTools: "U ovom zadatku uporaba alata generativne umjetne inteligencije nije dopuštena.",
    recordedHeading: "Što se bilježi",
    recorded: {
      steps: "Promjene teksta, sažete u odsječke od najviše 30 sekundi. Odsječak nosi jedno vrijeme, zaokruženo na minutu.",
      live: "U ovom zadatku bilježit će se svaka promjena teksta, znak po znak, s redoslijedom i vremenom: unos i brisanje, lijepljenje, uvoz, prijenos iz AI pomoćnika i izmjene nastavnika. Uz svaku promjenu bilježit će se i način unosa, pa će nastavnik (mentor) vidjeti oznaku kad uređivač uz unos nije vidio pritisak tipke ni lijepljenje, na primjer kod diktiranja, nekih tipkovnica na mobitelu ili pomoćnih alata. Oznaka govori samo kako je tekst ušao u uređivač, ne tko ga je napisao. To će služiti samo prikazu uživo i reprodukciji.",
      chain: "Svaki korak spremanja dobiva digitalni otisak povezan s prethodnim, pa se svaka kasnija izmjena zapisa vidi.",
      versions: "Verzije, predaja i napomene koje dodate.",
    },
    notRecordedHeading: "Što se ne bilježi",
    notRecorded: {
      inputs: "Koja je tipka pritisnuta i koliko je držana. Iz vremena promjena ne računaju se brzina, ritam ni bilo kakva mjera, osim sesija: sesije se određuju prekidom dužim od praga P-01. Reprodukcija neće preskakati ni isticati stanke.",
      outside: "Druge aplikacije i kartice preglednika, kamera, mikrofon i zaslon.",
      device: "IP adresa i podaci o uređaju.",
    },
    teacherHeading: "Što vidi nastavnik (mentor)",
    teacher: {
      state: "Od prvog dana pratit će Vaš rad uživo, dok nastaje, pa i tekst koji ćete kasnije možda obrisati. Ono što napišete bez mreže vidjet će tek kad se veza vrati.",
      // D-154, PRODUCT §5 rules 5 and 7: the student sees the same replay of their own work.
      replay: "Nastavnik (mentor) zadatka moći će reproducirati nastanak rada znak po znak, pa i obrisani tekst. Istu reprodukciju svog rada vidjet ćete i Vi.",
      purpose: "Prikaz uživo i reprodukcija služit će praćenju nastanka rada i komentarima, nikad ocjeni ni rangiranju.",
      history: "Povijest verzija i sažetak procesa, isti kao što ga vidite Vi.",
      // DAN-235 (D-130, PRODUCT §5 rules 5 and 17): the mentor's working records by kind.
      // Rubric, report draft and grade publication are conditional (D-135, D-136): stated as unavailable, never promised.
      workingNotes: `Mentor (nastavnik zadatka) moći će voditi i radne zapise o Vašem radu: oznaku zadnjeg pregleda s vremenom, privatne bilješke i predloške komentara. Oni nisu prikaz rada: nećete ih vidjeti u aplikaciji, ali ćete ih moći zatražiti pravom pristupa. U njima nema mjera ni zaključaka koje je izračunala ${APP_NAME}. Ne ulaze u sažetak, izvoz ni predaju, brišu se kad i rad i ne smiju utjecati na kašnjenje ni ocjenu. Rubrika i nacrt izvješća također bi bili radni zapisi, ali se u Ducturi zasad ne vode. Ni objava ocjene u Ducturi zasad nije dostupna.`,
      noVerdict: `${APP_NAME} ne procjenjuje autorstvo ni korištenje AI-ja.`,
    },
    // D-05, PRODUCT §6 "Profili evidencije": only for the extended profile.
    teacherExtended: "Usporedbu verzija na kraju sesija i poslanih verzija.",
    retention: "Zapis se čuva uz rad do isteka roka koji propisuje fakultet.",
    note: "Prije konačne predaje uz rad možete dodati napomenu. Napomene se samo dodaju.",
    checkbox: "Pročitao/la sam obavijest. Znam što se bilježi i što vidi nastavnik (mentor).",
    confirm: "Potvrdi i otvori editor",
    confirming: "Potvrđivanje…",
    notConsent: "Potvrda nije privola. Prije potvrde ništa se ne šalje na poslužitelj.",
    confirmed: "Potvrđeno {time}. Zapis počinje s prvom izmjenom.",
    openEditor: "Otvori editor",
    errors: {
      stale: "Nastavnik je u međuvremenu objavio novu verziju zadatka. Ponovno učitajte stranicu i pročitajte je.",
      unauthorized: "Prijava nije valjana. Prijavite se ponovno.",
      forbidden: "Ovaj račun ne može potvrditi obavijest za ovaj zadatak.",
      invalid: "Potvrda nije prihvaćena. Ponovno učitajte stranicu.",
      unavailable: "Potvrda nije zabilježena. Pokušajte ponovno.",
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
    failedBody: "Prijavu nije bilo moguće dovršiti. Pokušajte ponovno; ako se ponovi, javite se koordinatoru na svojoj ustanovi.",
    unavailableBody: "Prijava preko AAI@EduHr trenutačno ne odgovara. Pokušajte ponovno za nekoliko minuta.",
    retry: "Pokušaj ponovno",
    home: "Na početnu",
    signIn: "Prijava",
    logout: "Odjava",
    loggingOut: "Odjava…",
    logoutUnsaved:
      "Ovaj uređaj nije mogao pohraniti dio teksta, pa bi se odjavom izgubio. Izvezite tekst prije odjave.",
    // FE-D7 (D-118): the sign-out dialog. It speaks only of this device: the
    // app sends nothing to the server yet, so it promises no sending (#476).
    logoutTitle: "Odjava",
    logoutConfirm: "Odjavi se",
    // Unsaved text (#1331): sign-out is still allowed (D-118) but named for what it costs.
    logoutConfirmUnsaved: "Odjavi se bez izvoza",
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
      "Zapis ostaje vezan uz Vas na ovom uređaju i nastavljate ga kad se ponovno prijavite. Osoba koja se nakon Vas prijavi na ovom uređaju ne vidi Vaš rad.",
    // 3d-2c, P3 and P4 (a): a copy kept outside the work stays on sign-out.
    logoutCopy: {
      one: "Na ovom uređaju čuva se {n} kopija teksta koja nije u radu.",
      few: "Na ovom uređaju čuvaju se {n} kopije teksta koje nisu u radu.",
      many: "Na ovom uređaju čuva se {n} kopija teksta koje nisu u radu.",
    },
    logoutCopyKept:
      "Odjava kopiju ne briše. Ostaje vezana uz Vas na ovom uređaju i ponovno je vidite kad se prijavite.",
    copyTitle: "Kopija teksta",
    // F-154 (owner decision 1.3): text written after the submission stays on
    // sign-out (D-118) and goes only on the author's second click.
    afterSubmissionTitle: "Izmjene nakon predaje",
    afterSubmissionDiscard: "Obriši izmjene s ovog uređaja",
    afterSubmissionDiscardAsk: "Obrisane izmjene ne mogu se vratiti. Predani rad ostaje kakav jest. Obrisati ih?",
    afterSubmissionDiscardConfirm: "Da, obriši izmjene",
    afterSubmissionKeep: "Zadrži izmjene",
    afterSubmissionDiscardFailed: "Izmjene nisu obrisane i ostaju na ovom uređaju. Pokušaj ponovno.",
    copyNewestOnly: "Radnje se odnose na najnoviju kopiju.",
    copyRestore: "Vrati tekst u rad",
    copyDiscard: "Odbaci kopiju",
    copyDiscardAsk: "Odbačena kopija ne može se vratiti. Odbaciti je?",
    copyDiscardConfirm: "Da, odbaci kopiju",
    copyKeep: "Zadrži kopiju",
    copyDiscardFailed: "Kopija nije odbačena i ostaje na ovom uređaju. Pokušajte ponovno.",
    // #1330, #1444: ended here; nothing calls the server again.
    logoutDevice:
      "Odjava je na ovom uređaju gotova. Poslužitelj trenutačno ne odgovara, pa ondje prijava prestaje pri sljedećoj prijavi ili kad istekne.",
    // F-285: the server did not confirm the sign-out, so nothing ended on this
    // device. It claims nothing about the server, which may have closed it.
    logoutUnconfirmed:
      "Poslužitelj nije potvrdio odjavu. Pokušajte ponovno.",
    logoutClose: "Zatvori",
    signedOutElsewhere:
      "Prijava više ne vrijedi, pa ova kartica više ne prikazuje rad. Rad nastavljate kad se ponovno prijavite.",
    signInAgain: "Prijavi se",
  },
  // FE-D3 (DAN-222): /prijava, Prijava v5 of the design handoff without the
  // e-mail sign-in and the "Što Ductura čuva" panel (D-09, #476). AAI@EduHr is
  // the one way in; nothing here describes what is recorded (the notice of
  // each assignment does, PRODUCT §5 rule 6).
  prijava: {
    // Archivum sign-in (owner's design package of 26 Oct 2026, DAN-344).
    title: "Prijava",
    back: "Na naslovnicu",
    // D-181: the reader is addressed with "Vi" (Codex P2 on #879, 6ea3ced8).
    eyebrow: "Vaš akademski prostor",
    heading: "Dobro došli",
    headingMore: "u svoj",
    headingAccent: "prostor.",
    lead: "Jedan ulaz za studente i nastavnike.",
    leadMore: "Pisanje, povratna informacija i razgovor o radu.",
    paperMeta: `${APP_NAME} / akademski rad`,
    paperTitle: "Prije prve",
    paperTitleAccent: "rečenice.",
    paperNote: "Jasne upute. Povezan razgovor.",
    paperStudent: "Student piše.",
    paperTeacher: "Nastavnik usmjerava.",
    cardEyebrow: "Prijava",
    cardTitle: "Vaš akademski",
    cardTitleAccent: "identitet.",
    cardBody: "Prijavite se korisničkim računom AAI@EduHr, istim kojim se prijavljujete u Studomat i Merlin. Studenti i nastavnici koriste isti ulaz.",
    button: "Prijava sustavom AAI@EduHr",
    passwordNote: "Lozinku upisujete samo kod AAI@EduHr.",
    roleTitle: "Jedan ulaz. Vaš prostor.",
    roleBody: "Nakon prijave otvara se vaš prostor prema dodijeljenoj ulozi. Ulogu nastavnika potvrđuje administrator fakulteta.",
    codeSummary: "Prvi dolazak ili imate kod zadatka?",
    codeNote: "Prvo se prijavite sustavom AAI@EduHr. Kod zadatka od nastavnika upisujete nakon prijave.",
    footer: "Identitet AAI@EduHr · pristup prema dodijeljenoj ulozi",
    helpSummary: "Trebate pomoć?",
    helpAaiTitle: "Ne možete se prijaviti računom AAI@EduHr?",
    helpAaiBody: "Za zaboravljenu korisničku oznaku ili lozinku obratite se službi svoje matične ustanove.",
    helpAaiLink: "Službena pomoć AAI@EduHr",
    helpAccessTitle: "Prijava je uspjela, ali nemate pristup?",
    helpAccessBody: "Javite se koordinatoru na svojoj ustanovi.",
  },
  // DAN-378 (M1.8): Z-03, a closed session behind the cookie; signed out,
  // with no session ever shown; Z-05, signed in without the role (UX pass
  // DAN-450, #1091 c.6561627758). Z-05 speaks of the own account only.
  access: {
    expiredTitle: "Sesija je istekla",
    expiredBody: "Zbog neaktivnosti odjavljeni ste. Prijavite se ponovno i nastavite gdje ste stali.",
    signedOutTitle: "Niste prijavljeni.",
    signedOutBody: "Prijavite se da vidite {what}.",
    what: {
      courses: "svoje kolegije",
      newCourse: "obrazac za novi kolegij i zadatak",
      assignmentVersion: "obrazac za novu verziju zadatka",
      fastPath: "brz put kroz radove",
      mentoredWorks: "radove uz mentora",
      home: "svoj prostor",
      institution: "pregled svoje ustanove",
      users: "korisnike svoje ustanove",
      facultyRules: "pravila svoje ustanove",
      institutionCourses: "kolegije svoje ustanove",
    },
    deniedTitle: "Nemate pristup ovom prikazu",
    deniedBody: "Ovaj prikaz namijenjen je nastavnicima.",
    deniedPending: "Ulogu nastavnika potvrđuje administrator fakulteta. Dok se ne potvrdi, ovaj prikaz nije dostupan.",
    deniedNext: "Javite se koordinatoru na svojoj ustanovi.",
    backToOwn: "Natrag na moj prostor",
  },
  // DAN-591 (M2.11-P03, A-03): the institution's courses by academic year,
  // read only, as docs/design/ductura/m2-reference/a03-kolegiji-tim-i-grupe.html
  // writes them. Students are only counted, never named.
  institutionCourses: {
    title: "Kolegiji i akademske godine",
    lead: "Kolegiji vaše ustanove po akademskoj godini, s nastavnim timom i seminarskim grupama. Radovi studenata i njihov sadržaj ovdje se ne prikazuju.",
    yearHeading: "Akademska godina {year}",
    yearsLabel: "Akademske godine",
    enrolled: { one: "upisan student", few: "upisana studenta", many: "upisanih studenata" },
    students: { one: "student", few: "studenta", many: "studenata" },
    holder: "Nositelj",
    team: "Nastavni tim",
    noHolder: "Nije upisan",
    noTeam: "Nema članova",
    noGroups: "Kolegij nema seminarskih grupa.",
    groupTeacher: { one: "Nastavnik", many: "Nastavnici" },
    noTeacher: "Bez nastavnika",
    noTeacherNote: "Studenti grupe vide kolegij i zadatke.",
    emptyYear: "Za ovu akademsku godinu ustanova nema kolegija.",
    noCourses: "Ustanova još nema kolegija.",
    emptyNote: "Kolegij stvara nastavnik s potvrđenom ulogom; potvrda je u „Korisnici i uloge”.",
    unavailable: "Kolegiji trenutačno nisu dostupni. Pokušajte ponovno.",
    retry: "Pokušaj ponovno",
  },
  // DAN-590 (M2.12-P03, A-04): the faculty rule versions of DAN-315, read
  // only. The package of form rules (facultyRules below, M4) has no data yet
  // and is not shown. Purpose labels are short forms of tools.purposes.
  facultyRuleVersions: {
    title: "Pravila fakulteta",
    lead: "Polazno pravilo fakulteta za svaku vrstu rada i sve njegove objavljene verzije. Zaslon je samo za čitanje. Objavljena verzija se ne mijenja; nova verzija dolazi uz nju.",
    currentHeading: "Pravila na snazi",
    currentNote: "Za svaku vrstu rada vrijedi zadnja objavljena verzija.",
    versionOf: "Verzija {n} · objavljena {date}",
    aiPolicy: "AI pomoć",
    policies: {
      prohibited: "Nije dopuštena",
      partially_allowed: "Djelomično dopuštena",
      encouraged: "Potiče se",
    },
    purposes: "Dopuštene uporabe",
    purposeLabels: {
      formatting: "formatiranje",
      proofreading: "lektoriranje i jezična provjera",
      literature_search: "pronalaženje literature",
      transcription: "transkribiranje",
      translation: "prevođenje",
    },
    purposesNone: "Nijedna s popisa",
    profile: "Profil zapisa",
    profiles: { basic: "Osnovni", extended: "Prošireni" },
    importLabel: "Uvoz teksta",
    importValues: { yes: "Dopušten", no: "Nije dopušten" },
    origin: "Objavio",
    origins: { operator: "Tim Ducture", administrator: "Administrator ustanove" },
    historyLabel: "Povijest verzija: {workType}",
    colVersion: "Verzija",
    colPublished: "Objavljeno",
    colOrigin: "Objavio",
    colAi: "AI pomoć",
    inForce: "{n} (na snazi)",
    notSetHeading: "Bez pravila",
    notSetNote: "Za ove vrste rada pravilo fakulteta nije postavljeno:",
    empty: "Ustanova još nema objavljenih pravila fakulteta.",
    readOnly: "Ovaj zaslon samo prikazuje pravila. Objava nove verzije ovdje nije dostupna.",
    unavailable: "Pravila fakulteta trenutačno nisu dostupna. Pokušajte ponovno.",
    retry: "Pokušaj ponovno",
  },
  // #732 item 3: Next.js error and not-found pages in Croatian (D-84).
  // M4 (DAN-506): A-04 "Pravila fakulteta", read-only (D-217), reference #1403.
  facultyRules: {
    title: "Pravila fakulteta",
    intro: "Paket pravila oblika rada koji ustanova koristi. Zaslon je samo za čitanje; novu verziju paketa uvozi tim Ducture.",
    visibleHeading: "Što studenti i nastavnici vide",
    colWorkType: "Vrsta rada",
    colPanel: "Prikaz u panelu Upute i provjera oblika",
    colCause: "Uzrok",
    shapeCheck: "Provjera oblika, paket {version}",
    causeCovered: "Paket pokriva ovu vrstu rada.",
    causeNotCovered: "Paket {version} ne pokriva ovu vrstu rada.",
    notApplicable: "Ne odnosi se na ovu vrstu rada.",
    disabledHeading: "Nije uključeno za cijelu ustanovu",
    disabledSeen: "Studenti i nastavnici vide: „Provjera oblika trenutačno nije uključena na ovoj ustanovi. Predaja nije zbog toga ograničena.”",
    disabledLicence: "Licenca za paket pravila nije aktivna od {date}.",
    disabledOther: "Drugi mogući uzroci: paket nije uvezen; uvezeni paket nije valjan.",
    packageHeading: "Paket pravila",
    version: "Verzija",
    imported: "Uvezeno",
    publisher: "Izdavač",
    coveredTypes: "Pokrivene vrste rada",
    notCovered: "Nije pokriveno",
    ruleCount: "Broj pravila",
    rulesHeading: "Pravila i njihov puni tekst",
    verbatim: "Doslovni navod · {source}",
    historyHeading: "Povijest verzija",
    historyVersion: "Verzija",
    historyImported: "Uvezeno",
    historyCovered: "Pokrivene vrste rada",
    inUse: "{version} (u uporabi)",
    historyNote: "Rad zadržava verziju paketa s kojom je provjeren; nova verzija ne mijenja ranije provjere.",
    adminHeading: "Postavke koje uređuje administrator",
    adminNote: "Pravilo o AI pomoćniku, pružatelji, pragovi i rokovi nisu dio paketa pravila. Uređuju se odvojeno, na zaslonu Postavke ustanove.",
  },
  // DAN-294 (S-42, contract on #1836, c.6814737263): the student's own access log.
  accessLog: {
    title: "Tko je otvorio Vaš rad",
    context: "Dnevnik pristupa",
    backToWork: "Natrag na rad",
    note: "Ovdje vidite tko je i kada otvorio Vaš rad i što je otvoreno. Vrijeme je zaokruženo na 5 minuta.",
    empty: "Vaš rad još nitko nije otvorio. Kad ga netko otvori, ovdje ćete vidjeti tko, kada i što.",
    loading: "Učitavam dnevnik pristupa.",
    unavailable: "Dnevnik trenutačno nije moguće učitati. To ne utječe na upisivanje pristupa.",
    retry: "Pokušaj ponovno",
    older: "Prikaži starije dane",
    truncated: "Postoje i starija otvaranja, ali ih ova stranica ne može prikazati.",
    notFound: "Dnevnik pristupa nije dostupan ovom računu.",
    notStarted: "Rad još nije započet, pa ga nitko nije otvorio.",
    signInFirst: "Za dnevnik pristupa prijavite se.",
    signIn: "Prijava",
    invalid: "Adresa rada nije ispravna.",
    weekdays: ["Nedjelja", "Ponedjeljak", "Utorak", "Srijeda", "Četvrtak", "Petak", "Subota"],
    roles: {
      teacher: "nastavnik kolegija",
      mentor: "mentor",
      seminar_teacher: "nastavnik seminarske grupe",
      unknown: "druga uloga",
    },
    roleAlone: {
      teacher: "Nastavnik kolegija",
      mentor: "Mentor",
      seminar_teacher: "Nastavnik seminarske grupe",
      unknown: "Druga uloga",
    },
    surfaces: {
      live_view: "Rad uživo",
      submitted_text: "Predani tekst",
      process_summary: "Sažetak procesa",
      fast_path: "Brz put",
      replay: "Reprodukcija",
      unknown: "Drugi prikaz rada",
    },
  },
  replay: {
    titleStudent: "Reprodukcija Vašeg rada",
    titleTeacher: "Reprodukcija rada",
    context: "Reprodukcija",
    backToWork: "Natrag na rad",
    intro: "Ovo je nastanak rada, promjenu po promjenu.",
    purpose: "Služi razgovoru o radu, ne ocjeni.",
    sameView: "Isti prikaz vidi i Vaš mentor.",
    loading: "Učitavam promjene rada.",
    empty: "Nema zabilježenih promjena.",
    unavailable: "Reprodukcija se trenutačno ne može učitati.",
    unavailableStudent: "Rad i dalje možete pisati i predati.",
    retry: "Pokušaj ponovno",
    notFound: "Reprodukcija nije dostupna ovom računu.",
    signedOut: "Sesija je završila. Za reprodukciju se ponovno prijavite.",
    signInFirst: "Za reprodukciju rada prijavite se.",
    signIn: "Prijava",
    invalid: "Adresa rada nije ispravna.",
    notStarted: "Rad još nije započet, pa nema reprodukcije.",
    sourceLine: "Izvor ove promjene:",
    sheetLabel: "Tekst rada u trenutku odabrane promjene",
    scopeTitle: "Što se reproducira",
    scopeWhole: "Cijeli rad",
    scopeOne: "Jedan odlomak",
    paragraph: "Odlomak",
    paragraphOption: "Odlomak {k}: {text}",
    deletedOption: "Obrisani odlomak: „{text}”",
    scopeNote: "Reprodukcija se može pokrenuti za cijeli rad ili za jedan odabrani odlomak.",
    scopeNone: "Ovaj odlomak nije mijenjan ni u jednoj zabilježenoj promjeni.",
    controls: "Kontrole reprodukcije",
    slider: "Promjena",
    position: "Promjena {n} od {total}",
    start: "Početak zapisa",
    previous: "Prethodna promjena",
    next: "Sljedeća promjena",
    stepNote: "Svaka promjena je jedan unos: jedan znak, jedno lijepljenje ili brisanje.",
    change: "Promjena {n}: {parts}.",
    changeBare: "Promjena {n}.",
    startLive: "Početak zapisa: tekst prije prve zabilježene promjene.",
    inserted: { one: "umetnut {count} znak", few: "umetnuta {count} znaka", many: "umetnuto {count} znakova" },
    removed: { one: "obrisan {count} znak", few: "obrisana {count} znaka", many: "obrisano {count} znakova" },
    inBlock: "{what} u odlomku {k}",
    inBlockDeleted: "{what} u obrisanom odlomku",
    and: "{a} i {b}",
    format: "promijenjeno oblikovanje u odlomku {k}",
    structure: "promijenjena vrsta odlomka {k}",
    formatDeleted: "promijenjeno oblikovanje u obrisanom odlomku",
    structureDeleted: "promijenjena vrsta obrisanog odlomka",
    gapTitle: "Praznina u zapisu",
    gapsTitle: "Praznine u zapisu",
    gapBetween: "Između promjene {a} i promjene {b} nema zabilježenih promjena.",
    gapBefore: "Prije promjene {b} nema zabilježenih promjena.",
    gapStartsLater: "Zapis počinje kasnije od rada: ono što je napisano prije prve zabilježene promjene nije u zapisu.",
    gapResumed: "Reprodukcija se nastavlja od sljedeće zabilježene promjene.",
    gapStopped: "Nakon promjene {a} zapis je prekinut.",
    gapStoppedStart: "Zapis je prekinut prije prve zabilježene promjene.",
    gapStoppedNote: "Ostatak zapisa se ne reproducira: nema provjerenog teksta od kojeg bi se nastavilo.",
    goTo: "Idi na promjenu {n}",
    historyTitle: "Povijest odlomka {k}",
    historyTitleDeleted: "Povijest obrisanog odlomka",
    historyVersion: "Verzija odlomka",
    historyReplaced: "Čime je zamijenjena",
    historyOrigin: "Podrijetlo",
    historyCurrent: "Sadašnja (promjena {n})",
    historyPrevious: "Prethodna (promjena {n})",
    historyFirst: "Prva zabilježena (promjena {n})",
    historyDeleted: "odlomak je obrisan",
    historyNotYet: "još nije zamijenjena",
    historyBy: "promjena {n}",
    historyResumed: "Iz provjerenog nastavka (prije promjene {n})",
    historyResumedNow: "Sadašnja (iz provjerenog nastavka)",
    historyInGap: "unutar praznine u zapisu, promjena nije opažena",
    historyUnobserved: "nije opaženo",
    historyNone: "Do ove promjene odlomak nije mijenjan.",
    historyNote: "Prikazane su samo neke verzije odlomka: sadašnja, neposredno prethodna i prva zabilježena, uz to čime je koja zamijenjena i odakle potječe. Verzije između njih dobivaju se pomicanjem po promjenama.",
    note: "Ritam pisanja ne govori ništa o autorstvu ni o trudu.",
    foot: "Reprodukcija prikazuje redoslijed promjena. Ne ocjenjuje rad ni osobu.",
    sources: {
      editor: "utipkano",
      paste: "zalijepljeno (izvor nije opažen)",
      cut: "izrezano",
      drop: "povučeno i ispušteno (izvor nije opažen)",
      composition: "unos sastavljanjem znakova",
      "system-replacement": "zamjena iz preglednika",
      "keyless-input": "unos bez pritiska tipke",
      unattributed: "izvor nije opažen",
    },
  },
  errorPage: {
    notFoundTitle: "Stranica ne postoji",
    notFoundBody: "Na ovoj adresi nema stranice. Provjerite adresu ili se vratite na početnu.",
    errorTitle: "Stranicu nije bilo moguće prikazati",
    errorBody: "Dogodila se neočekivana greška. Pokušajte ponovno; ako se ponovi, vratite se na početnu.",
  },
} as const;

type Widen<T> = { readonly [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };

/** The shape every language table has to fill. */
export type Messages = Widen<typeof hr>;

export const messagesHr: Messages = hr;
