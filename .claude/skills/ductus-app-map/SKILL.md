---
name: ductus-app-map
description: "Map of the Ductus app: stack, layers of src/ and app/ and allowed imports, where each area lives, and which area skill to open next. Use at the start of any task when you do not yet know which files or area skill apply."
---

# Ductus: router za kartu repozitorija

Ova lokalna kopija služi samo kao router; repozitorij Ductus i njegove kanonske upute izvor su istine. Ne oslanjaj se na spremljene popise datoteka, verzija, implementiranih funkcija ili statusa.

U Ductus checkoutu prvo pročitaj `CLAUDE.md`, `AGENTS.md` i relevantni dio `STATE.md`. Za arhitekturu i stvarno stanje implementacije koristi `docs/ARCHITECTURE.md` §0.1–§2; backend `docs/BACKEND.md`; testiranje `docs/TESTING.md`; pravila rada `docs/ENGINEERING_SYSTEM.md` i `docs/SESSIONS.md`. Zatim slijedi dodijeljenu ulogu i usmjeri se na odgovarajuću projektnu vještinu u `.agents/skills/`, primjerice `ductus-worker`, `ductus-qa` ili vještinu područja.

Prije zaključka o putanjama ili implementaciji pregledaj trenutni kod i dokumente u aktivnom checkoutu. Ako kanonski opis i kod odstupaju, kod dokazuje implementaciju, a odstupanje prijavi prema projektnim pravilima.
