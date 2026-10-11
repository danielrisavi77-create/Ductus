# Ductus: karta testiranja

Ako se ovaj vodič i dokument ili kod razilaze, vrijedi dokument odnosno kod; nesklad prijavi u IZVJEŠTAJU.

Izvori: `docs/TESTING.md` (slojevi, browser politika, scenariji), `vitest.config.ts`, `playwright.config.ts`, `playwright.login.config.ts`, `package.json`, `.github/workflows/ci.yml`, `CLAUDE.md`, `.claude/rules/testni-podaci.md`.

## 1. Kada koristiti

- Dodaješ, mijenjaš ili tražiš test; pokrećeš provjeru prije commita; diraš `vitest.config.ts`, Playwright config ili korake testiranja u CI-ju.
- Uz njega: `ductus-synthetic-data` (podaci), `ductus-ci-change` (promjena workflowa), `ductus-attack-plan` (negativni testovi kao zahtjevi), `ductus-qa` (QA PASS), `ductus-new-table` (pgTAP redci). Mapu cijele aplikacije daje `docs/vodici/karta-aplikacije.md`.
- Cijeli `tests/` i `vitest.config.ts` su najmanje `critical` (ENGINEERING_SYSTEM §5); `e2e/` je Frontendov, QA ga dira samo u vlastitom zadatku (`.claude/rules/testni-podaci.md`, SESSIONS §1).

## 2. Slojevi i gdje žive

| Sloj | Gdje | Pokretanje |
| --- | --- | --- |
| Unit, colocated | `src/**/*.test.ts` (uz izvor) | `pnpm test:unit` |
| Unit, odvojeni | `tests/unit/**/*.test.ts` (auth, forbidden-terms, pg-import-boundary, codeowners, runner, vitest-workers, session-guc-scope, pr-metadata-precheck, server-sync-messages) | `pnpm test:unit` |
| Property (fast-check) | `src/**/*.property.test.ts`, `tests/property/**/*.property.test.ts` | `pnpm test:property` |
| Integration (živa baza i S3) | `tests/integration/**/*.integration.test.ts` | `pnpm test:integration` (treba `pnpm stack:up`, migrirano i seedano) |
| pgTAP | `db/tests/*.sql` (`000-harness`, `010-roles-and-privileges`, `020`..`022` sesija, `030`..`033` ustanova), `db/tests/fixtures/institution.inc` | `pnpm test:db` |
| E2E, glavni | `e2e/*.spec.ts` (accessibility, auth, block-identity, home, screenshots, shell) | `pnpm test:e2e` |
| E2E, puna prijava | `e2e/login/*.spec.ts` (`demo-flow`, `login`, `support.ts`) | `pnpm test:e2e:login` |
| Skripte | `scripts/engineering/*.test.mjs`, `scripts/orchestrator/*.test.mjs` (node:test) | `node --test scripts/engineering/*.test.mjs scripts/orchestrator/*.test.mjs` |
| Ostalo | `spikes/b0.2-reconstruction/spike.test.mjs`, `scripts/engineering/laya/tests/test_routing.py` | u `package.json` ni u CI-ju nisam našao korak koji ih pokreće |

Slojevi iz TESTING §1 koji još nemaju vlastiti kod u repou (chaos, load, restore, contract za sve adaptere): ne pretvaraj ih u tvrdnju da postoje.

## 3. Vitest (`vitest.config.ts`)

- Okruženje `node`; alias `^@/` -> `src/` (zrcali tsconfig, radi i na Windowsu).
- Tri projekta (`extends: true`):
  - `unit`: uključuje `src/**/*.test.ts` i `tests/unit/**/*.test.ts`; isključuje `*.property.test.ts`, `*.integration.test.ts`, `node_modules`.
  - `property`: `src/**/*.property.test.ts`, `tests/property/**/*.property.test.ts`; `setupFiles: tests/property/setup.ts`; `testTimeout` 60 000 ms. Property testovi se tako izvode točno jednom.
  - `integration`: `tests/integration/**/*.integration.test.ts`; `testTimeout` 30 000 ms; `APP_DATABASE_URL` (zadano lokalni `ductus_app_local` na 54329), `AUTH_DATABASE_URL` samo ako je postavljen.
