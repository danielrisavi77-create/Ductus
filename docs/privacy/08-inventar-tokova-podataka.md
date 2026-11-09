# 08 Inventar tokova podataka iz koda (za DPIA)

> **Ovo je radni nacrt za službenika za zaštitu podataka (DPO), nije pravni savjet ni pravno mišljenje.** Opisuje što kod na `main` radi s osobnim podacima. Ne ocjenjuje zakonitost, ne određuje rokove čuvanja i ne odlučuje ni jedno otvoreno pitanje.

Zadatak: DAN-430, M11.8-P01 (D-257: jedna DPIA). Inventar je napravljen nad `main` na `db12e1c5` (9. 11. 2026.). Klase su brojevi iz `06-klase-podataka.md` §2; ovaj dokument ne mijenja njihov popis ni brojeve. `01-tokovi-podataka.md` je stariji popis izveden iz planova; ovaj je izveden iz koda i ima prednost kad opisuje što danas postoji.

## 1. Kako čitati

- **Područje:** Prijava, Nastava, Evidencija, Prikaz, Predaja, Izvoz i Logovi. Zadnjih pet traži zadatak; prva dva su tu jer svaki API put mora biti u nekom toku.
- **Putanje:** datoteke na `main` iz kojih se tok vidi. Prva je ulaz (API put, stranica ili modul u pregledniku), ostale su kod koji podatak čita ili piše.
- **Klase:** brojevi iz `06` §2. „—” znači da tok ne nosi osobni podatak, uz razlog.
- **Tko čita:** uloga koja podatak vidi u aplikaciji ili na poslužitelju. Sve tablice u bazi čitaju se kroz `withActor` i RLS (`src/server/db/with-actor.ts`); taj sloj se ne ponavlja u svakom retku.
- **Stanje:** `izgrađeno` (kod postoji na `main`), `planirano` (postoji samo u dokumentima ili kao kod koji nitko ne poziva) ili `nije provjereno`.
- Test `src/domain/privacy/data-flow-inventory.test.ts` čita odjeljke 2 i 3. Pada ako navedena putanja ne postoji na `main`, ako klasa nije u `06`, ako API put (`app/api/**/route.ts`) nije ni u jednom toku, ako neko od pet traženih područja nema tok ili ako Q-3, Q-16 i D-30 nisu navedeni kao otvoreni.

## 2. Tokovi

