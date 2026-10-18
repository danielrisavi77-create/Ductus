# Zamke u radu sesija

Kratki zapisi o preprekama na koje su sesije naišle, da sljedeća sesija ne izgubi vrijeme na istu stvar. Ovo nije dokument s pravilima: svaki unos upućuje na kanonski izvor, a u sukobu vrijedi taj izvor (`CLAUDE.md`, "Mjerodavni izvori").

## Kako se dopunjuje

- Sesija koja naiđe na zamku može je navesti u svojoj predaji (`IZVJEŠTAJ` ili komentar predaje) kao redak `Zamka: simptom; uzrok; što raditi`. To nije obvezno polje predaje (`docs/SESSIONS.md` §3).
- Orkestrator odlučuje hoće li takav redak prenijeti ovamo; `docs/` je u njegovom vlasništvu (`docs/SESSIONS.md` §1).
- Unos ima simptom, uzrok, što raditi i izvor (PR, komentar ili odjeljak). Bez tajni, bez pojedinosti sigurnosnih nalaza i bez osobnih podataka.
- PR koji ukloni uzrok nekog unosa to može navesti u `IZVJEŠTAJ`-u kao redak `Zamka: ukloniti <unos>`; brisanje unosa je opet odluka orkestratora.

## Unosi

### Alati i okruženje

- **`git reset --hard` odbijen.** Uzrok: sigurnosni hook (`cc-safety-net`) blokira naredbe koje brišu lokalni rad. Što raditi: `git merge --ff-only origin/<grana>` za poravnanje s udaljenom granom, `git stash` za odlaganje izmjena. Izvor: #437, 18. 10. 2026.
- **Pristup `.npmrc` odbijen.** Uzrok: zabranu postavlja okruženje sesije, a ne hook iz repoa (u `.claude/`, `.cc-safety-net/` i `scripts/` nema pravila za `.npmrc`); datoteka može nositi tajne. Što raditi: ne ponavljati i ne zaobilaziti; ako zadatak traži tu datoteku, to je blokada za Daniela. Izvor: #437, 18. 10. 2026.
- **Linear MCP ne odgovara (403 na proxyju) u cloud sesiji.** Uzrok: mrežna politika okruženja ne propušta Linear. Što raditi: status u Linearu ne mijenjati zaobilaznim putem; u `Task:` napisati da `DAN-xxx` nije provjeren i ostaviti sljedivost orkestratoru. Zadatak se ne označava dovršenim na temelju PR-a (`CLAUDE.md`, "Mjerodavni izvori"). Izvor: #437, 18. 10. 2026.
- **SessionStart javlja da `node_modules` ne odgovara `pnpm-lock.yaml`.** Što raditi: `pnpm install --frozen-lockfile` samo na `main` ili na vlastitoj grani, nikad na headu koji se reviewa ili testira (`docs/SESSIONS.md` §4a).

### PR i gate

- **Preflight orkestratora pada na opisu PR-a.** Uzrok: nedostaje polje ugovora za critical PR. Što raditi: popuniti svih pet polja iz `docs/ENGINEERING_SYSTEM.md` §14 (Invarijanta, Mjesta, Stvarni pozivatelj, Poznate granice, "Što bi ovaj PR moglo oboriti na QA-i?"). Parser (`contractText` u `scripts/orchestrator/preflight-core.mjs`) skida oznake i traži dvotočku odmah iza naziva polja, a kod pitanja iza upitnika (`**Što bi ovaj PR moglo oboriti na QA-i?:**`); bez dvotočke polje se ne prepoznaje. Izvor: #437 i #448, 18. 10. 2026.
- **Codex ne daje QA ni review.** Uzrok: kvota iscrpljena. Što raditi: to nije nalaz; QA za critical prelazi na Grok (D-138). Izvor: #437, 18. 10. 2026.
- **Patch nadogradnja mijenja i retke lockfilea za pakete koji se ne nadograđuju.** Uzrok: pnpm normalizira ključeve peer-sufiksa. Što raditi: navesti te pakete u `IZVJEŠTAJ`-u, uz napomenu da im se verzija ne mijenja, da review to ne čita kao proširenje opsega. Izvor: #437, 18. 10. 2026.
