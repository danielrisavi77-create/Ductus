# Referentne slike M8, uvoz i izvoz: S-19, S-09, S-20 (paket 12, DAN-603)

Paket 12 iz `docs/design/EKRANI.md` (redak paketa za M8). Ovdje su S-19 Uvoz teksta, S-09 PDF izvor u bilježnici i S-20 Izvoz (A4 pregled). Smjer je „papir i grafit” (D-188, `docs/design/DESIGN-SYSTEM.md`). Spajanje PR-a vlasnikovom porukom „Spoji n” znači odobrenje slika kao reference (D-183). Dotad su prijedlog.

N-18 (izvoz predanog rada i paket za Merlin) i Povijest dokumenta (M8.13) su u paketu 12b, `../m8-reference-b`. Paket je podijeljen da svaki PR ostane malen, kao paketi 15 i 16 (DAN-604).

Status prototipa po retku u `docs/design/EKRANI.md`:

- S-19, prototip DJELOMIČNO. `editor-v11.dc.html` ima uvoz, ali nema korak „Pregled uvoza”.
- S-20, prototip DJELOMIČNO. `editor-v11.dc.html` ima „Pregled ispisa, A4 po FPZG-u”, ali nema izbornik „Preuzmi” ni stanja izvoza.
- S-09, prototip NEMA.

Prototip nije odobrena referenca (DESIGN-SYSTEM §1 t. 4). Ekrani su složeni od dijelova `../m5-reference` i `../m5-reference-c`.

## Stranice

| Stranica | Stanja | Izvori |
|---|---|---|
| `s19-uvoz.html` | prazno (odabir datoteke), učitavanje, popunjeno (pregled uvoza), djelomičan uvoz, nepodržan format, greška čitanja, zadatak ne dopušta uvoz | M8.2, #1792, #1794, D-281, D-282, D-198 t. 5 |
| `s09-pdf-izvor.html` | prazno, učitavanje, popunjeno (isticanje i navod), citat pronađen, citat nije pronađen, PDF bez sloja teksta, greška | M8.7, #1801, D-287, D-128 |
| `s20-izvoz.html` | popunjeno (A4 pregled i Preuzmi), prazno, tekst promijenjen u drugoj kartici, napomene o obliku, priprema datoteke, PDF/A provjereno, PDF/A nije dostupan, greška | M8.4, M8.5, #1796, #1797, #1798, D-284, D-222, D-203 t. 2 |

Mobitel je snimka širine 400 px.

Snimke su u `snimke/<stranica>-<tamna|svijetla>-<1440|400>.png`:

- `s19-tamna-1440.png`, `s19-tamna-400.png`, `s19-svijetla-1440.png`, `s19-svijetla-400.png`
- `s09-tamna-1440.png`, `s09-tamna-400.png`, `s09-svijetla-1440.png`, `s09-svijetla-400.png`
- `s20-tamna-1440.png`, `s20-tamna-400.png`, `s20-svijetla-1440.png`, `s20-svijetla-400.png`

Izrađene su Playwrightovim Chromiumom: cijela stranica, DPR 1, nakon `document.fonts.ready`, bez vodoravnog pomicanja na obje širine. Svijetla ljuska je `data-theme="light"` na `<html>`. Kontrolni zbrojevi su u `SHA256SUMS`. `reference.css` uvozi `../m5-reference-c/reference.css` i dodaje samo dva stupca, list A4, oznaku otvorenog ulaza, odabir mjesta umetanja i onemogućenu stavku izbornika.

## Odluke u slici

