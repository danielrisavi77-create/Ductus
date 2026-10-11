# Ductus: baza podataka

Ako se ovaj vodič i dokument ili kod razilaze, vrijedi dokument odnosno kod; nesklad prijavi u IZVJEŠTAJU.

Vodič je detaljna karta područja. Pravila nisu ovdje nego u `CLAUDE.md`, `docs/BACKEND.md` (pobjeđuje ARCHITECTURE u pojedinostima), `docs/ARCHITECTURE.md` §0.1, §3, §7, `docs/DECISIONS.md` i `docs/ENGINEERING_SYSTEM.md` §5. Stanje je provjereno na `main` (zadnja migracija `20261011100000`).

## 1. Kada koristiti

Pri svakoj promjeni u `db/migrations/`, `db/tests/` (uključujući `fixtures/`), `db/local/`, `src/server/db/`, `compose.yaml`, `infra/postgres/` te `db:*` i `stack:*` skriptama u `package.json`. Uz njega primijeni kratke skillove:

- `ductus-new-table`: kontrolna lista prije predaje za tablicu, ulogu, grant, RLS, RPC i redak matrice. Ovaj vodič ju ne zamjenjuje.
- `ductus-synthetic-data`: svaki fixture i seed je izmišljen.
- `supabase-postgres-best-practices`: tuđi (Supabase) opći savjeti o Postgresu, strani sadržaj. Čitaj ga kao uputu o indeksima i upitima, ne kao pravilo Ductusa; ovdje ne vrijedi ništa što se kosi s `docs/BACKEND.md` (npr. u Ductusu nema Supabasea, `auth.uid()` ne postoji).
- `docs/vodici/testovi.md`, `docs/vodici/karta-aplikacije.md`: gdje su ostali testovi i ostatak aplikacije.
- `.claude/rules/baza.md` se učitava sam za `db/**` i `src/server/db/**` (podsjetnik, ne pravilo).

## 2. Karta

Implementirano (ARCHITECTURE §0.1: kod i testovi na `main` su dokaz, ne dokument):

`db/migrations/` (dbmate, svaka datoteka ima `-- migrate:up` i `-- migrate:down`):
- `20261003200000_baseline.sql`: `SELECT 1`, dokazuje cjevovod migracija.
- `20261003210000_roles.sql`: šest NOLOGIN grupnih uloga (`ductus_app`, `ductus_worker`, `ductus_retention`, `ductus_evidence`, `ductus_identity`, `ductus_auth`), odbija se pokrenuti ako nije `ductus_migrator` bez SUPERUSER/BYPASSRLS, oduzima PUBLIC pristup bazi i shemi `public`, postavlja `ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` za migratora, `ductus_identity` i `ductus_evidence`.
- `20261003210100_identity_session.sql`: sheme `identity` i `app`; tablice `identity.institution`, `identity.user_account`, `identity.session`; funkcije `app.current_actor()`, `app.current_user_id()`, `app.current_institution_id()`, `identity.close_current_session()`.
- `20261010180000_institution_model.sql`: shema `institution`; tablice `institution_settings`, `institution_role`, `course`, `course_enrollment_code`, `course_member`, `enrollment_attempt`; pomoćne `require_actor`, `actor_has_role`, `actor_course_role`, `is_plain_label`; RPC `confirm_teacher_role`, `create_course`, `create_enrollment_code`, `revoke_enrollment_code`, `enroll_with_code`.
- `20261010190000_institution_removal.sql`: `course_member.removed_by`, `return_allowed_at`; RPC `remove_student`, `allow_student_return`, `revoke_teacher_role`; strože `is_plain_label`.
- `20261010200000_institution_assignment.sql`: tablice `assignment`, `assignment_version` (nepromjenjiva, okidači `refuse_change`), `notice_acknowledgment`; `is_assignment_content`, `ai_policy_rank`, `actor_assignment_role`; RPC `create_assignment`, `publish_assignment_version`, `acknowledge_notice`.
- `20261010210000_open_session.sql` i `20261010220000_open_session_realm.sql`: `identity.institution.aai_home_org`, RPC `identity.open_session` (jedini ga izvršava `ductus_auth`); druga migracija traži oblik `local@realm` i realm jednak `hrEduPersonHomeOrg`.
- `20261011100000_institution_assignment_key.sql`: `institution_id` na `assignment` i `notice_acknowledgment` (D-103).

