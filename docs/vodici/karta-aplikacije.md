# Ductus: karta aplikacije

Ako se ovaj vodič i dokument ili kod razilaze, vrijedi dokument odnosno kod; nesklad prijavi u IZVJEŠTAJU.

Stanje: čitano na `main` 11. 10. 2026. Što je implementirano dokazuje kod, ne dokument: `docs/ARCHITECTURE.md` §0.1 kaže da opisuje ciljnu arhitekturu, a ne da su svi moduli napisani. Ispod je samo ono što u repou postoji.

## 1. Kada koristiti

- Početak svakog zadatka, nakon `STATE.md` (CLAUDE.md: "Prije svakog rada pročitaj `STATE.md`"), da pronađeš pravo područje.
- Zatim otvori vodič područja iz tablice u §8. Postojeće kratke popise provjera (`.claude/skills/`) koristi uz njih: `ductus-worker` (cijeli tok zadatka), `ductus-new-table`, `ductus-sync-states`, `ductus-offline-recovery`, `ductus-local-storage-logout`, `ductus-identity-isolation`, `ductus-provenance-invariants`, `ductus-ui-copy`, `ductus-synthetic-data`, `ductus-ci-change`, `ductus-rules-change`, `ductus-attack-plan`, `ductus-review`, `ductus-qa`.
- Pravila po putanjama (`.claude/rules/`: `baza.md`, `evidencija-i-prijava.md`, `pravila-i-alati.md`, `sinkronizacija.md`, `sucelje.md`, `testni-podaci.md`) učitavaju se sama; to su podsjetnici, ne pravila.

## 2. Stack i verzije

Izvor: `package.json`, `compose.yaml`, `next.config.ts`, `tsconfig.json`, `.nvmrc`.

- Node `>=24` (`engines`), `pnpm@10.33.0` (`packageManager`), ESM (`"type": "module"`). TypeScript `^5.9.3`, `strict`, putanja `@/*` -> `./src/*`.
- Next.js `15.5.27` (App Router), React `19.3.0`. `next.config.ts` postavlja samo `poweredByHeader: false` i zaglavlja `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff`; puni CSP dolazi s portom editora (komentar u datoteci).
- Editor: Tiptap `^3.31.3` (core, react, pm, ekstenzije bold/italic/heading/history/paragraph/text/document/placeholder). Lokalna pohrana: Dexie `^4.4.6`.
- Prijava: `openid-client` `6.8.8`. Baza: `pg` `^8.23.1`. `@smithy/signature-v4` `5.7.4` (potpis S3 zahtjeva, `src/adapters/evidence/s3-signature.ts`).
- Testovi: Vitest `^5.0.1`, `fast-check ^4.10.2` + `@fast-check/vitest`, Playwright `^1.63.0`, `@axe-core/playwright`, `fake-indexeddb`. Detalji u `docs/vodici/testovi.md`.
- Alati: `dbmate ^2.36.0` (migracije), `lefthook ^2.1.16` (git hookovi), `cc-safety-net 2.6.1`.
- Lokalni stog (`compose.yaml`, projekt `ductus`, sve na `127.0.0.1`): `postgres` (PostgreSQL 17.11 s pgTAP, build iz `infra/postgres`, port 54329), `objects` (RustFS 1.0.0, S3 API, port 9100), `mail` (Mailpit, 8025 i 1025), `oidc` (lažni OIDC iz `infra/fake-oidc`, port 8090). Lokalne vrijednosti u `.env.example`; tajne nikad u repo.
- Ne postoje (ARCHITECTURE §1 ih planira): worker proces, pg-boss, API ruta za ingest, KMS u radu, Caddy/VM. Ne gradi kao da postoje.

## 3. Raspored direktorija

Korijen: `app/`, `src/`, `db/`, `tests/`, `e2e/`, `infra/`, `scripts/`, `config/`, `spikes/`, `plugins/`, `docs/`, `.github/`, `.claude/`, uz `STATE.md`, `CLAUDE.md`, `AGENTS.md`, `lefthook.yml`, `osv-scanner.toml`.

