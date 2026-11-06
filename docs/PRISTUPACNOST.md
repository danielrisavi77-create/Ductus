# Ductus: pristupačnost

Verzija 0.1 · 6. 11. 2026. · DAN-428 (M11.6-P01, plan rb34)

Ovaj dokument ne donosi nove odluke. Upisuje mjerodavni standard pristupačnosti iz `docs/DECISIONS.md` i matricu koja ga veže uz pilotske tokove, preglednike, uređaje i čitače zaslona. Svaki redak ima izvor. Ono što nijedan izvor ne određuje vodi se kao otvoreno pitanje (§7) i na tome se ne gradi. Mjerodavni su izvori iz stupca „Izvor”; ako se ovaj dokument s njima ne slaže, vrijede oni, a nesklad se ovdje ispravlja.

## 1. Mjerodavni standard

| Stavka | Sadržaj | Izvor |
| --- | --- | --- |
| Cilj | WCAG 2.2, razina AA, za cijeli proizvod | D-248, proširen D-266 t. (3) (Q-14 A); potvrđen D-276 NQ01; upis #1571 |
| Ranija granica | D-248 je 2. 11. 2026. tražio 2.2 AA samo za nove ekrane M6; od 4. 11. 2026. vrijedi za cijeli proizvod | D-266 t. (3) |
| Razina | Sukladnost razine AA po definiciji WCAG-a obuhvaća kriterije razine A i AA; kriteriji AAA nisu dio cilja | WCAG 2.2, definicija sukladnosti |
| Izjava o pristupačnosti | Piše se u obliku koji traži hrvatski propis o pristupačnosti mrežnih stranica, uz poziv na EN 301 549 | D-276 NQ01; F-03 i F-09 u `docs/FEATURES.md` |
| Gdje se izjava prikazuje | Ekran J-05 (statusna stranica i izjava o pristupačnosti) | `docs/PROGRAM-RAZRADA.md`, M11, popis ekrana |
| Nositelj u programu | M11.6, DAN-428: WCAG 2.2 AA, ručna provjera čitačem zaslona i izjava (F-03) | `docs/PROGRAM-RAZRADA.md`, redak M11.6 |
| Vanjski pregled | F-03 predviđa vanjski pregled uz rad kroz M5 i M11; izvođač i opseg nisu određeni (§7, P-05) | `docs/FEATURES.md`, F-03 |
| GO uvjet pilota | axe bez kritičnih nalaza; svi tokovi tipkovnicom; editor i pregled prije predaje provjereni čitačem zaslona. Dokaz: izvještaj axe i zapis ručne provjere | `docs/PROGRAM.md`, GO tablica, redak „Pristupačnost” |
| Odgovornost | Pristupačnost (axe, tipkovnica, čitač zaslona): Frontend i QA. Preglednici: QA | `docs/TESTING.md` §1 |

## 2. Razine provjere

Oznake u matrici (§3):

- **A**: automatska provjera axe-core (`@axe-core/playwright`) na ruti toka. GO traži da nema kritičnih nalaza.
- **T**: cijeli tok tipkovnicom. GO to traži za sve tokove.
- **Č**: ručna provjera čitačem zaslona. GO je izričito traži za editor i pregled prije predaje. Za ostale tokove nije odlučeno (§7, P-02).
- **axe danas**: specovi u `e2e/` koji na ruti toka pokreću `AxeBuilder`, stanje na `main` 6. 11. 2026. Crtica (—) znači da ovaj pregled takav spec nije našao, a ne da provjera sigurno ne postoji.

Svi današnji axe specovi traže oznake `wcag2a`, `wcag2aa`, `wcag21a` i `wcag21aa`, bez `wcag22aa` (§6, N-01). Za tokove koji se tek grade kriterije WCAG 2.2 čita ručna provjera dok se axe ne uskladi.

