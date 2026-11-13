# Referentne slike M8: N-18 i Povijest dokumenta (paket 12b, DAN-603)

Ovaj paket nastavlja paket 12 iz `docs/design/EKRANI.md` (redak paketa za M8). Sadrži N-18, izvoz predanog rada i paket za Merlin, te Povijest dokumenta (M8.13) s dijalogom pristupa oblaku (M8.11). Smjer je „papir i grafit” (D-188, `docs/design/DESIGN-SYSTEM.md`). Spajanje PR-a vlasnikovom porukom „Spoji n” znači odobrenje slika kao reference (D-183). Dotad su prijedlog.

S-19, PDF izvor i S-20 su u paketu 12, `../m8-reference`.

Status prototipa:

- N-18 u `docs/design/EKRANI.md` ima prototip NEMA.
- Povijest dokumenta i dijalog pristupa oblaku nemaju redak u `docs/design/EKRANI.md` (#1795), pa nemaju ni prototip.

Ekrani su složeni od dijelova `../m5-reference` i `../m5-reference-c`.

## Stranice

| Stranica | Stanja | Izvori |
|---|---|---|
| `n18-predani-rad.html` | popunjeno (mentor, paket za Merlin), popunjeno (student, moja predaja), učitavanje (priprema paketa), paket spreman, poveznica istekla, prazno, greška | M8, D-173, D-273, D-285, D-286, D-80 t. 2, #1799, #1800 |
| `povijest-dokumenta.html` | popunjeno (uvezene datoteke), popunjeno (verzije iz oblaka), dijalog pristupa, pružatelj bez dozvole za jednu datoteku, prazno, greška, učitavanje | M8.11, M8.13, D-198 t. 1, 5 i 6, D-281, D-283, D-24, #1795 |

Mobitel je snimka širine 400 px.

Snimke su u `snimke/<stranica>-<tamna|svijetla>-<1440|400>.png`:

- `n18-tamna-1440.png`, `n18-tamna-400.png`, `n18-svijetla-1440.png`, `n18-svijetla-400.png`
- `povijest-tamna-1440.png`, `povijest-tamna-400.png`, `povijest-svijetla-1440.png`, `povijest-svijetla-400.png`

Izrađene su Playwrightovim Chromiumom: cijela stranica, DPR 1, nakon `document.fonts.ready`, bez vodoravnog pomicanja stranice na obje širine. Svijetla ljuska je `data-theme="light"` na `<html>`. Kontrolni zbrojevi su u `SHA256SUMS`. `reference.css` uvozi `../m5-reference-c/reference.css` i dodaje samo dva stupca, oznaku otvorenog ulaza, tablicu i otisak.

## Odluke u slici

- **N-18, izvoz predanog rada.**
  - Mentorov paket za Merlin ima rečenicu iz #1800. Tablica (CSV) ima samo stupce iz D-286: prezime, ime, predano, vrijeme predaje na minutu, nakon roka (uz odobreno produljenje) i naziv datoteke u zipu. Ništa iz sažetka procesa.
  - Retci su poredani po prezimenu (D-80 t. 2). Stanje predaje nema boju.
  - Student vidi svoj redak s istim stupcima (D-286).
  - „Predana datoteka” i „Novi izvoz” su odvojeni, s rečenicama iz #1799. Bajtovi predane datoteke se čuvaju, pa njezin otisak uvijek odgovara potvrdi (D-285).
  - Studentov paket sadrži PDF teksta, potpisanu potvrdu predaje i popis otisaka (D-173).
  - Poveznica vrijedi 24 sata. Nakon toga briše se samo novi izvoz, a predani rad ostaje (D-173, D-273, D-285). Tekstovi poveznice i istekle poveznice su iz #1800.
- **Povijest dokumenta.**
  - Naslov, podnaslov, redak verzije, rečenica o drugim verzijama, rečenica o usporedbi i tekst dijaloga pristupa su iz #1795.
  - Prikaz je samo popis s oznakom „uvezeno, tvrdnja iz datoteke”, bez vremenske crte pisanja. Student i mentor vide isti prikaz (D-198 t. 6).
  - Po verziji iz oblaka stoje samo vrijeme na minutu i veličina, nikad osoba koja je verziju napravila (D-198 t. 5, D-24).
  - Rečenica „Ductura ne zna jesu li postojale i druge” stoji uvijek kad je izvor oblak (D-198 t. 1).
  - Praćene promjene iz uvezene datoteke prikazane su kao broj po vrsti, istim tekstom kao u S-19, bez boje (D-281).
  - „Ukloni pristup” je na istom ekranu kao popis verzija iz oblaka.
  - Kad pružatelj nema dozvolu za jednu datoteku, povezivanje se ne nudi i jedna rečenica kaže zašto (D-283).

## Tumačenje i otvoreni ulazi

Ulazi koji nisu odlučeni stoje u slici kao `{…}, otvoreno` s isprekidanim rubom. Ne izmišljam ih:

- oblik naziva datoteke u zipu (D-286 daje stupac, ne oblik naziva);
- naziv pružatelja u rečenici za D-283 (`{pružatelj}`). Rečenicu D-283 ne daje; ova je prijedlog;
- tehnički kod u „Pojedinosti za podršku”.

Tumačenja koja nisu doslovno odlučena:

- „Manifest s otiscima” iz D-173 u sučelju je „popis otisaka datoteka”.
- Tekstovi praznog stanja, učitavanja i greške su prijedlog.
- Vrijednosti stupaca „predano” i „nakon roka” („da”, „ne”) su prijedlog.

## Granice

- Ikone nisu dio slike; gumbi nose tekst.
- Oznake u velikim slovima („Stanje 1 · …”) i sitne bilješke ispod okvira opisuju referencu i nisu tekst sučelja. Brojevi odluka stoje samo u bilješkama.
- Tipkovnički redoslijed (EQ6) je bilješka na dnu svake stranice.
- Svi su podaci izmišljeni (Prezime A, Ime A, nazivi datoteka, vremena, veličine, otisak).

## Provjera rječnika

Tekst obiju stranica i ovog README-a, uključujući atribute `aria-label`, `title`, `alt`, `placeholder` i `value`, prošao je `findForbiddenTermsInMarkup` i `findForbiddenTerms` iz `scripts/forbidden-terms/terms.ts` bez nalaza (`docs/PRODUCT.md` §5).
