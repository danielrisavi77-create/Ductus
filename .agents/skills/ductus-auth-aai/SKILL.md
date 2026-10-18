---
name: ductus-auth-aai
description: "Ductus login, sessions, cookies, identity, fake OIDC, logout and HTTP mutation guards. Use when touching src/server/auth, src/server/http, app/api/auth or the identity/session SQL. Hard rule D-09: students sign in only through AAI@EduHr."
paths:
  - "src/server/auth/**"
  - "src/server/http/**"
  - "src/server/db/open-session.ts"
  - "src/server/db/with-actor*.ts"
  - "app/api/auth/**"
  - "tests/unit/auth/**"
  - "e2e/login/**"
  - "playwright.login.config.ts"
  - "infra/fake-oidc/**"
  - "db/migrations/*identity_session*.sql"
  - "db/migrations/*open_session*.sql"
  - "db/tests/020-*.sql"
  - "db/tests/021-*.sql"
  - "db/tests/022-*.sql"
  - "tests/unit/infra/fake-oidc-accounts.test.ts"
  - "tests/integration/open-session.integration.test.ts"
  - "tests/integration/with-actor.integration.test.ts"
---

# Ductus: router za prijavu i identitet

Ova lokalna kopija služi samo kao router; Ductus repozitorij, njegovi kanonski skillovi i dokumenti izvor su istine. Ne tretiraj spremljene implementacijske pojedinosti ili popise testova kao aktualne.

Za identitet i izolaciju pročitaj `.agents/skills/ductus-identity-isolation/SKILL.md`. Za sesije, AAI/OIDC i backend ograničenja pročitaj `docs/BACKEND.md` §4.3–§4.4, `docs/ARCHITECTURE.md` §4 i `docs/PRODUCT.md` §4. Za SQL/RLS promjene koristi `.agents/skills/ductus-new-table/SKILL.md`; za logout ili lokalni journal dodaj `.agents/skills/ductus-local-storage-logout/SKILL.md`. Slijedi postojeću dodijeljenu ulogu i rizik iz `docs/ENGINEERING_SYSTEM.md` §5.

Prije izmjene provjeri aktivni kod i testove u checkoutu. Pravila prijave iz kanonskih dokumenata vrijede; ovaj adapter ne dodaje ovlasti ni novu metodu prijave.
