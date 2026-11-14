# 06 Klase podataka (DATA-CLASS)

> **Ovo je radni nacrt, nije pravni savjet.** Rokove čuvanja potvrđuju FPZG i službenik za zaštitu podataka (D-30 je PRIJEDLOG, Owner queue Q-16, D-264 Q11).

Zadatak: DAN-297, M10.1-P01. Popis je napravljen nad `main` na `d791364e` (8. 11. 2026.), kako traži D-271 MQ01. Imao je 30 klasa; klasa 31 (prijave problema, DAN-431) dodana je poslije. Svaka klasa pripada točno jednoj od 8 kategorija iz C-21 (`docs/ARCHITECTURE.md` §3, D-271 MQ03). Rok se potvrđuje po klasi, a ne po kategoriji.

Ovaj popis ne odlučuje ni o jednom roku i na njemu se ništa ne gradi. Tablica `data_class`, tablica `erasure` i poslovi brisanja (M10.0-S1, M10.2) nastaju tek uz potvrđene rokove.

## 1. Kako čitati

- **Okidač:** događaj od kojeg teče rok.
- **Rok:** „otvoreno (D-30 PRIJEDLOG, Q-16)” znači da rok nije odlučen. Prijedlozi iz `docs/ARCHITECTURE.md` §3 i D-272 MQ06 navedeni su kao prijedlozi. Odlučeni su samo rokovi iz D-273 MQ08: sesije nakon 30 dana, izvozni artefakt nakon 24 sata (D-173) i odbačeni privremeni objekti. Prije potvrde D-30 sve ostalo smije raditi samo kao probni prolaz (dry-run).
- **Stanje:**
  - `izgrađeno`: tablica postoji na `main`;
  - `planirano`: podatak postoji samo u dokumentima;
  - `rezervirano`: broj je zauzet, a klasa se ne gradi.
  - Oznaka „kategorija za potvrdu” znači da C-21 tu vrstu podatka ne navodi izravno, pa je kategorija prijedlog ovog popisa.
- **Brojevi:** fiksni brojevi dolaze iz odluka:
  - 1, identitet (D-272 MQ05);
  - 4, uključuje seminarske grupe (D-271 MQ01);
  - 12, rezervirano (D-274 MQ09);
  - 16, predani rad (D-272 MQ06);
  - 27, hashevi i potvrde (D-272 MQ06).

  Ostali brojevi su **prijedlog ovog popisa**, a ne odluka. Plan M10 može promijeniti numeraciju; na nju se zato ne gradi kod. Promjena broja mijenja ovaj dokument i test.

Test `src/domain/privacy/data-class-inventory.test.ts` čita odjeljke 2 i 3. Pada ako tablica iz `-- migrate:up` dijela migracija nema redak u odjeljku 3, ako redak upućuje na tablicu koje nema, ako se tablica pojavi dvaput, ako je klasa nepoznata ili ako „bez osobnog podatka” nema razlog. Pada i ako klasa nije u jednoj od 8 kategorija.

## 2. Klase