Kriteriji koji su u WCAG 2.2 novi na razinama A i AA (2.4.11 fokus nije zaklonjen, 2.5.7 povlačenje, 2.5.8 veličina cilja, 3.2.6 dosljedna pomoć, 3.3.7 suvišan unos, 3.3.8 pristupačna prijava) ulaze u ručnu provjeru svakog toka. Za 2.5.8 postojeća pravila dizajna (32 px u gustim trakama, 44 px drugdje, `docs/design/DESIGN-SYSTEM.md`) su iznad najmanjih 24 px iz WCAG-a.

## 3. Matrica tokova

Tokovi su iz `docs/PRODUCT.md` §6, valovi iz `docs/PROGRAM.md` (D-36, D-203) i `docs/FEATURES.md`. Za svaki redak vrijede **A** i **T** (GO). Stupac „Č” kaže je li čitač zaslona obvezan po GO uvjetu.

### 3.1 Student

| Tok | Val | Č | axe danas | Izvor |
| --- | --- | --- | --- | --- |
| 1. Prijava AAI@EduHr | 1 (M1) | otvoreno | `accessibility.spec.ts` (`/prijava`), `login/access-screens.spec.ts` | PRODUCT §6 S1; PROGRAM val 1 (M0, M1); D-09 |
| 2. Ulaz u kolegij kodom | 1 | otvoreno | `accessibility.spec.ts` (`/upis`, `/upis/kolegij/…`), `login/enroll-code.spec.ts` | PRODUCT §6 S2 |
| 3. Obavijest S3 i potvrda | 1 (M7 osnovno) | otvoreno | `accessibility.spec.ts` (`/zadatak/…`), `login/assignment-notice.spec.ts`, `login/notice-header.spec.ts` | PRODUCT §6 S3; PROGRAM val 1 (M7) |
| 4. Pisanje u editoru, stanje spremanja, napredak | 1 (M5 osnovno); fusnote, tablice i slike val 2 | **obvezan** | `accessibility.spec.ts` (`/rad`, i 390 px s otvorenim trakama), `local-editor`, `editor-shell`, `toolbar-menus`, `status-bar`, `sources-panel`, `quote`, `bullet-item`, `offline-editor` | PRODUCT §6 S4; PROGRAM val 1 (M5), val 2 (M5 ostatak); GO „editor” |
| 5. AI pomoćnik | 1 (M9) | otvoreno | — | PRODUCT §6 S5; PROGRAM val 1 (D-199 t. 1) |
| 5a. Lijepljenje s oznakom izvora; oznaka prilagodbe | 1 (M3, M2) | otvoreno | — | PRODUCT §6 S5a; D-43, D-50; PROGRAM val 1 |
| 6. Uvoz teksta | DOCX val 2 (M8), PDF val 3 | otvoreno | — | PRODUCT §6 S6; PROGRAM val 2 i 3 |
| 7. Komentari i prijedlozi | 1 (M6 osnovno) | otvoreno | — | PRODUCT §6 S7; PROGRAM val 1 (M6) |
| 8. Slanje verzije na pregled | nije razvrstano u `PROGRAM.md` | otvoreno | — | PRODUCT §6 S8; D-28 |
| 9. Pregled prije predaje (S5) | 1 (M7 osnovno, predaja); otvorena mjesta i kontrolni popis val 2 | **obvezan** | `login/assignment-document.spec.ts` (`/rad/…/predaja`), `login/submission.spec.ts` | PRODUCT §6 S9; D-61, D-62; PROGRAM val 1 i 2; GO „pregled prije predaje” |
| 10. Konačna predaja, izjava, potvrda | 1 (M7; R-06) | otvoreno | `login/submission.spec.ts` | PRODUCT §6 S10; D-40; FEATURES R-06 |
| 11. Izvoz rada i evidencije | 1 (M8 izvoz, D-203 A3) | otvoreno | — | PRODUCT §6 S11; PROGRAM val 1 |
| Početni ekrani studenta (zadaci, radovi) | 1 | otvoreno | `login/student-home.spec.ts`, `login/student-home-empty.spec.ts`, `login/student-courses.spec.ts`, `login/student-workspace.spec.ts` | `e2e/login/` (postojeće rute) |

### 3.2 Nastavnik i mentor