`app/` (Next.js granica; samo tanki ulazi):
- `app/layout.tsx`, `app/page.tsx` (početna), `app/rad/page.tsx` (radni prostor), `app/globals.css`, `app/fonts/` (woff2 + `fonts.css`, `index.ts`, licence OFL, `SOURCE.md`).
- `app/api/auth/{login,callback,logout}/route.ts`: svaki je dvije linije, `authRoute(...)` iz `@/server/auth/deps` + `startLogin` / `finishLogin` / `logout` iz `@/server/auth/flow`. Ostalih API ruta još nema.

`src/` (jedan modularni monolit):
- `src/domain/`: čista pravila bez Reacta, SQL-a i SDK-ova. Podmape: `document` (kanonski model, `validate`, `normalize`, `transaction`, `edit-step`, `equality`), `sync` (`states`, `drain`, `recovery`, `restore`, `conflict`, `labels`, `journal-types`), `serverSync` (`contract`, `bootstrap`, `checkpoints`, `messages`), `forensics` (`jcs`, `crypto`, `signature`, `evidence-chain-v2`, `evidence-segment-v2`, `evidence-receipt`, `evidence-receipt-verifier`, `replay`, `ledger`, `integrity`, zlatni vektori), `evidence` (`basis`), `citation`, `collaboration` (`anchor`, `revision-request`, `share`), `diff`, te `json.ts`.
- `src/application/`: `ports/` (sučelja: `authorization`, `evidence-ingest`, `evidence-object-key`, `evidence-outbox`, `evidence-reconstruction`, `evidence-trust`, `signing-key-provider`) i `evidence/` (`evidence-gateway`, `evidence-outbox`, `evidence-reconstruction`).
- `src/adapters/`: `crypto/` (`development-ed25519-signer`, `aws-kms-ed25519-signer`) i `evidence/` (in-memory repozitorij/kontekst/pohrana, `s3-evidence-payload-store`, `s3-signature`, `evidence-storage-config`).
- `src/server/`: `auth/` (OIDC: `oidc`, `flow`, `config`, `claims`, `session-token`, `return-to`, `deps`), `db/` (`withActor` u `with-actor.ts`, `openSession` u `open-session.ts`, pool u `index.ts`, `APP_POOL_MAX = 10`), `http/mutation-request.ts` (`checkMutationRequest`, `readBodyWithLimit`).
- `src/editor/`: `schema`, `identity` (ID blokova), `interop`, `storable-input`, `storable-text`.
- `src/lib/`: `i18n/` (`messages.hr.ts`, `hr.ts`) i `journal/` (`atomic-dexie-journal`, `local-document-saver`, `local-scope`).
- `src/components/`: `shell/` (`AppHeader`, `ShellRail`, `WorkspaceShell`) i `fonts/`.
- Nepostojeće mape iz ARCHITECTURE §0.1: `src/features/`, `src/runtime/web`, `src/runtime/worker`.

