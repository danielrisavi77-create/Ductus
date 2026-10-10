# Ductus: pravila za AI agente

Prije svakog rada pročitaj `STATE.md`. Razvojni governance, risk razine, review i QA gateovi su u `docs/ENGINEERING_SYSTEM.md`, a runtime-neutral pravila za više Claude/ChatGPT računa u `docs/MULTI-ACCOUNT.md`. Projektni Claude skillovi su u `.claude/skills/` i moraju ostati tanki adapteri na kanonske dokumente.

## Mjerodavni izvori

- **Linear Ductus projekt i issue:** identitet zadatka, razlog, prioritet, nositelj, rok i trenutačni status.
- **Repo:** prihvaćene produktne i tehničke odluke, arhitektura, opseg, kriteriji i razvojne upute. Za proizvod čitaj `docs/PRODUCT.md`, za tehniku `docs/ARCHITECTURE.md` i `docs/BACKEND.md` (BACKEND ima prednost u pojedinostima), za odluke `docs/DECISIONS.md`, za funkcije `docs/FEATURES.md`, a za faze i GO uvjete `docs/PROGRAM.md` i `docs/PLAN-DEMO.md`.
- **GitHub:** verzije koda i dokumenata, grane, PR-ovi, reviewi, CI i izvršni dokazi. To je zajednički cross-account control plane, ali nije samostalni registar prioriteta i statusa zadataka.
- **Product Vision v1.0 i Product Constitution v1.3:** odobrene produktne i ustavne granice; u sukobu s repo dokumentom vrijedi Ustav, a pitanje ide u Owner queue.
- **Ductus Space:** datirani pregled iz Lineara i GitHuba; ne prepisuje njihove statuse kao neovisan izvor.

Ako se izvori ne slažu, sačuvaj nesklad kao otvoren, provjeri odgovarajući kanonski izvor i ne označavaj zadatak dovršenim na temelju PR-a, mergea ili zelenog CI-ja samog po sebi.

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
