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
| **M5 Akademski editor** | Numerirani naslovi, sadržaj, naslovna stranica i izjava, fusnote, tablice, slike s opisima, popisi tablica i slika, citiranje u tekstu, bibliografija u stilu fakulteta; provjera postojanja DOI-ja i URL-a (D-48, val 2); opseg po poglavlju (D-60), bilježnica izvora (D-59, uvoz iz Zotera u valu 2), poziv na prikaze, hrvatski navodnici, traži i zamijeni, fokus | Testni rad od 15.000 riječi sa svim elementima uređuje se bez gubitka; citati i bibliografija usklađeni; napredak studenta iz verzija (D-63) | 19 do 26 |
| **M6 Suradnja** | Nastavnički pogled na spremljeno stanje (Supabase Realtime), komentari vezani uz odlomak, prijedlozi izmjena, izravne izmjene s pripisivanjem, pravilo D-34; val 2: zahtjev za doradu (D-45), odgođeno objavljivanje (D-51), konzultacije (D-47) | Komentar i prijedlog stižu studentu bez osvježavanja; svaka izmjena nastavnika pripisana u evidenciji; nema izgubljenih promjena kad oboje rade; izmjena prihvaćenog odlomka ponovno otvara pregled | 17 do 24 |
| **M7 Predaja i sažetak** | Obavijest (S3), ciklusi verzija, pregled prije predaje, zamrzavanje, rekonstrukcija, potvrda, sažetak procesa, usporedba verzija, produljenje roka, izjava po FPZG čl. 9 i 15 (D-40); val 2: prenosiv zapis s QR provjerom (D-49) | Rekonstrukcija podudarna na svim scenarijima, uključujući prazninu; nepodudarnost blokira predaju; student i nastavnik vide isti sažetak; nema zabranjenih riječi; rok testiran preko promjene sata; izjava sadrži sve zabilježene stavke; karta podrijetla bez zbroja (D-57); otvorena mjesta (D-61) i pravila zadatka s kontrolnim popisom (D-62) bez oznaka prolaza | 15 do 20 |
| **M8 Uvoz i izvoz** | Uvoz DOCX-a i PDF-a kao označen događaj; izvoz DOCX-a i PDF-a u obliku fakulteta | Uvoz označen u evidenciji; izvezeni DOCX prolazi Lektinu provjeru za FPZG profil | 6 do 8 |
| **M9 AI pomoćnik** | Prijava preko OpenRoutera, popis dopuštenih pružatelja po fakultetu i zadatku, prenošenje teksta s bilježenjem pružatelja, modela i svrhe (D-42), razgovori uz izjavu (D-41), zaštita sadržaja pri lekturi (D-46), poznato podrijetlo i podudaranje s AI odgovorom (D-58) | Nedopušten pružatelj nije dostupan; svako prenošenje u evidenciji; nepriloženi razgovori nisu vidljivi nastavniku; promijenjena brojka ili citat prikazani prije primjene; prepisan AI odgovor označen; svrhe razine 2 nedostupne dok ih nastavnik ne uključi, pomoćnik koji pita (D-64) | 14 do 19 |
| **M10 Podaci** | Klase podataka, brisanje po roku, izvoz za studenta i za bivšeg studenta preko administratora | Brisanje po roku testirano; lanac ostaje provjerljiv nakon brisanja sadržaja | 3 |
| **M11 GO uvjeti** | Supabase Pro u EU-u, staging s AAI@EduHr Labom, proba povrata iz kopije, DPIA i ugovor o obradi, obavijest o privatnosti, pristupačnost, `docs/OPERATIONS.md` | Sve stavke iz tablice GO uvjeta zelene i zapisane | 3 + vanjski rokovi |
| **M12 Pilot** | Faza A tehnička proba, faza B nastava, faza C evaluacija | Mjerila iz `PRODUCT.md` §12 izmjerena i zapisana | Ljetni semestar |

**Zbroj prema tablici: 99 do 134 večeri** (69 do 93 prije dodataka D-40 do D-64). Procjene ovakvih projekata u pravilu se prekorače, pa je realan raspon **145 do 195 večeri**. Cijeli opseg ne stane u jedan semestar pripreme; zato vrijede valovi i kontrolna točka niže.

## Raspored po valovima [PRIJEDLOG D-36, verzija 2]

U pilot ulazi sve prihvaćeno (D-26, D-65), ali ne odjednom. Faze M0 do M11 iz tablice gore dijele se po valovima; ovdje je što točno ide u koji val.

### Kapacitet

Od 3. 10. 2026. do 22. 2. 2027. ima 20 tjedana, od toga oko 2 tjedna blagdana. Uz prekoračenje procjena od oko 40 %:

| Večeri tjedno za Ductus | Stvarnih večeri do 22. 2. | Nominalno (nakon prekoračenja) |
| --- | --- | --- |
| 3 | oko 54 | oko 38 |
| 4 | oko 72 | oko 51 |
| 5 | oko 90 | oko 64 |
| 6 | oko 108 | oko 77 |

Val 1 ispod ima 56 do 74 nominalne večeri, dakle traži **5 do 6 večeri tjedno samo za Ductus**. Uz 4 večeri tjedno rezovi s kontrolne točke postaju plan, ne rezerva.

### Val 1: početak ljetnog semestra (kod spreman oko 22. 2. 2027.)

Radovi: podnesci i eseji. Bez AI pomoćnika (FPZG ga ionako ne smije tražiti, D-38). Mentori mogu pratiti završne radove osnovnim nastavničkim funkcijama.

