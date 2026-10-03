# Ductus: registar odluka

Odgovorna osoba za sve odluke: Daniel Rišavi (Ustav C-52). Svaka odluka ima broj, status, sadržaj i razlog. Status je jedan od: **ODLUČENO**, **PRIJEDLOG** (čeka potvrdu), **ČEKA FPZG** (traži vanjsku potvrdu), **ODGOĐENO**.

Odluka se mijenja samo novim unosom koji navodi koju odluku zamjenjuje. Stari unos ostaje.

Brojevi D-01 do D-15 odgovaraju registru iz dokumenta "Pisač: smjer, arhitektura i timske prezentacije" (3. 10. 2026.), koji pokriva 151 slajd četiriju timskih prezentacija.

## Odlučeno

| Broj | Odluka | Datum | Razlog |
| --- | --- | --- | --- |
| D-09 | Studenti se prijavljuju isključivo AAI@EduHr računom. Drugog načina prijave za studente nema. | 3. 10. 2026. | Kompatibilnost sa Srceovim sustavom; jedan pouzdan identitet; fakultetu poznat način prijave |
| D-17 | Novi privatni repo `Ductus`; iz `pisac-editor` prenosi se dokazana jezgra s testovima, a novi dijelovi grade se čisto | 3. 10. 2026. | Čuva oko 450 testova sinkronizacije i spremanja; uklanja demo module, zamrznuti AI i dokumentaciju koja si proturječi |
| D-18 | `Ductus` je ime repoa i radno ime. Konačno ime proizvoda bira se posebno i mora imati slobodne domene i čist žig | 3. 10. 2026. | `ductus.com` i `ductus.app` su zauzeti; postoji švedska IT tvrtka Ductus |

## Prijedlozi koji čekaju potvrdu

| Broj | Odluka | Prijedlog |
| --- | --- | --- |
| D-01 | Obećanje proizvoda | "Ductus pokazuje kako je rad nastao. Ne donosi presudu o autorstvu." |
| D-02 | Kupac i korisnik | Kupac je fakultet, korisnici su student i nastavnik; student ima vlastitu korist. Upisati i kao izmjenu Product Visiona §1 i §5 kroz Constitution Gate. |
| D-03 | Vrsta zadatka u pilotu | Dva kratka pisana zadatka (esej ili seminarski rad) na jednom kolegiju; ne završni ni diplomski radovi; ne pisanje na nastavi ni zadaci nalik ispitu |
| D-04 | Što se bilježi | Promjene dokumenta sažete u odsječke od najviše 30 s s jednim vremenom zaokruženim na minutu; lijepljenje i uvoz s veličinom; bez tipki, vremena pojedinih promjena, ritma, IP-a i podataka o uređaju u evidenciji |
| D-05 | Što nastavnik vidi | Profili Osnovni (sažetak, zadano) i Prošireni (+ usporedba verzija na kraju sesija i predanih verzija). Reprodukcija pisanja nije u pilotu (C-14, C-19). Nastavnik nikad ne vidi tekst napisan i obrisan unutar sesije |
| D-06 | Kada nastavnik dobiva uvid | Tek nakon predaje; opseg određuje profil zadatka; student vidi pregled prije predaje |
| D-07 | Ovlasti | Članstvo i RLS u Postgresu, pgTAP matrica pristupa; bez OpenFGA servisa |
| D-08 | Stack i backend | Next.js, Tiptap, Dexie, Supabase, Netlify (sadržaj se ne obrađuje izvan EU-a) |
| D-10 | Integritet zapisa | JCS odsječci adresirani hashom, hash lanac, Ed25519 potvrde iz Edge Functiona s rotacijom ključeva. Dnevni korijen s RFC 3161 žigom odgođen nakon pilota |
| D-11 | Predaja i praznine | Nepodudarna rekonstrukcija blokira predaju; praznina ne blokira (rekonstrukcija kreće od kontrolne točke na kraju praznine), ali je vidljiva studentu i nastavniku |
| D-12 | AI u pilotu | Nema AI-ja u editoru ni u analizi procesa; samo studentova izjava o korištenju vanjskog AI-ja |
| D-16 | Prijava nastavnika i administratora | Također isključivo AAI@EduHr |

## Čeka FPZG

| Broj | Odluka | Prijedlog |
| --- | --- | --- |
| D-13 | Pravna osnova i uloge | FPZG voditelj obrade, Ductus izvršitelj (čl. 28 GDPR-a); DPIA prije stvarnih podataka; privola nije osnova |
| D-14 | Rokovi čuvanja | Ductus predlaže rokove po klasi podataka, FPZG potvrđuje |
| D-15 | GO uvjeti za stvarne studente | Tehnički, podatkovni, nastavni i operativni uvjeti iz `PROGRAM.md`, faza M7 |

## Zadane vrijednosti pragova

Pragovi su postavke ustanove (C-7, C-55). Ovo su zadane vrijednosti koje treba potvrditi; uvijek se prikazuju uz brojku na koju utječu.

| Broj | Prag | Zadana vrijednost | Gdje se koristi |
| --- | --- | --- | --- |
| P-01 | Prekid koji završava sesiju | 30 minuta bez promjene | Sažetak procesa |
| P-02 | Lijepljenje koje se prikazuje kao zaseban događaj | Više od 200 znakova | Sažetak procesa |
