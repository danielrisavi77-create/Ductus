# Ductus: pravila za AI agente

Prije svakog rada pročitaj `STATE.md`. Za proizvod čitaj `docs/PRODUCT.md`, za tehniku `docs/ARCHITECTURE.md` i `docs/BACKEND.md` (backend i hosting; u pojedinostima backenda ima prednost, a ARCHITECTURE daje cjelinu sustava), za odluke `docs/DECISIONS.md`, za prihvaćene funkcije `docs/FEATURES.md`, za faze i GO uvjete `docs/PROGRAM.md`. U repou su to jedini izvori istine. Iznad njih stoje Product Vision v1.0 i Product Constitution v1.3 (Google Drive); u slučaju sukoba vrijedi Ustav, a sukob se prijavljuje u Owner queue.

## Tvrda pravila

- Prijava studenata isključivo AAI@EduHr (D-09). Nikad ne dodaji drugi način prijave, ni privremeno, osim lažnog OIDC pružatelja koji radi samo lokalno i u CI-ju.
- Pravila iz `docs/PRODUCT.md` §5 nikad se ne krše. Riječi iz rječnika zabranjenih izraza ne smiju se pojaviti u sučelju.
- Ništa se ne gradi na odluci sa statusom PRIJEDLOG ako bi promjena te odluke bila skupa. U tom slučaju stani i dodaj pitanje u Owner queue.
- Jedan korak iz `STATE.md` po PR-u. Najviše oko 400 promijenjenih redaka koda; veći PR treba obrazloženje u opisu.
- Testovi moraju biti zeleni prije svakog commita. Nikad ne briši, ne preskači i ne stavljaj u karantenu test bez jednakovrijedne zamjene.
- Klijent nikad ne piše izravno u tablice evidencije, predaje ni revizijskog traga; samo kroz RPC.
- Svaka nova tablica ima RLS i retke u pgTAP matrici pristupa.
- Nikad ne koristi stvarne studentske radove ni osobne podatke u testovima i fixtureima.
- Tajne nikad u repou. Migracije se ne primjenjuju na produkciju iz agenta.
- `git add <putanje>`, nikad `git add -A`. Konvencionalni prefiksi: `feat:`, `fix:`, `test:`, `docs:`, `chore:`.

## Jezik

Tekst sučelja na hrvatskom. Kod, identifikatori i commit poruke na engleskom. Dokumenti u `docs/` na hrvatskom.
