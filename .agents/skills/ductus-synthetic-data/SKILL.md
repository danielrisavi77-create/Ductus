---
name: ductus-synthetic-data
description: Pre-handoff checklist for Ductus tests, fixtures, seed scripts, demo data and PR artifacts, confirming that every person, text and identifier in them is invented.
---

Popis provjera prije predaje PR-a koji dodaje testne podatke, fixturee, skriptu za punjenje baze, demo podatke ili artefakte PR-a. Ne uvodi pravila: svaka stavka upućuje na odjeljak koji je pravilo ili opisuje kako dokazati da je ispunjeno. Ako se popis i dokument razilaze, vrijedi dokument, a nesklad ide u IZVJEŠTAJ.

Pročitati `CLAUDE.md` (Tvrda pravila), `docs/ARCHITECTURE.md` §9, `docs/PLAN-DEMO.md` §1 i K-3 u §4, te `docs/TESTING.md` §4.

Pravilo: u testovima i fixtureima nema stvarnih studentskih radova ni osobnih podataka (`CLAUDE.md`); lokalno, u CI-ju i na stagingu podaci su samo sintetički (ARCHITECTURE §9); izlazni kriterij demoa i K-3 traže da nema nijednog stvarnog osobnog podatka (PLAN-DEMO §1, §4). Osobni podaci i tajne ne ulaze ni u issue ni u PR (`AGENTS.md` "Zajednička pravila").

Provjere izvedbe (kako pokazati da je podatak izmišljen):

1. Adrese e-pošte i imena poslužitelja koriste rezervirane domene (`.example`, `.test`, `.invalid`, `example.com`), koje ne mogu pripadati stvarnoj osobi ni ustanovi.
2. Imena osoba, kolegija i ustanova očito su izmišljena i ne podudaraju se sa stvarnim studentom, nastavnikom ni kolegijem. Identifikatori (AAI oznaka, matični broj, OIB) nisu preuzeti ni od koga.
3. Tekst rada napisan je za test. Nikad ne ide u fixture: stvarni studentski rad ili njegov dio, ispis stvarnog razgovora, izvoz iz stvarne baze ili preglednika, stvarni AAI atributi, stvarni ključ ili token (`CLAUDE.md`: tajne nikad u repou).
4. Isto vrijedi za artefakte: snimke zaslona, video i logove priložene uz PR (`docs/PLAN-DEMO.md` P-5).
5. Pretražiti diff za adresama e-pošte, domenama izvan rezerviranih i nizovima nalik identifikatorima; rezultat upisati u IZVJEŠTAJ uz potvrdu "nema tajni ni stvarnih osobnih podataka" iz predloška PR-a.
6. Demo podaci po K-3: fakultet, kolegij, zadatak, nastavnik, dva studenta i dvije povijesti koje Ductus ne može razlikovati (D-80 t. 3). Taj par je kanonski falsification par iz TESTING §4: nijedna povijest ne smije biti označena kao rizičnija. Prijava u demou nosi oznaku "demo prijava" (PLAN-DEMO §1).
7. Fixture ostaje u mapama dodijeljene uloge (`docs/SESSIONS.md` §1).