`db/tests/` (pgTAP; svaka datoteka je jedna transakcija koja završi `ROLLBACK`): `000-harness.sql` (migracije su se izvršile), `010-roles-and-privileges.sql` (uloge, članstva, katalog-široke provjere), `020-identity-session.sql`, `021-open-session.sql`, `022-open-session-realm.sql`, `030-institution-access-matrix.sql` (matrica), `031-institution-functions.sql`, `032-institution-assignments.sql`, `033-institution-key.sql` (čuvar ključa ustanove). `fixtures/institution.inc` se uključuje s `\ir`: privremene tablice `person`, `tok`, `ref`, izmišljene ustanove `fak-a`/`fak-b`, osobe (Iva, Vesna, Ana...), tokeni od 43 znaka.

`db/local/`: `migrator.sql` (stvara `ductus_migrator`, vlasnik baze), `app-login.sql` (`ductus_app_local`, član `ductus_app` s `SET FALSE`), `auth-login.sql` (`ductus_auth_local`, lozinka iz psql varijable, najmanje 16 znakova), `seed.sql` (dvije izmišljene ustanove, `demo.ductus.test`). `app-login.sql`, `auth-login.sql` i `seed.sql` odbijaju rad izvan lokalnog socketa compose kontejnera; `migrator.sql` nema tu provjeru.

`src/server/db/`: `index.ts` (izvozi `withActor`, `openSession`, konstante pool-a `APP_POOL_MAX` 10, `APP_CONNECTION_TIMEOUT_MS`, `APP_STATEMENT_TIMEOUT_MS`, `APP_IDLE_IN_TRANSACTION_TIMEOUT_MS`, `APP_QUERY_TIMEOUT_MS`, `appPoolConfig`, `handleConnectionErrors`), `with-actor.ts` (`createWithActor`, `leadingKeyword`), `open-session.ts` (`createOpenSession`), `with-actor.test.ts`.

Stog: `compose.yaml` (postgres 17.11 s pgTAP-om iz `infra/postgres/Dockerfile` na `127.0.0.1:54329`, objects/rustfs, mail/mailpit, oidc/fake OIDC), `.env.example` (`DATABASE_URL`, `APP_DATABASE_URL`, `AUTH_DATABASE_URL`, `DUCTUS_AUTH_LOCAL_PASSWORD`).

Povezani integracijski testovi izvan ovog područja: `tests/integration/app-database`, `with-actor`, `open-session`, `institution`, `institution-key-migration` (`*.integration.test.ts`).

Planirano, NE postoji: sheme `evidence`, tablice rada/dokumenta/evidencije/predaje (`project`, `document`, `evidence.segment`, `evidence.receipt`, `submission`, `access_log`...), uloge `ductus_worker`/`ductus_retention`/`ductus_evidence` postoje samo kao prazne grupe bez ovlasti, `notification`, pg-boss shema, `db/migrations.sum` i `db/schema.sql` (D-91 ih traži; u repou ih nema ni u CI-ju).

## 3. Sheme, uloge, tablice

Sheme: `public` (samo dbmate `schema_migrations`), `identity`, `app`, `institution`.

Uloge (BACKEND §3 pravilo 2; migracija `roles`): `ductus_migrator` (jedini s DDL-om, CREATEROLE, nije superuser, ne nasljeđuje uloge vlasnika, `GRANT ... WITH INHERIT FALSE, SET TRUE`), `ductus_identity` (vlasnik tablica i funkcija u `identity`, `app`, `institution`), `ductus_app` (web, podliježe RLS-u, na tablicama samo SELECT, na funkcijama EXECUTE po popisu), `ductus_auth` (jedino `identity.open_session`), `ductus_worker`, `ductus_retention`, `ductus_evidence` (još bez ovlasti). Prijave (`ductus_app_local`, `ductus_auth_local`) daje okolina, nikad migracija.

