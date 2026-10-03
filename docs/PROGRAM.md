# Ductus: program rada

Verzija 0.1 · 3. 10. 2026. · Odgovorna osoba: Daniel Rišavi

Faze idu redom po ovisnostima. Faza je gotova tek kad je njezin izlazni kriterij dokazan testom ili zapisom, ne kad je kod napisan. Procjene su u večerima rada (oko 3 sata) jedne osobe uz AI agente i služe samo za planiranje.

Paralelno s fazama teče tvoj red (`STATE.md`, Owner queue): Srce, FPZG, pravni dio. Taj red ne čeka kod i kod ne čeka njega dok ne dođe M7.

## Faze

| Faza | Sadržaj | Izlazni kriterij | Procjena |
| --- | --- | --- | --- |
| **M0 Temelj** | Prijenos jezgre iz `pisac-editor` s testovima; CI (lint, typecheck, unit, property, E2E, Gitleaks, zizmor, Semgrep, OSV); lefthook; `supabase start` u CI-ju | Svi preneseni testovi zeleni, isti broj kao u izvoru; CI zelen na `main` | 2 |
| **M1 AAI spike** | Prijava preko AAI@EduHr Laba kroz Supabase vlastiti OIDC pružatelj; čitanje userinfo podataka; lažni pružatelj za CI | Prijava na Labu radi; `app_user` vezan uz `hrEduPersonUniqueID`; test dokazuje da lažni pružatelj ne postoji u produkcijskoj konfiguraciji | 1 do 2 |
| **M2 Model ustanove** | Tablice ustanove, kolegija, članstva, zadatka i projekta; upis kodom; potvrda uloge nastavnika; pgTAP matrica pristupa | Matrica pristupa zelena za sve kombinacije uloga; student ulazi u kolegij kodom | 3 |
| **M3 Evidencija** | Sažimanje transakcija u odsječke, Edge Function `ingest` (Storage, RPC, potpis), hash lanac, kontrolne točke, praznine, offline oznaka; journal vezan uz korisnika i brisanje pri odjavi | Property testovi: izmjena, brisanje ili preslagivanje odsječka ruši provjeru; ponovljeno slanje je idempotentno; prekid između Storagea, RPC-a i potpisa se oporavlja; offline ostaje označen; izmjereno CPU vrijeme rekonstrukcije rada od 15.000 riječi | 6 do 8 |
| **M4 Predaja** | Verzije zadatka i potvrda obavijesti (S3), pregled prije predaje (S5), zamrzavanje, rekonstrukcija, potvrda (S6), produljenje roka | Rekonstrukcija podudarna na svim testnim scenarijima, uključujući prazninu; nepodudarnost blokira predaju; pregled i nastavnički prikaz generira ista funkcija; rok testiran preko promjene sata 25. 10. 2026. | 4 do 5 |
| **M5 Nastavnički pogled** | Kolegiji i zadaci (N1, N2), popis predaja (N3), sažetak procesa (N4), usporedba verzija u Proširenom profilu (N5), komentar, revizijski trag | Sažetak ima sve stavke iz `PRODUCT.md` §7 s definicijama; nema zabranjenih riječi (automatska provjera teksta sučelja); nastavnik u Osnovnom profilu ne može dohvatiti usporedbu ni odsječke; tekst obrisan unutar sesije ne pojavljuje se ni u jednom prikazu; svako čitanje predaje zapisano u revizijski trag | 6 |
| **M6 Podaci i izvoz** | Izvoz za studenta (S7) i predaje (DOCX); brisanje po klasi podataka; izvoz za bivšeg studenta preko administratora | Brisanje po roku testirano; lanac ostaje provjerljiv nakon brisanja sadržaja | 3 |
| **M7 GO uvjeti** | Supabase Pro u EU-u, staging s AAI@EduHr Labom, proba povrata iz kopije, DPIA i ugovor o obradi, obavijest o privatnosti, pristupačnost, `docs/OPERATIONS.md`, alternativni postupak predaje | Sve stavke iz tablice GO uvjeta niže zelene i zapisane | 3 + vanjski rokovi |
| **M8 Pilot** | Faza A tehnička proba (sintetički radovi), faza B nastavna proba, faza C evaluacija | Mjerila iz `PRODUCT.md` §10 izmjerena i zapisana | 6 do 8 tjedana promatranja |

Ukupno do spremnosti za pilot (M0 do M7): oko 28 do 33 večeri prema tablici. Iskustvo s ovakvim projektima kaže da se procjene u pravilu prekorače, pa je realan raspon 40 do 60 večeri, uz uvjet da vanjski koraci (Srce, FPZG) teku paralelno. Reprodukcija, izvoz PDF-a i dnevni korijen s RFC 3161 žigom namjerno su izvan pilota da bi ovaj raspon bio ostvariv.

## GO uvjeti za stvarne studente

Jedan crveni uvjet znači da pilot ne kreće.

| Područje | Uvjet | Dokaz |
| --- | --- | --- |
| Tehnički | Prvi demo iz `PRODUCT.md` §11 prolazi | Snimljen prolaz i zeleni E2E na stagingu |
| Tehnički | Matrica pristupa i testovi između ustanova zeleni | pgTAP izvještaj |
| Tehnički | Proba povrata iz kopije uspješna | Zapis probe s datumom |
| Tehnički | Produkcijska konfiguracija nema lažnog OIDC pružatelja | Test u CI-ju |
| Tehnički | Nema zabranjenih riječi u sučelju | Automatska provjera u CI-ju |
| Pristupačnost | axe bez kritičnih nalaza; svi tokovi tipkovnicom; S4 i S5 provjereni čitačem zaslona | Izvještaj axe i zapis ručne provjere |
| Podatkovni | DPIA i ugovor o obradi s FPZG-om potpisani | Dokumenti |
| Podatkovni | Rokovi čuvanja potvrđeni | `DECISIONS.md` D-14 |
| Podatkovni | Obavijest o privatnosti objavljena i ugrađena u S3 | Tekst obavijesti |
| Nastavni | Imenovan koordinator na FPZG-u, odabrani zadaci, dogovorena alternativa za studente koji ne sudjeluju | Zapis dogovora |
| Nastavni | Pragovi za korisnost i razumijevanje iz `PRODUCT.md` §10 definirani | Zapis u `DECISIONS.md` |
| Operativni | Kontakt za podršku, postupak incidenta, imenovana osoba na FPZG-u koja smije zaustaviti pilot (zamjena kad Daniel nije dostupan) | `docs/OPERATIONS.md` (nastaje u M7) |
| Operativni | Registracija u AAI@EduHr Registru resursa odobrena | Potvrda Srca |

Pilot se zaustavlja ako se dogodi kritičan neovlašten pristup, gubitak rada ili lažan status (npr. "spremljeno" a nije).