Ostalo:
- `db/migrations/` (9 dbmate migracija, od `20261003200000_baseline.sql` do `20261011100000_institution_assignment_key.sql`), `db/local/` (`migrator.sql`, `app-login.sql`, `auth-login.sql`, `seed.sql`), `db/tests/` (pgTAP `000` do `033`, `fixtures/institution.inc`).
- `tests/{unit,integration,property}`, `e2e/` (+ `e2e/login`, `e2e/support`): vidi `docs/vodici/testovi.md`.
- `infra/fake-oidc` (Dockerfile, `server.mjs`, vlastiti `package.json`/lockfile), `infra/postgres/Dockerfile`.
- `scripts/`: `engineering/` (PR metadata i review gate, `protected-paths.mjs`, `agent-hooks.mjs`, token-report), `orchestrator/` (`pr-status`, `pr-ready`, `push-verify`, `wait-verdict`, ...), `hooks/` (`safety-net`, `pr-metadata-precheck`, `pr-auto-merge`, `pr-command`), `forbidden-terms/` (skener teksta sučelja), `*.ps1` (worktree/usage pomoćnici).
- `config/faculties/fpzg/citation.json`: podaci pravila fakulteta (citatni stil).
- `spikes/b0.2-reconstruction/`: izolirano mjerenje rekonstrukcije (vlastiti `package.json`, `README.md`); nije dio buildа.
- `plugins/ductura-engineering/`: plugin sa skillovima za Codex/ChatGPT (`ductus-identity-isolation`, `ductus-offline-recovery`, `ductus-provenance-invariants`) i referencama. Putanja je D-97.
- `.github/workflows/`: `ci.yml`, `dependency-review.yml`, `engineering-gate.yml`.

## 4. Smjer ovisnosti

Pravilo (ARCHITECTURE §0.1): ovisnost ide prema unutra; `app` poziva application/server; application ovisi o domainu i portovima; adapters implementiraju portove; domain ne ovisi o Reactu, SQL-u, pohrani ni vendor SDK-ovima.

Što ESLint zaista provodi (`eslint.config.mjs`): samo jedna granica. Uvoz `pg`, `pg/...`, `pg-*` (regex `^pg(?:$|/|-)`) i dinamički `import("pg")` zabranjeni su svugdje osim u `src/server/db/**`, `tests/integration/**` i `e2e/login/**` (BACKEND §4.3, `withActor`). Pinuju je `tests/unit/pg-import-boundary.test.ts` i `pg-import-boundary.hardening.test.ts`. Ostale granice slojeva ESLint NE provodi; drži ih konvencija i recenzija.

Stvarno stanje uvoza (provjereno grepom, bez testova):
- `domain` uvozi uglavnom `domain`. Iznimka: `src/domain/serverSync/checkpoints.ts` uvozi `formatDateTimeHr` iz `@/lib/i18n/hr` (odstupanje od "domain bez ovisnosti"; prijavi, ne širi).
- `application` uvozi `domain` i svoje portove; `adapters` iz `application`/`domain`. Uvoz `adapters` u `application` nalazi se samo u testovima.
- `lib/journal` uvozi `domain` i `editor`; `editor` uvozi `domain`; `server` uvozi `lib/i18n` i `domain`; `components` uvoze `lib/i18n`.
- `app/` uvozi samo `@/server/auth/*`, `@/components/shell/*`, `@/lib/i18n/*`.

## 5. Tok jedne promjene (ARCHITECTURE §5)

Cilj, ne stanje. Implementirani dijelovi su označeni.

1. Editor stvara transakcije; journal ih trajno piše na uređaju ("spremljeno na uređaju"). Implementirano: `src/editor/*`, `src/lib/journal/atomic-dexie-journal.ts`, `local-document-saver.ts`, `src/domain/document/transaction.ts`.
2. Transakcije se sažimaju u odsječak od najviše 30 s (format v2: `src/domain/forensics/evidence-segment-v2.ts`, JCS u `jcs.ts`).
3. Drain šalje odsječak verzioniranoj API ruti za ingest: provjera sesije (`current_actor()`), SHA-256, zapis objekta u bucket (`v2/<ustanova>/<paket>/<hash>.json`), jedan RPC za CAS reviziju + `reserve`. Planirano u dijelovima: `src/domain/sync/drain.ts` i `src/domain/serverSync/*` postoje; ruta za ingest, RPC i tablice evidencije NE postoje u `db/migrations/`. S3 adapter postoji (`s3-evidence-payload-store.ts`).
4. Worker potpisuje (D-92) preko porta potpisa. Port i razvojni/KMS potpisnik postoje u `src/adapters/crypto/`; worker ne postoji.
5. "Spremljeno na poslužitelju" tek uz potpisanu potvrdu (`evidence-receipt.ts`, `evidence-receipt-verifier.ts`); inače klijent ostaje u čekanju.