Tablice i svrha:
- `identity.institution` (id, `slug`, `aai_home_org`); `identity.user_account` (ustanova + izdavatelj + `hr_edu_person_unique_id`, D-73, bez OIB-a); `identity.session` (samo SHA-256 tokena, istek, zatvaranje).
- `institution.institution_settings` (naziv, ograničenje pogrešnih kodova, zadano 5 u 15 min), `institution_role` (`teacher`, `admin`), `course` (pravilo AI-ja D-52), `course_enrollment_code` (samo hash), `course_member` (povijest članstva), `enrollment_attempt` (piše samo `enroll_with_code`).
- `institution.assignment`, `assignment_version` (nepromjenjiva, profil smije samo sužavati), `notice_acknowledgment`.

Tablice poslova (pg-boss) i potvrda o obavijestima/prijemu (`notification`): ne postoje u migracijama. BACKEND §4.5 propisuje pg-boss s `migrate: false` (shemu vodi `ductus_migrator`), tijela poslova samo ID-ovi, i obavijest najviše jednom po P-03 prozoru; ARCHITECTURE §3 opisuje `notification`. To je plan, ne kod. "Notice acknowledgment" koji postoji je `notice_acknowledgment` (student potvrdio obavijest verzije zadatka), što nije tablica obavijesti.

## 4. Tok podataka

Čitanje i pisanje iz aplikacije:
1. Ruta uzme kolačić sesije i zove `withActor(token, fn)` iz `src/server/db`. Token koji nije 43 znaka base64url postaje `""` (anoniman) i ne ide u bazu.
2. `createWithActor`: `BEGIN`, jedan upit `ENTER_ACTOR_SQL` postavlja `app.session_token` i `app.with_actor_tx` preko `set_config(..., true)` (transakcijski lokalno) i provjerava da je veza prijava koja nije superuser, nema BYPASSRLS, ima `ductus_app` i `session_user = current_user`.
3. `fn(tx)` smije samo `SELECT/WITH/INSERT/UPDATE/DELETE/MERGE/VALUES/TABLE/CALL` (provjera `leadingKeyword`); `BEGIN`, `SET`, `SAVEPOINT`, `LISTEN`... se odbijaju prije baze. Ugniježđeni `withActor` baca grešku (AsyncLocalStorage).
4. Prije `COMMIT` `EXIT_ACTOR_SQL` provjerava da marker i token nisu mijenjani i da je uloga ista; na kraju `DISCARD ALL` i povrat veze, ili zatvaranje ako je stanje nesigurno.
5. U bazi politike zovu `app.current_institution_id()` / `app.current_user_id()` kao `(SELECT ...)`, a oni `app.current_actor()`: hashira token, traži otvorenu neistekla sesiju. Pisanje ide samo kroz `SECURITY DEFINER` RPC (`institution.create_course` itd.) koji prvo zove `institution.require_actor()` (ZD401 bez sesije).

Prijava: callback zove `openSession(...)` (pool `AUTH_DATABASE_URL`, `max: 2`), koji u istom upitu provjerava da je veza član `ductus_auth` a ne `ductus_app`, pa zove `identity.open_session`. ZD403/ZD422/ZD503 postaju `refused`, ZD409 `conflict`. Odjava: `identity.close_current_session()`.

Greške RPC-a nose kod bez ulaza: ZD401 nema sesije, ZD403 zabranjeno (i kad objekt ne postoji), ZD409 sukob, ZD422 neispravan ulaz, ZD500 pogrešan način transakcije, ZD503 ustanova nije postavljena (zaglavlje `institution_model.sql`).

## 5. Invarijante