| Tok | Val | Č | axe danas | Izvor |
| --- | --- | --- | --- | --- |
| 1. Prijava AAI@EduHr | 1 (M1) | otvoreno | `login/access-screens.spec.ts` | PRODUCT §6 N1; D-09 |
| 2. Kolegij i pravilo AI-ja | 1 (M2) | otvoreno | — | PRODUCT §6 N2; D-52, D-175; PROGRAM val 1 (M2) |
| 3. Novi zadatak; R-01 popis uporaba | 1; R-01 demo | otvoreno | `accessibility.spec.ts` (`/nastavnik/zadatak/novi`), `app-shell.spec.ts`, `login/teacher-home.spec.ts` | PRODUCT §6 N3; FEATURES R-01 |
| R-03 brz put | demo | otvoreno | `accessibility.spec.ts` (`/nastavnik/brz-put`), `login/fast-path.spec.ts` | FEATURES R-03 |
| 4. Pregled radova | nije razvrstano u `PROGRAM.md`; ruta postoji | otvoreno | `accessibility.spec.ts` (`/nastavnik`), `login/teacher-home.spec.ts`, `login/mentored-works.spec.ts` | PRODUCT §6 N4; D-128 |
| 5. Rad u nastajanju uživo | 1 (M6 osnovno) | otvoreno | `login/teacher-live.spec.ts`, `login/teacher-view.spec.ts` | PRODUCT §6 N5; D-142, D-144 |
| 6. Komentari; zahtjev za doradu, odgođeno objavljivanje | 1; D-45 i D-51 val 2 | otvoreno | — | PRODUCT §6 N6; PROGRAM val 1 i 2 (M6) |
| 6a. Konzultacije | 3 | otvoreno | — | PRODUCT §6 N6a; D-47; PROGRAM val 3 |
| 7. Izmjene teksta (prijedlog, izravno) | 1 (D-203 B1) | otvoreno | — | PRODUCT §6 N7; D-21, D-34 |
| 8. Sažetak procesa; panel Pravila zadatka | 1 (M7); panel val 2 | otvoreno | — | PRODUCT §6 N8; D-62; PROGRAM val 1 i 2 |
| 9. Usporedba verzija | nije razvrstano u `PROGRAM.md` | otvoreno | — | PRODUCT §6 N9 |
| 10. Produljenje roka | 1 (M7 osnovno) | otvoreno | — | PRODUCT §6 N10; PROGRAM val 1 |
| 11. Izvoz predanog rada i potvrde | 1 (M8 izvoz; R-05, R-06) | otvoreno | — | PRODUCT §6 N11; FEATURES R-05, R-06 |
| Reprodukcija | povijest odlomka val 3 (D-56); ostalo nije razvrstano | otvoreno | — | PRODUCT §6 „Reprodukcija”; D-56, D-143; PROGRAM val 3 |

### 3.3 Administrator fakulteta

| Tok | Val | Č | axe danas | Izvor |
| --- | --- | --- | --- | --- |
| 1. Potvrda uloge nastavnika i mentora | nije razvrstano u `PROGRAM.md` | otvoreno | — | PRODUCT §6 A1 |
| 2. AI pružatelji i polazno pravilo | nije razvrstano u `PROGRAM.md` | otvoreno | — | PRODUCT §6 A2; D-23, D-117, D-175 |
| 3. Pragovi i rokovi čuvanja | model 1 (M10 osnovno); sučelje nije razvrstano | otvoreno | — | PRODUCT §6 A3; PROGRAM val 1 (M10) |
| 4. Obveznost po vrsti rada | nije razvrstano u `PROGRAM.md` | otvoreno | — | PRODUCT §6 A4; D-04 |
| 5. Revizijski trag | nije razvrstano u `PROGRAM.md` | otvoreno | — | PRODUCT §6 A5 |

### 3.4 Funkcije iz `docs/FEATURES.md`

Funkcije koje proširuju tok iz §3.1 do §3.3 ili imaju vlastiti ekran. Val je iz `docs/FEATURES.md`; prijedlog vala tamo nije konačan raspored, pa vrijedi `docs/PROGRAM.md` gdje se razlikuju. Za sve vrijede **A** i **T**; Č je otvoreno, osim gdje funkcija živi u editoru ili pregledu prije predaje.