- `FC_NUM_RUNS` skalira sve property testove (`tests/property/setup.ts`: `fc.configureGlobal({ numRuns })`, zadano 100).
- Broj paralelnih datoteka: funkcija `testWorkers` (pinuje `tests/unit/vitest-workers.test.ts`). `DUCTUS_TEST_WORKERS` postavlja broj (cijeli broj >= 1, samo znamenke; inače greška). Bez njega: u GitHub Actionsu odlučuje vitest, lokalno četvrtina procesora (min. 1). Mijenja samo brzinu, ne što se izvodi. Pre-push hook postavlja `CI=true` lokalno, pa ograničenje vrijedi.
- Napomena: `src/editor/interop.bench.test.ts` je običan `*.test.ts`, pa ulazi u `unit`.

## 4. Playwright

`playwright.config.ts` (`testDir: e2e`, `testIgnore: login/**`):
- `retries: 0` ("flaky pass nije pass"); reporter list + html; `locale hr-HR`, `timezoneId Europe/Zagreb`; video `on` u CI-ju, inače `retain-on-failure`; screenshot i trace pri padu.
- Četiri projekta: `desktop` (Desktop Chrome), `mobile` (Pixel 7, Chromium viewport), `firefox`, `webkit` (Desktop Safari). Svaki spec ide u svakom projektu; lokalno `--project desktop` za jedan.
- Tri web servera na 3000, 3001, 3002: isti produkcijski build; drugi i treći startaju s `NODE_ENV=test` odnosno `development` jer D-09 mora vrijediti za svaki `NODE_ENV` (`e2e/auth.spec.ts`). Svi imaju `DUCTUS_AUTH_PROVIDER=fake-oidc` namjerno, a build ga mora odbiti.
- Build: `pnpm build && pnpm start`; `E2E_NO_BUILD=1` preskače build (CI ga koristi). `E2E_REUSE_SERVER=1` dopušta već pokrenut server (zadano ne, jer na portu može biti `next dev` ili star build).

`playwright.login.config.ts` (`testDir: e2e/login`): samo `login-chromium`, `workers: 1`, `timeout` 90 s, izlaz u `playwright-report-login` i `test-results-login`, server je `pnpm dev --port 3000` jer produkcijski build lažnog pružatelja odbija. Treba stog (baza + lažni OIDC na 8090), migriranu i seedanu bazu i `AUTH_DATABASE_URL`.

Pomoći: `e2e/support/identity-harness.ts` i `.entry.ts` (paket bundlea Vite iz Vitesta i servira kroz `page.route`; ništa se ne dodaje u aplikaciju), `e2e/login/support.ts` (kolačići `__Host-ductus_session` i `__Host-ductus_login`, čita red sesije admin vezom).

## 5. Skripte u package.json

- `test:unit` = `vitest run --project unit`; `test:property` = `vitest run --project property`; `test` = unit + property (to pokreće i pre-push hook); `test:integration` = `vitest run --project integration`.
- `test:e2e` = `playwright test`; `test:e2e:login` = `playwright test --config playwright.login.config.ts`.
- `test:db` = `docker compose exec -T postgres pg_prove -U ductus -d ductus --recurse --ext .sql /db/tests` (`db/tests` je montiran samo za čitanje).
- Priprema: `stack:up` (`docker compose up -d --build --wait`), `stack:down` (`down -v`), `db:migrate` (provision + dbmate up + app i auth login), `db:seed`.
- Statičke provjere koje CI vrti uz testove: `lint` (`eslint .`), `typecheck` (`tsc --noEmit`).
- `agents:lint` (agnix) nije u CI jobu "build" koji sam vidio.

## 6. Koji CI job što izvodi (`.github/workflows/ci.yml`)

Job `build` ("Lint, typecheck, test and build"): `pnpm lint`, `pnpm typecheck`, `pr-metadata-check.mjs` (samo PR), `pnpm test:unit`, `node --test` skripte (`shopt -s failglob`), `pnpm test:property`, `pnpm build`.