| Dio | Sadržaj | Procjena |
| --- | --- | --- |
| M0, M1 | Temelj i AAI@EduHr (M1 ovisi o pristupu Labu Srca; do tada lažni pružatelj) | 3 do 5 |
| M2 | Model fakulteta s rupama: komentor, povjerenstvo, pravno zadržavanje, jezik rada, pravilo AI-ja kolegija, prilagodba | 5 do 6 |
| M3 | Evidencija, oznaka lijepljenja (D-43), vrsta dokaza (D-44), spike programskog unosa (D-54), bilježenje ritma za mentorske radove ako je D-56 odobren | 8 do 10 |
| M4 osnovno | Lekta paket: FPZG citatni stil, opseg, naslovna stranica | 4 do 6 |
| M5 osnovno | Naslovi, citiranje, bibliografija, DOI i ISBN (S-08), opseg po poglavlju (D-60), pravopis po jeziku rada (S-07), navodnici, traži i zamijeni, osnovna bilježnica izvora (D-59) | 9 do 12 |
| M6 osnovno | Pogled na rad u nastajanju, komentari, prijedlozi | 6 do 8 |
| M7 osnovno | Obavijest S3, predaja, rekonstrukcija, sažetak procesa, izjava D-40 bez AI dijela, produljenje roka | 8 do 10 |
| M10 osnovno | Klase podataka, brisanje po roku, pravno zadržavanje (F-02) | 2 do 3 |
| M11 | GO uvjeti, sučelje na engleskom (D-70), pristupačnost (F-03), statusna stranica (F-10) | 5 do 6 |
| Uz to | Obavijesti (N-01), podsjetnici (N-02), popis "tko treba pomoć" (N-12), uvodni vodič (S-11) | 6 do 8 |
| **Ukupno** | | **56 do 74** |

### Val 2: seminarski radovi (cilj sredina svibnja 2027.)

| Dio | Sadržaj | Procjena |
| --- | --- | --- |
| M5 ostatak | Fusnote, tablice, slike, pozivi na prikaze | 5 do 7 |
| M6 ostatak | Izravne izmjene (D-21), zahtjev za doradu (D-45), odgođeno objavljivanje (D-51), banka komentara (N-03), promjene od zadnjeg pregleda (N-05) | 8 do 11 |
| M7 ostatak | Karta podrijetla (D-57), otvorena mjesta (D-61), pravila zadatka i kontrolni popis (D-62) | 5 do 7 |
| M8 | Uvoz i izvoz DOCX-a | 4 do 5 |
| M9 | AI pomoćnik: svrhe (D-42, D-64), razgovori uz izjavu (D-41), zaštita sadržaja (D-46), "Objasni mi komentar" (A-01), EU modeli (A-05) | 12 do 16 |
| **Ukupno** | | **34 do 46** |

Razvoj vala 2 teče tijekom semestra, uz podršku pilotu. Ako kasni, val 2 se pomiče prema kraju semestra; ne skraćuje se val 1.

### Val 3: mentorski radovi i obrana (ljeto 2027., prije prvog roka obrana)

Konzultacije (D-47), ključni rokovi (N-07), komentor i povjerenstvo u sučelju (N-08, N-09), priprema za razgovor (D-53), reprodukcija s povijesti odlomka (D-56), priprema za obranu (A-04), PDF izvori i provjera citata (S-09, A-03), uvoz PDF-a, poznato podrijetlo (D-58), provjera izvora (D-48), prenosiv zapis i paket za zaštitu (D-49, S-01), vremeplov (S-02), planer (S-06), zbirni pregled (N-11), verifikator (A-07), "moj rad u brojkama" (A-10), portfelj (S-10), izvješće za evaluaciju (F-01), mobilne bilješke (S-03). Procjena **50 do 65**, uglavnom u ljetnim mjesecima.

### Ovisnosti koje se ne smiju propustiti

- **Ritam za reprodukciju (D-56)** postoji samo ako se bilježi od prvog dana pisanja. Ako izmjena Ustava C-14 i C-19 i pravno mišljenje nisu gotovi prije početka pisanja završnih radova, ti radovi imat će reprodukciju samo po odsječcima, bez ritma.
- **Grupni radovi (S-12)** odvijaju se tijekom semestra; u valu 3 (ljeto) gube smisao. Za pilot moraju u val 2, što ga produljuje za oko 4 večeri, ili ostaju za nakon pilota.
- **M1** ovisi o pristupu AAI@EduHr Labu (Srce).

### Kontrolna točka 15. 12. 2026.

Do tada moraju biti gotovi M0 do M3 (oko 17 do 23 nominalne večeri) i započet M4. Ako nisu, ovi rezovi stupaju na snagu redom, bez nove rasprave, dok val 1 ne stane:

1. Prijedlozi idu u val 2; u valu 1 samo komentari.
2. Osnovna bilježnica izvora ide u val 2; DOI i ISBN ostaju.
3. Obavijesti samo kao dnevni sažetak e-poštom.
4. Sučelje na engleskom ide u val 2; Erasmus studenti pišu izvan Ductusa do vala 2.
5. M4 samo citatni stil; provjera oblika u valu 2.

Ranije dogovoreno vrijedi i dalje: izravne izmjene u valu 2, uvoz PDF-a u valu 3, doktorski radovi nakon pilota. Rezovi se upisuju u `DECISIONS.md` kao nova odluka.

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
