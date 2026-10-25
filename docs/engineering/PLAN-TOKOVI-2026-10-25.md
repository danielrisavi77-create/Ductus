# Ductura — frontend, dizajn i podatkovni tokovi: Implementation Plan

> **For agentic workers:** pri eventualnom izvršenju koristiti superpowers:executing-plans i aktualni projektni ugovor. Ovaj plan ne pokreće sesije, ne delegira posao i ne daje ovlast za implementaciju, merge, deploy ili migraciju produkcije. Neovisni review i QA ostaju prema Engineering Systemu.

**Goal:** povezati postojeću Ducturinu jezgru u cjelovite studentske, nastavničke i administratorske tokove te odrediti konkretan put do operaterskog prostora.

**Architecture:** zadržati postojeći Next.js modularni monolit, PostgreSQL/RLS, withActor, API rute, Tiptap i Dexie. Serverske stranice čitaju postojeće serverske adaptere; HTTP rute dodaju se za korisničke mutacije i dohvat koji je stvarno potreban klijentu. Novi podaci i ovlasti uvode se samo za funkcije kojima postojeći model nije dovoljan.

**Tech Stack:** Node >=24, pnpm 10.33.0, Next.js 15.5.28, React 19.3.1, TypeScript, PostgreSQL/pg, Tiptap, Dexie, Vitest, pgTAP i Playwright prema pregledanom package.json. Zaključane inačice izvršitelj uzima iz aktualnog lockfilea.

**Spec:** repo dokumenti AGENTS.md, CLAUDE.md, STATE.md, docs/PRODUCT.md, ARCHITECTURE.md, BACKEND.md, PROGRAM.md, PLAN-DEMO.md, DECISIONS.md, TESTING.md i usvojeni dizajn docs/design/ductura. Protokol koordinacije je u Linearu.