| Područje | Tok | Izvor → odredište | Putanje | Klase | Tko čita | Stanje |
| --- | --- | --- | --- | --- | --- | --- |
| Prijava | Početak prijave | preglednik → AAI@EduHr, kolačić stanja prijave | `app/api/auth/login/route.ts`, `src/server/auth/flow.ts` | — samo nasumični parametri prijave (stanje i nonce), bez identiteta | poslužitelj | izgrađeno |
| Prijava | Povratak iz AAI@EduHr | AAI@EduHr (OIDC) → baza: račun, ime, sesija, pravo nastavnika | `app/api/auth/callback/route.ts`, `src/server/auth/oidc.ts`, `src/server/auth/claims.ts`, `src/server/db/open-session.ts` | 1, 2, 3, 5 | poslužitelj; ime vide nastavnik, mentor i administrator ustanove | izgrađeno; e-pošta i OIB se ne preuzimaju |
| Prijava | Odjava | preglednik → baza (zatvaranje sesije), brisanje lokalnog dnevnika | `app/api/auth/logout/route.ts`, `src/components/editor/LogoutDialog.tsx`, `src/client/logout-hold.ts`, `src/lib/journal/atomic-dexie-journal.ts` | 3, 30 | poslužitelj | izgrađeno |
| Prijava | Odjava s AAI@EduHr (back-channel) | AAI@EduHr → baza: zapis tokena odjave, zatvaranje sesija | `app/api/auth/backchannel-logout/route.ts`, `src/server/auth/backchannel-route.ts`, `src/server/auth/logout-token.ts`, `src/server/db/backchannel-logout.ts` | 3 | poslužitelj | izgrađeno |
| Prijava | Oznake sesije u pregledniku | poslužitelj → localStorage | `src/client/session-marks.ts`, `src/components/shell/SessionObserver.tsx` | 3 | preglednik korisnika | izgrađeno; oznake su hashirane |
| Prijava | Zaštita zahtjeva | preglednik → poslužitelj | `src/server/http/mutation-request.ts`, `middleware.ts` | — provjera zaglavlja Origin i Sec-Fetch-Site i politika sadržaja, ništa se ne sprema | poslužitelj | izgrađeno |
| Nastava | Kolegiji: stvaranje i popis | nastavnik → baza | `app/api/institution/courses/route.ts`, `src/server/institution/create-course.ts` | 4 | nastavnik, administrator ustanove | izgrađeno |
| Nastava | Upis studenta kodom | student → baza: članstvo i pokušaji upisa | `app/api/institution/enrollments/route.ts`, `src/server/institution/enrollment-route.ts`, `app/upis/page.tsx` | 4 | student, nastavnik kolegija | izgrađeno |
| Nastava | Kod za upis i njegov opoziv | nastavnik → baza i revizijski trag | `app/api/institution/courses/[courseId]/enrollment-code/route.ts`, `app/api/institution/courses/[courseId]/enrollment-code/revocation/route.ts`, `src/server/institution/enrollment-code-route.ts`, `src/server/institution/enrollment-code-revocation-route.ts` | 4, 26 | nastavnik kolegija | izgrađeno |
| Nastava | Uklanjanje studenta i dopuštenje povratka | nastavnik → baza i revizijski trag | `app/api/institution/courses/[courseId]/students/[studentId]/removal/route.ts`, `app/api/institution/courses/[courseId]/students/[studentId]/return-permission/route.ts`, `src/server/institution/student-removal-route.ts`, `src/server/institution/student-return-route.ts` | 4, 26 | nastavnik kolegija | izgrađeno |
| Nastava | Uloga nastavnika: potvrda i opoziv | administrator ustanove → baza i revizijski trag | `app/api/institution/teachers/[teacherId]/role-confirmation/route.ts`, `app/api/institution/teachers/[teacherId]/role-revocation/route.ts`, `src/server/institution/teacher-role-confirmation-route.ts`, `src/server/institution/teacher-role-revocation-route.ts` | 5, 26 | administrator ustanove | izgrađeno |
| Nastava | Zadatak i verzije zadatka | nastavnik → baza | `app/api/institution/courses/[courseId]/assignments/route.ts`, `app/api/institution/assignments/[assignmentId]/versions/route.ts`, `src/server/institution/assignment-route.ts`, `src/server/institution/assignment-version-route.ts` | 9 | nastavnik, studenti kolegija | izgrađeno |
| Nastava | Jezik rada za zadatak i za studenta | nastavnik → baza | `app/api/institution/assignments/[assignmentId]/work-language/route.ts`, `app/api/institution/assignments/[assignmentId]/students/[studentId]/work-language/route.ts`, `src/server/institution/work-language-route.ts` | 10 | nastavnik, student | izgrađeno |
| Nastava | Oznaka prilagodbe rada | baza → nastavnik | `src/server/institution/work-accommodation.ts`, `src/components/teacher/work-accommodations-read.ts`, `app/nastavnik/page.tsx` | 10 | nastavnik | izgrađeno (čitanje); put kojim se oznaka upisuje nije provjeren |
| Nastava | Potvrda obavijesti uz zadatak | student → baza | `app/api/institution/assignments/[assignmentId]/acknowledgment/route.ts`, `src/server/institution/acknowledgment-route.ts` | 7 | student, nastavnik | izgrađeno |
| Nastava | Nastavnikovi kolegiji i mentorstva | baza → nastavnik i mentor | `app/api/teacher/courses/route.ts`, `app/api/teacher/mentorships/route.ts`, `app/api/teacher/mentorships/[mentorshipId]/route.ts`, `src/server/institution/teacher-courses.ts`, `src/server/institution/mentored-works.ts`, `app/nastavnik/mentorstva/page.tsx` | 2, 4, 5, 11, 16 | nastavnik, mentor | izgrađeno; ovo čitanje ne piše zapis pristupa |
| Nastava | Stranice ustanove i studenta | baza → administrator ustanove, nastavnik, student | `app/ustanova/korisnici/page.tsx`, `app/ustanova/pravila/page.tsx`, `app/zadaci/radovi/page.tsx`, `src/server/institution/teacher-roles.ts`, `src/server/institution/faculty-rules.ts`, `src/server/institution/institution-overview.ts`, `src/server/institution/course-students.ts`, `src/server/institution/student-workspace.ts` | 2, 4, 5, 10 | administrator ustanove, nastavnik, student | izgrađeno |
| Evidencija | Spremanje odsječka rada | preglednik → poslužitelj → baza (revizija, paket, potvrda) i S3 (sadržaj odsječka) | `app/api/evidence/commit/route.ts`, `src/server/evidence/commit-route.ts`, `src/server/evidence/evidence-commit.ts`, `src/client/evidence-ingest.ts` | 11, 13, 21, 27 | student (samo svoj rad) | izgrađeno; potvrda sadrži UUID studenta, ne ime |
| Evidencija | Spremnik odsječaka | poslužitelj → S3, jedan bucket po domeni ustanove | `src/adapters/evidence/institution-routed-payload-store.ts`, `src/adapters/evidence/s3-evidence-payload-store.ts`, `src/adapters/evidence/evidence-storage-config.ts` | 21 | poslužitelj | izgrađeno |
| Evidencija | Otvaranje rada | baza → preglednik studenta: kontrolna točka s punim tekstom | `app/api/evidence/open/route.ts`, `src/server/evidence/open-route.ts`, `src/server/evidence/work-document-read.ts` | 11, 13, 14 | student (samo svoj rad) | izgrađeno |
| Evidencija | Lokalni dnevnik rada | uređivač → IndexedDB (Dexie) na uređaju, po opsegu korisnika i rada | `src/lib/journal/atomic-dexie-journal.ts`, `src/lib/journal/local-scope.ts`, `src/components/editor/LocalDocument.tsx` | 30 | svatko s pristupom tom pregledniku | izgrađeno |
| Evidencija | Vrijeme po promjeni | uređivač → lokalni dnevnik; poslužitelju se ne šalje | `src/editor/capture.ts`, `src/domain/forensics/evidence-timing-v1.ts` | 22, 30 | preglednik korisnika | planirano (slanje poslužitelju); lokalno se bilježi |
| Evidencija | Potpis potvrde | poslužitelj → potpis potvrde odsječka i predaje | `src/server/evidence/receipt-signer.ts`, `src/adapters/crypto/persistent-development-ed25519-signer.ts` | 27 | student (potvrda) | izgrađeno samo za razvoj i test; drugdje poslužitelj odbija s 503 |
| Evidencija | Potpis u KMS-u i pozadinski posao | poslužitelj → AWS KMS (digest) i red poslova u bazi | `src/adapters/crypto/aws-kms-ed25519-signer.ts`, `src/application/evidence/sign-pending-receipt.ts`, `db/migrations/20261108110100_pgboss_schema.sql`, `scripts/db/provision-worker.mjs` | 27 | poslužitelj | planirano; kod postoji, ali ga ništa ne pokreće |
| Prikaz | Prikaz uživo | student → stanje prikaza; nastavnik čita i ostavlja zapis pristupa | `app/api/live/[documentId]/route.ts`, `src/server/collaboration/live-route.ts`, `src/client/live-publisher.ts`, `src/client/live-reader.ts` | 15, 25 | nastavnik zadatka, mentor | izgrađeno |
| Prikaz | Ponovni prikaz nastanka rada | baza i S3 → nastavnik, uz zapis pristupa | `app/api/evidence/replay/route.ts`, `src/server/evidence/replay-route.ts`, `src/server/evidence/payload-reader.ts` | 13, 14, 21, 25 | nastavnik zadatka, mentor | izgrađeno |
| Prikaz | Sažetak procesa | baza → nastavnik, uz zapis pristupa | `app/api/process-summary/route.ts`, `src/server/projection/process-summary.ts` | 21, 25 | nastavnik zadatka, mentor | izgrađeno |
| Prikaz | Brzi put nastavnika | baza → nastavnik: imena, predaje i puni tekst kontrolne točke, uz zapis pristupa | `app/api/teacher/fast-path/route.ts`, `src/server/teacher/fast-path.ts`, `app/nastavnik/brz-put/page.tsx` | 2, 14, 16, 21, 25 | nastavnik | izgrađeno |
| Prikaz | Stranica rada za nastavnika | baza → nastavnik kroz prikaz uživo i sažetak procesa | `app/nastavnik/rad/[id]/page.tsx`, `src/components/teacher/LiveText.tsx`, `src/components/teacher/SummaryCard.tsx` | 15, 21, 25 | nastavnik zadatka, mentor | izgrađeno; čita kroz API putove iz dvaju redaka iznad; komentari na toj stranici nisu provjereni |
| Prikaz | Studentov uvid u zapis pristupa | baza → student | `db/migrations/20261107180000_read_my_access_log.sql`, `db/migrations/20261021120000_audit_access_log.sql` | 25 | student | planirano; funkcija postoji u bazi, aplikacija je ne poziva |
| Predaja | Predaja rada | student → baza: zahtjev, predana verzija i potpisana potvrda | `app/api/submission/route.ts`, `src/server/evidence/submission-route.ts`, `src/server/evidence/submission-receipt.ts`, `src/client/submission.ts` | 16, 27 | student, nastavnik zadatka | izgrađeno |
| Predaja | Popis predaja zadatka | baza → nastavnik | `app/api/teacher/assignments/[assignmentId]/submissions/route.ts`, `src/server/evidence/assignment-submissions.ts` | 11, 16 | nastavnik zadatka | izgrađeno |
| Predaja | Komentari | student, nastavnik i mentor → baza | `app/api/comments/[action]/route.ts`, `src/server/collaboration/comments.ts`, `src/client/comments.ts` | 18 | sudionici rada | izgrađeno; tekst do 2000 znakova, citat sidra do 500 |
| Predaja | Zahtjevi za doradu | nastavnik → baza; student odgovara | `app/api/revision-requests/[action]/route.ts`, `src/server/collaboration/revision-requests.ts` | 19 | student, nastavnik | izgrađeno |
| Izvoz | Preuzimanje teksta rada (TXT) | lokalni dnevnik → datoteka na uređaju (`ductus-rad.txt`, `ductus-raniji-tekst.txt`) | `src/components/editor/LocalDocument.tsx`, `src/components/editor/EarlierDraft.tsx`, `src/components/editor/LogoutDialog.tsx` | 30 | student na svom uređaju | izgrađeno; samo u pregledniku, poslužitelj ne sudjeluje |
| Izvoz | Izvozni paket za studenta | baza i S3 → paket za preuzimanje | `docs/privacy/06-klase-podataka.md`, `docs/privacy/07-prijedlog-rokova-cuvanja.md` | 20 | student | planirano |
| Logovi | Greške poslužitelja | poslužitelj → standardni izlaz procesa | `src/server/auth/flow.ts`, `src/server/collaboration/comments.ts`, `src/server/evidence/replay-route.ts`, `src/server/db/index.ts` | — zatvoreni kodovi i SQLSTATE, bez imena, identifikatora i teksta rada | operater poslužitelja | izgrađeno |
| Logovi | Upozorenja spremnika evidencije | poslužitelj → standardni izlaz procesa | `src/adapters/evidence/s3-evidence-payload-store.ts`, `src/adapters/evidence/institution-routed-payload-store.ts` | 21 | operater poslužitelja | izgrađeno; bilježe identifikator ustanove, paketa evidencije i hash odsječka |
| Logovi | Provjera konfiguracije pri pokretanju | poslužitelj → standardni izlaz procesa | `instrumentation.ts` | — samo imena neispravnih varijabli okruženja | operater poslužitelja | izgrađeno |
| Logovi | Zdravlje, spremnost i gašenje | nadzor → poslužitelj | `app/api/health/route.ts`, `app/api/ready/route.ts`, `src/server/ready.ts`, `src/server/shutdown.ts` | — stanje procesa i baze, bez podataka korisnika | operater poslužitelja | izgrađeno |
| Logovi | Nepoznata API putanja | preglednik → poslužitelj | `app/api/[...path]/route.ts` | — odgovor 404, ništa se ne bilježi | nitko | izgrađeno |
| Logovi | E-pošta | poslužitelj → lokalni Mailpit | `compose.yaml` | — samo lokalni razvojni stog, aplikacija ne šalje e-poštu | nitko | planirano; na `main` nema slanja e-pošte ni praćenja grešaka |

