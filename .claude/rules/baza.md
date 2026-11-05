---
paths:
  - "db/**"
  - "src/server/db/**"
---

# Područje: baza i migracije

Podsjetnik, ne pravilo. Pravila su u `CLAUDE.md` ("Tvrda pravila") i `docs/backend/prijava-i-ovlasti.md` §4.4, `docs/backend/baza-i-pogon.md` §4.8 i `docs/backend/kontrolna-lista.md` §6.

- Nova tablica: prođi skill `ductus-new-table` prije predaje.
- Pisanje klijenta u tablice evidencije, predaje i revizijskog traga ide samo kroz RPC; provjeri to u pgTAP matrici, ne samo u kodu.
- `db/migrations/`, `db/local/` i `src/server/db/` podižu risk floor na `critical` (`docs/ENGINEERING_SYSTEM.md` §5).
- pgTAP se pokreće `pnpm test:db` na lokalnom stogu; u CI-ju ga pokreće posao "Local stack".
- Migracije se nikad ne primjenjuju na produkciju iz agenta.
