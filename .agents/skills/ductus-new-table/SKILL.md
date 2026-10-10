---
name: ductus-new-table
description: Pre-handoff checklist for a Ductus PR that adds or changes a database table, role, grant, RLS policy, RPC or pgTAP access-matrix row.
---

Popis provjera prije predaje PR-a koji dodaje ili mijenja tablicu, ulogu, grant, RLS politiku, RPC ili redak pgTAP matrice. Ne uvodi pravila: svaka stavka upućuje na odjeljak koji je pravilo ili opisuje kako dokazati da je ispunjeno. Ako se popis i dokument razilaze, vrijedi dokument, a nesklad ide u IZVJEŠTAJ.

Pročitati `CLAUDE.md` (Tvrda pravila), `docs/BACKEND.md` §3 (pravilo 2), §4.3 i §6, `docs/ARCHITECTURE.md` §7, `docs/TESTING.md` §5 i D-90 u `docs/DECISIONS.md`.

1. Nova tablica ima RLS i retke u pgTAP matrici s testom odbijanja (`CLAUDE.md`; BACKEND §6 t. 3).
2. Matrica pokriva sve primjenjive aktere iz ARCHITECTURE §7 i svaku ulogu iz BACKEND §3 pravila 2 i D-90 t. 2, uključujući `ductus_migrator` ("svaka s pgTAP retkom"). Za svaku ulogu provjeriti SELECT, INSERT, UPDATE i DELETE, ne samo SELECT jedne uloge.
3. Odbijanje mora proizlaziti iz zaštite koju redak tvrdi (TESTING §5, prvi primjer). Provjera izvedbe: u testu privremeno dodijeliti `USAGE` na shemi i ovlast na tablici pa potvrditi da RLS i dalje vraća 0 redaka; odbijanje koje nestane s `USAGE` nije dokaz o tablici.
4. Testovi dokazano padaju bez zaštite (TESTING §5; `AGENTS.md` "Neovisni pregled" t. 4). Provjera izvedbe: lokalno ukloniti redom politiku, `FORCE ROW LEVEL SECURITY` i `REVOKE`, potvrditi da svaki put pada barem jedan test i u IZVJEŠTAJ upisati koja mutacija ruši koji test.
5. Svojstva uloga iz BACKEND §3 pravila 2 provjeriti i kroz članstva: provjere ovlasti vide samo naslijeđena prava, pa matrica čita `pg_auth_members` da članstvo sa `SET` bez `INHERIT` ne prođe neopaženo (postojeći obrazac: `db/tests/010-roles-and-privileges.sql`).
6. Migracija prolazi kao `ductus_migrator`, ne kao superuser, i ne stvara korisnike s prijavom ni lozinke (BACKEND §3 pravilo 2). Provjera izvedbe: `pnpm stack:up`, `pnpm db:migrate`, `pnpm test:db` s čistog stanja.
7. Klijent piše samo kroz RPC (`CLAUDE.md`). RPC izvodi identitet iz `current_actor()`, nikad iz parametra; `SECURITY DEFINER` ima prazan `search_path`; nema `SET` bez `LOCAL`; `EXECUTE` je oduzet od PUBLIC (BACKEND §3 pravilo 2 i §4.3; `docs/PLAN-DEMO.md` §4 uvod; `AGENTS.md` "Neovisni pregled" t. 2).
8. Plan migracije i povrata (BACKEND §6 t. 8). Provjera izvedbe lokalno: `pnpm db:rollback`, zatim ponovno `pnpm db:migrate` i `pnpm test:db`. Na produkciji vrijedi "samo naprijed" iz matrice kvarova u BACKEND §6; migracije se ne primjenjuju na produkciju iz agenta (`CLAUDE.md`).
9. Podaci u testovima su izmišljeni (`CLAUDE.md`); vidi `ductus-synthetic-data`.
10. Ostale točke BACKEND §6 ispunjene su ili je u opisu PR-a zapisano zašto nisu primjenjive.
11. `Risk` po `docs/ENGINEERING_SYSTEM.md` §5: RLS, pgTAP matrica i migracije koje mijenjaju ovlasti su `critical`.