| ID | Funkcija | Val | Tok | Izvor |
| --- | --- | --- | --- | --- |
| S-01 | Paket za zaštitu studenta | 2; PROGRAM val 3 | S10, S11 | FEATURES; PROGRAM val 3 |
| S-02 | Vremeplov verzija | 2; PROGRAM val 3 | S4 | FEATURES; PROGRAM val 3 |
| S-03 | Brze bilješke s mobitela | 3 | S4 (mobitel) | FEATURES; D-36 |
| S-06 | Planer rada | 2; PROGRAM val 3 | S4 | FEATURES; PROGRAM val 3 |
| S-07 | Pravopis po jeziku rada | 1 | S4 (editor, Č obvezan) | FEATURES; PROGRAM val 1 (M5) |
| S-08 | DOI i ISBN u zapis | 1 | S4 (editor, Č obvezan) | FEATURES; PROGRAM val 1 (M5) |
| S-09 | PDF izvori u bilježnici | 3 | S4 | FEATURES; PROGRAM val 3 |
| S-10 | Portfelj nakon studija | 3 | S11 | FEATURES |
| S-11 | Uvodni vodič od dvije minute | 1 | S3, S4 | FEATURES; PROGRAM val 1 |
| S-14 | Panel Nacrt („Struktura”) | M5 | S4 (editor, Č obvezan) | FEATURES; D-234 |
| N-01 | Obavijesti e-poštom i u aplikaciji | 1 | svi | FEATURES; PROGRAM val 1 |
| N-02 | Podsjetnici o roku | 1 | S3, S4 | FEATURES; PROGRAM val 1 |
| N-03 | Banka komentara | 2 | N6 | FEATURES; PROGRAM val 2 |
| N-04 | Glasovni komentar (sintetički podaci) | 2 | N6, S7 | FEATURES; D-201 t. 3d, D-240 |
| N-05 | Promjene od mog zadnjeg pregleda | 2 | N4, N5 | FEATURES; PROGRAM val 2 |
| N-07 | Ključni rokovi mentorskog rada | 3 | N2 | FEATURES; PROGRAM val 3 |
| N-08 | Komentor | 3 | N4 | FEATURES; PROGRAM val 3 |
| N-09 | Povjerenstvo s ograničenim pristupom | 3 | N4 | FEATURES; PROGRAM val 3 |
| N-11 | Zbirni pregled kolegija | 2; PROGRAM val 3 | N4 | FEATURES; PROGRAM val 3 |
| N-12 | Popis „tko treba pomoć” | 1 | N4 | FEATURES; PROGRAM val 1 |
| F-01 | Izvješće za evaluaciju smjernica | 3 | administrator | FEATURES |
| F-02 | Pravno zadržavanje i izvoz za postupak | model val 1, sučelje kasnije | administrator | FEATURES |
| F-04 | Izvoz svih podataka fakulteta | prije ugovora | administrator | FEATURES |
| F-06 | Jezik rada odvojen od jezika sučelja | 1 | N3, S4 | FEATURES; D-67 |
| F-10 | Statusna stranica | 1 | javno (J-05) | FEATURES; PROGRAM-RAZRADA M11 |
| A-01 | „Objasni mi komentar” (ulazak nije odlučen) | 2 | S7 | FEATURES |
| A-03 | Provjera doslovnog citata u PDF-u | uz S-09 | S4 | FEATURES |
| A-04 | Priprema za obranu | 3 | S10 | FEATURES; PROGRAM val 3 |
| A-05 | EU modeli u katalogu (ulazak nije odlučen) | 2 | S5, administrator | FEATURES |
| A-07 | Otvoreni verifikator zapisa | 3 | javno | FEATURES |
| A-10 | „Moj rad u brojkama” | 3 | S4 | FEATURES |
| R-04 | Demo s dvije izmišljene povijesti | demo | N5, reprodukcija | FEATURES |
| R-07 | Test jednakosti prikaza (UI, API, izvoz) | 1 | N8, S11 | FEATURES |
| R-08 | Osporavanje i dopuna opisa događaja | 2 | S9 | FEATURES |
| R-09 | Izjava o ljudskoj pomoći | 1 | S10 | FEATURES |
| R-10 | Ispis razgovora iz vanjskog AI-ja | 2 | S10 | FEATURES; D-77 |

