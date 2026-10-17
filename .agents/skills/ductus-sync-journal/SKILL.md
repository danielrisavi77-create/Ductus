---
name: ductus-sync-journal
description: "Detailed map of the Ductus sync and journal area - the local Dexie journal, the eight-state sync machine, drain planning, signed-receipt ACK, conflict, recovery, restore, logout fence and the serverSync wire contract. Use when changing or reviewing anything in src/domain/sync/, src/domain/serverSync/, src/lib/journal/ or their tests, or when a task touches SYNCED, ACK, offline, rebase, salvage or logout of local storage."
---

# Ductus: router za sinkronizaciju i journal

Ova lokalna kopija služi samo kao router; Ductus repozitorij, kanonski skillovi i dokumenti izvor su istine. Raniji popisi stanja, modula i testova mogu biti zastarjeli.

Za uvjete ACK/SYNCED koristi `.agents/skills/ductus-sync-states/SKILL.md`; za oporavak `.agents/skills/ductus-offline-recovery/SKILL.md`; za logout, brisanje lokalne pohrane i zastarjele tabove `.agents/skills/ductus-local-storage-logout/SKILL.md`. Kanonske reference su `docs/ARCHITECTURE.md` §5, `docs/BACKEND.md` §3, `docs/PRODUCT.md` §5 i `docs/TESTING.md` §§2–3.

Provjeri aktualni kod i relevantne testove u aktivnom checkoutu, osobito kad se radi o ACK-u, potvrdi, rebaseu ili gubitku podataka. Ovaj adapter ne dodaje pravila ni ovlasti.