1. Prijava studenata samo AAI@EduHr; lažni OIDC samo lokalno i u CI-ju (`CLAUDE.md`, D-09; BACKEND §4.3). Pin nije potvrđen u ovoj sesiji.
2. Svaka nova tablica ima RLS (`ENABLE` i `FORCE`) i retke u pgTAP matrici s testom odbijanja (`CLAUDE.md`; ARCHITECTURE §3; BACKEND §6 t. 3). Pin: `030` t. 1 (tablice sheme `institution` točno popisane) i drugi test (`relrowsecurity AND relforcerowsecurity AND owner = ductus_identity`).
3. Klijent nikad ne piše izravno u tablice evidencije, predaje ni revizijskog traga; samo kroz RPC (`CLAUDE.md`; ARCHITECTURE §3). U kodu: `ductus_app` ima samo SELECT, `030` bag_eq nad ovlastima to zaključava za sheme `institution`. Tablice evidencije još ne postoje.
4. RPC izvodi identitet iz `current_actor()`, nikad iz parametra; `SECURITY DEFINER` ima `SET search_path = ''`; EXECUTE oduzet od PUBLIC (BACKEND §3 pr. 2, §4.3). Pin: `033` (nijedna funkcija nema parametar koji sadrži "institution"), `010` (katalog-široke provjere search_path i PUBLIC).
5. Ključ ustanove (D-103; ARCHITECTURE §3 kraj): `institution_id` NOT NULL, bez defaulta, uzet iz roditeljskog retka ili sesije, nikad iz parametra; svaki strani ključ prema roditelju s ključem i prema `user_account` uključuje `institution_id`; nijedan strani ključ ne kaskadira. Pin: `033-institution-key.sql` (katalog), `tests/integration/institution-key-migration.integration.test.ts`. Tablice bez ključa su izričito popisane u `033` (`identity.institution`, `course_enrollment_code`, `enrollment_attempt`, `assignment_version`); nova tablica rada ne smije ući u taj popis.
6. Migracije se ne primjenjuju na produkciju iz agenta (`CLAUDE.md`; BACKEND §4.8 t. 7: produkcija samo naprijed, `dbmate up --strict` kao `ductus_migrator` s VM-a; `rollback` samo lokalno).
7. Nikad stvarni studentski radovi ni osobni podaci u testovima i fixtureima (`CLAUDE.md`). Fixtureovi koriste `.example`/`.test` domene i izmišljena imena (`fixtures/institution.inc`).
8. Migracija se izvršava kao `ductus_migrator` bez SUPERUSER/BYPASSRLS i ne stvara prijave ni lozinke (BACKEND §3 pr. 2). Kod: provjera na vrhu `roles.sql`; pin `010`.
9. Samo `ductus_app_local` i `ductus_auth_local` imaju prijavu (ductus_*), oba bez vlastite ovlasti; `010` navodi članstva po imenu i pada na svako drugo. Pin: `010`.
10. Nepromjenjivost: `assignment_version` odbija UPDATE/DELETE/TRUNCATE (okidač `refuse_change`, ZD403) čak i vlasniku (kod, komentar u `institution_assignment.sql`). Nova verzija smije sadržaj samo sužavati (PRODUCT §5 pr. 14, komentar u `publish_assignment_version`).
11. Samo `ductus_auth` smije `identity.open_session`; `withActor` odbija prijavu koja nije član `ductus_app`. Pin: `021`, `022`, `with-actor.test.ts`.
12. Samo `src/server/db` smije uvoziti `pg` (BACKEND §4.3; ESLint `no-restricted-imports` regex `^pg(?:$|/|-)` i `database-boundary/no-restricted-dynamic-imports` u `eslint.config.mjs`; iznimka za `src/server/db/**`, `tests/integration/**`, `e2e/login/**`).
13. GUC se ne drži na vezi: `set_config(..., true)` (LOCAL), nikad `SET` bez LOCAL; pin: `with-actor.test.ts` (sadržaj testa nije čitan do kraja). Dokument: BACKEND §4.3.
14. Vrijeme je iz sata baze (`now()`), `timestamptz` (ARCHITECTURE §3). RLS je obrana u dubinu, ne granica protiv kompromitirane aplikacije (BACKEND §4.3).
15. Nema `RAISE` koji citira ulaz; greške su kodovi ZDxxx (komentar zaglavlja `institution_model.sql`; "enforced in code, no document source found" za sam format kodova).

## 6. Kako napraviti promjenu

Risk: `db/migrations/`, `db/local/`, `src/server/db/`, pgTAP matrica i cijeli `tests/` su najmanje `critical` (ENGINEERING_SYSTEM §5, popis D-97). To znači plan napada prije koda (`ductus-attack-plan`), nezavisni review i QA, i spajanje samo po pravilima D-97 (Danielova naredba). PR najviše oko 400 redaka koda, jedan korak iz `STATE.md`.

