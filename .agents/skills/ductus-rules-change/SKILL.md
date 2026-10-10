---
name: ductus-rules-change
description: Pre-handoff checklist for a Ductus PR that changes governance rules in docs/ORKESTRATOR.md, docs/SESSIONS.md, docs/ENGINEERING_SYSTEM.md, docs/DECISIONS.md, AGENTS.md or related rule documents.
---

Popis provjera prije predaje PR-a koji mijenja pravila rada (`docs/ORKESTRATOR.md`, `docs/SESSIONS.md`, `docs/ENGINEERING_SYSTEM.md`, `docs/MULTI-ACCOUNT.md`, `docs/DECISIONS.md`, `AGENTS.md`, `CLAUDE.md`). Ne uvodi pravila: svaka stavka upućuje na odjeljak koji je pravilo ili opisuje kako dokazati da je ispunjeno. Ako se popis i dokument razilaze, vrijedi dokument, a nesklad ide u IZVJEŠTAJ.

Pročitati `CLAUDE.md` "Mjerodavni izvori", D-97 i zaglavlje `docs/DECISIONS.md`, `docs/ENGINEERING_SYSTEM.md` §5 i `docs/ORKESTRATOR.md` §4.

1. Provjeriti popis datoteka prema D-97. Ako PR dira nabrojene putanje ili zapis o tome tko smije pisati, pregledavati, spajati ili zaobići provjeru: `Risk` je `standard` ili viši (ENGINEERING §5, iznimka uz `low`), a `critical` gdje to traži "Automatski risk floor"; bez auto-mergea; u "Treba Daniel" ide naredba za spajanje.
2. Promjene u `CLAUDE.md`, `AGENTS.md` i odlukama pitanje su za Daniela (ORKESTRATOR §4 "Pita Daniela"). Ništa se ne gradi na odluci sa statusom PRIJEDLOG ako bi njezina promjena bila skupa (`CLAUDE.md`).
3. Pretražiti sve dokumente za rečenicama koje novo pravilo čini netočnima: `CLAUDE.md`, `AGENTS.md`, `STATE.md`, `docs/*.md`, `.claude/skills/`, `.agents/skills/`, `.claude/agents/`, `.github/pull_request_template.md` i komentare u `scripts/`. Tražiti po ključnim pojmovima, po brojevima i po oznakama odjeljaka. Svaki pogodak ispraviti u istom PR-u ili navesti u IZVJEŠTAJU kao otvoren nesklad (`CLAUDE.md`: nesklad izvora ostaje otvoren, ne rješava se prešutno).
4. Brojeve i nabrajanja provjeriti posebno (nalaz: "tri provjere" nakon dodavanja četvrte).
5. Svako upućivanje (`§N`, `D-NN`, putanja) otvoriti na grani i potvrditi da odjeljak postoji i kaže to što se tvrdi, a ne suprotno.
6. Red prvenstva: `docs/AGENT_SYSTEM_V2.md` §2; `docs/SESSIONS.md` u sukobu ustupa `CLAUDE.md`; u tehničkim pojedinostima `docs/BACKEND.md` ima prednost; iznad repo dokumenta je Ustav, a pitanje ide u Owner queue (`CLAUDE.md`).
7. Odluka se mijenja samo novim unosom koji navodi koju odluku zamjenjuje; stari unos ostaje (zaglavlje `docs/DECISIONS.md`). Nova odluka koja proturječi ranijoj mora to izričito reći.
8. Kolizija brojeva odluka. Provjera izvedbe: `gh pr list --state open` i diff `docs/DECISIONS.md` u otvorenim PR-ovima prije izbora broja; ponoviti prije pusha.
9. Izvedivost. Provjera izvedbe: za svako novo pravilo navesti što ga provodi (gate, hook, skripta i njihov test) ili izričito napisati da je governance dokaz, a ne strojna granica, kako to rade D-97 i ENGINEERING §7. Pravilo koje alati ne mogu izvesti ne opisivati kao da je pokriveno.
10. Skillovi ostaju tanki adapteri (`CLAUDE.md`; `docs/MULTI-ACCOUNT.md` §5): u njima se mijenja upućivanje, ne prepisuje se pravilo.
