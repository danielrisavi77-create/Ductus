# Referentne slike M7, paket 6 (A): S-30, S-31, S-32 (DAN-600)

Ovo je prvi dio paketa 6 iz `docs/design/EKRANI.md` §4 (Predaja, student). Sadrži ekrane S-30 Pregled prije predaje, S-31 Izjava i S-32 Potvrda predaje. S-15 i S-33 iz istog paketa dolaze u zasebnom PR-u u istu mapu.

Smjer je „papir i grafit” (D-188, `docs/design/DESIGN-SYSTEM.md`). Spajanje PR-a vlasnikovom porukom „Spoji n” znači da su slike odobrene kao referenca (D-183). Dotad su prijedlog.

Ulaz je M7 UX prolaz, issuei #1779 do #1790. Stari prototip `../demo-tok-v2.dc.html` ima korake predaje, ali nije odobrena referenca (DESIGN-SYSTEM §1 t. 4). Iz njega nisu preuzeti ni raspored ni boje.

Stranice su složene iz dijelova `../m5-reference` i `../m7-reference-c`: koraci, kartica, oznaka, dijalog i kostur učitavanja.

## Stranice

| Stranica | Prototip | Stanja | Izvori |
|---|---|---|---|
| `s30-pregled-prije-predaje.html` | `../demo-tok-v2.dc.html` (stari, nije preslikan) | korak 3 prije predaje (popis), korak 4 prije roka, nakon roka, produljen rok, bez mreže, prazno (rad nije započet), odbijeno (zapis nije potvrđen), predaja nije dovršena, već zatraženo i ishod nepoznat, učitavanje, greška | #1779, #1780, #1782, #1784, #1787, D-128, D-129, D-137, Q07, Q-3, PRODUCT §5 pravila 3 i 5 |
| `s31-izjava.html` | `../demo-tok-v2.dc.html` (stari, nije preslikan) | popunjeno, izjava i zapis se ne slažu, pregled priloženog razgovora, prazno (ništa zabilježeno), učitavanje, greška | #1783, D-40, D-44, D-62, D-263 Q22, PRODUCT §5 pravilo 5 |
| `s32-potvrda-predaje.html` | `../demo-tok-v2.dc.html` (stari, nije preslikan) | popunjeno i potpisano, potvrda čeka potpis, nakon roka, zapis ima praznine, prazno (rad nije predan), učitavanje, greška | #1781, #1782, D-49, D-128, Q07, `docs/contracts/submission-receipt-v2.md` |

Mobitel je snimka širine 400 px. Snimke su u `snimke/<stranica>-<tamna|svijetla>-<1440|400>.png`. Izrađene su Playwrightovim Chromiumom:

- cijela stranica, DPR 1, nakon `document.fonts.ready`;
- bez vodoravnog pomicanja na obje širine.

Svijetla ljuska je `data-theme="light"` na `<html>`. Kontrolni zbrojevi su u `SHA256SUMS`. `reference.css` uvozi `../m7-reference-c/reference.css` (a time i `../m5-reference/reference.css`) i dodaje samo:

- niz koraka;
- blok stanja;
- mono redak otiska;
- okvir izjave;
- širinu padajućeg izbornika.

## Odluke u slici

### Pregled prije predaje (S-30)

- Tok ima pet koraka (tekst, izjava, prije predaje, predaja, potvrda), a pregled je korak 3. Popis kaže je li sve priloženo i ne ocjenjuje rad. Retci popisa:
  - izjava;
  - razgovori;
  - mjesta za izvor;
  - zalijepljeni odlomci;
  - pravila oblika.
- „Mjesto za izvor” i „Zalijepljeno (izvor nije opažen)” su dva različita retka (D-137). Uz zalijepljeno stoji „Možete dodati oznaku podrijetla. Nije obavezno.”
- Do potvrde D-129 nijedan redak popisa ne zaustavlja predaju. Nema ocjene ni oznake „prolazi” (D-62).
- Napomena uz predaju nije obavezna i vodi na S-43.
- Nakon roka predaja izgleda jednako kao prije roka: isti tekst, rub i boja, bez crvene (D-128). „Nakon roka” ovisi samo o vremenu zahtjeva i o roku zamrznutom pri zahtjevu (Q07).
- Produljen rok se prikazuje kao oznaka uz rok.
- Bez mreže se predaja ne nudi. Tekst je spremljen na uređaju, a gumb „Predaj rad” je onemogućen s objašnjenjem. Vrijeme predaje je trenutak kad zahtjev stigne na poslužitelj (`requestedAt`), ne trenutak klika. To piše i u koracima 4 prije i nakon roka.
- Odbijanja poslužitelja imaju zaseban tekst:
  - nije započet (`notStarted`);
  - zapis nije potvrđen (`blocked`);
  - predaja nije dovršena (`recordMismatch`);
  - već zatraženo (`alreadyRequested`);
  - ishod nepoznat (`unavailable`).
