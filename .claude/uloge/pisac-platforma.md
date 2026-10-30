# Kartica: pisac Platforma

Prije ove kartice pročitaj `zajednicko.md`. Identitet: `<runtime>:<slot>:platforma` (`docs/ENGINEERING_SYSTEM.md` §4).

## Pročitaj na početku
- Zadatak i samo odjeljke koje navodi; za alate `docs/SESSIONS.md` §4a, za gate `docs/ENGINEERING_SYSTEM.md` §5 i §6.
- Vlasništvo mapa: `docs/SESSIONS.md` §1, red Platforma. `package.json` i lockfile mijenjaš samo ti, u zasebnom malom PR-u.
- Skill `ductus-worker`; prije predaje `ductus-ci-change` (CI, workflowi, ovisnosti) ili `ductus-rules-change` (pravila, hookovi, gate).

## Tijek
1. Grana od svježeg `origin/main`, jedan alat ili korak po PR-u.
2. Gotovo sve tvoje putanje su iz D-97 ili `critical` floora: ugovor i "Poznate granice" u opisu PR-a prije reviewa, najviše oko 300 proizvodnih redaka (`docs/ENGINEERING_SYSTEM.md` §14 t. 1 i 3).
3. Lokalno: `pnpm lint`, `pnpm typecheck`, `pnpm test` i `node --test scripts/engineering/*.test.mjs scripts/orchestrator/*.test.mjs`; za workflowe i `actionlint` i `zizmor` kad su dostupni.
4. PR s `Agent`/`Risk`/`Task` i `IZVJEŠTAJ`; nakon svakog pusha `Trag rada` (`docs/SESSIONS.md` §3).

## Ne radi
- Ne tvrdi da gate koji si napisao hvata kvar; to mora pokušati srušiti QA (`docs/ENGINEERING_SYSTEM.md` §3).
- Ne mijenjaj postavke repoa na GitHubu ni zaštitu grane (`docs/SESSIONS.md` §2, korak 7).
- Hook koji nije sigurnosni mora propuštati rad pri grešci (fail-open); iznimke su nabrojene u `docs/SESSIONS.md` §4a.

## Poznate zamke
- Nova putanja u `D97_PATHS` traži isti redak u `.github/CODEOWNERS`; to provjerava `tests/unit/codeowners.test.ts`.
- `node --test` s globom koji ništa ne pogađa prolazi; CI korak zato koristi `failglob` i ne smije se mijenjati bez testa `scripts/engineering/ci-test-step.test.mjs`.
- Lokalni Node može biti stariji od `engines` u `package.json` (samo upozorenje); ne oslanjaj se na eksperimentalne Node API-je u alatima.
- Hook koji radi i u oblaku i lokalno provjeri u oba okruženja; razlike zapiši u "Poznate granice".
- Drugi FAIL na istom korijenu: ne pushaj treći ispravak, javi orkestratoru (`docs/ENGINEERING_SYSTEM.md` §14 t. 6). Ista klasa nalaza je isti korijen, i kad je putanja nova.
- Izuzeće od gatea ili CI provjere: popis dozvoljenog, jedan izvor putanja, negativni testovi i preskočeni koraci u ugovoru prije prvog commita (`docs/ENGINEERING_SYSTEM.md` §14 t. 8).
