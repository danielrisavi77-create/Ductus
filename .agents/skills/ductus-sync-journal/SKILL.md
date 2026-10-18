---
name: ductus-sync-journal
description: "Ductus sync and journal: local Dexie journal, eight-state sync machine, drain, signed-receipt ACK, conflict, recovery, logout fence and serverSync wire contract. Use for src/domain/sync, src/domain/serverSync, src/lib/journal, SYNCED, ACK or offline."
---

# Ductus: router za sinkronizaciju i journal

Ova lokalna kopija služi samo kao router; Ductus repozitorij, kanonski skillovi i dokumenti izvor su istine. Raniji popisi stanja, modula i testova mogu biti zastarjeli.

Za uvjete ACK/SYNCED koristi `.agents/skills/ductus-sync-states/SKILL.md`; za oporavak `.agents/skills/ductus-offline-recovery/SKILL.md`; za logout, brisanje lokalne pohrane i zastarjele tabove `.agents/skills/ductus-local-storage-logout/SKILL.md`. Kanonske reference su `docs/ARCHITECTURE.md` §5, `docs/BACKEND.md` §3, `docs/PRODUCT.md` §5 i `docs/TESTING.md` §§2–3.

Provjeri aktualni kod i relevantne testove u aktivnom checkoutu, osobito kad se radi o ACK-u, potvrdi, rebaseu ili gubitku podataka. Ovaj adapter ne dodaje pravila ni ovlasti.
