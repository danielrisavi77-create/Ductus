# Engineering System: sažetak

Sažetak nije izvor pravila. U sukobu vrijedi `docs/ENGINEERING_SYSTEM.md`; uz svaku stavku je njegov odjeljak.

## Uloge i identitet

- Normalno tri writera: Backend, Frontend i Platforma. Četvrti samo za potpuno neovisan zadatak; više od četiri nije dopušteno (§1, §13).
- Autor PR-a nije njegov neovisni reviewer. Orkestrator ne piše proizvodni kod. Platforma ne potvrđuje sama da njezin sigurnosni gate hvata kvar; QA ga mora pokušati srušiti (§3).
- Identitet agenta je `<runtime>:<slot>:<role>` (§4).

## Risk razine

- `low`: dokumentacija, copy bez promjene značenja, jednostavna konfiguracija. PR koji dira putanje ili zapise iz D-97 nije `low` (§5).
- `standard`: frontend ponašanje, editor, adapteri, CI promjene, refaktori (§5).
- `critical`, među ostalim: identity, authz, RLS, pgTAP matrica, evidence, potpisi, KMS, session, submission, retention, backup/restore, migracije koje mijenjaju ovlasti, `PRODUCT.md` §5 ili druga trust granica (§5).
- Automatski risk floor računa najmanju razinu po putanjama. Među ostalim, `CLAUDE.md`, `AGENTS.md`, `ENGINEERING_SYSTEM.md`, svaki workflow i svaka putanja iz D-97 su najmanje `critical`. Agent ne smije spustiti risk (§5).

## Gate po razini

- `low`: CI, dependency review kad je primjenjiv, jedan neovisni review ili Owner Override (§5).
- `standard`: CI, dependency review, jedan neovisni reviewer na aktualnom headu; QA kad Orkestrator procijeni (§5).
- `critical`: svi standard gateovi, zaseban QA PASS na aktualnom headu, sintetički staging prolaz kad vrijedi `BACKEND.md` §6 t. 12 i pravila rada iz §14 (§5).
- `critical` PR koji mijenja samo testove ili samo dokumente ne traži QA; review ostaje. PR koji mijenja i testove i dokumente nije izuzet; `*.md` u testnim mapama broji se kao oboje (§5).
- Za `critical` PASS reviewer i QA moraju biti različit GitHub App. Iznimke, uz uvjete: kvotni fallback i druga Claude sesija (D-139) (§6).
- `main`: PR obvezan, squash, obvezni statusi, nerazriješeni razgovori blokiraju (§10).

## Metadata i verdikti

- PR nosi `Agent:`, `Risk:` i `Task:` (§6).
- Review komentar počinje s `Agent-Review:`, QA komentar s `QA-Agent:`; oba nose head i verdict, QA i `QA-Scope` (§6).
- `FAIL` ili `BLOCK` bilo kojeg valjanog ne-autorskog reviewa ili QA-e drži gate blokiranim (§6).
- Pisac plana napada ne daje review ni QA verdikt na PR-u tog zadatka (§6).

## Head i invalidacija

- Novi push poništava review, QA i Owner Override (§6, §9).
- Iznimka D-101: čisto spajanje osnovne grane koje ne mijenja diff PR-a prenosi verdikt i override (§6, §15).
- Prije ready-for-review autor provjerava overlap s aktualnim `main`. Spaja se samo PR čiji head sadrži aktualni `main` (§9).

## Owner Override

- Piše ga samo vlasnik repoa, zasebnim komentarom `Owner-Override:` s `Override-Head` i `Override-Reason`. Iznimka je i governance dokaz, ne sigurnosna granica (§7).

## Critical PR (D-106)

- Ugovor prije koda: Invarijanta, Mjesta, Stvarni pozivatelj, Poznate granice i "Što bi ovaj PR moglo oboriti na QA-i?:" (§14).
- Najviše oko 400 promijenjenih redaka koda, veći uz obrazloženje u opisu; `critical` i oko 300 redaka produkcijskog koda, veći se dijeli, iznimku odobrava vlasnik (§14).
- Poznata granica umanjuje nalaz samo uz trag vlasnikova odobrenja, nikad za tvrdo pravilo ili granicu povjerenja (§14).
- QA FAIL samo za kvar koda. Svaki nalaz ima redak "Dohvatljivo kroz", a manji nalaz nosi "blokira" ili "ne blokira"; onaj u testovima ili dokumentima uz PASS ide u zaseban zadatak, onaj u produkcijskom kodu zatvara se novim headom prije spajanja (§14).
- Najviše dva kruga: drugi FAIL na istom korijenu zaustavlja ispravke (§14).
- U gateu je najviše jedan PR. Za `critical` review i QA kreću istodobno na istom headu, osim QA-e s Codexa ili Groka: ona tek nakon Claude review PASS-a (D-138). QA ne čita review prije vlastitog verdikta (§13, §15).

## Kad stati i pitati vlasnika

- Nalaz s "Dohvatljivo kroz: nije pokazano" ili bez stvarnog pozivatelja ide vlasniku, ne piscu (§14).
- Treći krug na istom PR-u ide vlasniku s popisom krugova (§14).
- D-97 PR spaja se tek na Danielovu naredbu; noćni prozor je u `ORKESTRATOR.md` §4 (§5, §10).
- Zaštitu grane, uključujući `strict`, mijenja samo vlasnik (§10, §15).