Job `stack` ("Local stack"): `stack:up`, nasumična lozinka za `ductus_auth_local` po pokretanju (maskirana), `db:migrate`, `test:db` (pg_prove), `db:seed`, `test:integration`, `build`, instalacija chromium+firefox+webkit, `test:e2e` (`E2E_NO_BUILD=1`), upload `playwright-report`, `test:e2e:login`, upload `playwright-report-login`, `docker compose logs` pri padu, `stack:down` uvijek.

Job `security`: gitleaks, negativni smoke, zizmor, Semgrep, OSV. Drugi workflowi: `dependency-review.yml`, `engineering-gate.yml` (metadata, review i QA, ne izvršava PR kod). Obvezni statusi na `main`: CI, Local stack, Security scanners, Dependency review, Engineering review gate (STATE.md Owner queue). Lokalni hookovi (`lefthook.yml`): pre-commit eslint + gitleaks; pre-push `typecheck` i `test`.

## 7. Browser politika (TESTING §2)

Chromium za svaki frontend/E2E PR; Firefox za editor, sync, journal, clipboard, auth, submission; WebKit za editor, IndexedDB/Dexie, offline, Web Locks, clipboard, auth, submission. CI vrti sva tri na svakom PR-u, bez filtra po putanji (komentar u `playwright.config.ts`). Mobilni viewport je dodatak, ne zamjena WebKita. Iznimka demoa (D-98 dopuna): demo spec K-4 obvezan do 1. 11. samo na Chromiumu, ostali informativno. Iznimka vlasnika: puna prijava samo Chromium; odbijanje lažnog pružatelja u buildu (`e2e/auth.spec.ts`) ide na sva tri.

## 8. Obvezni adversarial scenariji (TESTING §3)

Prije pilota svaki od 24 dobiva test ili zapis ručne probe: dva taba, dva uređaja, offline pa povrat, crash tijekom lokalnog savea, istek sesije offline, drugi korisnik u istom pregledniku, IndexedDB quota/eviction, private browsing, stari frontend nakon deploya, isti ID isti sadržaj, isti ID drugi sadržaj, korumpiran objekt, worker pada prije/poslije potpisa, DB/S3/KMS nedostupni, ukinuto članstvo uz otvorenu stranicu, zlonamjerni HTML pri pasteu, paste 100.000+ znakova, zero-width/bidi, programski umetnut tekst, promjena sata/DST oko roka, 100 predaja u zadnjih 15 min, povrat baze i bucketa. Ne tvrdi da je neki pokriven bez imena testa.

Falsification (TESTING §4): kanonski par A (samostalno tipkanje) i B (pretipkavanje tuđeg/AI teksta); ako su opaženi događaji isti, projekcija mora biti ista; "nepoznato ostaje nepoznato". Security negativni (TESTING §5): critical backend PR ima barem jedan test koji bi prošao da zaštita ne postoji, pa dokaz da je odbija. QA PASS (TESTING §7) navodi aktualni head i što je pokušano; "CI je zelen" nije QA PASS.

## 9. Nikad ne briši i ne preskači

- CLAUDE.md: "Testovi moraju biti zeleni prije svakog commita. Nikad ne briši, ne preskači i ne stavljaj u karantenu test bez jednakovrijedne zamjene."
- `.claude/rules/testni-podaci.md`: popravak prihvaćenog nalaza ide s testom koji bez popravka pada.
- TESTING §9: test koji povremeno prolazi smatra se padom dok se uzrok ne ukloni.
- Hook "protect-tests" nisam našao: u `.claude/settings.json` i `scripts/hooks/` postoje `safety-net.mjs`, `pr-metadata-precheck.mjs`, `pr-auto-merge.mjs`, `pr-command.mjs`, i nijedan nije imenovan ni opisan kao zaštita testova (sadržaj `safety-net.mjs` nisam čitao u cijelosti). Pravilo je dakle u CLAUDE.md i recenziji, a gate podiže rizik za `tests/` na `critical`.

## 10. Fixturei i sintetički podaci

