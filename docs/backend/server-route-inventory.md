# Inventar ruta aplikacije (ulaz za prijenos na server)

Zadatak DAN-714, plan servera S-0.2. Samo dokumentacija: ništa se ne mijenja u kodu. Popis je stanje `main` na dan 14. 11. 2026. i vodi se uz `tests/unit/server-route-inventory.test.ts`, koji ga uspoređuje s datotekama `app/api/**/route.ts`.

Plan servera navodi 37 ruta; na mainu je **38** `route.ts` datoteka (uključujući `[...path]`). Popis pokriva sve, a test ne tvrdi broj nego usporedbu s datotekama.

## Zajedničko

- Sve rute imaju `runtime = "nodejs"` i `dynamic = "force-dynamic"`; odgovori su `no-store`.
- Mutacije (POST/PUT) koje prolaze kroz `counted(...)` idu kroz zajednički čuvar (izuzeci niže): Origin mora odgovarati konfiguriranom pozivu OIDC-a, `Content-Type: application/json`, ograničenje tijela i vremena čitanja, kolačić sesije, pa `counted` bilježi aktivnost. Ovlast ne odlučuje ruta nego baza (`withActor`, RLS, RPC). Klijent ne piše izravno u tablice. Izuzeci čuvara: `auth/backchannel-logout` prima `application/x-www-form-urlencoded` bez kolačića (logout token pružatelja), `auth/logout` i `auth/logout-all` provjeravaju samo isti Origin (bez `counted` i bez provjere Content-Typea), a `[...path]` na POST vraća 404.
- Greške su zatvoreni kodovi (`unauthorized`, `forbidden`, `invalid_input`, `unavailable`); poruke baze, SQL i parametri ne izlaze.
- Čitanja koja nose identifikator dokumenta ili komentara rade se kao POST da id ne završi u URL-u ni u zapisniku pristupa.

## Rute

Stupac „Ciljni zadatak” je oznaka obitelji u planu servera (PRIJEDLOG): `S-M-*` platforma i prijava, `S-1D-*` ustanova, suradnja i podrška, `S-1E-*` evidencija i dokazi. Točne sufikse upisuje orkestrator iz plana (plan je izvan repoa).

