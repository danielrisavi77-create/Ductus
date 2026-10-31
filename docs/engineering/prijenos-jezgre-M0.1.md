# Zapis prijenosa jezgre iz `pisac-editor` (M0.1)

Datum: 31. 10. 2026. · Korak M0.1 iz `docs/PROGRAM-RAZRADA.md` · DAN-376 · autor `claude:p2:platforma`

Zapis daje broj testova po sloju u izvoru i na `main`, točne naredbe brojanja i usporedbu s izlaznim kriterijem M0 iz `docs/PROGRAM.md`: „Svi preneseni testovi zeleni, isti broj kao u izvoru”. Popis što se prenosi je u `docs/ARCHITECTURE.md` §12 i `docs/BACKEND.md` §2. Zapis ne odlučuje prihvaća li se kriterij; to je pitanje 9 u `docs/PROGRAM-RAZRADA.md`.

## Točke mjerenja

| Repo | Commit | Zašto ovaj |
| --- | --- | --- |
| `danielrisavi77-create/pisac-editor` | `6cd0b75324f645177788bc5f715f31d0aa550043` (spajanje izvornog PR-a #50, 3. 10. 2026.) | Osnova svih PR-ova prijenosa (#8, #19, #21, #24, #26, #49 navode `pisac-editor@6cd0b75`). Kasniji `main` izvora `e63eda8ed9733de7202ae52f9581d2590ed5d3ed` mijenja samo dokumentaciju; brojevi su isti. |
| `danielrisavi77-create/Ductus` | `7f45899bf95be0c729e23acdf361eee164fd17e2` | Najnoviji commit na `main` sa zelenim CI-jem u trenutku mjerenja (CI run 41219649323). Noviji commiti na `main` tada još nisu imali završen CI. |

## Brojevi po sloju

Broj iz CI-ja je broj slučajeva koje je alat izveo i ispisao (vitest `Tests`, Playwright `passed`, `pg_prove` `Tests=`, `node --test` `ℹ tests`). Statički broj je broj redaka koji počinju pozivom `it`/`test` (s `.prop`, `.each`, `.skip` i sličnim); `.each` tablica i petlje broje se jednom, pa je statički broj manji. Isti način brojanja koristili su PR-ovi prijenosa („broj literalnih `it`/`test` poziva; `.each` je brojen jednom”, #8).

| Sloj | Izvor: datoteka | Izvor: CI | Izvor: statički | Ductus: datoteka | Ductus: CI | Ductus: statički |
| --- | --- | --- | --- | --- | --- | --- |
| unit (vitest) | 110 | 1.498 | 1.264 | 263 | 8.373 | 3.134 |
| property (vitest) | 1 | 6 | 6 | 22 | 78 | 78 |
| integration (vitest) | nema sloja | – | – | 37 | 189 | 171 |
| E2E (Playwright) | 14 | 65 | 57 | 55 | 1.012 standardni + 181 prijava | 311 |
| pgTAP | nema sloja | – | – | 49 | 3.459 (`pg_prove`) | 1.784 (zbroj `plan(n)`) |
| `node --test` | 13 (`tools/ai-architect`) | 86 | 86 | 83 | vidi niže | 934 |
| OpenFGA model (`authz/*.fga`) | – | 9 | – | nema sloja | – | – |

Napomene uz tablicu:

- **E2E Ductus:** standardni E2E iz tri sharda (340 + 364 + 308) i E2E prijave iz šest shardova (20 + 16 + 30 + 46 + 44 + 25). Projekti u `playwright.config.ts` množe svaki `test` po pregledniku i uređaju, zato je broj iz CI-ja veći od statičkog.
- **pgTAP:** `pg_prove` broji izvedene tvrdnje (`Files=49, Tests=3459`); dio datoteka računa `plan` izrazom, pa zbroj literalnih `plan(n)` nije potpun.
- **`node --test` Ductus u CI-ju:** 978 (`scripts/engineering`, `scripts/orchestrator`), 59 i 5 (`pnpm test:demo`, `pnpm test:fake-oidc`), 8 (`pnpm test:skills`); u E2E poslovima još 6 (`pnpm stack:up`) i 3 (`pnpm test:demo:browser`).
- **Izvor:** `node --test` (86) pripada AI Architectu, a OpenFGA testovi (9) modelu ovlasti; ni jedno se ne prenosi (`docs/ARCHITECTURE.md` §12: AI Architect se ne prenosi, `authz/*.fga` samo kao izvor neprijateljskih slučajeva).

## Usporedba po prenesenim datotekama (unit i property, statički)

Izvor ima 1.270 statičkih unit i property slučajeva. Raspored:

| Skupina | Slučajeva u izvoru | Stanje u Ductusu |
| --- | --- | --- |
| A. Preneseno na istu putanju | 509 | 612 na istim putanjama; nijedna datoteka nema manje slučajeva nego u izvoru |
| B. Nije preneseno, razlog zapisan u PR-u prijenosa | 143 | – |
| C. U planu prijenosa ili na popisu §12, a nije preneseno ni zapisano kao izostavljeno | 271 | vlastite zamjene za dio, bez zapisa usporedbe |
| D. Izvan opsega prijenosa prema §12 i odlukama u PR-ovima prijenosa | 347 | – |

**A. Preneseno (izvor → Ductus, statički):** `domain/json` 8 → 11; `domain/diff` 7 → 7; `domain/document` 78 → 78 (5 datoteka); `domain/collaboration` 20 → 26; `domain/evidence/basis` 6 → 10; `domain/forensics` (`canonicalization.property`, `crypto`, `evidence-segment-v2`, `forensics`, `jcs`, `signature`) 32 → 47; `forensics/replay` 2 iz `replay-rhythm` → 4 u `replay.test.ts`; `domain/serverSync` (`bootstrap`, `checkpoints`, `contract`) 80 → 84; `domain/sync` (`conflict`, `drain`, `labels`, `recovery`, `states`) 170 → 191; `application/evidence` (`evidence-gateway`, `evidence-outbox`) 21 → 51; `application/ports/evidence-ingest` 2 → 13; `adapters/crypto` (`aws-kms-ed25519-signer`, `development-ed25519-signer`) 6 → 8; `editor` (`schema`, `interop`, `interop.bench`) 52 → 57; `lib/i18n/hr` 25 → 25.

**B. Nije preneseno, s razlogom u PR-u prijenosa:**

| Izvor | Slučajeva | Razlog i trag |
| --- | --- | --- |
| `domain/serverSync/migration`, `checkpointsMigration`, `leastPrivilegeMigration` | 85 | tekstualne provjere Supabase SQL migracija; zamjena su pgTAP testovi (#8, #24) |
| `domain/forensics` `rhythm` dio `replay-rhythm`, `sessions`, `semantic`, `process-history`, `process-analytics`, `global-history-navigation`, `mentor-process`, `playback` | 38 | računaju mjere iz vremena, PRODUCT §5 pravilo 4 i D-63 (#18) |
| `adapters/evidence/supabase-*` (4 datoteke) | 13 | prepisuju se, `docs/ARCHITECTURE.md` §12 |
| `adapters/crypto/azure-key-vault-signer` | 5 | odluka uz B-1 (#32) |
| `application/ports/revisions` | 2 | koristi ga samo Supabase adapter (#20) |

**C. Nije preneseno, bez zapisa usporedbe (otvoreno):**

| Izvor | Slučajeva | Što postoji u Ductusu |
| --- | --- | --- |
| `lib/journal/journal`, `lock`, `recovery` (plan F10 i F11 u #8) | 126 | novi journal `src/lib/journal/atomic-dexie-journal*` (#112, DAN-90) i `local-document-saver` (#206); nisu doslovni prijenos |
| `lib/sync/drainRunner` (plan F12) | 40 | novi `src/lib/sync/drain-runner.ts` (#408, DAN-49), 12 statičkih slučajeva |
| `editor/process-capture*` (plan F5) | 25 | novi `src/editor/capture*`; nije doslovni prijenos |
| `lib/process-ledger/*` (plan F6) | 14 | nema |
| `domain/forensics/verified-*`, `evidence-v2-legacy-compat` | 11 | nema; #9 ih odgađa „nakon Frontendova editora” |
| `domain/docx/*`, `lib/docx/export` | 47 | nema; DOCX izvoz je na popisu §12 |
| `lib/document/queries` | 8 | nema; na popisu §12 |

**D. Izvan opsega:** `domain/academic-graph`, `attention`, `authorization`, `decision`, `defense`, `dependency`, `lineage`, `memory`, `mentor-command`, `mentor-review`, `readiness`, `review`, `share`, `verification`, `workspace`, `version`; `lib/supabase`, `workspace`, `rate`, `evidence`, `evidence-basis`, `mentor-review`, `academic-object-registry`, `academic-revision`; `adapters/supabase`. Razlozi su djelomično zapisani (#9 za `version`, #21 za `academic-graph`, §12 za Supabase i stari prototip); ostalo nije pojedinačno provjereno u ovom zapisu.

## Ocjena prema kriteriju

- **Ukupno:** Ductus ima više testova od izvora u svakom sloju koji izvor ima, osim slojeva koji se po §12 ne prenose (AI Architect `node --test`, OpenFGA).
- **Doslovno „isti broj kao u izvoru” za prenesene module:** ispunjeno za skupinu A (509 izvornih slučajeva, nijedna datoteka nema manje). Nije ispunjeno za skupinu C: 271 izvorni slučaj iz plana prijenosa nije prenesen, a zamjenski kod nema zapisanu usporedbu s izvornim testovima.
- **Za odluku (pitanje 9 u `docs/PROGRAM-RAZRADA.md`):** prihvaća li se skupina C kao zamijenjena novim kodom ili se traži zapis „izvorni test → test u Ductusu” za journal, drain runner i capture te prijenos ili izričito izostavljanje DOCX-a, `queries`, `process-ledger` i `verified-*`.

## Naredbe

Izvor se samo klonira i čita; njegov kod se ne izvodi. Brojevi iz CI-ja su iz dnevnika GitHub Actionsa.

```sh
# izvor
git clone https://github.com/danielrisavi77-create/pisac-editor.git src-pisac
git -C src-pisac archive -o s6.tar 6cd0b75 && mkdir src-6cd0 && tar -xf s6.tar -C src-6cd0
gh run view 37120295819 -R danielrisavi77-create/pisac-editor --log   # CI na 6cd0b75
gh run view 37850833201 -R danielrisavi77-create/pisac-editor --log   # CI na e63eda8e, isti brojevi

# Ductus
git archive -o d7.tar 7f45899bf95be0c729e23acdf361eee164fd17e2 && mkdir ductus-7f45 && tar -xf d7.tar -C ductus-7f45
gh run view 41219649323 -R danielrisavi77-create/Ductus --log

# iz dnevnika: retci "Test Files", "Tests", "passed (", "Files=..., Tests=", "ℹ tests"
# statički broj, za oba stabla:
node count-tests.mjs <stablo> --files
```

`count-tests.mjs` (privremena skripta, nije u repou) prolazi stablom bez `node_modules`, `.git`, `.next`, `.claude` i `.agents` i razvrstava datoteke kao vitest konfiguracija Ductusa: `*.property.test.ts` pod `src/` ili `tests/property/` je property, `tests/integration/**/*.integration.test.ts` integration, ostali `*.test.ts` pod `src/` ili `tests/unit/` unit, `e2e/**/*.spec.ts` E2E, `db/tests/*.sql` pgTAP i `*.test.mjs` `node --test`. Slučaj je redak koji odgovara izrazu `^\s*(?:it|test)(?:\.(?:prop|each|skip|only|todo|concurrent|fails|sequential))*\s*[(\x60]`; za pgTAP zbraja se `plan(n)`. Usporedba po datoteci spaja izvor i Ductus po istoj putanji.
