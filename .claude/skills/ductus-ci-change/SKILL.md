---
name: ductus-ci-change
description: Pre-handoff checklist for a Ductus PR that changes GitHub workflows, CI images, action pins, scanners or the tests that guard them.
---

Popis provjera prije predaje PR-a koji dira `.github/`, slike i pinove u CI-ju ili testove koji ih čuvaju. Ne uvodi pravila: svaka stavka upućuje na odjeljak koji je pravilo ili opisuje kako dokazati da je ispunjeno. Ako se popis i dokument razilaze, vrijedi dokument, a nesklad ide u IZVJEŠTAJ.

Pročitati `docs/ENGINEERING_SYSTEM.md` §3, §5 i §10, `docs/ARCHITECTURE.md` §10, `docs/REPOZITORIJI.md` §8.3, D-97 u `docs/DECISIONS.md` te `scripts/engineering/ci-registry-pins.test.mjs` i `scripts/engineering/engineering-workflow.test.mjs`.

1. `.github/` je mapa Platforme (`docs/SESSIONS.md` §1); Backend i Frontend ne mijenjaju workflowe bez koordinacije (ENGINEERING §3).
2. `Risk: critical` za svaki GitHub workflow (ENGINEERING §5 "Automatski risk floor"); niža razina ruši provjeru metapodataka.
3. PR koji dira `.github/` ili `scripts/engineering/` spaja se tek na Danielovu naredbu (D-97): u "Treba Daniel" upisati naredbu za spajanje i ne uključivati auto-merge.
4. Imena obveznih statusa iz ENGINEERING §10 ostaju ista. Promjena imena posla mijenja zaštitu `main`, a postavke repoa su pitanje za Daniela (`docs/ORKESTRATOR.md` §4 "Pita Daniela").
5. Akcije su pinane na puni SHA (ARCHITECTURE §10). Slike nose registar i `@sha256:` digest, izvan Docker Huba, kako traži `ci-registry-pins.test.mjs`.
6. Ako se mijenja ugovor testa pinova, novi test je jednako strog: test se ne slabi bez jednakovrijedne zamjene (`CLAUDE.md`). Provjera izvedbe: lokalno vratiti nepinanu sliku ili akciju i potvrditi da test pada.
7. Nove ovlasti (`permissions`) i tajne navesti u opisu PR-a s razlogom; tajne, ovlasti i izuzeća u skenerima su pitanje za Daniela (ORKESTRATOR §4). Privilegirani workflow ostaje metadata-only: default branch, bez tajni, jedina write ovlast `statuses: write` (ENGINEERING §10; `engineering-workflow.test.mjs`).
8. Migracije se ne pokreću na produkciju iz GitHub Actionsa (`docs/BACKEND.md` §3 pravilo 2).
9. Lokalno prije pusha: `actionlint`, `zizmor` u verziji iz CI-ja, `osv-scanner` kad se diraju ovisnosti (REPOZITORIJI §8.3) i `node --test scripts/engineering/*.test.mjs`. Mjerodavan ostaje CI.
10. Platforma ne potvrđuje sama da gate hvata kvar (ENGINEERING §3). Provjera izvedbe: za novu ili promijenjenu provjeru u IZVJEŠTAJ upisati negativni dokaz (namjerno pokvaren ulaz ruši posao, kao u `docs/PLAN-DEMO.md` P-2), da ga QA može ponoviti.