- Svi izmišljeni (CLAUDE.md; ARCHITECTURE §9): rezervirane domene (`.test`, `.example`), npr. `demo.ductus.test` i `ana@demo.ductus.test` u `tests/unit/auth/test-idp.ts` i `e2e/login/support.ts`.
- `tests/unit/auth/test-idp.ts` (`createTestIdp`): OIDC pružatelj kao `fetch` funkcija, bez mreže; `next` upravlja kako se ponaša loše, jedan način po testu.
- pgTAP: svaka datoteka je jedna transakcija i završava `ROLLBACK`-om (`000-harness.sql`); zajednički fixture `db/tests/fixtures/institution.inc` uključuje se s `\ir` u istoj transakciji, definira osobe preko privremene tablice `person` s determinističkim UUID-ovima i dvije izmišljene ustanove (`fak-a`, `fak-b`).
- Seed za lokalni stog: `db/local/seed.sql` (demo ustanova `demo-fakultet`), pokreće `pnpm db:seed`.
- Zlatni vektori: `src/domain/forensics/golden-vectors/evidence-v2.json` (+ `load.ts`), `src/domain/document/edit-step.vectors.json`; test ih drži jednakima dokumentu (`evidence-receipt-v2.test.ts`).
- Satovi i mreža se ubrizgavaju (npr. `drain.ts` prima sat i adaptere); IndexedDB u testovima je `fake-indexeddb` (`src/lib/journal/*.test.ts`).
- Imenovanje: `*.hardening.test.ts` (nalazi neovisnog pregleda), `*.model.test.ts`, `*.property.test.ts`, `*.integration.test.ts`. Imenovanje određuje projekt (§3).
- Interni RFC 8032 testni seed u BACKEND.md je javni i samo za test; nikad produkcijski ključ.

## 11. Provjera prije predaje

1. `pnpm lint` i `pnpm typecheck`.
2. `pnpm test` (unit + property); za skripte `node --test scripts/engineering/*.test.mjs scripts/orchestrator/*.test.mjs`.
3. Dira bazu, ulogu ili ovlast: `pnpm stack:up`, `pnpm db:migrate`, `pnpm test:db`, `pnpm db:seed`, `pnpm test:integration`.
4. Dira UI, rutu ili auth: `pnpm build` pa `pnpm test:e2e` (ili `--project desktop` za brzi prolaz, ali CI traži sva četiri projekta); za puni tok prijave `pnpm test:e2e:login`.
5. Test koji dodaješ mora pasti bez popravka (negativni test); za critical dodaj plan napada (`ductus-attack-plan`).

## 12. Zamke

- Naziv datoteke odlučuje o projektu: `.property.test.ts` NE ulazi u `unit`; `.integration.test.ts` mora biti u `tests/integration/` da ga integration projekt uhvati (`src/**` se ne traži).
- ESLint test `tests/unit/pg-import-boundary*.test.ts` prvi put učitava konfiguraciju nekoliko sekundi, zato `beforeAll` ima 60 s.
- Integration i E2E trebaju stog i ne rade bez `AUTH_DATABASE_URL`/migriranih baza; lozinka nikad u repo (`.env.example` samo opisuje).
- Server na portu 3000 koji nije svjež build daje lažne rezultate: ne postavljaj `E2E_REUSE_SERVER=1` bez razloga.
- `test:e2e` pokreće tri servera i četiri projekta; spor je i traži `pnpm build` (osim `E2E_NO_BUILD=1`).
- `FC_NUM_RUNS` mijenja pokrivenost property testova; CI koristi zadano 100.

## 13. Otvoreno

- Contract testovi "svi adapteri poštuju isti ugovor" (ARCHITECTURE §2a) postoje djelomično; ne tvrdi potpunost.
- Demo specovi K-4 i post-merge smoke (TESTING §8) ovise o PLAN-DEMO; provjeri ondje prije gradnje.
- Pragovi i razmak kontrolnih točaka (PRIJEDLOG, ARCHITECTURE §5) ne smiju biti fiksirani u testovima koji bi ih učinili skupima za promjenu bez odluke vlasnika.
- Je li zaštita testova strojno provedena izvan recenzije: nisam utvrdio.
