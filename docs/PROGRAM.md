# Ductus: program rada

Verzija 0.2 · 3. 10. 2026. · Odgovorna osoba: Daniel Rišavi

Faze idu redom po ovisnostima. Faza je gotova tek kad je njezin izlazni kriterij dokazan testom ili zapisom, ne kad je kod napisan. Procjene su u večerima rada (oko 3 sata) jedne osobe uz AI agente i služe samo za planiranje.

Paralelno s fazama teče tvoj red (`STATE.md`, Owner queue): Srce, FPZG, pravni dio, Lekta. Taj red ne čeka kod i kod ne čeka njega dok ne dođu GO uvjeti.

## Rok

- Ljetni semestar 2026./2027.: prema okvirnom kalendaru Sveučilišta u Zagrebu nastava počinje 22. 3. 2027. FPZG ima vlastiti kalendar; točan datum potvrditi s fakultetom.
- Tehnička proba (faza A) traje oko 4 tjedna prije početka nastave, pa kod za prvi val mora biti spreman **oko 22. 2. 2027.**
- Od 3. 10. 2026. do 22. 2. 2027. ima oko 20 tjedana.

## Faze

| Faza | Sadržaj | Izlazni kriterij | Procjena |
| --- | --- | --- | --- |
| **M0 Temelj** | Prijenos jezgre iz `pisac-editor` s testovima; CI (lint, typecheck, unit, property, E2E, axe, Gitleaks, zizmor, Semgrep, OSV); lefthook; `supabase start` u CI-ju | Svi preneseni testovi zeleni, isti broj kao u izvoru; CI zelen na `main` | 2 do 3 |
| **M1 AAI spike** | Prijava preko AAI@EduHr Laba kroz Supabase vlastiti OIDC pružatelj; pet pitanja iz `ARCHITECTURE.md` §4; lažni pružatelj za CI | Prijava na Labu radi; `app_user` vezan uz `hrEduPersonUniqueID`; test dokazuje da lažni pružatelj ne postoji u produkciji | 1 do 2 |
| **M2 Model fakulteta** | Fakultet, kolegij, članstvo, zadatak i verzije zadatka, potvrda obavijesti, mentorstvo, uloge, pravilo AI-ja kolegija (D-52), oznaka prilagodbe (D-50); upis kodom; pgTAP matrica pristupa | Matrica pristupa zelena za sve kombinacije uloga, uključujući mentora | 4 do 5 |
| **M3 Evidencija** | Sažimanje transakcija u odsječke s autorom, Edge Function `ingest`, hash lanac, kontrolne točke, praznine, offline oznaka, oznaka lijepljenja (D-43), vrsta dokaza (D-44), spike programskog unosa (D-54); journal vezan uz korisnika i brisanje pri odjavi | Property testovi: izmjena, brisanje ili preslagivanje odsječka ruši provjeru; idempotentno ponovno slanje; oporavak prekida između Storagea, RPC-a i potpisa; izmjereno CPU vrijeme rekonstrukcije doktorskog rada | 7 do 9 |
| **M4 Lekta paket** | U Lekti: generirani paket pravila po uzoru na `katedra-pack` (FPZG profili, pravila oblika, citatni stilovi, predlošci naslovne stranice). U Ductusu: učitavanje profila i provjera oblika nad dokumentom editora | FPZG profili učitani iz paketa s verzijom; test zanošenja (drift) u Lekti; provjera oblika javlja odstupanja na testnim radovima | 8 do 12 |
| **M5 Akademski editor** | Numerirani naslovi, sadržaj, naslovna stranica i izjava, fusnote, tablice, slike s opisima, popisi tablica i slika, citiranje u tekstu, bibliografija u stilu fakulteta; provjera postojanja DOI-ja i URL-a (D-48, val 2); opseg po poglavlju (D-60), bilježnica izvora (D-59, uvoz iz Zotera u valu 2), poziv na prikaze, hrvatski navodnici, traži i zamijeni, fokus | Testni rad od 15.000 riječi sa svim elementima uređuje se bez gubitka; citati i bibliografija usklađeni | 18 do 25 |
| **M6 Suradnja** | Nastavnički pogled na spremljeno stanje (Supabase Realtime), komentari vezani uz odlomak, prijedlozi izmjena, izravne izmjene s pripisivanjem, pravilo D-34; val 2: zahtjev za doradu (D-45), odgođeno objavljivanje (D-51), konzultacije (D-47) | Komentar i prijedlog stižu studentu bez osvježavanja; svaka izmjena nastavnika pripisana u evidenciji; nema izgubljenih promjena kad oboje rade; izmjena prihvaćenog odlomka ponovno otvara pregled | 17 do 24 |
| **M7 Predaja i sažetak** | Obavijest (S3), ciklusi verzija, pregled prije predaje, zamrzavanje, rekonstrukcija, potvrda, sažetak procesa, usporedba verzija, produljenje roka, izjava po FPZG čl. 9 i 15 (D-40); val 2: prenosiv zapis s QR provjerom (D-49) | Rekonstrukcija podudarna na svim scenarijima, uključujući prazninu; nepodudarnost blokira predaju; student i nastavnik vide isti sažetak; nema zabranjenih riječi; rok testiran preko promjene sata; izjava sadrži sve zabilježene stavke; karta podrijetla bez zbroja (D-57) | 13 do 17 |
| **M8 Uvoz i izvoz** | Uvoz DOCX-a i PDF-a kao označen događaj; izvoz DOCX-a i PDF-a u obliku fakulteta | Uvoz označen u evidenciji; izvezeni DOCX prolazi Lektinu provjeru za FPZG profil | 6 do 8 |
| **M9 AI pomoćnik** | Prijava preko OpenRoutera, popis dopuštenih pružatelja po fakultetu i zadatku, prenošenje teksta s bilježenjem pružatelja, modela i svrhe (D-42), razgovori uz izjavu (D-41), zaštita sadržaja pri lekturi (D-46), poznato podrijetlo i podudaranje s AI odgovorom (D-58) | Nedopušten pružatelj nije dostupan; svako prenošenje u evidenciji; nepriloženi razgovori nisu vidljivi nastavniku; promijenjena brojka ili citat prikazani prije primjene; prepisan AI odgovor označen | 12 do 16 |
| **M10 Podaci** | Klase podataka, brisanje po roku, izvoz za studenta i za bivšeg studenta preko administratora | Brisanje po roku testirano; lanac ostaje provjerljiv nakon brisanja sadržaja | 3 |
| **M11 GO uvjeti** | Supabase Pro u EU-u, staging s AAI@EduHr Labom, proba povrata iz kopije, DPIA i ugovor o obradi, obavijest o privatnosti, pristupačnost, `docs/OPERATIONS.md` | Sve stavke iz tablice GO uvjeta zelene i zapisane | 3 + vanjski rokovi |
| **M12 Pilot** | Faza A tehnička proba, faza B nastava, faza C evaluacija | Mjerila iz `PRODUCT.md` §12 izmjerena i zapisana | Ljetni semestar |