A. Nova migracija
1. `pnpm db:new naziv` (dbmate). Ime je `YYYYMMDDHHMMSS_naziv.sql`; broj mora biti veći od zadnjeg (sada `20261011100000`), jer redoslijed daje broj. Postojeću migraciju nikad ne mijenjaj (D-91; zaštitu `migrations.sum` CI još ne provodi, pa ovisi o reviewu).
2. Obrazac iz postojećih: `GRANT CREATE ON SCHEMA x TO ductus_identity; SET LOCAL ROLE ductus_identity;` ... `SET LOCAL ROLE ductus_migrator; REVOKE CREATE ON SCHEMA x FROM ductus_identity;`. Tablice i funkcije pripadaju `ductus_identity` (tablice reference na `user_account` smije stvarati samo vlasnik).
3. Uvijek napiši `-- migrate:down` (lokalno), s komentarom "Local only".
4. Migracija mora proći na bazi s redovima (`institution-key-migration.integration.test.ts` pokazuje kako se testira migracija nad starim podacima).

B. Nova tablica (uz `ductus-new-table`)
1. `ENABLE` i `FORCE ROW LEVEL SECURITY`, politika `<tablica>_owner TO ductus_identity USING (true) WITH CHECK (true)` (FORCE traži politiku i za vlasnika), politika `_read FOR SELECT TO ductus_app` koja prvo provjerava `institution_id = (SELECT app.current_institution_id())`.
2. Ako to nije tablica identiteta: `institution_id uuid NOT NULL` bez defaulta, `UNIQUE (id, institution_id)`, složeni strani ključevi na roditelja i na `user_account (id, institution_id)`, bez CASCADE (D-103).
3. Grant: samo `GRANT SELECT` (ili stupci, kao `course_enrollment_code` bez `code_hash`) za `ductus_app`; pisanje isključivo kroz RPC.
4. Matrica: ažuriraj popise u `030` (katalog tablica, ovlasti, politike, plan broj) i dodaj redove za sve aktere iz ARCHITECTURE §7 (student A/B, nastavnik vlastitog/tuđeg kolegija, administrator vlastite/tuđe ustanove, anoniman, istekla i tuđa sesija, uloga `ductus_test_stranger`) uključujući persone druge ustanove (D-103). Ažuriraj `033` ako tablica nema ključ.
5. Odbijanje mora ostati i kad se privremeno doda USAGE/ovlast (TESTING §5), a testovi moraju pasti kad se makne politika, FORCE ili REVOKE.

C. Novi RPC
1. `LANGUAGE plpgsql ... SECURITY DEFINER SET search_path = ''`, sve s kvalificiranim imenima; prvo `institution.require_actor()`, pa provjera uloge (`actor_has_role`, `actor_course_role`, `actor_assignment_role`); nepoznat objekt isto što i zabranjeno (ZD403).
2. Idempotentnost (isti zahtjev vraća isti rezultat; različit sadržaj ZD409), zaključavanje (`FOR UPDATE`, `pg_advisory_xact_lock`) gdje postoje utrke.
3. `GRANT EXECUTE ... TO ductus_app` izričito (zadano je oduzeto od PUBLIC); prijave RPC-a koje samo `ductus_auth` smije: `REVOKE ALL ... FROM PUBLIC` pa grant samo toj ulozi.
4. Testovi u datoteci `031`/`032` ili novoj `03x-`: tko smije, tko ne, što ostaje poslije odbijanja, utrke (paralelne sesije idu u `tests/integration`).

D. Promjena `src/server/db`: ne proširuj `ALLOWED_STATEMENTS` ni ne izvozi pool; ažuriraj `with-actor.test.ts` i `tests/integration/with-actor.integration.test.ts`.

E. Izmjena lokalnog stoga ili `db/local/`: skripte moraju ostati zaštićene provjerom lokalnog socketa; ne stavljaj lozinke u repo (auth lozinka dolazi iz `DUCTUS_AUTH_LOCAL_PASSWORD`).

## 7. Provjera

Lokalno (Docker; ne pokreći ako nisi dobio zadatak koji to traži):
- `pnpm stack:up` (`docker compose up -d --build --wait`), `pnpm db:migrate` (provision migratora, `dbmate up` kao `ductus_migrator`, provision `ductus_app_local` i `ductus_auth_local`; treba `DUCTUS_AUTH_LOCAL_PASSWORD` iz `.env`), `pnpm test:db` (`pg_prove --recurse --ext .sql /db/tests` u kontejneru), `pnpm db:seed`, `pnpm test:integration`.
- Povrat: `pnpm db:rollback`, zatim opet `pnpm db:migrate` i `pnpm test:db`. Potpuni reset: `pnpm stack:down` (briše volumene, `down -v`) pa `stack:up`.
- `pnpm db:status` (dbmate status). `pnpm typecheck`, `pnpm lint`, `pnpm test:unit` za `src/server/db`.