R-01, R-03, R-05 i R-06 su uz tokove u §3.1 i §3.2. Izvan matrice: S-12 (izvan pilota, D-78) i F-09 (paket dokumenata, bez ekrana; izjava o pristupačnosti iz paketa je u §1). Stavke iz „Razgovarati” i „Kasnije” u `docs/FEATURES.md` nisu u pilotu.

### 3.5 Javne stranice

| Stranica | Val | axe danas | Izvor |
| --- | --- | --- | --- |
| Naslovnica (J-01) | 1 (M11) | `accessibility.spec.ts` (`/`), `landing.spec.ts` | PROGRAM-RAZRADA M11, ekrani |
| Kako Ductura radi (J-02) | 1 (M11) | — | PROGRAM-RAZRADA M11, ekrani |
| Statusna stranica i izjava o pristupačnosti (J-05) | 1 (M11) | — | PROGRAM-RAZRADA M11, ekrani; F-03, F-10 |

## 4. Preglednici i pogoni

| Pogon ili preglednik | Što se danas vrti | Razina | Izvor |
| --- | --- | --- | --- |
| Chromium (Desktop Chrome) | Projekt `desktop`; i `login-chromium` | obvezan status na svakom PR-u punog profila | `playwright.config.ts`, `playwright.login.config.ts`; `docs/TESTING.md` §2 |
| Firefox (Desktop Firefox) | Projekt `firefox` | obvezan status | isto |
| WebKit na Linuxu (Desktop Safari) | Projekt `webkit`; `login-webkit` samo za popis specova | obvezan status; `login-webkit` podskup | isto |
| WebKit na macOS-u | Noćni posao „WebKit E2E (macOS)” | savjetodavan dok #1046 ima poznate padove | `docs/TESTING.md` §2 |
| Pravi Safari (`safaridriver`) | ne vrti se | druga razina, nije pokriveno | `docs/TESTING.md` §2 |
| Safari na iOS-u | ne vrti se | treća razina, nije pokriveno | `docs/TESTING.md` §2 |
| Pilot | cijeli acceptance path na Chromiumu, Firefoxu i WebKitu | uvjet prije pilota | `docs/TESTING.md` §2 |

Verzije preglednika koje pilot podržava nisu zapisane (§7, P-04).

## 5. Uređaji, širine i čitači zaslona

| Stavka | Stanje | Izvor |
| --- | --- | --- |
| Mobilni viewport | Projekt `mobile` (Chromium, profil Pixel 7); dodatak, ne zamjena za WebKit | `playwright.config.ts`; `docs/TESTING.md` §2 |
| Uska širina u axe-u | `/rad` na 390 px s otvorenim trakama, obje teme lista | `e2e/accessibility.spec.ts` |
| Teme | Obje teme lista u `accessibility.spec.ts` | `e2e/accessibility.spec.ts` |
| Prijelomne točke | 1250, 1050, 800 i 640 px (mobitel) | `docs/design/DESIGN-SYSTEM.md` |
| Tekst | Osnova 13,5 px, najmanje 12 px, na mobitelu najmanje 13 px | `docs/design/DESIGN-SYSTEM.md` |
| Ciljevi dodira | Najmanje 32 px u gustim trakama, 44 px drugdje i na mobitelu | `docs/design/DESIGN-SYSTEM.md` |
| Mobilni prikaz | Ekran Z-12 u M11 | PROGRAM-RAZRADA M11, ekrani |
| Prilagodba (diktiranje, asistivni alat) | Student smije označiti odobrenu prilagodbu; ugrađeno diktiranje se ne gradi | D-50; FEATURES S-04 (preporuka) |
| Čitači zaslona | Nijedan dokument ne imenuje čitač zaslona, verziju ni par s preglednikom | §7, P-01 |
| Stvarni uređaji | Nijedan dokument ne navodi popis stvarnih uređaja | §7, P-03 |

