---
name: ductus-evidence-forensics
description: "Use when reading or changing Ductus evidence and forensics code - canonical JSON (JCS) and hashing, evidence segment/receipt formats and versions, signing and signed receipts, the institution/evidence-domain key, payload storage adapters (S3 store, storage domains with sealed keys), replay and reconstruction, size limits. Paths - src/domain/forensics/ (incl. golden-vectors), src/domain/evidence/, src/domain/json.ts, src/application/evidence/, src/application/ports/, src/adapters/evidence/, src/adapters/crypto/ and their tests. All of it is risk level critical."
---

# Ductus: router za evidenciju i forenziku

Ova lokalna kopija služi samo kao router; Ductus repozitorij, kanonski skill i dokumenti izvor su istine. Ne oslanjaj se na pohranjene formatne verzije, module, testove ili rizik ako ih nisi provjerio u aktivnom checkoutu.

Za invarijante podrijetla i evidencije pročitaj `.agents/skills/ductus-provenance-invariants/SKILL.md`. Referentni dizajn je u `docs/ARCHITECTURE.md` §5, §8 i §8a; backend, pohrana i potpisi u `docs/BACKEND.md` §4.1–§4.2 i §6; obvezni adversarial/security testovi u `docs/TESTING.md` §§3, 5. Slijedi dodijeljenu ulogu i risk pravila iz `docs/ENGINEERING_SYSTEM.md` §5.

Prije izmjene provjeri implementaciju, kanonske vektore/testove i projektne upute. Ovaj router ne mijenja pravilo izvora istine niti odobrava promjenu formata ili invarijante.
