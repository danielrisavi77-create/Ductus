---
name: ductus-evidence-forensics
description: "Ductus evidence and forensics: JCS hashing, segment and receipt formats, signing, institution key, payload storage, replay and size limits. Use for src/domain/forensics, src/domain/evidence, src/adapters/evidence or src/adapters/crypto. Risk critical."
---

# Ductus: router za evidenciju i forenziku

Ova lokalna kopija služi samo kao router; Ductus repozitorij, kanonski skill i dokumenti izvor su istine. Ne oslanjaj se na pohranjene formatne verzije, module, testove ili rizik ako ih nisi provjerio u aktivnom checkoutu.

Za invarijante podrijetla i evidencije pročitaj `.agents/skills/ductus-provenance-invariants/SKILL.md`. Referentni dizajn je u `docs/ARCHITECTURE.md` §5, §8 i §8a; backend, pohrana i potpisi u `docs/backend/evidencija.md` §4.1–§4.2 i `docs/backend/kontrolna-lista.md` §6; obvezni adversarial/security testovi u `docs/TESTING.md` §§3, 5. Slijedi dodijeljenu ulogu i risk pravila iz `docs/ENGINEERING_SYSTEM.md` §5.

Prije izmjene provjeri implementaciju, kanonske vektore/testove i projektne upute. Ovaj router ne mijenja pravilo izvora istine niti odobrava promjenu formata ili invarijante.