Tvrde invarijante cijelog toka (STATE.md "Ne smije se izgubiti"): JCS + SHA-256, nepoznata polja se odbijaju, commit+reserve atomarno, ograničenje veličine na klijentu i poslužitelju (B-8); SYNCED samo uz potpisanu potvrdu (F-3/F-8); replay za delete/cut/replace provjerava hash uklonjenog raspona (B-12).

## 6. Okruženja (ARCHITECTURE §9)

- Lokalno i CI: `docker compose` (Postgres s istim ulogama i migracijama, RustFS, Mailpit, lažni OIDC), samo sintetički podaci, lažni OIDC dopušten (D-09).
- Staging: kao produkcija, AAI@EduHr Lab, samo sintetički. Produkcija: VM u EU-u (Caddy, web, worker), upravljani PostgreSQL, tek stvarni podaci nakon GO uvjeta. Dobavljači su PRIJEDLOG (D-08, B0.1).
- Migracije: lokalno `pnpm db:migrate`; na staging/produkciju ih iz agenta nikad ne primjenjuješ (CLAUDE.md, ARCHITECTURE §9).
- Build odbija lažnog pružatelja za svaki `NODE_ENV` (`e2e/auth.spec.ts`); "Demo prijava" radi samo pod `next dev` (`playwright.login.config.ts`).

## 7. Naredbe (package.json)

