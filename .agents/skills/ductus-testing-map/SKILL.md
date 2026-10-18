---
name: ductus-testing-map
description: "Map of all Ductus test layers (vitest unit, property, integration; pgTAP, Playwright e2e, node --test), their scripts and CI jobs, and the never-skip rule. Use when adding, running or locating tests or changing test config or CI test steps."
---

# Ductus: router za testiranje

Ova lokalna kopija služi samo kao router; Ductus repozitorij i njegovi kanonski dokumenti izvor su istine. Nemoj koristiti spremljene naredbe, CI-popise ili browser politiku bez provjere aktualnog checkouta.

Za QA bez implementacije koristi `.agents/skills/ductus-qa/SKILL.md`; za workflowe i CI `.agents/skills/ductus-ci-change/SKILL.md`; za fixturee i sintetičke podatke `.agents/skills/ductus-synthetic-data/SKILL.md`. Kanonska pravila i slojevi testiranja su u `docs/TESTING.md` §§1–9, a risk i handoff u `docs/ENGINEERING_SYSTEM.md` §5 i `docs/SESSIONS.md`.

Prije pokretanja provjeri skripte u aktualnom `package.json`, konfiguraciju testova i CI. Ne uklanjaj ili preskači testove bez kanonski dopuštene, jednakovrijedne zamjene.