| Klasa | Naziv | Kategorija | Svrha | Okidač | Rok | Stanje |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Identitet računa | Sesije | Veza računa s AAI@EduHr i ustanovom (D-09) | Istekao je zadnji ovisni zapis (D-272 MQ05) | otvoreno (D-30 PRIJEDLOG, Q-16) | izgrađeno |
| 2 | Ime i prezime | Sesije | Prikaz osobe nastavniku i mentoru (D-170 O1) | Kao klasa 1; osvježava se pri prijavi | otvoreno (D-30 PRIJEDLOG, Q-16); briše se samo uskom funkcijom (D-272 MQ04) | izgrađeno |
| 3 | Sesije prijave i odjave | Sesije | Prijava, odjava, zaštita od ponovljenog tokena odjave | Kraj sesije; istek `expires_at` | 30 dana nakon kraja (D-273 MQ08); `identity.purge_ended_sessions()` postoji, raspored nije izgrađen (M10.0-S2) | izgrađeno |
| 4 | Nastava i članstvo | Sesije | Kolegiji, članstvo, seminarske grupe, kodovi i pokušaji upisa | Kraj članstva ili akademske godine | otvoreno (D-30 PRIJEDLOG, Q-16); pokušaji upisa brišu se pri sljedećem pokušaju | izgrađeno; kategorija za potvrdu |
| 5 | Uloge i dodijeljeni pristup | Sesije | Uloge nastavnika i ustanove, zamjene, mentorstvo, pristup radu | Kraj uloge, mentorstva ili dodjele | otvoreno (D-30 PRIJEDLOG, Q-16) | izgrađeno; kategorija za potvrdu |
| 6 | Obavijesti u aplikaciji | Predaja | Obavijest o komentaru, verziji zadatka, predaji | Obavijest pročitana ili rad zatvoren | otvoreno (D-30 PRIJEDLOG, Q-16) | izgrađeno; kategorija za potvrdu |
| 7 | Potvrda obavijesti uz zadatak | Revizijski trag | Dokaz da je student vidio obavijest uz verziju zadatka | Kraj rada | otvoreno (D-30 PRIJEDLOG, Q-16) | izgrađeno; kategorija za potvrdu |
| 8 | Evaluacija pilota | Evaluacija pilota | Ankete i razgovori, odvojeno od evidencije | Kraj evaluacije | otvoreno (D-30 PRIJEDLOG, Q-16); prijedlog „do kraja evaluacije” | planirano |
| 9 | Zadatak i verzije zadatka | Radne verzije | Upute, rokovi i pravila koje postavlja nastavnik | Kraj akademske godine zadatka | otvoreno (D-30 PRIJEDLOG, Q-16) | izgrađeno; kategorija za potvrdu |
| 10 | Pravila fakulteta i jezik rada | Radne verzije | Pravila rada ustanove, iznimka jezika po studentu | Novo pravilo; kraj rada | otvoreno (D-30 PRIJEDLOG, Q-16) | izgrađeno; kategorija za potvrdu |
| 11 | Projekt i dokument | Radne verzije | Metapodaci rada: kome pripada, koji zadatak | Kraj rada; predaja | otvoreno (D-30 PRIJEDLOG, Q-16) | izgrađeno |
| 12 | Privatna povijest rada | Radne verzije | Studentova privatna povijest (M10.8) | Nije određen | otvoreno (D-30 PRIJEDLOG, Q-16); ne gradi se do D-55 i C-19 (D-274 MQ09) | rezervirano |
| 13 | Revizije dokumenta | Radne verzije | Verzije teksta rada | Kraj rada; predaja | otvoreno (D-30 PRIJEDLOG, Q-16); prijedlog „do kraja akademske godine” | izgrađeno |
| 14 | Kontrolne točke s punim tekstom | Radne verzije | Brzo otvaranje i obnova rada | Kraj rada; predaja | otvoreno (D-30 PRIJEDLOG, Q-16); `body` se briše samo uskom funkcijom (D-272 MQ04) | izgrađeno |
| 15 | Stanje prikaza uživo | Radne verzije | Prikaz uređivanja uživo | Kraj rada ili povlačenje (D-12) | otvoreno (D-30 PRIJEDLOG, Q-16); `collaboration.delete_live_state` postoji za `ductus_retention` | izgrađeno |
| 16 | Predani rad | Predaja | Predana verzija i zahtjev za predaju | Predaja | otvoreno (D-30 PRIJEDLOG, Q-16); prijedlog „prema pravilniku fakulteta” | izgrađeno |
| 17 | Izjava o pomoći AI-ja i ispisi razgovora | Predaja | Izjava uz predaju (D-77) | Predaja | otvoreno (D-30 PRIJEDLOG, Q-16) | planirano |
| 18 | Komentari | Predaja | Niti komentara nastavnika, mentora i studenta | Kraj rada | otvoreno (D-30 PRIJEDLOG, Q-16); prijedlog „kao predaja”; `body` uskom funkcijom (D-272 MQ04) | izgrađeno |
| 19 | Zahtjevi za doradu | Predaja | Zahtjev, njegove verzije i odgovor | Kraj rada | otvoreno (D-30 PRIJEDLOG, Q-16); prijedlog „kao predaja” | izgrađeno |
| 20 | Izvozni paket | Predaja | Paket za studenta ili bivšeg studenta (D-271 MQ02) | Izdana poveznica | 24 sata, koliko i poveznica (D-173, D-273 MQ08) | planirano; kategorija za potvrdu |
| 21 | Odsječci i paketi evidencije | Evidencija | Zapis nastanka rada (D-24) | Predaja; kraj rada | otvoreno (D-30 PRIJEDLOG, Q-16); prijedlog „kao predaja”; sadržaj u S3 briše adapter (D-272 MQ04) | izgrađeno |
| 22 | Vrijeme po promjeni | Evidencija | Redoslijed i vrijeme svake promjene (D-143) | Predaja | otvoreno (D-30 PRIJEDLOG, Q-16); D-143 traži zasebnu klasu s kraćim rokom | planirano kao zasebna klasa |
| 23 | Odbačeni privremeni objekti | Evidencija | Rezervirani objekti bez potvrđenog upisa | Odbacivanje | Briše se prije D-30 (D-273 MQ08); trajanje nije zapisano | planirano |
| 24 | Zapis AI pomoćnika | Evidencija | Prijenosi iz pomoćnika i razgovori (D-194) | Predaja | otvoreno (D-30 PRIJEDLOG, Q-16); uz Q-10 | planirano; kategorija za potvrdu |
| 25 | Zapis pristupa radu | Revizijski trag | Tko je otvorio rad (PRAVILO 17) | Pristup | otvoreno (D-30 PRIJEDLOG, Q-16); prijedlog „dulje od predaje”; briše ga samo uska funkcija (D-272 MQ05) | izgrađeno |
| 26 | Događaji promjena ovlasti | Revizijski trag | Trag promjena članstva, uloga, mentorstva i pravila | Događaj | otvoreno (D-30 PRIJEDLOG, Q-16) | izgrađeno |
| 27 | Hashevi i potvrde | Evidencija | Dokaz predaje nakon brisanja sadržaja | Predaja | otvoreno (D-30 PRIJEDLOG, Q-16); prijedlog „rok klase 16 uz rok za prigovor”; do potvrde osobni podatak (D-272 MQ06, D-264 Q11) | izgrađeno |
| 28 | Evidencija brisanja | Revizijski trag | Nadgrobni zapis brisanja (tablica `erasure`) | Završen posao brisanja | otvoreno (D-30 PRIJEDLOG, Q-16) | planirano (M10.0-S1) |
| 29 | Kopije baze i bucketa | Kopije | PITR, dnevni dump, replika i verzije bucketa (BACKEND §4.7) | Nastanak kopije | otvoreno (D-30 PRIJEDLOG, Q-16); vlastiti rok po vrsti kopije (D-12); PITR 3 dana je tehnička postavka, ne rok | planirano |
| 30 | Lokalni dnevnik na uređaju | Lokalni zapis na uređaju | Rad bez mreže (Dexie) | Sinkronizacija; odjava | otvoreno (D-30 PRIJEDLOG, Q-16); zapis živi do sinkronizacije, rok trajanja odlučuje se prije pilota (D-118, D-122) | izgrađeno u pregledniku, bez tablice |
| 31 | Prijave problema | Sesije | Opis problema i zatvoreni tehnički kontekst koje korisnik šalje podršci, bez teksta rada (DAN-431) | Prijava poslana | otvoreno (D-30 PRIJEDLOG, Q-16) | izgrađeno; kategorija za potvrdu |