CI: posao "Local stack (compose.yaml)" u `.github/workflows/ci.yml` (job `stack`) radi: `pnpm stack:up`, nasumična lozinka za `ductus_auth_local` po pokretanju, `pnpm db:migrate`, `pnpm test:db` (pgTAP), `pnpm db:seed`, `pnpm test:integration`, `pnpm build`, Playwright E2E i login E2E, zatim `stack:down`. Slike su pinane SHA-256 digestom. Jedinični i svojstveni testovi su u zasebnom poslu.

## 8. Zamke

- Plan pgTAP-a je fiksni broj (`SELECT plan(643)` u `030`); dodan ili izbačen test traži novi broj. Datoteke počinju `BEGIN` i završavaju `ROLLBACK`, pgTAP ekstenzija nikad ne ostaje u bazi.
- Uloge koje testiraš ne vide `public` (USAGE oduzet); `020` im dodjeljuje USAGE na `public` samo unutar transakcije.
- `has_table_privilege` broji naslijeđena prava, pa prijava koja je član `ductus_app` izgleda kao `ductus_app`; matrica zato izuzima prijave (`NOT rolcanlogin`) a `010` provjerava članstva.
- `FORCE ROW LEVEL SECURITY` znači da vlasnik bez politike ne vidi ništa; zato `_owner` politika.
- Vlasništvo se prenosi zadnje; nakon toga migrator ne može mijenjati objekt bez `SET LOCAL ROLE ductus_identity`. Vlasnik treba privremeno `CREATE` na shemi.
- `SET LOCAL ROLE` vrijedi samo do kraja transakcije migracije; na kraju vrati `ductus_migrator`.
- `enroll_with_code` traži `READ COMMITTED` (ZD500) i vraća red umjesto greške da se neuspjeli pokušaj zapiše; ne pretvaraj ga u RAISE.
- `is_plain_label` je u CHECK-ovima: pooštravanje funkcije može slomiti vraćanje postojećih podataka, zato migracija `removal` provjerava pohranjena imena prije promjene.
- Hash koda upisan u `course_enrollment_code` ne smije se dati `ductus_app`-u (stupčani grant).
- Docker slike u CI-ju dolaze s ECR/GHCR, ne s Docker Huba; lokalno zadane vrijednosti iz `compose.yaml`.
- `with-actor.ts`: promjena koja dopusti `SET` ili transakcijske naredbe, ili makne `DISCARD ALL`, vraća curenje stanja između zahtjeva.

## 9. Otvoreno

- D-91 (dbmate) je potvrđen, ali mjere `db/migrations.sum`, `--strict` u CI-ju, usporedba s `db/schema.sql` i `pg_advisory_lock` nisu u repou (nema ih u `db/`, `.github/` ni `package.json`: `db:migrate` ne koristi `--strict`). Ne pretpostavljaj da CI hvata izmjenu stare migracije.
- D-08 dio o dobavljačima (upravljana baza, PITR) je PRIJEDLOG do provjere B0.1, rok 16. 11. 2026. Ništa ne gradi na imenovanom dobavljaču baze. Dio o aplikaciji (PostgreSQL, RLS, uloge) je ODLUČEN.
- Domena evidencije (D-102), dnevnik potvrda po domeni (D-93, val 2), model računa za drugog izdavatelja (D-104, `critical`, prije M1) mijenjaju `identity.*` i buduće tablice; ne pretpostavljaj globalni brojač ni jedan izdavatelj u novom dizajnu.
- Odnos D-06 i D-39 (obavijest nastavniku, `notification`) je u Owner queue; tablica obavijesti se ne gradi dok nije razriješen.
- Pragovi P-01 do P-03 i rokovi čuvanja još nisu u `institution_settings`.
- Tablice evidencije i `evidence` shema: fizički nazivi se određuju u B-8/B4 prema prenesenom gatewayu (ARCHITECTURE §3).
