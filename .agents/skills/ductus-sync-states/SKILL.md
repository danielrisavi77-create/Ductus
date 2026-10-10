---
name: ductus-sync-states
description: Pre-handoff checklist for a Ductus PR that changes sync states, ACK handling, drain or recovery planning, or the conditions under which SYNCED is shown.
---

Popis provjera prije predaje PR-a koji mijenja stanja sinkronizacije, obradu potvrda, drain ili oporavak. Ne uvodi pravila: svaka stavka upućuje na odjeljak koji je pravilo ili opisuje kako dokazati da je ispunjeno. Ako se popis i dokument razilaze, vrijedi dokument, a nesklad ide u IZVJEŠTAJ.

Pročitati `STATE.md` "Ne smije se izgubiti" (F-3/F-8, B-8), `docs/ARCHITECTURE.md` §5, `docs/BACKEND.md` §3 pravilo 3, `docs/PRODUCT.md` §5 pravilo 10 i `docs/TESTING.md` §2 i §3. Za scenarije oporavka koristiti `ductus-offline-recovery`.

Pravilo je jedno: stanje "spremljeno na poslužitelju" (SYNCED) nastaje tek kad klijent dobije potpisanu potvrdu (ARCHITECTURE §5 t. 5; BACKEND §3 pravilo 3; `STATE.md` F-3/F-8). Stavke niže su provjere izvedbe; svaka traži test koji pada kad se uvjet ukloni.

1. Svaki put koji emitira SYNCED prolazi kroz provjeru potpisane potvrde. Test: odgovor bez potpisa, s `pending_signature` ili s neispravnim potpisom ne daje SYNCED.
2. Parser odgovora ne odbacuje potvrdu: test ide od sirovog odgovora do stanja, ne od već složenog objekta.
3. Potvrda za stariji red ne prebacuje stanje u SYNCED dok noviji tekst nije poslan i potvrđen (`STATE.md`: stale i local-save ishodi nakon novog EDIT-a).
4. Zadane vrijednosti su zatvorene: poziv s izostavljenim argumentom ili opcijom ne smije dopustiti ACK. Test poziva funkciju bez tog argumenta.
5. Red se prepoznaje po identitetu, ne po referenci objekta: test s jednakim redom u novom objektu (nakon reloada ili serijalizacije). Identitet po kanonskom skillu `ductus-offline-recovery`, korak 4.
6. Redovi više dokumenata u istom redu čekanja: potvrda jednog dokumenta ne mijenja stanje drugog.
7. Provjera je vezana uz transakciju, ne uz objekt: potvrda vrijedi samo za ID transakcije i sadržaj na koji se odnosi; ponovljeni ID vraća isti rezultat (ARCHITECTURE §5 t. 3).
8. Redoslijed recovery, rebase i salvage ima testove (`STATE.md` F-3/F-8).
9. Offline zapis ostaje označen i nakon sinkronizacije (PRODUCT §5 pravilo 10; `docs/PLAN-DEMO.md` F-8). Tekst stanja: vidi `ductus-ui-copy`.
10. Preglednici po TESTING §2: Firefox i WebKit za editor, sync i journal; primjenjive scenarije iz TESTING §3 (t. 1 do 5 i 9 do 11) navesti u IZVJEŠTAJU kao provjerene ili otvorene.
11. `Risk` po `docs/ENGINEERING_SYSTEM.md` §5; uvjet za SYNCED dira evidenciju i potpisanu potvrdu, pa ga ne spuštati ispod semantičke ozbiljnosti.
