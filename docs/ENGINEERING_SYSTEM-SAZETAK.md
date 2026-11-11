# Engineering System: sažetak

Sažetak nije izvor pravila. U sukobu vrijedi `docs/ENGINEERING_SYSTEM.md`; uz stavku je njegov odjeljak.

## Uloge i identitet

- Obično tri writera (Backend, Frontend, Platforma na poziv); četvrti samo za neovisan posao, peti nikad. Iznad 3 PR-a izvan nacrta nema nove dodjele (§1, §13).
- Autor ne reviewa svoj PR. Orkestrator ne piše proizvodni kod. Platforma sama ne potvrđuje svoj sigurnosni gate; QA ga pokušava srušiti (§3).
- Identitet agenta je `<runtime>:<slot>:<role>` (§4).

## Risk razine

- `low`: dokumentacija, copy bez promjene značenja, jednostavna konfiguracija (§5).
- `standard`: frontend ponašanje, editor, adapteri, CI promjene, refaktori (§5).
- `critical`, među ostalim: identity, authz, RLS, pgTAP matrica, evidence, potpisi, KMS, session, submission, retention, backup/restore, migracije ovlasti, `PRODUCT.md` §5, trust granice (§5).
- Risk floor po putanjama daje najmanju razinu; svaki workflow i putanja iz D-97 su najmanje `critical`. Agent ga ne spušta (§5).

## Gate po razini

- `low`: CI, dependency review ako vrijedi, jedan neovisni review ili Owner Override; bez reviewa samo dokumenti iz §5 (D-189).
- `standard`/`critical` sa samo novim testovima iz §5: bez reviewa i QA-a, samo za granu ovog repoa.
- `standard`: CI, dependency review, neovisni reviewer na aktualnom headu; QA po procjeni Orkestratora (§5).
- `critical`: svi standard gateovi, zaseban QA PASS na aktualnom headu, sintetički staging prolaz kad vrijedi `BACKEND.md` §6 t. 12 i pravila rada iz §14 (§5).
- `critical` PR koji mijenja samo testove ili samo dokumente ne traži QA; review ostaje. Mješoviti nije izuzet; `*.md` u testnim mapama je oboje (§5).
- `critical` PASS: različiti Appovi; iznimke (§6): kvota, D-139, Codex par na aktualnom headu (D-158).
- `main`: PR obvezan, squash, obvezni statusi, otvoreni razgovori blokiraju (§10).

## Metadata i verdikti

- PR i issue počinju retcima za ljude **Što**, **Zašto**, **Rizik i provjera**, bez oznaka i SHA-ova; ispod `Agent:`, `Risk:`, `Task:` (§6).
- Review počinje s `Agent-Review:`, QA s `QA-Agent:` (head, verdict; QA i `QA-Scope`), pa rečenica za ljude i nalazi (§6).
- Pisac javlja „Spreman za review” samo na #1091 (§8).
- `FAIL` ili `BLOCK` valjanog ne-autorskog reviewa ili QA-e drži gate blokiranim (§6).
- Pisac plana napada ne daje verdikt na PR-u tog zadatka (§6).

## Head i invalidacija

- Novi push poništava review, QA i Owner Override (§6, §9).
- Iznimka D-101: čisto spajanje osnovne grane bez promjene diffa prenosi verdikt i override, i Codex par (D-161; §6, §15).
- Prije reviewa provjeri overlap; ažurnost provjerava izvorni head ili Mergify carrier (DAN-263; §9, §10).

## Owner Override

- Samo vlasnik, zasebnim komentarom `Owner-Override:` s `Override-Head` i `Override-Reason`. Governance, ne sigurnosna granica (§7).

## Critical PR (D-106)

- Ugovor prije koda: Invarijanta, Mjesta, Stvarni pozivatelj, Poznate granice, "Što bi ovaj PR moglo oboriti na QA-i?:" (§14).
- Najviše oko 400 redaka koda, veći uz obrazloženje; za `critical` i oko 300 produkcijskog, veći se dijeli ili ga vlasnik izuzme (§14).
- QA FAIL samo za kvar koda; za PR sučelja i neobrazloženi izgled (D-183). Nalaz ima "Dohvatljivo kroz"; manji nosi "blokira" ili "ne blokira" i u produkcijskom kodu zatvara se novim headom prije spajanja (§14).
- Najviše dva kruga za svaki risk; drugi FAIL iste klase zaustavlja ispravke. Izuzeće od gatea je popis dozvoljenog (§14, D-190).
- U gateu najviše tri PR-a bez preklapanja (D-161); review i QA kreću odmah, za `critical` istodobno, i s QA-om Codex ili Grok (D-155). QA ne čita review prije verdikta (§13, §15).

## Kad stati i pitati vlasnika

- Nalaz s "Dohvatljivo kroz: nije pokazano" ili bez stvarnog pozivatelja ide vlasniku, ne piscu (§14).
- Treći krug ide vlasniku s popisom krugova (§14).
- D-97 PR spaja Danielova naredba ili prozor od 24 h: `ORKESTRATOR.md` §4 (§5, §10).
- Zaštitu grane, uključujući `strict`, mijenja samo vlasnik (§10, §15).
