---
name: ductus-database
description: "Detailed guide to the Ductus database area - db/migrations, db/tests (pgTAP and fixtures), db/local, src/server/db (withActor, openSession), compose.yaml and the db:* scripts. Use when adding or changing a table, role, grant, RLS policy, SECURITY DEFINER function (RPC), migration, pgTAP matrix row, local stack provisioning, or the way server code reaches PostgreSQL."
---

# Ductus: router za bazu podataka

Ova lokalna kopija služi samo kao router; Ductus repozitorij i kanonski dokumenti izvor su istine. Zanemari spremljene popise tablica, migracija, uloga, naredbi i stanja implementacije dok ih ne provjeriš u aktivnom checkoutu.

Za tablice, uloge, grantove, RLS, RPC i pgTAP matricu pročitaj `.agents/skills/ductus-new-table/SKILL.md`. Kanonske zahtjeve potraži u `docs/BACKEND.md` §3, §4.3–§4.8 i §6, `docs/ARCHITECTURE.md` §3 i §7 te `docs/TESTING.md` §5. Pravila rizika i koordinacije su u `docs/ENGINEERING_SYSTEM.md` §5 i `docs/SESSIONS.md`.

Provjeri postojeće migracije, helper-e i testove prije promjene. Projektna dokumentacija određuje pravilo; ovaj adapter ne uvodi nova pravila.
