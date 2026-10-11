# Kartica: pisac Frontend

Prije ove kartice pročitaj `zajednicko.md`. Identitet: `<runtime>:<slot>:frontend` (`docs/ENGINEERING_SYSTEM.md` §4).

## Pročitaj na početku
- Zadatak i samo odjeljke koje navodi; za sučelje `docs/PRODUCT.md` §5 i rječnik sučelja, za funkciju zapis u `docs/FEATURES.md`.
- Vlasništvo mapa: `docs/SESSIONS.md` §1, red Frontend. `app/api/` nije tvoj; `src/domain/sync`, `document`, `diff` i `serverSync` smiješ mijenjati uz oznaku u opisu PR-a.
- Skill `ductus-worker`; prije predaje kontrolni skill koji odgovara diffu: `ductus-ui-copy`, `ductus-sync-states`, `ductus-local-storage-logout`, `ductus-offline-recovery`.

## Tijek
1. Grana od svježeg `origin/main`, jedan korak iz `STATE.md` po PR-u (`CLAUDE.md`).
2. Za `critical` (sinkronizacija, evidencija, odjava): ugovor i "Poznate granice" u opisu PR-a prije reviewa (#87 komentar `6108500315`).
3. `pnpm lint`, `pnpm typecheck`, `pnpm test`; za tokove i `pnpm test:e2e`.
4. PR s `Agent`/`Risk`/`Task` (`docs/ENGINEERING_SYSTEM.md` §6) i `IZVJEŠTAJ`; nakon svakog pusha `Trag rada` (`docs/SESSIONS.md` §3).

## Ne radi
- Ne mijenjaj `package.json` ni lockfile; paket traži u izvještaju (`docs/SESSIONS.md` §1).
- Ne tvrdi pokrivenost provjerom zabranjenih izraza dok ne dokažeš da `scripts/forbidden-terms/scan.ts` čita datoteku s novim tekstom; ne čita svaku mapu (`ductus-ui-copy` t. 6).
- Ne mijenjaj Platformine workflowe bez koordinacije (`docs/ENGINEERING_SYSTEM.md` §3).

## Poznate zamke
- Stanja spremanja i sinkronizacije imaju točno značenje; pogrešna oznaka je kršenje pravila, ne stil (`ductus-sync-states`, `STATE.md` "Ne smije se izgubiti").
- QA i Frontend nikad ne pišu u isti branch; `e2e/` QA dira samo u vlastitom zadatku (`docs/SESSIONS.md` §1).
- Popravak prihvaćenog nalaza ide s testom koji bez popravka pada (`AGENTS.md`).
- U "Poznate granice" upiši i pozivatelje za koje jamstvo vrijedi. Nalaz koji nije dostižan kroz stvarnog pozivatelja ide vlasniku na odluku (popravak ili suženi ugovor), ne automatski u novi krug (#87 komentari `6109073566` t. 3 i `6109041185`).
- Drugi FAIL na istom korijenu: ne pushaj treći ispravak, javi orkestratoru (#87 komentar `6108500315` t. 4).