- **Uvoz teksta (S-19).**
  - Uvoz je samo iz datoteke, a dijalog se obraća studentu s „Vi” i kaže da mentor vidi naziv datoteke (D-282). Uvodna rečenica dijaloga je iz #1794 i ponavlja `docs/PRODUCT.md`: zapisuju se naziv, vrsta i veličina datoteke te vrijeme uvoza na minutu.
  - „Pregled uvoza” je obvezan korak prije nego što tekst uđe u rad. Popis „Neće se prenijeti” pojavljuje se samo za ono čega u datoteci ima.
  - Praćene promjene uvoze se kao prihvaćene. Student i mentor vide isti tekst: broj promjena po vrsti, bez imena, datuma i obrisanog teksta (D-281, D-198 t. 5).
  - Poruke greške su iz #1792. Tehnički kod je samo u „Pojedinosti za podršku” i nikad nije jedina poruka.
  - Uvezeni tekst ostaje zabilježen kao uvoz i ako ga student kasnije obriše ili promijeni (rečenica iz #1794).
  - Kad zadatak isključi uvoz, stavka „Uvezi tekst iz datoteke” ostaje vidljiva, ali je onemogućena i navodi razlog (D-282).
- **PDF izvor u bilježnici (S-09).**
  - PDF se učitava uz izvor u bilježnici izvora. Student ističe tekst i umeće navod sa stranicom.
  - „A-03 Provjera doslovnog citata” je usporedba teksta, ne AI analiza. Rezultat vidi samo student i ne ulazi u sažetak, izvoz ni predaju (D-287).
  - Oznake „pronađen” i „nije pronađen” su neutralne, bez boje upozorenja (D-128). Tekst „nije pronađen” je iz #1801 i navodi uobičajene uzroke.
  - Kod PDF-a bez sloja teksta provjera nije moguća, a navod sa stranicom se i dalje može umetnuti.
- **Izvoz (S-20).**
  - List je papir u obje ljuske (D-188). Naslovnica pokazuje samo podatke studija, nikad podatke iz zapisa procesa (PRODUCT §5 pravilo 2).
  - Izvoz radi i kad provjera oblika nije uključena (D-203 t. 2). Napomene o obliku nikad ne sprječavaju izvoz ni predaju (D-222).
  - Oznaka „PDF/A” pojavljuje se tek kad veraPDF provjera prođe. Inače je stavka obični PDF s rečenicom „Ova datoteka nije u obliku PDF/A”, a .docx ostaje ponuđen (D-284).
  - Pregled i datoteka nose vrijeme stanja rada. Kad se tekst promijeni u drugoj kartici, pregled to kaže i nudi osvježavanje; mehanizam pripada M8.4 i M8.5.
  - Greška kaže da tekst rada nije promijenjen i nudi tekst kao .txt.

## Tumačenje i otvoreni ulazi

- **„PDF izvor” je S-09.** Ugovor na #1836 (c.6860076905) tumačio je „PDF izvor” kao M8.3 (uvoz PDF-a). Redak paketa 12 u `docs/design/EKRANI.md` navodi S-09, a D-287 se odnosi na A-03 u S-09, pa je nacrtan S-09. Poruka M8.3 za PDF bez teksta je redak u stanju 6 S-19.
- Ulazi koji nisu odlučeni stoje u slici kao `{…}, otvoreno` s isprekidanim rubom. Ne izmišljam ih:
  - granice veličine datoteke i broja stranica PDF-a (D-291);
  - opis oblika iz profila fakulteta (Lekta, Q-11);
  - kome se student javlja kad su podaci naslovnice netočni (#1797).
- Traži li FPZG PDF/A, pitanje je u paketu Q-3; dodatna rečenica za taj slučaj nije nacrtana.
- Nazivi stavki „Preuzmi” su prijedlog iz #1796, ne vlasnička odluka.
- Kod naziva uvezene datoteke odlučena je samo vidljivost (D-292). Gdje se naziv čuva, otvoreno je do ugovora M8.0-S1, pa slika o tome ništa ne kaže.

## Granice

- Ikone nisu dio slike; gumbi nose tekst.
- Oznake u velikim slovima („Stanje 1 · …”) i sitne bilješke ispod okvira opisuju referencu i nisu tekst sučelja. Brojevi odluka stoje samo u bilješkama.
- Tipkovnički redoslijed (EQ6) je bilješka na dnu svake stranice.
- Svi su podaci izmišljeni (Student A, Nastavnik B, Horvat, A. (2019), Kovač, B. (2020), naslov rada, nazivi datoteka, vremena, brojevi).

## Provjera rječnika

Tekst sve tri stranice i ovog README-a, uključujući atribute `aria-label`, `title`, `alt`, `placeholder` i `value`, prošao je `findForbiddenTermsInMarkup` i `findForbiddenTerms` iz `scripts/forbidden-terms/terms.ts` bez nalaza (`docs/PRODUCT.md` §5).
