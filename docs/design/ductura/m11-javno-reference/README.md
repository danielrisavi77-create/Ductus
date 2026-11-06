# Referentne slike M11, javne stranice: J-01, J-02, J-05 (paket 17, DAN-584)

Paket 17 iz `docs/design/EKRANI.md` (redak paketa za M11). Ekrani su J-01 Naslovnica, J-02 Kako Ductura radi i J-05 Stanje sustava i izjava o pristupačnosti. Smjer je „papir i grafit” (D-188, `docs/design/DESIGN-SYSTEM.md`). Spajanje PR-a vlasnikovom porukom „Spoji n” znači odobrenje slika kao reference (D-183). Dotad su prijedlog.

Raspored J-01 preuzet je iz `../prijava-v5.dc.html` (ime, rečenica o proizvodu, prijava, uzorak lista), a J-02 iz `../kako-radi.dc.html` (odjeljci jedan ispod drugog, tablica ovlasti). Oba su prebojana prema EQ1 (#87 c.6645288294); boje prototipa nisu preuzete. J-05 nema prototip (u `docs/design/EKRANI.md` redak J-05 „Statusna stranica i izjava o pristupačnosti”, prototip NEMA, paket 17, stanja popunjeno, prazno, učitavanje, greška, mobitel i incident). Složen je po tom retku od dijelova `../m5-reference` i `../m5-reference-c` (panel, bilješka, kostur učitavanja, gumbi).

Ostali ekrani M11 (A-07, A-09, Z-09, Z-10, Z-12) su paket 18 i dolaze u zasebnom PR-u nakon spajanja ovoga.

## Stranice

| Stranica | Stanja | Izvori |
|---|---|---|
| `j01-naslovnica.html` | odjavljen, prijavljen, prazno (nema obavijesti), učitavanje, greška (prijava ne radi) | D-09, D-142, EQ10, PRODUCT §5 pravila 4 i 5, `../prijava-v5.dc.html` |
| `j02-kako-radi.html` | popunjeno, prazno (fakultet nije objavio pravila), učitavanje, greška | D-142, D-143, PRODUCT §5, `../kako-radi.dc.html` |
| `j05-status-pristupacnost.html` | popunjeno, incident u tijeku, incident riješen, prazno, učitavanje, greška, izjava o pristupačnosti | D-277 NQ10, D-276, D-248 |

Mobitel je snimka širine 400 px.

Snimke su u `snimke/<stranica>-<tamna|svijetla>-<1440|400>.png`:

- `j01-tamna-1440.png`, `j01-tamna-400.png`, `j01-svijetla-1440.png`, `j01-svijetla-400.png`
- `j02-tamna-1440.png`, `j02-tamna-400.png`, `j02-svijetla-1440.png`, `j02-svijetla-400.png`
- `j05-tamna-1440.png`, `j05-tamna-400.png`, `j05-svijetla-1440.png`, `j05-svijetla-400.png`

Izrađene su Playwrightovim Chromiumom: cijela stranica, DPR 1, nakon `document.fonts.ready`, bez vodoravnog pomicanja na obje širine. Svijetla ljuska je `data-theme="light"` na `<html>`. Kontrolni zbrojevi su u `SHA256SUMS`. `reference.css` uvozi `../m5-reference-c/reference.css` i dodaje samo zaglavlje javne stranice, tablicu ovlasti, popis dijelova sustava, incident s vremenskom crtom i oznaku otvorenog dijela.

## Odluke u slici

- **Naslovnica (J-01).**
  - Prijava je samo sustavom AAI@EduHr (D-09). Nema polja za e-poštu ni lozinku; rečenica uz gumb kaže da lozinku vidi samo AAI@EduHr.
  - Rečenice uz prijavu kažu da mentor i nastavnik zadatka vide rad uživo (D-142) i da student vidi sve što vide oni (PRODUCT §5 pravila 4 i 5).
  - Zadana tema je tamna; svijetla je ista stranica sa svijetlom ljuskom (EQ10). Gumb teme je preklopnik s `aria-pressed` i istim natpisom u obje teme.
  - Nijedan drugi način prijave nije nacrtan, ni kao primjer; prijava kodom zadatka ili e-poštom iz prototipa nije preuzeta (D-09).
  - U stanju greške gumb za prijavu ostaje na istom mjestu i neaktivan, a poveznica vodi na J-05.
- **Kako Ductura radi (J-02).**
  - Odjeljci kažu što se bilježi, što se ne bilježi i tko što vidi. Tipke, brzina, stanke i ritam se ne bilježe; nema ocjene o tome tko je napisao tekst.
  - Prikaz nastanka slovo po slovo označen je kao uvjetan, uz pravno mišljenje prije pilota (D-143).
  - Provjera predanog rada kaže samo da zapis nije mijenjan nakon predaje i izričito ne dokazuje tko je tekst napisao.
  - Pružatelj i lokacija poslužitelja su otvoreni dok se ne odaberu (P-01 do P-04); slika ne navodi zemlju ni pružatelja.
  - Odjeljak prototipa o istrazi nije preuzet.
  - Pravila fakulteta su postavka fakulteta; primjer na slici je izmišljen. Prazno, učitavanje i greška odnose se samo na taj odjeljak, a ostatak stranice uvijek vrijedi.
- **Stanje sustava i pristupačnost (J-05).**
  - Stanje prikazuje samo rezultate provjera koje Ductura sama izvodi (D-277 NQ10). Prijava sustavom AAI@EduHr navedena je kao dio koji pruža Srce.
  - Stanje dijela razlikuje se riječju i oblikom oznake (puna točka ili prsten), ne samo bojom.
  - Greška pri učitavanju kaže da nedostupni rezultati ne znače da sustav ne radi.
  - Izjava slijedi cilj WCAG 2.2 AA i EN 301 549 (D-248, D-276). Ocjena usklađenosti, opis obrasca AAI@EduHr, način provjere i mjerodavni propis s tijelom za praćenje označeni su kao otvoreni. Rok odgovora je također otvoren: dok je mjerodavni propis otvoren (`docs/PRISTUPACNOST.md`, P-06), slika ne imenuje ni propis ni rok. „[e-pošta podrške]” je mjesto za adresu koja još nije određena.

## Granice

- Ikone nisu dio slike; gumbi nose tekst.
- Oznake u velikim slovima („Stanje 1 · …”) i sitne bilješke ispod okvira opisuju referencu i nisu tekst sučelja. Brojevi odluka stoje samo u bilješkama.
- Tipkovnički redoslijed (EQ6) je bilješka na dnu svake stranice.
- Svi su podaci izmišljeni (Student A, uzorak lista, vremena incidenta).

## Provjera rječnika

Tekst svih triju stranica i ovog README-a, uključujući atribute `aria-label`, `title`, `alt`, `placeholder` i `value`, prošao je `findForbiddenTermsInMarkup` i `findForbiddenTerms` iz `scripts/forbidden-terms/terms.ts` bez nalaza (`docs/PRODUCT.md` §5).
