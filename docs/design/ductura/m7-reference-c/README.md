# Referentne slike M7, dopuna C: S-43, J-03, S-47 (paket 8, DAN-569)

Paket 8 iz `docs/design/EKRANI.md` §4. Ekrani su S-43 Napomene i osporavanje, J-03 Provjera potvrde (putovnica) i S-47 Moj rad u brojkama. Smjer je „papir i grafit” (D-188, `docs/design/DESIGN-SYSTEM.md`). Spajanje PR-a vlasnikovom porukom „Spoji n” znači odobrenje slika kao reference (D-183). Dotad su prijedlog.

Sva tri ekrana imaju u EKRANI §5 status NEMA: nijedan nema prototip `.dc.html`. Složeni su iz ugovora u EKRANI §5 i dijelova `../m5-reference` (panel, dijalog, oznaka, kostur učitavanja). Iz `../analiza.dc.html` (S8) preuzeto je samo pravilo „napomene se samo dodaju; ispravak upućuje na staru”, bez rasporeda i boja.

## Stranice

| Stranica | Prototip | Stanja | Izvori |
|---|---|---|---|
| `s43-napomene.html` | nema; složeno po ugovoru iz EKRANI §5 | popunjeno (napomena, ispravak koji upućuje na staru, dopuna), osporavanje (unos), osporavanje poslano, prazno, učitavanje, greška učitavanja i greška slanja | M7.8, R-08, D-80 t. 7 i 9, PRODUCT §5 pravila 3 i 5 |
| `j03-provjera-potvrde.html` | nema; složeno po ugovoru iz EKRANI §5 | prazno, podudara se (popunjeno), ne podudara se (potpis; datoteka rada uz podudaran potpis), učitavanje, greška (registar ključeva nedostupan; datoteka bez potvrde) | M7.10, D-49, D-80 t. 11, D-263 Q24, A-07, `docs/contracts/submission-receipt-v2.md`, PRODUCT §5 pravila 3 i 9 |
| `s47-brojke.html` | nema; složeno po ugovoru iz EKRANI §5 | popunjeno, prazno, prva verzija, učitavanje, greška | M7.13, A-10 u `docs/FEATURES.md`, D-63 (b), D-142, PRODUCT §5 pravilo 4, #1030 |

Mobitel je snimka širine 400 px. Snimke su u `snimke/<stranica>-<tamna|svijetla>-<1440|400>.png`. Izrađene su Playwrightovim Chromiumom: cijela stranica, DPR 1, nakon `document.fonts.ready`, bez vodoravnog pomicanja na obje širine. Svijetla ljuska je `data-theme="light"` na `<html>`. Kontrolni zbrojevi su u `SHA256SUMS`. `reference.css` uvozi `../m5-reference/reference.css` i dodaje samo polja putovnice, okvir ishoda, retke unosa i niz gumba.

## Odluke u slici

- **Napomene i osporavanje (S-43).**
  - Zabilježeni opis događaja se ne mijenja. Student dodaje napomenu, dopunu opisa ili osporavanje, a svaki unos stoji uz opis (D-80 t. 7).
  - Unosi se samo dodaju. Ispravak je novi unos s uputom na stari; stari ostaje vidljiv s isprekidanim rubom i retkom „Ispravljeno napomenom 2”.
  - Unos studenta je izjava i označen je kao „Vaš unos”, odvojeno od onoga što je zabilježeno iz preglednika (D-80 t. 9).
  - Unose vidi i nastavnik kolegija, jednako kao student (pravilo 5), pa panel nosi oznaku „Vidi i nastavnik”.
  - Događaj je opisan sesijom i brojem promjene, bez sata, kao u `../m6-reference/s34-reprodukcija-student.html`.
  - Osporen događaj nosi neutralnu oznaku „Osporeno” s isprekidanim rubom, bez boje.
  - Nakon slanja osporavanja opis ostaje uz osporavanje, a gumb „Osporavam opis” se više ne nudi. Ispravak osporavanja je nova napomena.
  - Napomena nije obvezna. Prazan popis ne nosi nikakvu oznaku za događaj.