**Zbroj prema tablici: 95 do 127 večeri** (69 do 93 prije dodataka D-40 do D-60). Procjene ovakvih projekata u pravilu se prekorače, pa je realan raspon **135 do 185 večeri**. Cijeli opseg ne stane u jedan semestar pripreme; zato vrijede valovi i kontrolna točka niže.

## Valovi puštanja unutar pilota [PRIJEDLOG D-36]

U pilot ulazi sve (D-26). Da rok početka semestra ne ovisi o najvećim dijelovima, predlažem puštanje u tri vala tijekom semestra:

| Val | Kada | Radovi | Faze |
| --- | --- | --- | --- |
| 1 | Početak ljetnog semestra | Podnesci i eseji | M0 do M4, osnovni dio M5 (naslovi, citiranje, bibliografija), M6, M7, M10, M11 |
| 2 | Oko 4 tjedna kasnije | Seminarski radovi s ciklusima verzija | Ostatak M5 (fusnote, tablice, slike), M8, M9 |
| 3 | Druga polovina semestra | Završni, diplomski, specijalistički i doktorski radovi s mentorom | Optimizacija dugih dokumenata, izvoz u punom obliku fakulteta |

Ako val 1 nije spreman do 22. 2. 2027., pilot se ne skraćuje nego pomiče cijeli raspored valova.

## Iskrena procjena roka

- Cijeli opseg ne stane do 22. 2. 2027. uz posao na puno radno vrijeme i druge projekte. Realno je samo **val 1** (oko 55 do 74 nominalne večeri s dodacima D-43, D-44, D-50, D-52 i osnovnom izjavom D-40, uz prekoračenje više).
- **Kontrolna točka 15. 12. 2026.**: ako M0 do M3 nisu gotovi i M4 nije započet, unaprijed dogovoreni rezovi stupaju na snagu bez nove rasprave:
  1. izravne izmjene nastavnika (D-21) idu u val 2, u valu 1 samo komentari i prijedlozi;
  2. uvoz PDF-a ide u val 3, u valu 1 samo DOCX;
  3. doktorski radovi idu nakon pilota.
- Rezovi se upisuju u `DECISIONS.md` kao nova odluka, ne brišu se postojeće.

## GO uvjeti za stvarne studente

Jedan crveni uvjet znači da val ne kreće.

| Područje | Uvjet | Dokaz |
| --- | --- | --- |
| Tehnički | Prvi demo iz `PRODUCT.md` §13 prolazi za radove tog vala | Snimljen prolaz i zeleni E2E na stagingu |
| Tehnički | Matrica pristupa i testovi između fakulteta zeleni | pgTAP izvještaj |
| Tehnički | Proba povrata iz kopije uspješna | Zapis probe s datumom |
| Tehnički | Produkcijska konfiguracija nema lažnog OIDC pružatelja | Test u CI-ju |
| Tehnički | Nema zabranjenih riječi u sučelju | Automatska provjera u CI-ju |
| Pristupačnost | axe bez kritičnih nalaza; svi tokovi tipkovnicom; editor i pregled prije predaje provjereni čitačem zaslona | Izvještaj axe i zapis ručne provjere |
| Podatkovni | DPIA i ugovor o obradi s FPZG-om potpisani | Dokumenti |
| Podatkovni | Rokovi čuvanja i dopušteni AI pružatelji potvrđeni | `DECISIONS.md` D-30, D-35 |
| Podatkovni | Obavijest o privatnosti objavljena i ugrađena u obavijest o zadatku | Tekst obavijesti |
| Nastavni | Koordinator na FPZG-u, odabrani kolegiji i mentori, odluka o obveznosti (D-04) | Zapis dogovora |
| Nastavni | Pragovi za korisnost i razumijevanje iz `PRODUCT.md` §12 definirani | Zapis u `DECISIONS.md` |
| Operativni | Kontakt za podršku, postupak incidenta, imenovana osoba na FPZG-u koja smije zaustaviti pilot | `docs/OPERATIONS.md` (nastaje u M11) |
| Operativni | Registracija u AAI@EduHr Registru resursa odobrena | Potvrda Srca |

Pilot se zaustavlja ako se dogodi kritičan neovlašten pristup, gubitak rada ili lažan status (npr. "spremljeno" a nije).
