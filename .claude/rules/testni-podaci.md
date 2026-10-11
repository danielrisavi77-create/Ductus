---
paths:
  - "tests/**"
  - "e2e/**"
  - "db/tests/**"
  - "**/*.test.ts"
---

# Područje: testovi i fixturei

Podsjetnik, ne pravilo. Pravila su u `CLAUDE.md` ("Tvrda pravila") i `docs/TESTING.md`.

- Samo sintetički podaci; prije predaje prođi skill `ductus-synthetic-data`.
- Test se ne briše, ne preskače i ne stavlja u karantenu bez jednakovrijedne zamjene.
- Popravak prihvaćenog nalaza ide s testom koji bez popravka pada (`AGENTS.md`).
- Cijeli `tests/` je najmanje `critical` (`docs/ENGINEERING_SYSTEM.md` §5); `e2e/` je Frontendov, QA ga dira samo u vlastitom zadatku (`docs/SESSIONS.md` §1).