- Svako odbijanje kaže što student sada radi (#1780) i ne govori o studentu (pravilo 3).
- `recordMismatch` vodi na zamjenski postupak. Kontakt je „Obratite se nastavniku kolegija”.
- Greška učitavanja ne tvrdi da predaja postoji ili ne postoji. Traži ponovni pokušaj prije nove predaje.

### Izjava (S-31)

- Naslov je „Izjava o korištenju generativne umjetne inteligencije”, uz uputu na čl. 9 i 15 pravilnika fakulteta (#1783).
- Zabilježeno i izjavljeno su odvojeni (D-40, D-44):
  - okvir „Zabilježeno u Ducturi” ima puni rub, a student ga ne može brisati, samo dodati objašnjenje;
  - okvir „Vaša izjava” ima isprekidani rub i oznaku „izjavljeno”.
- Uz svaki priloženi razgovor je „Pregledaj razgovor”. Dijalog prikazuje cijeli razgovor točno kako je zabilježen, prije potvrde (D-263 Q22).
- Razgovor iz kojeg je prenesen tekst nosi oznaku „Obvezno”.
- Potvrda izjave nije unaprijed označena.
- Kad se odabrani obrazac izjave i zapis ne slažu, slika to kaže činjenicom o zapisu („Zapis bilježi prijenos iz AI pomoćnika na …”) i traži provjeru odabira. Nema ocjene ni zaustavljanja. Nastavnik vidi isto (pravilo 5).
- Model u zapisu je izmišljena oznaka „M-2”.

### Potvrda predaje (S-32)

- Prikazana su polja potvrde v2:
  - vrijeme predaje iz `requestedAt`;
  - rok iz `dueAt`;
  - „nakon roka” iz `afterDeadline`;
  - „Potpisivanje potvrde započelo” iz `signedAt`. Prema ugovoru v2 to je početak izdavanja potpisa, ne trenutak dovršetka. Slika ga ne predstavlja kao vremenski žig treće strane.
- Vremena su po zagrebačkom vremenu s oznakom zone u istom retku, „(UTC+1)”, ljeti „(UTC+2)” (prijedlog iz #1788). Točne vrijednosti iz potvrde u UTC-u su u pojedinostima, neskraćene, sa šest decimala sekunde kako ih zapisuje ugovor v2.
- „Otisak predanog teksta” ima 64 heksadekadske znamenke u skupinama radi čitanja, uz objašnjenje.
  - „Kopiraj otisak” u međuspremnik stavlja 64 znaka bez razmaka.
  - Poveznica „Provjera potvrde” vodi na `/provjera` (J-03, D-49), bez prijave.
- Dok potvrda čeka potpis, stanje je „Predaja u obradi” (#1781, #1782). Preuzimanje zapisa i provjera nude se tek s potpisom.
- Predaja nakon roka je činjenica bez boje (D-128). Kasniji potpis ne mijenja „nakon roka” (Q07).
- Praznina u zapisu ne mijenja predaju ni vrijeme predaje. Vodi na sažetak procesa.
- Greška učitavanja ne tvrdi da predaja postoji ili ne postoji.

## Otvoreno za vlasnika

Slika ova pitanja označava kao otvorena i ne odlučuje ih:

- **Gdje popis živi (#1787).** Popis je ovdje nacrtan kao korak 3 toka predaje. Mjesto određuje orkestrator ili vlasnik.
- **Zaustavlja li išta predaju (D-129).** Dok FPZG to ne potvrdi, ništa ne zaustavlja.
- **Kontakt zamjenskog postupka (Q-3).** To je parametar fakulteta. Do odgovora FPZG-a tekst je „Obratite se nastavniku kolegija”.
- **Nazivi stanja (#1782).** „Predaja nije dovršena: zamjenski postupak” i „Predaja u obradi” preuzeti su iz prijedloga u #1782, koji još nije potvrđen.
- **Zona vremena (#1788).** S-32 prikazuje zagrebačko vrijeme s oznakom zone. J-03 u `../m7-reference-c` prikazuje UTC. Usklađivanje J-03 je otvoreno.
- **Naslov izjave.** #1783 predlaže „Izjava o korištenju generativne umjetne inteligencije”. `../m9-reference-b/s31-ai.html` koristi „Izjava o uporabi AI u predaji”. Usklađivanje je otvoreno.

## Nije nacrtano

- S-15 i S-33 dolaze u zasebnom PR-u ovog paketa.
- Ekrani paketa 7 (N-05, N-10, N-11, N-13) idu u `../m7-reference-b`.
- Panel napomena S-43 je u `../m7-reference-c`. Ovdje je samo poveznica na njega.
- Cijeli AI dio izjave (sastavljanje iz zapisa pomoćnika) je u `../m9-reference-b`.
- Sadržaj PDF zapisa i QR koda nije nacrtan, kao ni nastavnički prikaz predaje.

## Granice

- Ikone nisu dio slike; gumbi nose tekst.
- Oznake u velikim slovima („Stanje 1 · …”) i sitne bilješke ispod okvira opisuju referencu i nisu tekst sučelja.
- Tipkovnički redoslijed (EQ6) je bilješka na dnu svake stranice.
- Svi su podaci izmišljeni: autor, rad, datumi, otisak i oznaka modela.
- Datumi 20. 11. i 27. 11. 2026. su primjer, ne stvarni rokovi.

## Provjera rječnika

Tekst i atributi svih triju stranica i tekst ovog README-a prošli su provjeru bez nalaza (`docs/PRODUCT.md` §5). Korištene su `findForbiddenTermsInMarkup` i `findForbiddenTerms` iz `scripts/forbidden-terms/terms.ts`. Kontrolni prolaz s umetnutim zabranjenim izrazom javio je nalaz.