## 6. Neskladi u repou

Bilježe se, ovaj PR ih ne ispravlja. Q-14 traži da se F-03 i axe usklade (`STATE.md`, Owner queue).

| ID | Gdje | Što piše | Što vrijedi |
| --- | --- | --- | --- |
| N-01 | Svi axe specovi u `e2e/` | Oznake do `wcag21aa`, bez `wcag22aa` | 2.2 AA (D-266 t. 3) |
| N-02 | `e2e/accessibility.spec.ts`, komentar na vrhu i nazivi testova | „WCAG 2.1 AA is the pilot target” | 2.2 AA |
| N-03 | `docs/design/DESIGN-SYSTEM.md`, nepromjenjiva pravila; D-115 | WCAG 2.1 AA | 2.2 AA (D-266 t. 3 kasniji je i širi) |
| N-04 | `docs/PROGRAM-RAZRADA.md`, M6 | „WCAG 2.2 AA je cilj za nove ekrane (D-248)” | cijeli proizvod (D-266 t. 3) |
| N-05 | `docs/design/ductura/INTEGRACIJA.md`, pristupačnost | Puni prolaz tipkovnicom i čitačem zaslona još nije napravljen | GO traži oboje prije pilota |
| N-06 | Širina 320 px | Kriterij 1.4.10 (preoblikovanje) mjeri se na 320 CSS px; najuža provjera u repou je 390 px | 2.2 AA |

## 7. Otvorena pitanja

Nijedno nije odlučeno. Dok ne bude, na njima se ne gradi ništa što bi se skupo mijenjalo.

| ID | Pitanje | Zašto je otvoreno |
| --- | --- | --- |
| P-01 | Koji čitači zaslona, koje verzije i s kojim preglednikom (npr. par za Windows, macOS, iOS i Android) | Nijedan izvor ih ne imenuje; GO traži provjeru, ne određuje alat |
| P-02 | Traži li se čitač zaslona i za tokove osim editora i pregleda prije predaje | GO ga traži samo za ta dva; M11.6 kaže „ručna provjera čitačem zaslona” bez opsega |
| P-03 | Popis stvarnih uređaja i najmanja podržana širina | Postoje samo emulirani viewport i prijelomne točke |
| P-04 | Najstarije podržane verzije preglednika | Nije zapisano nigdje |
| P-05 | Tko radi vanjski pregled iz F-03, kada i u kojem opsegu | F-03 ga navodi bez izvođača i roka |
| P-06 | Koji je točno propis mjerodavan za oblik izjave, s obzirom na to da je operater privatna pravna osoba, a FPZG tijelo javnog sektora | D-276 NQ01 kaže „hrvatski propis”, bez naziva i bez odgovora tko je obveznik |
| P-07 | Mora li cijela matrica proći i na engleskom sučelju | Sučelje je hr i en od vala 1 (D-70); M5 i M6 se grade samo na hrvatskom, engleski dolazi s M11 (D-236, D-247) |
| P-08 | Jesu li izvozi (DOCX, PDF, PDF/A, potvrda predaje R-06, izvoz evidencije) u opsegu „cijelog proizvoda” | D-266 t. 3 kaže „cijeli proizvod”; nijedan izvor ne govori o pristupačnosti datoteka |
| P-09 | Tekstna zamjena za glasovni komentar (N-04) | WCAG 1.2.1 traži zamjenu za snimljeni zvuk; N-04 je u valu 2 bez te odluke |
| P-10 | Prijava AAI@EduHr (3.3.8 pristupačna prijava) | Obrazac prijave pruža Srce, izvan Ductusa; kako se to iskazuje u izjavi nije odlučeno |
| P-11 | Pristupačan prikaz reprodukcije (upravljanje pokretom, npr. WCAG 2.2.2, i tekstni prikaz istog sadržaja) | Reprodukcija prikazuje rad u pokretu; kako se kriteriji primjenjuju nije opisano |
