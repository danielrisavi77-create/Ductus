# Engineering System: sažetak

Sažetak nije izvor pravila. U sukobu vrijedi `docs/ENGINEERING_SYSTEM.md`; uz stavku je njegov odjeljak.

## Uloge i identitet

- Normalno tri writera: Backend, Frontend i Platforma. Četvrti samo za neovisan zadatak; peti nije dopušten (§1, §13).
- Autor PR-a nije njegov neovisni reviewer. Orkestrator ne piše proizvodni kod. Platforma ne potvrđuje sama da njezin sigurnosni gate hvata kvar; QA ga pokušava srušiti (§3).
- Identitet agenta je `<runtime>:<slot>:<role>` (§4).

## Risk razine

- `low`: dokumentacija, copy bez promjene značenja, jednostavna konfiguracija. PR koji dira D-97 nije `low` (§5).
- `standard`: frontend ponašanje, editor, adapteri, CI promjene, refaktori (§5).
- `critical`, među ostalim: identity, authz, RLS, pgTAP matrica, evidence, potpisi, KMS, session, submission, retention, backup/restore, migracije koje mijenjaju ovlasti, `PRODUCT.md` §5 ili druga trust granica (§5).
- Automatski risk floor računa najmanju razinu po putanjama; npr. `CLAUDE.md`, `AGENTS.md`, `ENGINEERING_SYSTEM.md`, svaki workflow i svaka putanja iz D-97 su najmanje `critical`. Agent ne spušta risk (§5).

## Gate po razini

- `low`: CI, dependency review ako vrijedi, jedan neovisni review ili Owner Override; bez reviewa za samo `.md` izvan `app/`, `src/`, `public/`, D-97 (D-189, §5).
- Samo novi `*.test.*`/`*.spec.*` izvan `db/tests/`, D-97: bez reviewa i QA-a (§5).
- `standard`: CI, dependency review, jedan neovisni reviewer na aktualnom headu; QA kad Orkestrator procijeni (§5).
- `critical`: svi standard gateovi, zaseban QA PASS na aktualnom headu, sintetički staging prolaz kad vrijedi `BACKEND.md` §6 t. 12 i pravila rada iz §14 (§5).
- `critical` PR koji mijenja samo testove ili samo dokumente ne traži QA; review ostaje. Mješoviti nije izuzet; `*.md` u testnim mapama je oboje (§5).
- `critical` PASS: različiti Appovi; iznimke (§6): kvota, D-139, Codex par na aktualnom headu (D-158).
- `main`: PR obvezan, squash, obvezni statusi, nerazriješeni razgovori blokiraju (§10).

## Metadata i verdikti

- PR nosi `Agent:`, `Risk:` i `Task:` (§6).
- Review komentar počinje s `Agent-Review:`, QA komentar s `QA-Agent:`; oba nose head i verdict, QA i `QA-Scope` (§6).
- `FAIL` ili `BLOCK` valjanog ne-autorskog reviewa ili QA-e drži gate blokiranim (§6).
- Pisac plana napada ne daje review ni QA verdikt na PR-u tog zadatka (§6).

## Head i invalidacija

- Novi push poništava review, QA i Owner Override (§6, §9).
- Iznimka D-101: čisto spajanje osnovne grane bez promjene diffa PR-a prenosi verdikt i override, i za Codex par (D-161; §6, §15).
- Prije reviewa provjeriti overlap; ažurnost provjerava izvorni head ili aktivirani DAN-263 Mergify carrier (§9, §10).

## Owner Override

- Piše ga samo vlasnik, zasebnim komentarom `Owner-Override:` s `Override-Head` i `Override-Reason`. Dokaz je governance, ne sigurnosna granica (§7).

## Critical PR (D-106)

- Ugovor prije koda: Invarijanta, Mjesta, Stvarni pozivatelj, Poznate granice i "Što bi ovaj PR moglo oboriti na QA-i?:" (§14).
- Najviše oko 400 redaka koda, veći uz obrazloženje; `critical` i oko 300 redaka produkcijskog koda, veći se dijeli, iznimku odobrava vlasnik (§14).
- QA FAIL samo za kvar koda. Nalaz ima "Dohvatljivo kroz"; manji nosi "blokira" ili "ne blokira"; u produkcijskom kodu zatvara se novim headom prije spajanja (§14).
- Najviše dva kruga: drugi FAIL na istom korijenu zaustavlja ispravke (§14).
- U gateu najviše tri PR-a bez preklapanja (D-161); review i QA kreću odmah, za `critical` istodobno na istom headu i kad je QA Codex ili Grok (D-155). QA ne čita review prije vlastitog verdikta (§13, §15).

## Kad stati i pitati vlasnika

- Nalaz s "Dohvatljivo kroz: nije pokazano" ili bez stvarnog pozivatelja ide vlasniku, ne piscu (§14).
- Treći krug na PR-u ide vlasniku s popisom krugova (§14).
- D-97 PR spaja se tek na Danielovu naredbu; noćni prozor je u `ORKESTRATOR.md` §4 (§5, §10).
- Zaštitu grane, uključujući `strict`, mijenja samo vlasnik (§10, §15).