Napomene uz tablicu:

- Revizijske funkcije za mentorstva, objavu pravila fakulteta i imenovanje ili opoziv administratora ustanove postoje u bazi, ali ih aplikacija ne poziva; zato ih tablica ne navodi kao tok.
- Obavijesti u aplikaciji (klasa 6) i kopije (klasa 29) na `main` nemaju tok u kodu aplikacije.

## 3. Otvoreno

Ovaj inventar ništa od navedenog ne odlučuje.

- Q-3: paket pitanja za FPZG, uključujući DPO-a i DPIA uz DPO-a (D-257), otvoreno.
- Q-16: rokovi čuvanja i brisanje u kopijama, otvoreno; kod čuvanja se ne gradi.
- D-30: rokovi čuvanja su PRIJEDLOG, otvoreno; inventar ne navodi rok ni za jedan tok.
- D-55, D-142 i D-143: pravno mišljenje i ocjena vremena po promjeni prije pilota sa stvarnim studentima, otvoreno.
- D-29: otvoreno, ide u paket za FPZG (Q-3).
- Strukturirani dnevnik poslužitelja (DAN-586) nije na `main`; što će bilježiti i koliko dugo, otvoreno.
- Pozadinski posao potpisa i potpis u KMS-u (D-92) nisu spojeni; tok digesta prema AWS KMS-u i njegov dobavljač (Q-2), otvoreno.
