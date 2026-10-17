---
name: ductus-auth-aai
description: "Use when touching Ductus login, sessions, cookies, identity or institution derivation, the fake OIDC provider, logout, HTTP mutation guards or the identity/session SQL - paths src/server/auth/, src/server/http/, src/server/db/ (open-session, with-actor), app/api/auth/, tests/unit/auth/, e2e/login/, playwright.login.config.ts, infra/fake-oidc/, db/migrations identity and open_session, db/tests 020-022. Hard rule D-09: students sign in only through AAI@EduHr."
---

# Ductus: router za prijavu i identitet

Ova lokalna kopija služi samo kao router; Ductus repozitorij, njegovi kanonski skillovi i dokumenti izvor su istine. Ne tretiraj spremljene implementacijske pojedinosti ili popise testova kao aktualne.

Za identitet i izolaciju pročitaj `.agents/skills/ductus-identity-isolation/SKILL.md`. Za sesije, AAI/OIDC i backend ograničenja pročitaj `docs/BACKEND.md` §4.3–§4.4, `docs/ARCHITECTURE.md` §4 i `docs/PRODUCT.md` §4. Za SQL/RLS promjene koristi `.agents/skills/ductus-new-table/SKILL.md`; za logout ili lokalni journal dodaj `.agents/skills/ductus-local-storage-logout/SKILL.md`. Slijedi postojeću dodijeljenu ulogu i rizik iz `docs/ENGINEERING_SYSTEM.md` §5.

Prije izmjene provjeri aktivni kod i testove u checkoutu. Pravila prijave iz kanonskih dokumenata vrijede; ovaj adapter ne dodaje ovlasti ni novu metodu prijave.