| Datoteka | Metoda | Tko smije pozvati | Ulaz | Izlaz | Ciljni zadatak |
| --- | --- | --- | --- | --- | --- |
| `app/api/[...path]/route.ts` | GET, POST, PUT, PATCH, DELETE | svatko | — | 404 `{error:not_found}`, `no-store` | S-M-* |
| `app/api/auth/backchannel-logout/route.ts` | POST (ostale 405) | pružatelj prijave (AAI), bez kolačića | potpisani logout token, do 16 KiB | zatvara sesije korisnika; zatvoreni kodovi | S-M-* |
| `app/api/auth/callback/route.ts` | GET | svatko (povratak s pružatelja, state i PKCE) | `code`, `state` u upitu | preusmjerenje, postavlja kolačić sesije | S-M-* |
| `app/api/auth/login/route.ts` | GET | svatko | `returnTo` u upitu (provjeren `safeReturnTo`) | preusmjerenje na pružatelja prijave (PKCE) | S-M-* |
| `app/api/auth/logout-all/route.ts` | POST | prijavljen korisnik, Origin | prazno tijelo | zatvara sve sesije korisnika | S-M-* |
| `app/api/auth/logout/route.ts` | POST | prijavljen korisnik, Origin | prazno tijelo | zatvara trenutnu sesiju | S-M-* |
| `app/api/comments/[action]/route.ts` | POST | prijavljen korisnik; baza odlučuje (`collaboration.actor_role`, ZD403) | akcija `create, reply, resolve, reopen, delete, list`; JSON do 16 KiB | redak komentara ili popis | S-1D-* |
| `app/api/evidence/commit/route.ts` | POST | student vlasnik rada | omotnica commita (base64 bajtovi, ključ idempotencije), zatvoren skup ključeva | potvrda revizije ili 409 `stale_base` ili drugi zatvoreni `status` | S-1E-* |
| `app/api/evidence/open/route.ts` | POST | student vlasnik; nastavnik kroz bazu | JSON do 1 KiB (`documentId`) | stanje otvaranja rada | S-1E-* |
| `app/api/evidence/replay/route.ts` | POST | student vlasnik; nastavnik kroz bazu | JSON do 1 KiB (`documentId`) | kontrolne točke i izvor za rekonstrukciju | S-1E-* |
| `app/api/health/route.ts` | GET | svatko (živost) | — | 200 `{status:ok}`, `no-store` | S-M-* |
| `app/api/institution/assignments/[assignmentId]/acknowledgment/route.ts` | POST | student upisan na kolegij | JSON do 1 KiB | potvrda obavijesti (`acknowledge_notice`) | S-1D-* |
| `app/api/institution/assignments/[assignmentId]/students/[studentId]/work-language/route.ts` | POST | nastavnik kolegija | JSON do 128 B (`expectedVersion`, `language`) | izuzetak jezika za jednog studenta | S-1D-* |
| `app/api/institution/assignments/[assignmentId]/versions/route.ts` | POST | nastavnik kolegija | JSON do 90 000 B | nova verzija zadatka (`publish_assignment_version`) | S-1D-* |
| `app/api/institution/assignments/[assignmentId]/work-language/route.ts` | POST | nastavnik kolegija | JSON do 128 B (`expectedVersion`, `language`) | jezik rada za zadatak | S-1D-* |
| `app/api/institution/assignments/[assignmentId]/works/[documentId]/work-language/route.ts` | POST | nastavnik kolegija | JSON do 128 B (`expectedVersion`, `language`) | izuzetak jezika za jedan rad | S-1D-* |
| `app/api/institution/courses/[courseId]/assignments/route.ts` | POST | nastavnik kolegija | JSON do 90 000 B (`create_assignment`) | novi zadatak | S-1D-* |
| `app/api/institution/courses/[courseId]/enrollment-code/revocation/route.ts` | POST | nastavnik kolegija | JSON do 64 B | opoziv koda za upis | S-1D-* |
| `app/api/institution/courses/[courseId]/enrollment-code/route.ts` | POST | nastavnik kolegija | JSON do 1 KiB | novi kod za upis (prikaz jednom) | S-1D-* |
| `app/api/institution/courses/[courseId]/students/[studentId]/removal/route.ts` | POST | nastavnik kolegija | JSON do 64 B | uklanjanje studenta s kolegija | S-1D-* |
| `app/api/institution/courses/[courseId]/students/[studentId]/return-permission/route.ts` | POST | nastavnik kolegija | JSON do 64 B | dopuštenje povratka studenta | S-1D-* |
| `app/api/institution/courses/route.ts` | POST | nastavnik s ovlasti | JSON do 2 KiB (`create_course`) | novi kolegij | S-1D-* |
| `app/api/institution/enrollments/route.ts` | POST | student (prijavljen) | JSON do 1 KiB (`code`) | 200 `{courseId}`; 422 `refused`; 429 `too_many_attempts` | S-1D-* |
| `app/api/institution/teachers/[teacherId]/role-confirmation/route.ts` | POST | administrator ustanove | JSON do 64 B | potvrda uloge nastavnika | S-1D-* |
| `app/api/institution/teachers/[teacherId]/role-revocation/route.ts` | POST | administrator ustanove | JSON do 64 B | opoziv uloge nastavnika | S-1D-* |
| `app/api/live/[documentId]/route.ts` | GET, PUT | PUT student vlasnik; GET vlasnik i nastavnik (isti bajtovi i ETag) | PUT točni JCS bajtovi valjanog dokumenta do `MAX_DOCUMENT_SNAPSHOT_BYTES` | zadnje stanje dokumenta, ETag | S-1D-* |
| `app/api/process-summary/route.ts` | POST | student vlasnik; nastavnik kroz bazu | JSON do 1 KiB (`documentId`) | sažetak procesa iz dokaza | S-1E-* |
| `app/api/profile/interface-locale/route.ts` | GET, POST | prijavljen korisnik | POST JSON do 256 B | jezik sučelja | S-M-* |
| `app/api/ready/route.ts` | GET | svatko (spremnost) | — | 200 ili 503 sa zatvorenim riječima po sposobnosti (capability) | S-M-* |
| `app/api/revision-requests/[action]/route.ts` | POST | prijavljen korisnik; baza odlučuje | akcija (create, respond, accept, reopen, rereview, withdraw, list); JSON do 16 KiB | zahtjev za reviziju ili popis | S-1D-* |
| `app/api/status/route.ts` | GET | svatko (javni status) | — | 200 sa zatvorenim tijelom u tri dijela ili 503 bez tijela (gašenje ili neuspjela provjera), `no-store` | S-M-* |
| `app/api/submission/route.ts` | POST | student vlasnik rada | JSON do 1 KiB (`documentId`, `revision`) | predaja rada (potpisana potvrda) | S-1E-* |
| `app/api/support/problem-report/route.ts` | POST | prijavljen korisnik | JSON do 8 KiB, kanonski, zatvoren skup klasa | referenca prijave; 429 `too_many_reports` | S-1D-* |
| `app/api/teacher/assignments/[assignmentId]/submissions/route.ts` | GET | nastavnik kolegija | — | predaje za zadatak | S-1D-* |
| `app/api/teacher/courses/route.ts` | GET | nastavnik | — | kolegiji i zadaci nastavnika | S-1D-* |
| `app/api/teacher/fast-path/route.ts` | POST | nastavnik kolegija | JSON do 1 KiB | brzi pregled radova | S-1E-* |
| `app/api/teacher/mentorships/[mentorshipId]/route.ts` | GET (ostale 405, OPTIONS isto) | mentor nastavnik | — | radovi jednog mentorstva | S-1D-* |
| `app/api/teacher/mentorships/route.ts` | GET (ostale 405, OPTIONS isto) | mentor nastavnik | — | radovi koje nastavnik mentorira | S-1D-* |

## Ograničenja broja zahtjeva

Postojeća ograničenja nalaze se u bazi, ne u ruti, i moraju se sačuvati pri prijenosu. Ostale rute nemaju zasebno ograničenje broja zahtjeva (samo ograničenje veličine tijela).

- **Upis na kolegij** (`institution/enrollments`): RPC `institution.enroll_with_code` broji pokušaje po korisniku u `institution.enrollment_attempt`; zadano 5 odbijenih pokušaja u 15 minuta (uspješan upis se ne broji) (`institution_settings.enrollment_attempt_limit` 1 do 100, `enrollment_attempt_window` 1 min do 24 h). Pokušaji se serijaliziraju savjetodavnom zaključavanjem po korisniku, zahtijeva se READ COMMITTED, a odbijeni pokušaj sprema svoj pokušaj (zato se ishod mapira tek nakon commita). Ruta vraća 429 `too_many_attempts`.
- **Prijava problema** (`support/problem-report`): RPC odbija s `ZD429` kad korisnik ima 5 ili više prijava u zadnjih sat vremena (zaključava redak korisnika, READ COMMITTED). Ruta vraća 429 `too_many_reports`.

## Poznate granice

- Plan navodi 37 ruta, na mainu ih je 38; razlika je zabilježena, ne objašnjena (plan je izvan repoa).
- Ciljni ID je na razini obitelji dok se ne upišu točni sufiksi iz plana.
