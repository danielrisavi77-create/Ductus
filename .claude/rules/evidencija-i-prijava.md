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

Podsjetnik, ne pravilo. Pravila su u `CLAUDE.md` ("Tvrda pravila", D-09), `docs/BACKEND.md` §4.1, §4.3 i §6 te `STATE.md` ("Ne smije se izgubiti", B-8 i B-12).

- Prije predaje prođi skillove `ductus-provenance-invariants` i `ductus-identity-isolation`.
- Lažni OIDC pružatelj (`infra/fake-oidc/`) smije raditi samo lokalno i u CI-ju; nikakav drugi način prijave.
- Ove putanje su najmanje `critical`: ugovor i "Poznate granice" u opisu PR-a prije reviewa (#87 komentar `6108500315`).
- Najčešći nalazi reviewa: `AGENTS.md`, "Neovisni pregled", točka 2.