`pnpm dev|build|start`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (unit + property), `pnpm stack:up|stack:down`, `pnpm db:migrate|db:seed|db:rollback|db:status|db:new`, `pnpm test:db`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm test:e2e:login`, `pnpm orch:*`, `pnpm agents:lint`, `pnpm tokens:report`. Što koja pokreće: `docs/vodici/testovi.md`.

## 8. "Trebam promijeniti X": odakle krenuti

| Trebam | Počni u | Vodič područja |
| --- | --- | --- |
| Hash/JCS, potpis, potvrda, lanac odsječaka, replay, zlatni vektori | `src/domain/forensics/*`, `src/domain/evidence/basis.ts`, `src/application/evidence/*`, `src/adapters/crypto/*` | `docs/vodici/evidencija.md` |
| S3 pohrana objekata, ključ objekta, outbox, rekonstrukcija | `src/adapters/evidence/*`, `src/application/ports/evidence-*.ts` | `docs/vodici/evidencija.md` |
| Stanja spremanja, drain, recovery, konflikt, Dexie journal, odjava | `src/domain/sync/*`, `src/domain/serverSync/*`, `src/lib/journal/*` | `docs/vodici/sinkronizacija.md` (+ `ductus-sync-states`, `ductus-offline-recovery`, `ductus-local-storage-logout`) |
| Dokument, korak uređivanja, schema, ID blokova, paste/ulaz | `src/domain/document/*`, `src/editor/*` | `docs/vodici/editor-i-dokument.md` |
| Tekst sučelja, ljuska, raspored, fontovi, dostupnost | `src/lib/i18n/*`, `src/components/*`, `app/*.tsx`, `app/globals.css` | `docs/vodici/sucelje.md` (+ `ductus-ui-copy`) |
| Prijava, sesija, kolačići, `return-to`, CSRF/Origin | `src/server/auth/*`, `src/server/http/*`, `app/api/auth/*` | `docs/vodici/prijava.md` |
| Tablica, uloga, RLS, RPC, migracija, pgTAP, `withActor` | `db/migrations/`, `db/tests/`, `db/local/`, `src/server/db/*` | `docs/vodici/baza.md` (+ `ductus-new-table`) |
| Novi ili izmijenjeni test, fixture, workflow job, Playwright projekt | `tests/`, `e2e/`, `vitest.config.ts`, `.github/workflows/ci.yml` | `docs/vodici/testovi.md` (+ `ductus-synthetic-data`, `ductus-ci-change`) |
| Citiranje, usporedba verzija, komentari/prijedlozi | `src/domain/citation/*`, `config/faculties/`, `src/domain/diff/*`, `src/domain/collaboration/*` | `docs/vodici/editor-i-dokument.md` |
| Pravila rada, gate, hookovi, uloge | `docs/ENGINEERING_SYSTEM.md`, `scripts/engineering/`, `.claude/` | `ductus-rules-change` |

## 9. Risk razine po putanji (ENGINEERING_SYSTEM §5)

Donja granica računa gate iz promijenjenih putanja; agent je ne smije spustiti.
- `low`: samo dokumentacija bez D-97 putanja.
- `standard`: runtime kod, infra, izvršne skripte, `docs/DECISIONS.md`.
- `critical` (najmanje): identity/auth/authz/OIDC/session, evidence, ingest, submission, crypto/signing/forensics/JCS/replay, `app/api/**` s tim segmentima, sigurnosne migracije, pgTAP matrica, forbidden-terms gate, svaki workflow, putanje D-97 (`D97_PATHS` u `scripts/engineering/protected-paths.mjs`: `.github/`, `.claude/`, `scripts/engineering/`, `scripts/hooks/`, `scripts/orchestrator/`, `lefthook.yml`, `plugins/ductura-engineering/`, ...), `STATE.md`, `db/migrations/`, `db/local/`, `src/server/db/`, cijeli `tests/` i `vitest.config.ts`.
- Putanje D-97 spaja tek Danielova naredba. PR metadata (`Agent`, `Risk`, `Task`) provjerava `scripts/engineering/pr-metadata-check.mjs`.

## 10. Tvrda pravila koja se vide u svakoj promjeni (CLAUDE.md)

Prijava studenata samo AAI@EduHr (D-09); PRODUCT §5 i rječnik zabranjenih izraza; jedan korak iz STATE.md po PR-u, oko 400 redaka; testovi zeleni prije commita, test se ne briše ni ne preskače bez jednakovrijedne zamjene; klijent piše u tablice evidencije/predaje/revizijskog traga samo kroz RPC; svaka nova tablica ima RLS i retke u pgTAP matrici; samo sintetički podaci; `git add <putanje>`; prefiksi `feat:|fix:|test:|docs:|chore:`; tekst sučelja hrvatski, kod i commit poruke engleski, `docs/` hrvatski.

## 11. Zamke

- Naziv mape nije dokaz implementacije (ARCHITECTURE §0.1): nema workera, ingest rute ni tablica evidencije, iako ih dokumenti opisuju.
- `app/` drži samo tanke ulaze; logika ide u `src/`.
- ESLint ne štiti granice slojeva osim `pg`; ne računaj na njega da uhvati krivi uvoz.
- Playwright pokreće produkcijski build, nikad `next dev` (osim `playwright.login.config.ts`); lažni OIDC u buildu je namjerno odbijen.
- `error.log` u korijenu nije dio repoa (untracked); ne dodaji ga.

## 12. Otvoreno

- D-08, dio o dobavljačima i trošku: PRIJEDLOG do B0.1 (rok 16. 11. 2026.); odnos prema B0.2 nije odlučen (STATE.md Owner queue). Ništa skupo ne gradi na tome.
- D-72 (neovisno vrijeme, RFC 3161), D-73 (samo izbor OIDC biblioteke), D-75: PRIJEDLOG (ARCHITECTURE uvod).
- Retci ARCHITECTURE §1 Editor, Lokalna pohrana, E-pošta ostaju prijedlog; razmak kontrolnih točaka (~2.000 koraka) je PRIJEDLOG.
- Odnos D-06 i D-39 otvoren u Owner queue; do odluke vrijedi D-06.
- Ime proizvoda, vidljivost repoa, pravni izvršitelj obrade: Owner queue.
