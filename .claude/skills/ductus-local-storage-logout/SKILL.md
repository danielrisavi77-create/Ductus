---
name: ductus-local-storage-logout
description: Pre-handoff checklist for a Ductus PR that changes logout, deletion of local browser storage (Dexie journal) or the handling of stale tabs.
---

Popis provjera prije predaje PR-a koji mijenja odjavu, brisanje lokalne pohrane preglednika ili rukovanje zastarjelim tabovima. Ne uvodi pravila: svaka stavka upućuje na odjeljak koji je pravilo ili opisuje kako dokazati da je ispunjeno. Ako se popis i dokument razilaze, vrijedi dokument, a nesklad ide u IZVJEŠTAJ. Za scenarije oporavka koristiti `ductus-offline-recovery`.

Pročitati `docs/PRODUCT.md` §13 t. 13, `docs/BACKEND.md` §4.3, `docs/ARCHITECTURE.md` §10, `docs/TESTING.md` §2 i §3 (t. 1, 5 i 6) i `STATE.md` "Ne smije se izgubiti". Svaka stavka traži test:

1. Odjava s nesinkroniziranim promjenama je blokirana uz poruku; provjera i brisanje u istoj su transakciji, da upis između njih ne može biti izgubljen.
2. Zastarjeli tab ne stvara ponovno obrisanu bazu, ni kad mu preglednik sam zatvori vezu (`versionchange`, `pagehide`, `onclose`).
3. Brisanje koje ne uspije ponavlja se; blokirano brisanje završava definiranim ishodom u ograničenom vremenu, a ne tihom odjavom.
4. Istodobna odjava iz dva taba; prijava istog i drugog korisnika nakon prekinute odjave; istek sesije nije odjava i ne briše journal.
5. `fake-indexeddb` nije stvarni preglednik (kanonski skill `ductus-offline-recovery`, korak 7): ključne scenarije ponoviti u preglednicima po TESTING §2. Prolaz u Playwrightovu WebKitu zapisati kao WebKit, ne kao Safari.
