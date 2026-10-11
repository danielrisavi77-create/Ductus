---
paths:
  - "src/domain/sync/**"
  - "src/domain/serverSync/**"
  - "src/editor/**"
  - "src/lib/journal/**"
---

# Područje: sinkronizacija, journal i editor

Podsjetnik, ne pravilo. Pravila su u `docs/ARCHITECTURE.md` §5, `docs/PRODUCT.md` §5 (pravila 7 i 10) i `STATE.md` ("Ne smije se izgubiti", F-3/F-8).

- Prije predaje prođi skillove `ductus-sync-states`, `ductus-offline-recovery` i, kad diraš odjavu ili lokalnu pohranu, `ductus-local-storage-logout`.
- Stanje "na poslužitelju" postoji samo uz potpisanu potvrdu; test mora pasti kad potvrda nedostaje.
- Redoslijed recovery, rebase i salvage testira se, ne pretpostavlja.
- Pisac u ovom području radi na Opusu bez obzira na `Risk` (`docs/ORKESTRATOR.md` §7).
