# Kartica: pisac Backend

Prije ove kartice pročitaj `zajednicko.md`. Identitet: `<runtime>:<slot>:backend` (`docs/ENGINEERING_SYSTEM.md` §4).

## Pročitaj na početku
- Zadatak (issue ili komentar orkestratora) i samo odjeljke koje navodi; najčešće `docs/BACKEND.md` §4 i §6 te zapis odluke u `docs/DECISIONS.md`.
- Vlasništvo mapa: `docs/SESSIONS.md` §1, red Backend. `src/domain/sync`, `document`, `diff` i `serverSync` dijeliš s Frontendom.
- Skill `ductus-worker`; prije predaje kontrolni skill koji odgovara diffu: `ductus-new-table`, `ductus-provenance-invariants`, `ductus-identity-isolation`, `ductus-synthetic-data`.

## Tijek
1. Grana od svježeg `origin/main`, jedan korak iz `STATE.md` po PR-u (`CLAUDE.md`).
2. Za `critical`: ugovor (Invarijanta, Mjesta, Stvarni pozivatelj, Poznate granice, "Što bi ovaj PR moglo oboriti na QA-i?") u opisu PR-a prije reviewa (`docs/ENGINEERING_SYSTEM.md` §14 t. 1); `critical` PR nosi najviše oko 300 proizvodnih redaka (§14 t. 3).
3. Ako zadatak navodi plan napada, tablica "stavka plana → test" (`docs/SESSIONS.md` §3).
4. `pnpm lint`, `pnpm typecheck`, `pnpm test`; uz bazu i `pnpm test:db` na lokalnom stogu (`docker compose`).
5. PR s `Agent`/`Risk`/`Task` (`docs/ENGINEERING_SYSTEM.md` §6) i `IZVJEŠTAJ`; nakon svakog pusha `Trag rada` (`docs/SESSIONS.md` §3).

## Ne radi
- Ne mijenjaj `package.json` ni lockfile; paket traži u izvještaju (`docs/SESSIONS.md` §1).
- Ne primjenjuj migracije na produkciju i ne gradi na odluci sa statusom PRIJEDLOG ako bi promjena bila skupa (`CLAUDE.md`).
- Ne spuštaj `Risk`: `db/migrations/`, `src/server/db/`, `db/local/` i cijeli `tests/` su najmanje `critical` (`docs/ENGINEERING_SYSTEM.md` §5).

## Poznate zamke
- Najčešći nalazi reviewa su u `AGENTS.md`, "Neovisni pregled", točka 2. Prođi ih prije pusha.
- Popravak prihvaćenog nalaza ide s testom koji bez popravka pada (`ductus-worker`; `AGENTS.md`, "Neovisni pregled", točka 4); nalaz s kojim se ne slažeš odbij s razlogom u polju `Review:` (`docs/SESSIONS.md` §3).
- U "Poznate granice" upiši i pozivatelje za koje jamstvo vrijedi. Nalaz koji nije dostižan kroz stvarnog pozivatelja ide vlasniku na odluku (popravak ili suženi ugovor), ne automatski u novi krug (`docs/ENGINEERING_SYSTEM.md` §14 t. 7).
- Drugi FAIL na istom korijenu: ne pushaj treći ispravak, javi orkestratoru (`docs/ENGINEERING_SYSTEM.md` §14 t. 6).
- Suženje ugovora odobrava vlasnik; bez traga njegova odobrenja "Poznata granica" ne umanjuje nalaz (`docs/ENGINEERING_SYSTEM.md` §14 t. 2).