**Datum i baza:** 25. 10. 2026.; main `5cd9cf8f28bca2804511db4ea166eb0c5c647250`. Osvježenje u odnosu na prethodni audit donijelo je samo promjenu teksta pragova i pripadajućeg testa (#741); ostali pregledani izvori ostali su isti.

**Način rada:** PLAN, bez promjene repoa ili Lineara. Nisu izvršeni aplikacija, lokalni testovi ni neovisni QA. Sve naredbe u nastavku su upute za budućeg izvršitelja, a svi očekivani ishodi su kriteriji, ne ostvareni PASS.

## 1. Global Constraints

- Linear određuje zadatak, prioritet, nositelja, rok, status i predaju. GitHub/repo određuje prihvaćene odluke i izvedbene dokaze.
- Oznake A1–E3 u ovom dokumentu označavaju redoslijed plana, a ne nove identifikatore zadataka ili dodatni statusni registar.
- Postojeći zadatak dopunjuje se prije otvaranja novog. Novi zadatak u Linearu predlaže se samo gdje u pregledu nije nađen pokriven opseg.
- Prije izvršenja: aktualni opis i komentari, aktivne rezervacije, PREUZETO, izolirani worktree, dodijeljene putanje. Završetak: PREDAJA s bazom/HEAD-om, dokazima i preostalim poslom.
- Prijava studenta ostaje isključivo AAI@EduHr. Lažni OIDC dopušten je samo lokalno i u CI-ju. Identitet nije e-mail.
- Akter dolazi iz serverske sesije i current_actor(); studentId, institutionId ili role iz zahtjeva nikad ne daju ovlast.
- Klijent ne piše izravno u tablice evidencije, predaje ni audita. Nove tablice imaju FORCE RLS i odgovarajuću pgTAP matricu.
- SECURITY DEFINER ima prazan search_path i uske EXECUTE grantove; nema proširivanja ductus_app na superuser/BYPASSRLS.
- Student vidi istu dopuštenu projekciju svoga rada kao nastavnik. Administrator ustanove i operater nemaju zadani pristup sadržaju rada.
- Nema procjene autorstva, AI postotaka, rizika osobe, rangiranja studenata ili zaključivanja o trudu.
- Spremljeno na poslužitelju označava samo potvrđenu evidenciju uz provjeren potpis. Live prikaz i trajna evidencija imaju različite ugovore.
- D-166: spašena kopija ostaje uz račun i rad dok je autor izričito ne vrati ili odbaci; odjava uvijek zatvara sesiju.
- D-167: /rad bez zadatka je slobodan lokalni nacrt bez predaje. Pisanje nakon roka ostaje dopušteno; predaja dobiva odgovarajuću oznaku.
- D-107/D-108/D-114: demo ima prednost; ovaj plan ne mijenja proces, gateove ili tooling. Zamrzavanje opsega 28. 10. i cilj demoa 2. 11. ostaju.
- D-168: WebKit/Safari odgođen je nakon demoa; prije stvarnog pilota vrijede aktualni puni browser uvjeti.
- Trenutačni CSS v3 i postojeći CSS moduli polazište su za nove ekrane. Koriste se postojeći tokeni, fontovi i komponente.
- Svi testni korisnici i dokumenti su sintetički; tajne, stvarni studentski tekstovi i sirovi auth tragovi ne ulaze u dokaze.
- Risk i neovisnost određuje aktualni Engineering System, uključujući automatski risk floor. Ovaj plan ne uvodi novi formalni gate.

## 2. Review Focus

Pet najvažnijih rubnih slučajeva koje konkretni koraci moraju pokriti:

1. Prelazak iste osobe između dva zadatka: dokument, journal, komentar i predaja ostaju vezani uz isti zadatak. Vlasnik testa: A1.
2. Lokalni nacrt noviji od poslužiteljske revizije: nema tihog prepisivanja, lažnog SYNCED-a ni prešućivanja razlike pri predaji. Vlasnici: A2 i B4.
3. Opoziv prava ili promjena računa dok je ekran otvoren: sljedeći pristup se odbija, stari sadržaj se uklanja prema postojećem session ugovoru. Vlasnici: A2 i C3.
4. Nova verzija zadatka ili produljenje roka: stara potvrda i vrijeme već izvršene predaje ne mijenjaju se retroaktivno. Vlasnici: B7–B9.
5. Nepotpuni podaci, nepoznat status i istek sesije: UI ne prikazuje lažnu praznu listu, nulu ili uspjeh niti otkriva tuđi resurs. Vlasnici: B1, B2, C1 i E1.

## 3. Stvarno postojeće i potrebno proširenje

| Cjelina | Postojeće u pregledanom mainu | Potrebno |
|---|---|---|
| Baza | 34 migracije; identity, institution, evidence, collaboration i audit; RLS i RPC-i | Nove projekcije, ciljane rute i nekoliko domenskih proširenja |
| Studentski editor | /rad, LocalDocument, journal, komentari, lokalno spremanje, live publisher | Završiti stvarni dokument zadatka i spoj trajne evidencije |
| Otvaranje rada | readWorkDocument, readWorkContext, POST /api/evidence/open | Iskoristiti iste rezultate u svim površinama rada |
| Sinkronizacija | AtomicDexieJournal.startEvidence/adoptServerEvidence, createDrainRunner, createEvidenceTransport, evidenceVerifierFor | Povezati stvarnog UI pozivatelja prema postojećem 3d-2c ugovoru |
| Nastavnički ulaz | /nastavnik i readTeacherCourses | Detalj kolegija/zadatka i navigacija do radova |
| Veza zadatak → radovi | readAssignmentWorks i app.assignment_works | F2 poveznice; kasnije puna projekcija predaja i studenata bez rada |
| Novi kolegij/zadatak | TeacherSetup i postojeći createAssignment/course API | Samostalno stvaranje zadatka u postojećem kolegiju |
| Predaja | /rad/[assignmentId]/predaja, Submission, POST /api/submission | Završiti povezani tok; dopuniti postojeće auditne zadatke |
| Uloge | institution_role, confirm/revoke teacher; navigacija teacher/student | Minimalni institucijski admin i dopuštene projekcije korisnika |
| Dorade | Čisti domenski automat revision-request.ts sa 6 stanja | Trajna pohrana, serverska autorizacija i UI |
| Obavijesti | N-01/N-02 u prihvaćenom FEATURES/PROGRAM | Događaji, korisnički inbox, postavke i kasnije isporuka e-poštom |
| Dizajn | v3 tokeni, AppShell, WorkspaceShell, fontovi, responsive i axe | Završiti postojeće popravke i provjeriti nove tokove |

**Baza ostaje jedna po prihvaćenom modelu, s odvojenim ovlastima i granicama ustanova.** Novi studentski dashboard ne traži novu bazu ni preseljenje na Supabase Auth. Objavljena instanca i primijenjene produkcijske migracije nisu provjerene ovim planom.

## 4. Mapa postojećih zadataka i aktivnog rada

| Opseg | Primarni postojeći trag | Uputa za izvršenje |
|---|---|---|
| Dokument zadatka, stari lokalni nacrt, F2 | DAN-89; GitHub #711; otvoren #731 | Nastaviti postojeći ugovor, bez drugog F1 writera |
| Potpisana sinkronizacija, bootstrap/recovery | DAN-37, DAN-49, DAN-285; #476 3d-2c | Provjeriti stvarne dodjele; #734 je uski hardening, ne cijela integracija |
| Puni K-4 | DAN-89, DAN-232; #655; otvoren #726 | Otvoreni PR ne znači izvršeni prihvatni tok |
| Predana revizija, zatvaranje paketa | DAN-289 | Dopuniti postojeći zadatak povezivanjem UI-ja |
| Popis svih predaja | DAN-290 | Dodati roster/projekciju prije punog dashboarda |
| Jednom izdana potvrda | DAN-291 | Iskoristiti postojeći receipt storage; ne uvoditi drugi potpisni put |
| Administrativne i verzijske rute | DAN-292 | Podijeliti po postojećim RPC-ovima i provjerljivim radnjama |
| Snimke/verzije rada | DAN-293 | Dodati čitanje s provjerom hasha i pravima vidljivosti |
| Studentov dnevnik pristupa | DAN-294; prethodni DAN-228 Done | DAN-228 nije dokaz dovršenog studentskog prikaza |
| Retention, infrastruktura i operacije | DAN-297, DAN-298, DAN-299 | Ovisnosti za pilot; zasebno od izgleda frontend ekrana |
| Odjava i spašene kopije | DAN-288; otvoren #751 | Usuglasiti s D-166 i budućim radom s više dokumenata |
| Dizajnerski popravci | #732; #742, #750; DAN-214/281 | #740 i #741 su već na mainu; ne ponavljati ih |
| Studentski dashboard | GitHub #335 | Pronaći/proširiti odgovarajući Linear opseg; po potrebi tek onda novi DAN |
| Task wizard, roster, admin, policy | GitHub #337, #327/#338, #331/#333, #328 | Povezati s postojećim DAN-ovima gdje se preklapaju |
| Responsive i pristupačnost | #341; DAN-232 | Kriteriji uz svaki ekran i završna provjera |

Prije prvog izvršnog koraka osvježiti sve retke. Tijekom planiranja nisu mijenjani statusi ni tuđe rezervacije.

## 5. Redoslijed i granice isporuke

| Faza | Ishod | Preduvjeti |
|---|---|---|
| A — postojeći demo | Isti studentski rad prolazi pisanje, trajnu sinkronizaciju, nastavnički komentar i predaju | Aktualni #711, #476 i K-4 |
| B — svakodnevni rad | Moji radovi, postojeći kolegiji, roster, verzije zadatka i rokovi | A; dodatne projekcije i ugovori B4–B9 |
| C — upravljanje i privatnost | Ovlašteni institucijski admin, studentov audit i verzije | A/B; D-16/AAI i data-access odluke |
| D — dodatni prihvaćeni tokovi | Obavijesti, dorade, institucionalna pravila i izvoz | Odgovarajući B/C ugovori i prihvaćeni raspored valova |
| E — pilot i operacije | Provjerljiva spremnost, infrastruktura i zasebna ops granica | Postojeći M1/M10/M11 GO uvjeti |

Faza A je postojeći odobreni posao prije demoa. Faze B–E su prijedlog redoslijeda unutar prihvaćenog programa, uz primjenu njegovih valova; ovaj dokument ih ne prebacuje automatski u demo ili prvi pilot.

## 6. Faza A — dovršetak postojećeg demo toka

### A1. Jedinstveni dokument zadatka i stari lokalni nacrt

**Vlasnik:** postojeći Frontend pisac; Task DAN-89/#711. **Risk:** critical.

**Datoteke:** postojeći app/rad/page.tsx, src/components/editor/LocalDocument.tsx, CommentPanel.tsx, src/components/student/work-context-read.ts; novi work-document-plan.ts i OpenWork.* postoje u otvorenom #731, ne stvarati njihove kopije. Serverski izvor je src/server/evidence/work-document-read.ts.

**Interfaces:** koristiti postojeći `readWorkDocument(token, assignmentId, withActor): Promise<WorkDocumentRead>` i `openWork(assignmentId)`. Njihov `documentId` ide u journal, komentare, live i predaju. Ugovor #711 i D-167 određuju odvojeni slobodni nacrt.

- [ ] Provjeriti #731 na njegovu aktualnom headu i dovršiti postojeći F1a postupak.
- [ ] F1b dovršiti u zasebnom postojećem podkoraku: stari local-demo-document ponuditi kao spašenu kopiju; ručni prijenos bilježi lijepljenje.
- [ ] Provesti konkretne E2E asercije: zadatak A i B daju različite id-jeve; ista predaja i editor daju isti id; drugi korisnik ne vidi kopiju; GET stranice ne stvara rad.
- [ ] Izvesti profil UI + TRUST iz odjeljka 12, zatim predati stvarni SHA i poznate granice.

**Dokaz:** `expect(editorDocumentId).toBe(submissionDocumentId)` i `expect(documentA).not.toBe(documentB)` uz stvarne sintetičke radove. Nazivi varijabli ovdje označavaju vrijednosti opažene u E2E-u, nisu novi produkcijski API.

### A2. Stvarni UI pozivatelj evidencije, novi uređaj i oporavak

**Vlasnici:** postojeći Frontend/Backend opsezi DAN-37/DAN-49/#476. **Risk:** critical.

**Datoteke:** src/components/editor/LocalDocument.tsx; postojeći src/lib/journal/atomic-dexie-journal.ts, src/lib/sync/drain-runner.ts, evidence-transport.ts; src/client/evidence-ingest.ts; src/domain/serverSync/bootstrap.ts. Ako ugovor dodaje EvidenceSession, upotrijebiti putanju koju je već odredio postojeći pisac.

**Interfaces:** `journal.startEvidence(documentId, opened, openedAt)`, `journal.adoptServerEvidence(...)`, `createDrainRunner(deps).step(documentId)`, `createEvidenceTransport()` i `evidenceVerifierFor(work)`. Tijela i potpise funkcija preuzeti iz aktualnog ugovora; ovaj plan ih ne mijenja.

- [ ] Završiti postojeći bootstrap: lokalni snapshot zadržava lokalni rad; uređaj bez journala dobiva provjereni server snapshot; bez oba izvora nema izmišljenog praznog dokumenta.
- [ ] Spojiti snimanje odsječaka, transport i provjeru potvrde po istom dokumentu. Uz kasni odgovor nakon novog EDIT-a ne postaviti lažni SYNCED.
- [ ] Izvesti scenarije: offline → povrat; izgubljen odgovor i retry; novi uređaj; dvije kartice; dva konkurentna uređaja; korumpiran server snapshot; istek sesije; spašena kopija kroz odjavu/prijavu.
- [ ] Predati TRUST provjere i zapisati što od recovery ugovora nije izvedeno.

**Granica:** offline ponovno pokretanje aplikacije/PWA nije dio ovog koraka. Multi-device i trajna evidencija imaju prednost pred novim offline startup mehanizmom.

### A3. Nastavnik dolazi do stvarnog rada kroz navigaciju

**Vlasnik:** postojeći F2 u DAN-89/#711. **Risk:** najmanje standard; povećati ako se mijenja authz.

**Datoteke:** src/components/teacher/TeacherCourses.tsx, app/nastavnik/rad/[id]/page.tsx; postojeći src/server/evidence/assignment-works.ts. Detalj rute odabrati prema postojećem F2 ugovoru, a B5 kasnije proširuje puni ekran.

**Interface:** `readAssignmentWorks(sessionToken, assignmentId, withActor): Promise<AssignmentWorksRead>` vraća samo parove `studentId/documentId`. Nije izvor imena, statusa predaje ili studenata bez rada.

- [ ] Dovršiti postojeće poveznice kolegij/zadatak → rad, bez ručnog prepisivanja id-ja u adresu.
- [ ] Zadržati jednaku zabranu za tuđi i nepostojeći rad; obična poveznica nije dokaz prava.
- [ ] E2E: nastavnik otvori rad vlastitog zadatka; nastavnik drugog kolegija i drugi student dobiju neutralno odbijanje.
- [ ] UI + odgovarajući TRUST dokaz na testiranom SHA-u.

**Prikaz identiteta:** B2 projekcija ne nosi ime ni prezime. Za ovaj mali most ne izmišljati imena; puni roster zahtijeva C1 ugovor.

### A4. Puni K-4 kroz prihvaćene površine

**Vlasnik:** postojeći QA/Frontend opseg DAN-89 i DAN-232. **Risk:** po stvarnom diffu i aktualnim iznimkama.

**Datoteke:** e2e/login/demo-flow.spec.ts; postojeći evidence-receipt.ts, assignment-work.ts i sintetički fixtureovi. Sažetak ostaje ProcessSummaryView.

- [ ] Nakon A1–A3 zamijeniti tri obvezna test.step.skip stvarnim radnjama; ne uklanjati skip oznaku bez dokaza ishoda.
- [ ] Jedan tok: nastavnik stvara zadatak → student se upisuje i potvrđuje obavijest → piše offline → dobiva provjerenu potvrdu → nastavnik otvara i komentira → student predaje → obje uloge otvaraju isti sažetak.
- [ ] Usporediti documentId, reviziju i otisak kroz iste stvarne zapise, ne samo izgled teksta.
- [ ] Izvesti negativne slučajeve i pregledati video; zapisati source SHA, testirani SHA, rezultate i broj obveznih preskočenih koraka = 0.

**Prije prihvata:** DAN-89 Done i zeleni CI ne zamjenjuju taj dokaz. Korekcija statusa pripada ovlaštenom nositelju u Linearu.

## 7. Faza B — svakodnevni studentski i nastavnički rad

### B1. Serverska projekcija studentskih kolegija, zadataka i radova

**Vlasnik:** Backend. **Trag:** #335, M2/M7; povezati Linear prije izvršenja. **Risk:** critical ako se uvodi/širi podatkovna granica.

**Create:** src/server/institution/student-workspace.ts i student-workspace.test.ts. **Test:** novi db/tests/090-student-workspace.sql; numeraciju provjeriti prije upisa.

**Predloženi novi interface:**
```ts
type StudentWorkspaceItem = {
  assignmentId: string; courseId: string; courseName: string; academicYear: string;
  title: string; opensAt: string; dueAt: string; currentVersion: number;
  acknowledged: boolean; documentId: string | null;
  serverRevision: number | null; submittedRevision: number | null;
  submittedAt: string | null; afterDeadline: boolean | null;
};
type StudentWorkspaceRead =
  | { kind: "ok"; items: StudentWorkspaceItem[] }
  | { kind: "unauthorized" | "unavailable" };
declare function readStudentWorkspace(token: string | undefined, withActor: WithActor):
  Promise<StudentWorkspaceRead>;
```

- [ ] Testirati sintetičku studenticu s dva kolegija i radovima te drugu ustanovu: vidi samo vlastite dopuštene zadatke i predaje; zatvoreno članstvo ne otvara editor.
- [ ] Implementirati jedan RLS SELECT u withActor, s eksplicitnim provjerama uloge/aktivnog članstva po uzoru na WORK_DOCUMENT_SQL. Ako postojeća RLS prava nisu dovoljna, dodati uski RPC po modelu assignment_works, a ne širiti grantove na identity tablice.
- [ ] Razlikovati odsutan rad, odsutnu predaju i nedostupnu bazu. Ne izvoditi aktivnost iz vremena ni označavati lokalni nacrt kao potvrđen serverski rad.
- [ ] DB + UNIT provjere. Prva inačica može čitati postojeće tablice bez nove migracije; indeks ili RPC dodati tek uz pokazanu potrebu.

**Spremno kad:** vlastiti popis je stvaran, tuđi se redak ne može dobiti podmetnutim parametrom, nedostupnost baze nije prazna lista.

### B2. Studentski ekran Moji radovi i početna po dostupnom prostoru

**Vlasnik:** Frontend. **Ovisi:** B1. **Risk:** standard; primijeniti risk floor za stvarni diff.

**Create:** app/student/page.tsx, app/student/loading.tsx, src/components/student/StudentWorkspace.tsx i StudentWorkspace.module.css. **Modify:** app/page.tsx, src/components/shell/nav.ts, src/lib/i18n/messages.hr.ts. Putanja /student je prijedlog ovog plana, nije postojeća ruta.

**Interface:** `StudentWorkspace({items}: {items: readonly StudentWorkspaceItem[]})`; server stranica poziva samo readStudentWorkspace. Odabrani assignment vodi preko /zadatak/[id] i postojeće notice provjere.

- [ ] E2E student-workspace.spec.ts: dva kolegija, dva zadatka, nova verzija obavijesti, predani rad, prazan dopušteni popis i nedostupna baza daju različita ispravna stanja.
- [ ] Prikazati naslov, kolegij, akademsku godinu, rok i dokazano stanje rada; dodati pretragu po naslovu i filter po godini. Pretraga nikad ne proširuje serverski skup podataka.
- [ ] U navigaciji dodati Moji radovi, a Slobodan nacrt i Upis ostaviti zasebnima. Početna vodi u dopušteni prostor; promjena navigacije ne dodjeljuje ulogu.
- [ ] UI provjera na desktopu i telefonu; povratak iz editora čuva točan zadatak.

**Arhiva:** prošla akademska godina je filter, ne automatsko brisanje, zatvaranje ili read-only. Prava arhiva zahtijeva dogovoren lifecycle kolegija u M2.

### B3. Zadatak u postojećem kolegiju

**Vlasnik:** Frontend; Backend samo ako ugovor pokaže nedostatak postojećeg čitanja. **Trag:** dopuniti DAN-35/#337. **Ovisi:** osnovni readTeacherCourses. **Risk:** standard.

**Create:** app/nastavnik/kolegiji/[courseId]/zadatak/novi/page.tsx, src/components/teacher/AssignmentForm.tsx i ciljane testove. **Modify:** TeacherSetup.tsx i TeacherCourses.tsx. **Reuse:** src/components/teacher/assignment-create.ts, postojeći POST /api/institution/courses/[courseId]/assignments i createAssignment.

**Interface:** `AssignmentForm({courseId, coursePolicy}: {courseId: string; coursePolicy: CoursePolicy})`. U kodu ponovno koristiti postojeći tip CoursePolicy, validaciju assignmentBody i idempotency key ugovor.

- [ ] Test naziva existing course creates second assignment without creating another course: poslije uspjeha jedan kolegij ima dva zadatka; createCourse nije pozvan.
- [ ] Izdvojiti postojeća polja zadatka iz TeacherSetup u AssignmentForm bez promjene njihove semantike. Page utvrđuje da courseId pripada nastavnikovom dopuštenom popisu.
- [ ] Isti obrazac koristiti nakon stvaranja novog kolegija i iz detalja postojećeg; nakon uspjeha ponuditi Otvori zadatak / Natrag na kolegij.
- [ ] Provjeriti retry istog zahtjeva, izgubljen odgovor, odbijen kolegij i očuvanje upisanih polja nakon greške. UNIT + UI.

### B4. Dosljedna predaja i trajno vezanje predane revizije

**Vlasnici:** Backend i postojeći Frontend predaje u odvojenim PR-ovima. **Trag:** DAN-289, DAN-291, DAN-87; ne otvarati drugi submission mehanizam. **Risk:** critical.

**Datoteke:** postojeći src/server/evidence/submission.ts, submission-record.ts, src/components/student/Submission.tsx i SubmissionView.ts, src/lib/journal/atomic-dexie-journal.ts; nove migracije s bazama imena close_submitted_package i stable_submission_receipt samo ako to preostaje u aktualnom DAN-u. Dovršiti unutar postojećih testova predaje i db/tests/061-submission.sql, db/tests/062-submission-record.sql i db/tests/063-submission-receipt-issuance.sql.

**Interfaces:** sačuvati postojeći SubmissionOutcome i SignedSubmissionReceiptV1; kod slijedi stvarni request_submission → rekonstrukcija → record_submission. Predaja uvijek imenuje prikazanu serversku reviziju.

- [ ] Prvo reproducirati rizik: poslužitelj ima reviziju N, lokalno je noviji nepotvrđeni tekst; otvoriti stranicu predaje. Zabilježiti stvarno ponašanje prije proglašenja buga.
- [ ] Dodati čitanje lokalnog stanja za isti scope/documentId. Predloženi UI ugovor: kod potvrđenih pending promjena primarna radnja vraća na sinkronizaciju; svjestan izbor stare prikazane revizije mora biti zasebno i jasno potvrđen. Ako lokalno stanje nije dostupno, prikazati unknown i ne tvrditi da su svi uređaji sinkronizirani. Ovaj izbor potvrditi u postojećem ugovoru predaje prije koda.
- [ ] Backendovim atomskim korakom završiti prihvaćeni DAN-289 ugovor zatvaranja paketa. Sačuvati predani revision/hash i mogućnost čitanja baš te verzije; eventualni novi krug rada zahtijeva zaseban ugovor otvaranja, bez promjene već predane revizije.
- [ ] DAN-291: prvi uspješan rezultat potvrde pohraniti i ponovno vratiti iste bajtove, vrijeme i identifikatore. Iskoristiti već postojeću submission_receipt_issuance migraciju i provjeriti što točno još nedostaje.
- [ ] Testirati gubitak odgovora, dupli klik, dvije kartice, lokalni edit tijekom učitavanja predaje, mismatch, promjenu baze nakon predaje i ponovno čitanje potvrde. DB + UNIT + TRUST + UI.

**Podjela:** lokalni guard, zatvaranje paketa/čitanje predane verzije i stabilna potvrda tri su neovisno pregledljiva PR-a u postojećim zadacima. U demo ulazi samo dio koji pripada važećem prihvatnom ugovoru; ostalo se dovršava prije stvarnog pilota.

### B5. Puna serverska projekcija nastavničkog popisa radova i predaja

**Vlasnik:** Backend. **Trag:** DAN-290 i čitanje predane verzije iz DAN-289. **Ovisi:** B4 za immutable submission detalj; C1 prije proširenja identiteta. **Risk:** critical.

**Create:** src/server/institution/assignment-roster.ts, assignment-roster.test.ts, nova migracija assignment_submissions i pgTAP datoteka assignment-submissions.sql. **Reuse:** institution.course_member, evidence.submission, app.assignment_works.

**Predloženi interface:**
```ts
type AssignmentRosterItem = {
  studentId: string; displayLabel: string | null;
  documentId: string | null; submissionId: string | null;
  submittedRevision: number | null; submittedAt: string | null;
  afterDeadline: boolean | null;
};
type RosterCursor = { sortKey: string; studentId: string };
type AssignmentRosterRead =
  | { kind: "ok"; items: AssignmentRosterItem[]; nextCursor: RosterCursor | null }
  | { kind: "unauthorized" | "not_found" | "unavailable" };
declare function readAssignmentRoster(
  token: string | undefined, assignmentId: string,
  page: { limit: number; cursor: RosterCursor | null }, withActor: WithActor
): Promise<AssignmentRosterRead>;
```

- [ ] pgTAP fixture: četiri upisana studenta — bez rada, rad bez predaje, pravodobna predaja i predaja nakon roka. Rezultat ovlaštenog nastavnika ima sva četiri; nema pristupa nastavnika drugog kolegija ni druge ustanove.
- [ ] Implementirati predloženi RPC app.assignment_submissions(p_assignment_id uuid, p_limit integer, p_after_sort_key text, p_after_student_id uuid). Zadani limit je 50, dopušteno 1–100; server validira cursor. Cross-schema čitanje slijedi uske helper-e i vlasništvo iz assignment_works, ne globalni SELECT grant.
- [ ] Vrijeme i kašnjenje uzimati iz pohranjene predaje. Polje displayLabel ostaje null dok C1 ugovor ne osigura dopušten izvor; ne koristiti DEMO_FAST_PATH.
- [ ] Ugovor C1 mora definirati stabilni sortKey prema dopuštenom prezimenu/oznaci i provjerenoj DB kolaciji. Keyset cursor zatim koristi (sortKey, studentId); za neprovjereno imenovanje ne prikazivati tvrdnju o poretku po prezimenu. Prvi mali F2 iz A3 ne čeka ovaj puni roster.
- [ ] Izvesti DB + UNIT, uključujući opoziv uloge tijekom postojeće sesije.

**Granica:** popis svih trenutno upisanih i povijesni prikaz uklonjenih studenata odvojeni su upiti i prava. Ovdje se ne daje administratoru pristup sadržaju.

### B6. Nastavnički detalj zadatka i pregled predane verzije

**Vlasnik:** Frontend. **Trag:** #327/#338 + DAN-290/DAN-289. **Ovisi:** B5, A3. **Risk:** standard za prikaz, critical kad se dira trust granica.

**Create:** app/nastavnik/zadatak/[assignmentId]/page.tsx, loading.tsx; src/components/teacher/AssignmentRoster.tsx i CSS. **Modify:** TeacherCourses.tsx; FastPath.tsx samo prema odobrenom ugovoru stvarne projekcije.

**Interface:** `AssignmentRoster({items}: {items: readonly AssignmentRosterItem[]})`. Server stranica validira cursor iz searchParams i zove readAssignmentRoster s page argumentom; paginacijske poveznice čuvaju assignmentId. Link na live rad i link na predanu reviziju dvije su jasno označene radnje.

- [ ] E2E assignment-roster.spec.ts: svi upisani su prikazani, rad bez predaje nije Predano, a nakon nove promjene dokumenta predana verzija i dalje je ista.
- [ ] Dodati navigaciju kolegij → zadatak → studentov rad; prikazati stanja tekstom bez rangiranja po količini rada ili evidenciji.
- [ ] Ponuditi Otvori trenutačni rad i Otvori predanu verziju samo kad za njih postoje ovlašteni serverski podaci.
- [ ] Provjeriti duga sintetička imena/naslove, prazne retke, tipkovnicu, uski ekran, paginaciju i neutralan odgovor na tuđi assignmentId. UNIT + UI.

**Ne koristiti:** stariji #327 prijedlog prosječne dovršenosti ili dokaznih nedostataka bez provjere PRODUCT pravila i D-105. Tijek rada i cjelovitost evidencije ostaju različite informacije.

### B7. HTTP granica za novu verziju zadatka

**Vlasnik:** Backend. **Trag:** DAN-292, jedan postojeći RPC po koraku. **Risk:** critical.

**Create:** app/api/institution/assignments/[assignmentId]/versions/route.ts, src/server/institution/assignment-version-route.ts i test. **Reuse:** institution.publish_assignment_version, checkMutationRequest, readBodyWithLimit i postojeći zatvoreni parser polja zadatka.

**Predloženi HTTP ugovor:** POST s expectedVersion i istim sadržajnim poljima koja podržava aktualni RPC/AssignmentBody. Uspjeh vraća assignmentId i novu versionNo; zastarjela expectedVersion daje 409 bez upisa; neovlašten resurs neutralan 404/403 prema ugovoru ustanove.

- [ ] Testirati dva zahtjeva s istom expectedVersion: najviše jedan stvara novu verziju; drugi ne prepisuje rezultat.
- [ ] Serverski pozvati postojeći RPC u withActor. Pokušaj širenja već potvrđenih pravila mora biti odbijen; nema prepisivanja starih assignment_version ili notice_acknowledgment redaka.
- [ ] Provjeriti postojeći word_min/word_max potpis aktualnog RPC-a; ne koristiti stari potpis iz prve migracije.
- [ ] DB + UNIT + integration: novi student potvrđuje novu verziju, stari acknowledgment ostaje povijesni, evidence za novu verziju traži odgovarajuću potvrdu.

### B8. Uređivanje zadatka s pregledom posljedica promjene

**Vlasnik:** Frontend. **Trag:** #337 uz DAN-292; povezati Linear opseg. **Ovisi:** B3, B7. **Risk:** standard/critical prema semantici promjene.

**Create:** app/nastavnik/zadatak/[assignmentId]/uredi/page.tsx, src/components/teacher/AssignmentVersionPreview.tsx. **Modify:** AssignmentForm.tsx za početne vrijednosti i postojeću verziju; src/components/student/AssignmentNotice.tsx samo ako nedostaje tekst nove potvrde.

**Predloženi interface:** `AssignmentForm` dobiva diskriminiranu konfiguraciju `mode: "create" | "newVersion"`; u newVersion slučaju obvezni su assignmentId i expectedVersion. Ne dodavati režim kojim klijent sam određuje prava.

- [ ] Test: nastavnik vidi staru i predloženu vrijednost; poruka kaže da se objavljuje nova verzija; odbijena promjena čuva upisana polja.
- [ ] Onemogućiti prikaz radnje koja bi širila potvrđena pravila, uz server kao konačnu provjeru. Prikazati 409 i radnju Učitaj aktualnu verziju.
- [ ] Studentu pri sljedećem otvaranju prikazati novu obavijest kroz postojeći gate; bez automatskog označavanja kao pročitano.
- [ ] UNIT + UI: dva nastavnikova prozora, stara forma, novi acknowledgment i očuvanje već izdanih potvrda.

### B9. Produljenje roka i upravljanje upisom kao odvojene radnje

**Vlasnici:** Backend pa Frontend. **Trag:** M7 produljenje; DAN-292 za revoke koda/uklanjanje/povratak. **Risk:** critical za nove ovlasti i podatke.

**Novi model, prijedlog za ugovor:** institution.deadline_extension(assignment_id, student_id, extension_no, due_at, reason, granted_by, created_at), nepromjenjiva povijest; razlog vide samo taj student i nastavnik zadatka. Očekivana verzija produženja štiti paralelne upise. Stvarno ime migracije dodjeljuje dbmate u trenutku izvršenja.

**Predložene datoteke:** src/server/institution/deadline-extension.ts; app/api/institution/assignments/[assignmentId]/extensions/route.ts; src/components/teacher/DeadlineExtensionDialog.tsx. Postojeći request_submission i B1/B5 projekcije trebaju isti izračun efektivnog roka.

- [ ] Definirati i testirati effectiveDueAt kao kasniji od aktualnog općeg roka i dopuštenog individualnog produženja; vrijeme prihvata predaje ostaje requested_at iz sata baze.
- [ ] Dodati RLS/RPC za nastavnika konkretnog zadatka. Produženje se upisuje kao nova odluka; retroaktivno mijenjanje već evidentiranog afterDeadline ishoda nije dopušteno.
- [ ] UI prikazuje kome, do kada i s kojim razlogom se produžuje, uz pregled prije potvrde. Drugi student ne vidi razlog niti podatke.
- [ ] Zasebni mali podkoraci DAN-292 izlažu postojeće revoke_enrollment_code, remove_student i allow_student_return. Dijalog za zamjenu koda jasno kaže da se prethodni kod mijenja; plaintext se prikazuje samo jednom.
- [ ] DB + UI: rub točno na roku, dva UTC vremena u ponovljenom jesenskom satu Europe/Zagreb, ponavljanje zahtjeva, dva nastavnika, opoziv prava i zabranjeni tuđi student.

**Podjela:** deadline backend, deadline UI i upravljanje članstvom/kodom odvojeni su PR-ovi. Odobreni rok čuvanja nije rok predaje i ne koristi ovaj model.

## 8. Faza C — institucijska administracija i privatnost

### C1. Ugovor za prikaz identiteta i potvrdu nastavničke uloge

**Vlasnici:** vlasnik/AAI nositelj i Backend; ovo je ugovor prije skupih promjena koda. **Trag:** DAN-196/DAN-198, D-16, #333.

**Dokaz iz koda:** LoginIdentity u src/server/auth/claims.ts trenutačno ima subject, uniqueId i homeOrg. identity.user_account nema ime/prezime ni pohranjenu pripadnost djelatnicima. confirm_teacher_role provjerava ustanovu i administratorsku ovlast, ali ne provjerava atribut djelatnik.

- [ ] U postojećem AAI zadatku potvrditi koji provjereni izvor daje minimalnu oznaku osobe za studentski roster i popis kandidata; odvojiti identitet od prikaznog imena.
- [ ] Potvrditi D-16 i dokaz podobnosti za nastavničku ulogu: koji podatak se čita, gdje se pohranjuje, koliko je svjež i kako se opoziva.
- [ ] Odrediti da AAI pripadnost samo stvara podobnost; stvarni grant i dalje radi ovlašteni administrator.
- [ ] Tek nakon prihvata ugovora proširiti claims/open_session model i uski identity read. Testirati izmijenjen/neprovjeren atribut, drugu ustanovu, nedostupnost izvora i odsutno prikazno ime.

**Izlaz:** prihvaćen ugovor u postojećem zadatku i repou, s popisom stvarnih atributa i rubnih slučajeva. Ovaj dokument ne izmišlja nazive AAI atributa za ime/prezime niti proglašava D-16 prihvaćenim.

### C2. Uske administratorske projekcije, grantovi i audit promjena

**Vlasnik:** Backend. **Trag:** DAN-292 i #333/#331. **Ovisi:** C1 za stvarne nastavnike; sintetički testovi mogu se pripremiti prije toga. **Risk:** critical.

**Create:** src/server/institution/admin-people.ts, teacher-role-route.ts; app/api/institution/teacher-grants/route.ts i teacher-revocations/route.ts. Nova migracija institution_admin_people dodaje ograničeno čitanje; audit_admin_action dodaje administrativni trag ako aktualni audit modul to još nema.

**Predloženi interfaces:**
```ts
type TeacherCandidate = {
  id: string; displayLabel: string | null;
  eligibility: "verified" | "unknown"; teacherRole: "confirmed" | "unconfirmed";
};
declare function readTeacherCandidates(
  token: string | undefined, withActor: WithActor
): Promise<{kind: "ok"; people: TeacherCandidate[]} |
           {kind: "unauthorized" | "not_found" | "unavailable"}>;
```

HTTP POST grant prima candidateId; opoziv prima teacherId. Akter i ustanova uvijek se izvode iz sesije. Rezultat ne vraća podatke druge ustanove.

- [ ] pgTAP: admin A vidi dopuštene kandidate A i potvrđuje drugu podobnu osobu A; ne potvrđuje sebe, osobu B ni osobu bez potrebnog verificiranog uvjeta.
- [ ] Omotati postojeće institution.confirm_teacher_role i revoke_teacher_role uz checkMutationRequest i zatvorene greške. Retry iste potvrde ne stvara dvostruku aktivnu ulogu.
- [ ] U istoj transakciji zapisati admin radnju s akterom, ustanovom, vrstom, ciljanim resursom, vremenom i ishodom. Dnevnik otvaranja rada ne pretvarati u opći admin log; koristiti zasebnu tablicu ako shema to zahtijeva.
- [ ] Testirati aktivnu sesiju opozvanog nastavnika: sljedeće čitanje rada je odbijeno; prethodna sesija ne održava stari grant.
- [ ] DB + UNIT + integration. Kandidatski popis ne smije postati izvoz svih studentskih identiteta.

### C3. Minimalni fakultetski administratorski prostor i navigacija

**Vlasnik:** Frontend. **Trag:** #331/#333, povezan s DAN-292. **Ovisi:** C2. **Risk:** standard/critical prema dodiru granice ovlasti.

**Create:** app/ustanova/page.tsx, app/ustanova/korisnici/page.tsx, src/components/institution/TeacherRoles.tsx i pripadajući CSS/testovi. **Modify:** AppShell, nav.ts i shell-role.ts; katalog poruka.

**Predloženi interface:** `readShellCapabilities(token, withActor)` vraća serverom utvrđen popis dostupnih područja student/teacher/institutionAdmin. Aktivno područje je ono trenutne rute; capability nije dokaz pristupa pojedinom resursu.

- [ ] Testirati korisnika s nastavničkom i admin ulogom: može promijeniti područje, ali API provjerava svaku radnju. Podmetnut query/cookie role=admin nema učinka.
- [ ] Implementirati popis podobnih nastavnika, stanje čeka potvrdu/potvrđen i dijalog potvrde/opoziva. Radnju prikazati tek uz provjerene podatke i ponoviti provjeru na serveru.
- [ ] Početni admin pregled prikazuje samo ovlaštene metapodatke i vrijeme osvježavanja. Ne dodavati otvaranje studentskih radova.
- [ ] UNIT + UI: prazan popis, unknown podobnost, neuspjeli upis, ponovljeni klik, promjena računa u drugoj kartici i druga ustanova.

**Prvi admin:** i dalje se postavlja postojećim odobrenim provisioning postupkom na zahtjev ustanove; ovaj ekran ne daje sam sebi admin prava.

### C4. Studentov dnevnik pristupa — stvarni read i ekran

**Vlasnici:** Backend pa Frontend. **Trag:** DAN-294, uz DAN-228 kao dokaz postojećeg zapisivanja. **Risk:** critical za novi podatkovni ugovor; ne preuzimati nižu oznaku iz naslova zadatka bez provjere Engineering Systema.

**Create:** src/server/audit/work-access.ts, app/api/documents/[documentId]/access/route.ts; src/components/student/WorkAccessLog.tsx. Nova migracija read_work_access_log dodaje samo ovlašteno čitanje.

**Predloženi DTO:** `{accessedAt: string; actorRole: string; actorLabel: string | null; action: string}`. Vremenska preciznost i imenovanje otvaratelja slijede prihvaćeni ugovor, ne sirovi DB timestamp.

- [ ] Prije koda razriješiti postojeće DAN-294 pitanje što je otvaranje rada, uključujući čitanje komentara. To mijenja značenje zapisa, pa ne izmišljati mjeru u UI-ju.
- [ ] RPC dopušta vlasniku dokumenta samo njegovu projekciju; nastavnik i drugi student kroz ovu rutu nemaju pravo.
- [ ] UI u radu nudi Tko je pristupio radu, s praznim stanjem i nedostupnošću. Nema vremenskog ritma, bodovanja ili izlaganja tuđih dokumenata.
- [ ] pgTAP/UNIT/E2E: jedan nastavnički pristup se pojavi vlasniku; drugi student ne vidi ni redak ni identitet; polling ne proizvodi izmišljene nove ljudske posjete.

### C5. Čitanje verzija rada i studentski vremeplov

**Vlasnici:** Backend pa Frontend. **Trag:** DAN-293/S-02; raspored valova iz PROGRAM. **Ovisi:** A2 i ugovor dopuštenih verzija; B4 za predanu verziju. **Risk:** critical.

**Create:** src/server/evidence/checkpoint-read.ts, app/api/documents/[documentId]/versions/[revision]/route.ts, src/components/student/WorkVersions.tsx. **Reuse:** evidence.document_checkpoint i verifyDocumentSnapshot.

- [ ] Implementirati predloženi app.read_document_checkpoint(documentId, revision) uz postojeći DAN-293 ugovor i ponovnu provjeru hasha.
- [ ] Prvi UI prikazuje vlastite imenovane/poslane/predane verzije; povrat verzije nudi eksplicitnu kopiju/novu izmjenu, bez prepisivanja povijesti ili tihe predaje.
- [ ] Odvojiti studentsku vlastitu povijest od nastavničkog prava na dopuštene verzije. Checkpoint tablica ne daje automatski pravo na sve međusnimke, a vremeplov nije UI reprodukcije znak po znak.
- [ ] DB + UNIT + UI: korumpirani checkpoint se ne prikazuje kao ispravan, tuđa revizija je nedostupna, vraćanje kopije ne mijenja postojeću potvrdu predaje.

## 9. Faza D — obavijesti, dorade, pravila i izvoz

### D1. Obavijesti unutar aplikacije

**Vlasnici:** Backend pa Frontend. **Trag:** N-01/N-02 u FEATURES/PROGRAM; povezati postojeći ili predložiti novi uski Linear zadatak. **Ovisi:** stabilni B/C događaji. **Risk:** critical za nove tablice i ovlasti.

**Predloženi model:** institution.notification s id, institution_id, recipient_id, event_key, kind, target_id, created_at i read_at; jedinstvenost po recipient_id/event_key. Nema sadržaja rada niti proizvoljnih HTML poruka.

**Create:** src/server/notifications/notifications.ts; app/obavijesti/page.tsx, app/api/notifications/read/route.ts i src/components/notifications/NotificationList.tsx. Nova migracija user_notifications; RLS čitanja/označavanja samo za primatelja.

**Interfaces:** `readNotifications(token, cursor, withActor)` vraća ograničen popis metapodataka; `markNotificationRead(token, notificationId, withActor)` idempotentno označava vlastitu obavijest. Vrste prvog reza: objavljen komentar, nova verzija zadatka i zabilježena predaja; dorade dodaje D2.

- [ ] Testirati da retry iste domenske radnje stvara jednu obavijest po primatelju; rollback ne ostavlja lažnu obavijest.
- [ ] Događaj nastaje uz stvarnu mutaciju u istoj DB transakciji ili putem prihvaćenog transakcijskog outboxa. Preglednik ne može proizvoljno slati obavijesti drugim osobama.
- [ ] Inbox i broj nepročitanog čitaju stvarni status; link ponovno provjerava pravo ciljanog resursa. Opoziv pristupa ne smije ostaviti čitljiv sadržaj kroz staru poveznicu.
- [ ] DB + UNIT + UI: drugi primatelj, dupli događaj, prazan inbox, nedostupnost i označi pročitano bez proširenja prava.

**N-01/N-02 drugi rez:** rokovi, postavke i dnevni sažetak e-poštom koriste postojeći predviđeni worker/poslove nakon B-9. Produljenje roka mijenja budući raspored podsjetnika. E-pošta čeka odabran i odobren transport iz B0.1; lokalno Mailpit. Provider, ključevi i naplata ne uvode se ovim planom.

### D2. Trajni zahtjevi za doradu i odgovor studenta

**Vlasnici:** Backend pa Frontend. **Trag:** #338/D-45/M6; pronaći/povezati Linear prije rada. **Ovisi:** A1/A2 i dozvoljeno sidrenje komentara; D1 za obavijesti. **Risk:** critical.

**Reuse:** src/domain/collaboration/revision-request.ts i TextAnchor. Sačuvati stanja OPEN, STUDENT_RESPONDED, SHARED_FOR_REVIEW, ACCEPTED_FOR_REVISION, NEEDS_CLARIFICATION i REREVIEW_REQUIRED.

**Create:** src/server/collaboration/revision-requests.ts; app/api/revision-requests/[action]/route.ts; src/components/editor/RevisionRequests.tsx i nastavničku komponentu. Migracija revision_requests dodaje izvorni zahtjev, odgovor i audit promjena s verzijom stanja.

- [ ] Povezati postojeće createRevisionRequest, submitStudentResponse, shareResponseForReview, acceptForRevision i requestClarification sa serverskim pravima i očekivanom stateVersion.
- [ ] Autor zahtjeva dolazi iz sesije nastavnika toga rada; odgovor daje samo student vlasnik. Izvorni requestedRevision i sidro ostaju sačuvani.
- [ ] Testirati pogrešnu tranziciju, odgovor za drugi requestId, prihvat bez odgovora i dva paralelna odgovora. Jedna tranzicija uspijeva, druga dobiva konflikt bez gubitka teksta.
- [ ] UI prikazuje zahtjev, odgovor, povezanu reviziju i iduću dopuštenu radnju. Prihvaćanje dorade nije ocjena autorstva ni konačna predaja.
- [ ] DB + UNIT + UI. S-UV1/conditions ostaje u postojećem prihvaćenom režimu/flagu; ovaj plan ga ne uključuje automatski.

### D3. Institucionalna pravila i njihove verzije

**Vlasnici:** Backend i Frontend nakon prihvaćenog ugovora. **Trag:** #328, D-52/D-117; povezati s M2/M10. **Ovisi:** C2/C3 i prihvaćeni model pravila. **Risk:** critical.

**Prvi ugovor treba točno odrediti:** što smije mijenjati ustanova, što kolegij, što zadatak; kako se pravila sužavaju; tko smije objaviti; koja verzija se primjenjuje na novi zadatak; gdje se sprema nepromjenjivi snapshot.

**Predložene putanje:** src/server/institution/policy-versions.ts, app/ustanova/pravila/page.tsx i src/components/institution/PolicyVersionEditor.tsx. Novi institution.policy_version s expectedVersion/CAS; assignment_version referencira odabranu verziju/snapshot bez retroaktivne izmjene starih potvrda.

- [ ] Najprije prihvatiti navedeni ugovor i migracijski postupak za postojeće legacy zadatke. Nullable polje bez objašnjenja nije dokaz primijenjene politike.
- [ ] Uvesti nacrt → pregled posljedica → objavljena nepromjenjiva verzija, s uskom administratorskom ovlasti i auditom.
- [ ] Prikazati efektivna pravila kolegija/zadatka i podrijetlo verzije. Pravila oblika iz Lekte prikazivati samo uz odobreni paket i njegovu verziju.
- [ ] Test: policy v2 ne mijenja zadatak vezan uz v1; kolizija expectedVersion daje 409; profil potvrđenog zadatka se ne proširuje; druga ustanova ne može objaviti.
- [ ] DB + UNIT + UI. Rokovi čuvanja u ovom editoru postaju aktivni tek uz odobrene M10 vrijednosti i stvarni retention postupak DAN-297.

### D4. Izvoz rada, potvrde i evidencije

**Vlasnici:** Backend/Platforma za generiranje i Frontend za zahtjev/status. **Trag:** M7/M10, R-05/R-06, #329 i F-04; povezati prije rada. **Ovisi:** B4, dopuštene projekcije i eventualno B-9 worker. **Risk:** critical.

**Predložene putanje:** src/server/exports/request-export.ts, export-worker.ts; app/api/exports/route.ts; app/api/exports/[exportId]/route.ts; src/components/student/ExportRequest.tsx. Posao koristi postojeći planirani worker, bez trećeg servisa. Prije koda u postojećem M10 ugovoru zaključiti format/veličinu paketa, pravo izvoza, rok preuzimanja i vlasništvo DB granta. Predloženi exports.export_job čuva recipient/ustanovu, opseg/reviziju, idempotency key, status, server vrijeme, manifest hash i referencu privatnog artefakta; ne sadrži tekst u statusnom payloadu.

- [ ] Definirati verzionirani manifest paketa: dokument/revizija, potvrda, dopuštena evidencija i hashovi. Izvoz ne sadrži privatne mentorove zapise, nedopuštenu međupovijest ili tuđe podatke.
- [ ] Student iz sesije traži vlastiti izvoz; worker ponovno provjerava scope; preuzimanje traži važeću ovlast i nije javno predvidiva poveznica.
- [ ] Potvrda za referadu/PDF i Merlin paket koriste iste pohranjene vrijednosti predaje. Ne generirati novo vrijeme ili novi sadržaj potvrde pri svakom preuzimanju.
- [ ] UI razlikuje queued/running/ready/failed/expired; neuspjeh je ponovljiv bez novog poslovnog izvoza. Privremeni lokalni izvoz teksta za oporavak ostaje zasebna postojeća radnja.
- [ ] Integration + DB + UI: student B ne preuzima A; opoziv/istek linka; timeout generiranja; retry; bajtovi potvrde isti kao iz B4.
- [ ] F-04 i bivši student bez AAI računa idu kroz dokumentirani institucijski zahtjev i poseban uski grant; osnovna admin uloga ne dobiva Export all sadržaj.

## 10. Faza E — kvaliteta svakog ekrana i operativni završetak

### E1. Stanja sučelja, responsive i pristupačnost kroz svaki rez

**Vlasnici:** Frontend + neovisni QA prema aktualnom ugovoru. **Trag:** #341/#732, DAN-232 i DAN-234. **Izvodi se uz A–D, ne tek na kraju.**

**Datoteke:** postojeći AppShell, WorkspaceShell, CSS moduli, messages.hr.ts, e2e/accessibility.spec.ts i e2e/screenshots.spec.ts; novi ekrani dobiju odgovarajuće retke/specove.

- [ ] Za svaki novi ekran napisati konkretne slučajeve iz matrice u odjeljku 11, uključujući razlikovanje greške izvora od praznog dopuštenog rezultata.
- [ ] Zadržati postojeće v3 tokene. U pregledanom CSS-u radni prostor prelazi na dvije kolone pri 1250 px i jednu pri 1050 px; bočna navigacija prelazi u drawer ispod 800 px. Komentare/prototipove s povijesnim 1240/1000 ne uzimati kao aktualni runtime ugovor.
- [ ] Provjeriti 1440, 1024, 800 i 390 px te granice 1250/1251, 1050/1051 i 799/800 kroz test rasporeda. Osigurati najmanje 12 px UI teksta, 13 px na telefonu i postojeće ciljeve klika 32 px u gustim trakama/44 px drugdje.
- [ ] Provesti axe i stvarni tok tipkovnicom: otvaranje, fokus dijaloga, Escape, povrat fokusa, slanje forme i poruka ishoda. Prije pilota zapisati ručnu provjeru editora i predaje čitačem zaslona.
- [ ] Snimke služe pregledu stvarnog ekrana; postojeći screenshots spec ne proglašavati automatskom usporedbom s referentnom slikom.
- [ ] Nakon aktualizacije protokola DAN-234 provesti postojeći UX uvjet s najmanje 5 studenata i 5 nastavnika koji nisu gradili proizvod. Ne koristiti zastarjeli dio UX-EVAL koji proturječi prihvaćenom live prikazu.

**Već riješeno:** hrvatske error/not-found stranice #740 i tekst pragova #741 na bazi ovog plana. #742, #750 i #751 ostaju pod svojim aktualnim provjerama i rezervacijama.

### E2. Tvoj operaterski prostor nakon prihvaćene auth granice

**Vlasnici:** vlasnik/Platforma/Backend za ADR, zatim odvojeni Backend i Frontend zadaci. **Trag:** uloga operatera u PRODUCT; DAN-299 za operativne izvore. Zaseban razrađen Linear zadatak za portal nije nađen. **Risk:** critical.

**Predloženi oblik:** zasebno zaštićena grupa ruta u postojećem Next.js procesu, npr. app/operacije/*, src/server/operations/* i src/components/operations/*. Konačna ruta i session granica prihvaćaju se u ADR-u prije koda.

- [ ] ADR mora zaključiti identitet operatera, prijavu/MFA, odvojenu privilegiranu sesiju, opoziv, audit, dozvoljene projekcije i iznimni pristup podrške. Poddomena sama nije sigurnosna granica.
- [ ] Nakon toga definirati read-only prvi rez: ustanove po operativnom statusu, zdravlje servisa, posljednji potvrđeni restore, odgođeni poslovi i incidenti. Svako polje ima asOf i healthy/degraded/down/unknown/not_configured.
- [ ] Koristiti izvore DAN-299 i DAN-298; podatak iz konfiguracije ne prikazivati kao potvrđenu izvršenu provjeru.
- [ ] Testirati lažni institutionId, običnu studentsku/nastavničku/admin sesiju, isteklu ops sesiju i izostanak telemetry podataka. Nema studentskih tekstova, globalnog canReadAnyDocument niti neposrednog superuser SQL-a iz weba.
- [ ] Kasniji onboarding ustanove, poslovni ugovori i podrška dodaju se samo uz odobrene radnje i potrebne podatke. Naplata ili novi payment provider nisu preduvjet početnog portala.

**Granica točnosti plana:** dok ADR nije prihvaćen, ne daje se izmišljeni gotov OIDC provider, tablica operatora, cookie ili superuser RPC. Gore je precizan redoslijed ugovora i prvog reza, a ne odobrena nova sigurnosna arhitektura.

### E3. Stvarni pilot, infrastruktura i podaci

**Vlasnik:** postojeći Platforma/AAI/owner zadaci. **Trag:** DAN-295–DAN-299, DAN-196/DAN-198, M10/M11. **Ovisi:** odabrani scope pilota, računi/odobrenja i izvršivi sintetički staging.

- [ ] Završiti postojeći produkcijski potpisnik, health/readiness i operativne izvore; frontend prikazuje stvarni status.
- [ ] Provesti restore baze i bucketa; zapisati stvarni rezultat i dogovorene RPO/RTO. Datum backupa nije datum uspješnog restorea.
- [ ] Primijeniti potvrđene rokove čuvanja/izvoz/hold i provjeriti njihovu izvedbu; UI sam ne briše studentske podatke.
- [ ] Izvesti prihvatni tok na odobrenom stagingu s odgovarajućim vrstama resursa i stvarnim AAI Lab ugovorom, po postojećim pravilima.
- [ ] Uz tehnički prihvat prikupiti postojeće institucionalne, podatkovne i operativne GO dokaze iz PROGRAM. Demo GO, pilot GO i produkcijski deploy ostaju različiti zapisi.

## 11. Zajednička matrica stanja — prihvatni kriteriji u postojećim zadacima

Ova tablica ide u kriterije zadataka/PR-ova gdje je primjenjiva; ne uvodi novi statusni registar ili novu automatiziranu provjeru.

| Stanje | Primjer | UI ishod |
|---|---|---|
| loading | Čeka se roster | Vidljiva poruka učitavanja, bez lažne nule |
| empty | Ovlašteni student nema zadatke | Objašnjenje i Upis u kolegij |
| unauthorized/expired | Sesija istekla | Postojeća AAI prijava; čuvanje lokalnog rada prema ugovoru |
| denied/not_found | Tuđi ili nepostojeći rad | Neutralna poruka bez identiteta i sadržaja |
| pending_role | Uloga još nije potvrđena | Vlastiti status i kontakt/postupak potvrde nakon C1/C2 |
| offline | Trenutno nema mreže | Samo stvarno dostupne lokalne radnje, jasna granica server potvrde |
| conflict | Drugi uređaj ili novija verzija zadatka | Eksplicitni recovery/reload; nema tihog overwritea |
| unknown | Lokalni journal/health feed nije dostupan | Ne tvrditi da je sve poslano ili zdravo |
| unavailable/error | Baza ili servis nedostupan | Poruka i siguran retry; ne prazna lista |
| success | Objavljena verzija/predaja | Potvrđeni serverski rezultat i identifikator/verzija |
| stale/changed | Na serveru postoji novija verzija | Prikaz razlike i nova dozvoljena radnja |

Server odbijanje ne prevoditi u uspjeh. Vizualno skriven gumb ne zamjenjuje server provjeru.

## 12. Provjere i izvršenje prema aktualnom kodu

### 12.1 Profili koje koraci gore koriste

**UNIT — za promijenjene servise, parsere i domenski automat**
```bash
pnpm lint
pnpm typecheck
pnpm exec vitest run --project unit src/server/institution/student-workspace.test.ts
```
Posljednji argument zamjenjuje se točnom testnom datotekom navedenom u zadatku. Očekivanje: svaki konkretni novi test prolazi; privremena mutacija relevantne zaštite mora srušiti odgovarajući negativni test.

**DB — samo izolirani sintetički stack namijenjen zadatku**
```bash
pnpm stack:up
pnpm db:migrate
pnpm db:seed
pnpm test:db
```
Za ciljanu matricu može se koristiti postojeći pg_prove:
```bash
docker compose exec -T postgres pg_prove -U ductus -d ductus /db/tests/090-student-workspace.sql
```
Očekivanje: planirani broj pgTAP asercija i svi relevantni akteri imaju stvarno provjerene ishode. Odbijanje zbog nedostajućeg USAGE nije samo po sebi dokaz RLS-a.

Za novi RPC/migraciju izvršitelj slijedi .agents/skills/ductus-new-table: migrator bez superuser prečaca, grantovi, FORCE RLS, testovi mutacija i lokalni rollback/reapply u vlastitoj potrošnoj testnoj bazi. Produkcija migrira samo prema odobrenom postupku.

**UI — stvarni novi tok i postojeća pristupačnost**
```bash
pnpm test:e2e:login student-workspace.spec.ts
pnpm test:e2e accessibility.spec.ts --project=desktop --project=mobile
pnpm test:e2e screenshots.spec.ts --project=desktop --project=mobile
```
Prvi argument login suitea zamijeniti konkretnim novim spec-om, npr. assignment-roster.spec.ts. Login suite u pregledanom configu nema project nazvan chromium; standardni suite ima desktop/mobile/firefox/webkit. Nazive se ne smije zamijeniti napamet.

**TRUST — evidencija, oporavak, auth, predaja i RLS**
```bash
pnpm test:integration
pnpm test:e2e:login demo-flow.spec.ts
pnpm test:db
```
Uz to izvesti ciljane property, offline/concurrency i relevantne browser provjere koje traži TESTING. D-168 dopušta odgodu WebKita/Safarija nakon demoa; odgoda ne vrijedi automatski za stvarni pilot.

**Obvezna predaja**
```bash
pnpm test
pnpm build
pnpm orch:overlap
```
Primijeniti važeći pre-push/CI profil iz repoa. Ciljani brzi testovi tijekom rada ne zamjenjuju obvezne testove, formalni review ili QA. Ako projektna iznimka vrijedi, navesti je uz točan opseg.

### 12.2 Točne predložene nove testne putanje

Postojeći testovi se proširuju gdje već pokrivaju ponašanje. Ovo su predložene putanje za nove provjere; brojeve pgTAP datoteka izvršitelj usklađuje s aktualnim mainom prije preuzimanja.

| Korak | Unit/DB test | Browser dokaz |
|---|---|---|
| B1/B2 | src/server/institution/student-workspace.test.ts; db/tests/090-student-workspace.sql | e2e/login/student-workspace.spec.ts |
| B3 | src/components/teacher/AssignmentForm.test.ts | e2e/login/existing-course-assignment.spec.ts |
| B5/B6 | src/server/institution/assignment-roster.test.ts; db/tests/091-assignment-submissions.sql | e2e/login/assignment-roster.spec.ts |
| B7/B8 | src/server/institution/assignment-version-route.test.ts; proširenje db/tests/032-institution-assignments.sql | e2e/login/assignment-version.spec.ts |
| B9 | src/server/institution/deadline-extension.test.ts; db/tests/092-deadline-extension.sql | e2e/login/deadline-extension.spec.ts |
| C2/C3 | src/server/institution/admin-people.test.ts; db/tests/093-institution-admin.sql | e2e/login/institution-admin.spec.ts |
| C4 | src/server/audit/work-access.test.ts; db/tests/094-work-access-read.sql | e2e/login/work-access.spec.ts |
| C5 | src/server/evidence/checkpoint-read.test.ts; db/tests/095-document-checkpoints.sql | e2e/login/work-versions.spec.ts |
| D1 | src/server/notifications/notifications.test.ts; db/tests/096-notifications.sql | e2e/login/notifications.spec.ts |
| D2 | src/server/collaboration/revision-requests.test.ts; db/tests/097-revision-requests.sql | e2e/login/revision-requests.spec.ts |
| D3 | src/server/institution/policy-versions.test.ts; db/tests/098-institution-policy.sql | e2e/login/institution-policy.spec.ts |
| D4 | src/server/exports/request-export.test.ts; db/tests/099-exports.sql | e2e/login/exports.spec.ts |

Scenariji/asercije nalaze se u odgovarajućem koraku. Namjena testova je dokazati ovlasti i stvarne ishode, bez testiranja same činjenice da komponenta vraća markup.

### 12.3 Lokalna okolina i poznate granice

- Kanonske upute su docs/DEMO-UP.md i aktualni CI. Za interaktivni lokalni demo koristi se pnpm demo:up.
- Za automatizirani čisti prihvat koristi se postojeći demo:prepare/CI setup i okolina s lokalnim AUTH_DATABASE_URL, razvojnim potpisnikom i S3 domenom. demo:prepare i demo:up ne pripremaju isti seed scenarij.
- Runner ne prenosi generiranu lozinku natrag u parent shell. Za zasebno pokretanje login testova mora se koristiti već postojeći lokalni/CI način dostave potrebne okoline; ne pretpostaviti da sam slijed naredbi stvara sve auth varijable.
- Ne ispisivati ili upisivati tajne u plan, testni izvještaj ili repo.
- Ako lokalni uređaj ne može pokrenuti Docker, koristiti već odobreni izvršivi testni host/CI. Neizvedena provjera ostaje NEPROVJERENO.
- Prije svakog commita poštovati projektno pravilo zelenih testova. Stageati samo eksplicitne putanje, ne git add -A.

### 12.4 Review, QA i migracije

- Svaki PR ima postojeći Task, Agent, Risk, invarijantu, stvarnog pozivatelja, poznate granice i zahtijevane dokaze.
- critical: neovisni review i zaseban QA na aktualnom headu, osim točno primjenjive važeće projektne iznimke. Nema vlastitog kanonskog PASS-a.
- Nova semantička izmjena invalidira prethodni verdict; primjenjivost D-101 dokazuje se, ne pretpostavlja.
- Dbmate generira stvarni UTC prefiks migracije u trenutku preuzimanja, nakon aktualne zadnje migracije. Imena baze migracije navedena u koracima jesu konkretna; prefiksi i slobodni brojevi pgTAP datoteka ne rezerviraju se ovim read-only planom.
- Izmjena s više od dopuštenog opsega dijeli se na smisleno pregledljive backend/UI korake. Plan ne daje iznimku od granice približno 300 produkcijskih/400 ukupnih kodnih redaka za critical PR.
- Poslije mergea izvesti postojeći smoke na točnom main SHA-u. Merge ne dokazuje deploy; deploy ne dokazuje pilot GO.

## 13. Red rada, kapacitet i procjena

**Do zamrzavanja 28. 10.:** postojeći A1–A4 i već prihvaćeni dizajnerski popravci #732. Točan preostali broj sati nije provjeren; puni K-4 i aktualni gate određuju može li demo biti GO ili PARTIAL DEMO.

**Odmah paralelno na razini pripreme:** C1 ugovor i vanjski AAI/owner odgovori. Ne čekati dovršetak svih studentskih ekrana da se razriješi identitet za roster i admin.

**Nakon prihvata demoa:** B1 → B2; neovisno B3; B4 → B5 → B6. B7 → B8 i B9 dolaze u isti svakodnevni ciklus po kapacitetu. C2 → C3 može teći nakon C1; C4 i C5 po svojim postojećim zadacima/valovima.

**Kasnije prema PROGRAM:** D1, D2, D3 i D4 ne uvode se svi odjednom; obavijesti i osnovni izvoz imaju prednost prema cilju konkretnog pilota. Puni institucionalni policy editor, prenosivi paket i vremeplov poštuju odabrani val. E1 prati svaki korak; E2 čeka ADR, E3 stvarne GO ovisnosti.

| Paket | Gruba procjena implementacijskog rada | Napomena |
|---|---:|---|
| B: svakodnevni tokovi | 14–24 writer-dana | Zbroj Backend + Frontend, uz postojeće temelje i B4 podkorake |
| C: minimalni admin i privatnost | 10–18 writer-dana | C1 vanjsko čekanje nije u broju; C5 može ostati u kasnijem valu |
| D: obavijesti/dorade/policy/izvoz | 18–32 writer-dana | Više odvojenih isporuka prema programu; opseg izvoza i policy ugovor mijenjaju procjenu |
| E2: početni ops portal | Procjena nakon ADR-a | Neoznačena auth arhitektura nije vjerodostojno procjenjiva |
| E3: infrastruktura | Postojeći zadaci i njihova aktualna procjena | Vanjski računi, AAI i institucionalni uvjeti imaju vlastite rokove |

To su planerske procjene, nisu izmjereni sati ni obećani datumi. Uz jedan Backend i jedan Frontend rad se djelomično preklapa, ali jedan Frontend ostaje usko grlo za više novih ekrana. Postojeći Platforma writer radi infrastrukturu i potrebne ovisnosti. Nitko nije pokrenut ili dodijeljen ovim dokumentom.

Ne uvoditi drugi pisac na iste datoteke. Poruke, PREUZETO i ograničenja gatea ostaju u postojećem sustavu; broj paralelnih planiranih tokova nije ovlast za dodatne sesije.

## 14. Teme koje ostaju vidljive u postojećem programu

| Tema | Kada se uključuje | Zašto nije dio prvog frontend reza |
|---|---|---|
| Više grupa i zamjenski/sunastavnici | M2 ako odabrani pilot to traži | Potreban model izvedbe kolegija i prijenos odgovornosti |
| Gubitak uređaja / opoziv ostalih sesija | Uz DAN-212/DAN-296 prije relevantnog pilota | Odvojeno od odjave trenutne kartice |
| Offline ponovno otvaranje/PWA | Nakon posebnog auth/cache ugovora | Trenutni offline editor ne dokazuje siguran offline startup |
| Live skaliranje | Mjerenje 50/200/500 sintetičkih autora | Ne mijenjati kanal i arhitekturu bez mjerenja |
| Samostalni mentorski radovi i povjerenstvo | PROGRAM val 3 | Trenutni evidence projekt vezan je uz zadatak; tip master_thesis sam ne čini puni mentorski sustav |
| AI pomoćnik i integracije | Prema prihvaćenim flagovima/valovima | Nisu preduvjet povezivanja osnovnih radova i predaje |

## 15. Preporučeni prvi provedbeni nalog

Ako vlasnik naknadno zatraži implementaciju, prvi nalog treba ostati u postojećem DAN-89/#711:

**Cilj:** dovršiti A1, A2 i A3 kroz njihove već dodijeljene podkorake, zatim izvršiti A4 na točnom spojenom SHA-u. Ne otvarati paralelni editor, novu bazu ili drugi K-4 test.

**Nakon toga:** prvi novi produktni rez je B1+B2 — Moji radovi na stvarnim podacima — i B3 kao zaseban mali tok za drugi zadatak u postojećem kolegiju.

**Prije početka bilo kojeg novog koraka:** aktualizirati izvore, pronaći/povezati Linear zadatak, provjeriti rezervacije i dogovoriti putanje. Sam ovaj plan nije preuzimanje zadatka.

## 16. Izvori i provjerljiva polazišta

- [Pregledani main 5cd9cf8](https://github.com/danielrisavi77-create/Ductus/commit/5cd9cf8f28bca2804511db4ea166eb0c5c647250)
- [Linear Ductus](https://linear.app/daniel77/project/ductus-a9da19a077dc)
- [Protokol koordinacije](https://linear.app/daniel77/document/protokol-koordinacije-agenata-ductus-i-lekta-40749fe0b6d2)
- [PRODUCT](https://github.com/danielrisavi77-create/Ductus/blob/5cd9cf8f28bca2804511db4ea166eb0c5c647250/docs/PRODUCT.md), [ARCHITECTURE](https://github.com/danielrisavi77-create/Ductus/blob/5cd9cf8f28bca2804511db4ea166eb0c5c647250/docs/ARCHITECTURE.md), [BACKEND](https://github.com/danielrisavi77-create/Ductus/blob/5cd9cf8f28bca2804511db4ea166eb0c5c647250/docs/BACKEND.md)
- [PROGRAM](https://github.com/danielrisavi77-create/Ductus/blob/5cd9cf8f28bca2804511db4ea166eb0c5c647250/docs/PROGRAM.md), [PLAN-DEMO](https://github.com/danielrisavi77-create/Ductus/blob/5cd9cf8f28bca2804511db4ea166eb0c5c647250/docs/PLAN-DEMO.md), [DECISIONS](https://github.com/danielrisavi77-create/Ductus/blob/5cd9cf8f28bca2804511db4ea166eb0c5c647250/docs/DECISIONS.md)
- [TESTING](https://github.com/danielrisavi77-create/Ductus/blob/5cd9cf8f28bca2804511db4ea166eb0c5c647250/docs/TESTING.md), [DEMO-UP](https://github.com/danielrisavi77-create/Ductus/blob/5cd9cf8f28bca2804511db4ea166eb0c5c647250/docs/DEMO-UP.md)
- [Izvor studentskog dokumenta](https://github.com/danielrisavi77-create/Ductus/blob/5cd9cf8f28bca2804511db4ea166eb0c5c647250/src/server/evidence/work-document-read.ts)
- [Nastavnikovi kolegiji](https://github.com/danielrisavi77-create/Ductus/blob/5cd9cf8f28bca2804511db4ea166eb0c5c647250/src/server/institution/teacher-courses.ts)
- [Radovi zadatka](https://github.com/danielrisavi77-create/Ductus/blob/5cd9cf8f28bca2804511db4ea166eb0c5c647250/src/server/evidence/assignment-works.ts)
- [TeacherSetup](https://github.com/danielrisavi77-create/Ductus/blob/5cd9cf8f28bca2804511db4ea166eb0c5c647250/src/components/teacher/TeacherSetup.tsx)
- [Journal](https://github.com/danielrisavi77-create/Ductus/blob/5cd9cf8f28bca2804511db4ea166eb0c5c647250/src/lib/journal/atomic-dexie-journal.ts)
- [Revision request automat](https://github.com/danielrisavi77-create/Ductus/blob/5cd9cf8f28bca2804511db4ea166eb0c5c647250/src/domain/collaboration/revision-request.ts)
- [Postojeći #711](https://github.com/danielrisavi77-create/Ductus/issues/711), [#731](https://github.com/danielrisavi77-create/Ductus/pull/731), [#476](https://github.com/danielrisavi77-create/Ductus/issues/476), [#655](https://github.com/danielrisavi77-create/Ductus/issues/655), [#732](https://github.com/danielrisavi77-create/Ductus/issues/732)
- Prethodni datirani izvještaji služe kao navigacija; činjenične tvrdnje plana vezane su uz gornji repo i aktualno pročitane Linear zadatke.