- **Provjera potvrde (J-03).**
  - Stranica je javna i bez prijave. Polja potvrde su u mono fontu (DESIGN-SYSTEM §4, „Kod, putovnica”).
  - Prikazana su polja potvrde v2: zahtjev predaje (requestedAt), rok (dueAt), „na vrijeme” iz afterDeadline, vrijeme potpisa (signedAt), zadatak i verzija, rad i revizija, otisak datoteke rada (artifactSha256, 64 heksadekadske znamenke bez razmaka, kako stoji u potvrdi) i ključ s verzijom.
  - Vremena su vrijeme poslužitelja u UTC-u. Slika izričito kaže da to nije vremenski žig treće strane (ugovor: signedAt nije TSA).
  - Ime studenta se ne prikazuje, jer nije polje potvrde.
  - Ishod „podudara se” kaže samo da je zapis cjelovit i neizmijenjen od primitka. Rečenica „Ne pokazuje tko je rad napisao” (pravilo 9) stoji u oba stanja s ishodom, „podudara se” i „ne podudara se”.
  - Ishod „ne podudara se” govori samo o datoteci koja se provjerava (potvrdi ili datoteci rada), ne o studentu (pravilo 3). Razlikuje se rubom i tekstom, ne bojom. Svaka provjera (potpis, valjanost ključa, otisak datoteke rada) ima svoj ishod i svoj naslov. Kad se potpis podudara, a datoteka rada ne, slika to prikazuje kao dva odvojena ishoda: potvrda je neizmijenjena, a odabrana datoteka rada nije ona predana uz potvrdu. Opozvan ključ i vrijeme potpisa izvan valjanosti ključa imaju zaseban naslov „Ključ nije bio valjan pri potpisu.”, a ne „Potpis se ne podudara”.
  - Kad registar ključeva nije dostupan, o potvrdi se ništa ne zaključuje.
  - Datoteke se provjeravaju u pregledniku (D-49). S poslužitelja se dohvaća samo javni registar ključeva.
  - QR kod s prenosivog zapisa otvara samo lokalnu provjeru; zapis ili potvrdu korisnik bira sam. Nema javnog krajnjeg mjesta s podacima potvrde (D-263 Q24).
  - Kratki identifikatori (`zad-7f3c`, `dok-19a0`) i ime ključa su izmišljeni oblici prikaza. Ugovor ih ne određuje.
- **Moj rad u brojkama (S-47).**
  - Brojke su samo iz verzija na poslužitelju: riječi u radu, broj verzija, izvori, citati, fusnote, riječi po poglavlju te riječi po verziji s dodanim i uklonjenim riječima.
  - Nema brzine, stanki, ritma ni usporedbe s drugima (D-63 (b), A-10).
  - Vidi ih samo student („Vidite samo Vi”, kao planer S-06 u `../m5-reference-c`). Ne ulaze u sažetak procesa, izvoz, predaju ni nastavnički prikaz.
  - Oznaka se odnosi na brojke, ne na tekst rada. Tekst mentor vidi uživo (D-142), i slika to izričito kaže.
  - Riječi na dan prema cilju i dani do roka ostaju u Planeru rada (S-06), na koji stranica upućuje. Ovdje se ne ponavljaju.
  - Zbroj poglavlja (5.120) i lanac verzija (4.680 → 4.830 → 5.120) se slažu.

## Nije nacrtano

- Odgovor nastavnika na osporavanje i ishod osporavanja nisu definirani, pa nisu nacrtani.
- Nastavnički prikaz istih napomena nije zaseban ekran ovog paketa.
- Točan sadržaj QR koda (oblik adrese) nije definiran ugovorom. Slika prema D-263 Q24 kaže samo da QR otvara lokalnu provjeru, a paket korisnik bira sam.
- Pristupni zapis „Tko je otvorio moj rad” (S8 u `../analiza.dc.html`) je S-42 u paketu 15 i ovdje nije nacrtan.

## Granice

- Ikone nisu dio slike; gumbi nose tekst.
- Oznake u velikim slovima („Stanje 1 · …”) i sitne bilješke ispod okvira opisuju referencu i nisu tekst sučelja.
- Tipkovnički redoslijed (EQ6) je bilješka na dnu svake stranice.
- Svi su podaci izmišljeni (Horvat, A., otisci, identifikatori i ključ).

## Provjera rječnika

Tekst svih triju stranica i ovog README-a prošao je `findForbiddenTermsInMarkup` i `findForbiddenTerms` iz `scripts/forbidden-terms/terms.ts` bez nalaza (`docs/PRODUCT.md` §5).
