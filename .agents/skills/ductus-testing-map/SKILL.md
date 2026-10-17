---
name: ductus-testing-map
description: "Map of every test layer in Ductus - vitest projects (unit, property, integration), colocated src tests, pgTAP in db/tests, Playwright e2e with both configs, scripts node --test suites, every test script in package.json, which CI job runs which layer, browser policy and mandatory adversarial scenarios, the never-delete-or-skip rule, and how synthetic fixtures are made. Use when adding, changing, running or locating tests, or touching vitest/playwright config or CI test steps in this repository."
---

# Ductus: router za testiranje

Ova lokalna kopija služi samo kao router; Ductus repozitorij i njegovi kanonski dokumenti izvor su istine. Nemoj koristiti spremljene naredbe, CI-popise ili browser politiku bez provjere aktualnog checkouta.

Za QA bez implementacije koristi `.agents/skills/ductus-qa/SKILL.md`; za workflowe i CI `.agents/skills/ductus-ci-change/SKILL.md`; za fixturee i sintetičke podatke `.agents/skills/ductus-synthetic-data/SKILL.md`. Kanonska pravila i slojevi testiranja su u `docs/TESTING.md` §§1–9, a risk i handoff u `docs/ENGINEERING_SYSTEM.md` §5 i `docs/SESSIONS.md`.

Prije pokretanja provjeri skripte u aktualnom `package.json`, konfiguraciju testova i CI. Ne uklanjaj ili preskači testove bez kanonski dopuštene, jednakovrijedne zamjene.
