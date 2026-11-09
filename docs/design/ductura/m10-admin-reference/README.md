# Referentne slike M10, administrator fakulteta: A-05, A-06, A-08 (paket 16, DAN-604)

Paket 16 iz `docs/design/EKRANI.md` (redak paketa za M10). Ekrani su A-05 Čuvanje i pravno zadržavanje, A-06 Revizijski trag pristupa i A-08 Izlaz iz usluge. Smjer je „papir i grafit” (D-188, `docs/design/DESIGN-SYSTEM.md`). Spajanje PR-a vlasnikovom porukom „Spoji n” znači odobrenje slika kao reference (D-183). Dotad su prijedlog. Paket 15 (S-42, S-44) je u `../m10-student-reference`.

Nijedan od tri ekrana nema prototip. Složeni su po svom retku u `docs/design/EKRANI.md` od dijelova `../m5-reference` i `../m5-reference-c`:

- A-05, prototip NEMA, stanja popunjeno, pravno zadržavanje, prazno, učitavanje, greška i mobitel;
- A-06, prototip NEMA, stanja popunjeno, prazno, učitavanje, greška i mobitel;
- A-08, prototip NEMA, stanja popunjeno, potvrda, prazno, učitavanje, greška i mobitel.

Oznake A-05, A-06 i A-08 ovdje su oznake ekrana iz `docs/design/EKRANI.md`. `docs/FEATURES.md` iste oznake koristi za druge stavke (EU modeli u katalogu, ključ fakulteta za AI, dnevni vremenski žig); to nisu ovi ekrani.

## Stranice

| Stranica | Stanja | Izvori |
|---|---|---|
| `a05-cuvanje-zadrzavanje.html` | popunjeno, pravno zadržavanje, prazno, učitavanje, greška | D-275 MQ13, D-30, D-273 MQ08, D-274 MQ11, `docs/privacy/07` |
| `a06-revizijski-trag.html` | popunjeno, prazno, učitavanje, greška | PRODUCT §6, D-274 MQ10 |
| `a08-izlaz-iz-usluge.html` | popunjeno, potvrda, prazno, učitavanje, greška | D-274 MQ12, D-262 Q06 |

Mobitel je snimka širine 400 px.

Snimke su u `snimke/<stranica>-<tamna|svijetla>-<1440|400>.png`:

- `a05-tamna-1440.png`, `a05-tamna-400.png`, `a05-svijetla-1440.png`, `a05-svijetla-400.png`
- `a06-tamna-1440.png`, `a06-tamna-400.png`, `a06-svijetla-1440.png`, `a06-svijetla-400.png`
- `a08-tamna-1440.png`, `a08-tamna-400.png`, `a08-svijetla-1440.png`, `a08-svijetla-400.png`

Izrađene su Playwrightovim Chromiumom: cijela stranica, DPR 1, nakon `document.fonts.ready`, bez vodoravnog pomicanja na obje širine. Svijetla ljuska je `data-theme="light"` na `<html>`. Kontrolni zbrojevi su u `SHA256SUMS`. `reference.css` uvozi `../m5-reference-c/reference.css` i dodaje samo dva stupca, podnaslov, redak traga, filtre i korake izlaza.

## Odluke u slici

- **Čuvanje i pravno zadržavanje (A-05).**
  - Rokovi čuvanja samo se prikazuju. Ustanova ih u sučelju ne uređuje; verziju pravila upisuje održavatelj Ducture nakon potvrde fakulteta (D-275 MQ13).
  - Nijedan rok nije odobren (D-30 PRIJEDLOG, `docs/privacy/07`). Slika zato pokazuje „Verzija pravila čuvanja: nije upisana”. Klase s prijedlogom nose oznaku „čeka potvrdu fakulteta”, a samo rokovi zapisani odlukom (sesije 30 dana, izvozni paket 24 sata, D-273 MQ08) nose „zapisano odlukom”.
  - Zadržavanje postavlja administrator fakulteta s brojem slučaja; pravni opis se ne upisuje. Skida ga drugi administrator ili održavatelj Ducture, ne onaj koji ga je postavio. Više zadržavanja vrijedi neovisno (D-274 MQ11). Dok vrijedi, brisanje po roku čuvanja stoji (`docs/PROGRAM-RAZRADA.md`).
  - **Tumačenje:** zadržavanje je u slici vezano uz jedan rad. Ako je opseg drugačiji (osoba, kolegij), stanje se precrtava.
- **Revizijski trag pristupa (A-06).**
  - Administrator vidi tko je i kada otvorio koji rad i što je otvoreno, bez sadržaja rada (PRODUCT §6). Nema zbroja posjeta ni trajanja.
  - **Otvoreno:** zrnatost vremena za administratorov pogled nije odlučena. D-274 MQ10 određuje 5 minuta za studentov dnevnik (S-42); slika ga samo posuđuje.
  - Pristup podrške sadržaju (Q-5, ADR još nije napisan) i događaji promjena ovlasti (klasa 26) nisu u ovoj slici.
- **Izlaz iz usluge (A-08).**
  - Izlaz pokreće održavatelj Ducture na pisani zahtjev ustanove (D-274 MQ12, konzola D-262 Q06). Paket s manifestom predaje se imenovanom primatelju i ne pokreće brisanje. Na stranici nema gumba koji pokreće izlaz.
  - Puni posao izlaza dolazi nakon pilota; izlazna odredba ugovora o obradi (D-264 Q13) je otvorena.
  - **Tumačenje:** stanje „potvrda” iz `docs/design/EKRANI.md` slika čita kao zapis o predaji paketa (svi koraci gotovi, primatelj, otisak manifesta, „Podaci u Ducturi nisu obrisani.”). Ako je mišljena potvrda nečega drugog, stanje se precrtava.
  - Koraci se razlikuju riječju i oblikom oznake: puna točka (gotovo), debeli prsten i podebljan tekst (sada), tanki krug (slijedi).

## Granice

- Ikone nisu dio slike; gumbi nose tekst.
- Oznake u velikim slovima („Stanje 1 · …”) i sitne bilješke ispod okvira opisuju referencu i nisu tekst sučelja. Brojevi odluka stoje samo u bilješkama.
- Tipkovnički redoslijed (EQ6) je bilješka na dnu svake stranice.
- Svi su podaci izmišljeni (Administrator A, Administrator F, Nastavnik B, Nastavnik C, Student A, Student D, Osoba E, brojevi slučaja i zahtjeva, naslovi radova, vremena, otisak manifesta).

## Provjera rječnika

Tekst sve tri stranice i ovog README-a, uključujući atribute `aria-label`, `title`, `alt`, `placeholder` i `value`, prošao je `findForbiddenTermsInMarkup` i `findForbiddenTerms` iz `scripts/forbidden-terms/terms.ts` bez nalaza (`docs/PRODUCT.md` §5).
