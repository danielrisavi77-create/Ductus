---
paths:
  - "src/domain/evidence/**"
  - "src/domain/forensics/**"
  - "src/adapters/**"
  - "src/server/auth/**"
  - "src/server/http/**"
  - "app/api/**"
  - "infra/fake-oidc/**"
---

# Područje: evidencija, potpisi i prijava

Podsjetnik, ne pravilo. Pravila su u `CLAUDE.md` ("Tvrda pravila", D-09), `docs/backend/evidencija.md` §4.1, `docs/backend/prijava-i-ovlasti.md` §4.3 i `docs/backend/kontrolna-lista.md` §6 te `STATE.md` ("Ne smije se izgubiti", B-8 i B-12).

- Prije predaje prođi skillove `ductus-provenance-invariants` i `ductus-identity-isolation`.
- Lažni OIDC pružatelj (`infra/fake-oidc/`) smije raditi samo lokalno i u CI-ju; nikakav drugi način prijave.
- Razinu rizika određuje evaluator (`scripts/engineering/pr-metadata-core.mjs`); za `critical` PR ugovor i "Poznate granice" idu u opis prije reviewa (`docs/ENGINEERING_SYSTEM.md` §14).
- Najčešći nalazi reviewa: `AGENTS.md`, "Neovisni pregled", točka 2.