## 3. Tablice po klasama

Svaka tablica koju `-- migrate:up` dijelovi u `db/migrations/` ostavljaju na `main` ima ovdje točno jedan redak. Crtica „—” znači da tablica nema osobnog podatka, a napomena daje razlog. Zapis `pgboss.*` pokriva cijelu shemu, i dinamičke particije.

| Tablica | Klasa | Napomena |
| --- | --- | --- |
| `identity.user_account` | 1 | |
| `identity.person_name` | 2 | |
| `identity.session` | 3 | |
| `identity.user_preference` | 1 | Samo jezik sučelja (`hr` ili `en`) i vrijeme promjene; jezik rada nije ovdje |
| `identity.problem_report` | 31 | Opis do 1000 znakova i kontekst iz zatvorenih skupova; podrška još nema pravo čitanja |
| `identity.ops_alarm` | — | Operativni alarm spremnosti: samo vrsta iz zatvorenog skupa, kategorija i vremena; nijedan stupac ne nosi osobu, ustanovu, rad ni poruku greške (DAN-184) |
| `identity.ops_alarm_fault` | — | Svjež zapis kvara po izvještaču: vrsta iz zatvorenog skupa, `reporter` (slučajni UUID procesa, nastaje pri pokretanju; ne označava osobu ni stroj) i vrijeme; zapis stariji od 120 s briše se pri sljedećem pozivu iste vrste (DAN-184) |
| `identity.logout_token_jti` | 3 | Samo hash `jti` i istek, briše se pri sljedećem upisu |
| `identity.institution` | — | Podaci ustanove, ne osobe |
| `identity.institution_issuer` | — | Adresa OIDC izdavatelja ustanove |
| `identity.teacher_eligibility` | 5 | |
| `institution.institution_role` | 5 | |
| `institution.team_substitution` | 5 | |
| `institution.mentorship` | 5 | |
| `institution.mentorship_request` | 5 | |
| `institution.work_grant` | 5 | |
| `institution.course` | 4 | |
| `institution.course_member` | 4 | |
| `institution.course_holder` | 4 | |
| `institution.course_editor` | 4 | |
| `institution.course_enrollment_code` | 4 | |
| `institution.enrollment_attempt` | 4 | |
| `institution.seminar_group` | 4 | |
| `institution.seminar_group_member` | 4 | |
| `institution.seminar_group_teacher` | 4 | |
| `institution.institution_settings` | — | Postavke ustanove, bez stupca osobe |
| `institution.notification` | 6 | |
| `institution.notice_acknowledgment` | 7 | |
| `institution.assignment` | 9 | |
| `institution.assignment_version` | 9 | |
| `institution.faculty_work_rule` | 10 | |
| `institution.faculty_rule_version` | 10 | |
| `institution.work_language_override` | 10 | |
| `institution.work_accommodation` | 10 | Klasa i rok za potvrdu; samo oznaka na radu (D-50); je li oznaka podatak o zdravlju otvoreno je (`05-otvorena-pitanja.md` t. 10) |
| `evidence.project` | 11 | |
| `evidence.document` | 11 | |
| `evidence.document_revision` | 13 | |
| `evidence.document_checkpoint` | 14 | |
| `collaboration.live_state` | 15 | |
| `evidence.submission` | 16 | |
| `evidence.submission_request` | 16 | |
| `collaboration.comment_thread` | 18 | |
| `collaboration.comment` | 18 | |
| `collaboration.revision_request` | 19 | |
| `collaboration.revision_request_version` | 19 | |
| `collaboration.revision_response` | 19 | |
| `evidence.package` | 21 | |
| `evidence.segment` | 21 | |
| `evidence.domain` | — | Domena evidencije ustanove i regija |
| `evidence.signing_key` | — | Javni ključ potpisa ustanove |
| `evidence.fast_path_window` | 25 | Vrijeme otvaranja rada po čitatelju |
| `audit.access_log` | 25 | |
| `audit.course_handover` | 26 | |
| `audit.course_member_event` | 26 | |
| `audit.enrollment_code_event` | 26 | |
| `audit.faculty_rule_event` | 26 | |
| `audit.mentorship_event` | 26 | |
| `audit.teacher_role_event` | 26 | |
| `evidence.receipt` | 27 | |
| `evidence.submission_receipt` | 27 | |
| `evidence.submission_receipt_issuance` | 27 | |
| `pgboss.*` | — | Red poslova workera; na `main` nijedan posao ne šalje se iz koda. Novi posao s osobnim podatkom dobiva klasu |

Popis pokriva tablice, a ne pojedine stupce. Provjeru po stupcu i ugovor brisanja vodi plan napada #1532 (DAN-539).

## 4. Klase iz FA §20.1

| FA §20.1 | Klase |
| --- | --- |
| `work_content` | 13, 14, 15, 21 |
| `evidence_events` | 21 |
| `replay_timing` | 22 |
| `comments` | 18 |
| `declarations` | 17 |
| `access_logs` | 25 |
| `receipts` | 27 |
| `exports` | 20 |
| `identity_sessions` | 1, 3 |

Pravna osnova, način brisanja i istek u kopijama, koje FA §20.1 traži po klasi, ovdje nisu određeni. Odlučuju ih ustanova i pravnik (`01-tokovi-podataka.md`, `05-otvorena-pitanja.md`).
