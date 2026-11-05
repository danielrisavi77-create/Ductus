# Arhiva dokumenata

Ovdje su dokumenti koje nijedan aktualni dokument ne navodi kao mjerodavne: stara istraživanja, zamijenjeni planovi i specifikacije. Čuvaju se radi traga. Nisu izvor pravila, odluka ni opsega; u sukobu vrijede dokumenti iz `CLAUDE.md`, "Mjerodavni izvori".

Datoteka se premješta ovamo samo ako je ne čitaju `CLAUDE.md`, `AGENTS.md`, `docs/ENGINEERING_SYSTEM.md` ni skripte, a poveznice na nju se u istom PR-u popravljaju (DAN-373, issue #1000).

## Premješteno

| Datoteka | Prije | Datum | Razlog |
| --- | --- | --- | --- |
| `ISTRAZIVANJE-ALATA-2026-10-25.md` | `docs/` | 1. 11. 2026. | Istraživanje alata, samo za sebe kaže da nije odluka o instalaciji. Koraci iz njegova §5 vode se kao zasebni zadaci u Linearu, a `docs/REPOZITORIJI.md` §10 upućuje ovamo. |

## Pregledano, ali nije premješteno

Stanje 1. 11. 2026. Kandidat ostaje na svom mjestu dok vrijedi razlog.

| Datoteka | Razlog |
| --- | --- |
| `docs/PLAN-DEMO.md` | `CLAUDE.md` ga navodi među mjerodavnim izvorima, a navodi ga i `scripts/engineering/pre-push-tests.mjs`. |
| `docs/DEMO-UP.md`, `docs/DEMO-SUHI-PROLAZ.md`, `docs/DEMO-TEACHER-BOOTSTRAP.md` | Upute za lokalno pokretanje; navodi ih `scripts/engineering/pre-push-tests.mjs`. |
| `docs/FUNCTIONAL_ARCHITECTURE_V1.md`, `docs/PRODUCT_SPEC_V1.md`, `docs/UX-EVAL.md` | Navode ih skripte (`pre-push-tests.mjs`, `ci-docs-scope.mjs`). |
| `docs/AGENT_SYSTEM_V2.md` | D-97 putanja u `scripts/engineering/protected-paths.mjs`. |
| `docs/engineering/PLAN-TOKOVI-2026-10-25.md` | `docs/PROGRAM-RAZRADA.md` koristi njegove oznake koraka A1 do E3; preimenovanje čeka odluku iz #1085. |
| `docs/FREE-AI-PR-REVIEW.md` | Opisuje živi workflow `.github/workflows/free-ai-pr-review.yml`. |
| `docs/engineering/mergify-rollout.md`, `docs/engineering/queue-proof/` | Čekaju aktivaciju Mergify reda (DAN-263). |
| `docs/design/ductura/` | Skup s manifestom `SOURCE-2026-10-22.json`; na datoteke upućuje kod u `src/`. |
