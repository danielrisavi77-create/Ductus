# Referentne slike M11, postavke i podrška: A-07, A-09, Z-09, Z-10, Z-12 (paket 18, DAN-584)

Paket 18 iz `docs/design/EKRANI.md` (redak paketa za M11). Ekrani su A-07 Integracije i stanje AAI@EduHr, A-09 Zdravlje sustava i sigurnosne kopije, Z-09 Postavke, Z-10 Prijavi problem i Z-12 Mobilni prikaz. Smjer je „papir i grafit” (D-188, `docs/design/DESIGN-SYSTEM.md`). Spajanje PR-a vlasnikovom porukom „Spoji n” znači odobrenje slika kao reference (D-183). Dotad su prijedlog. Paket 17 (J-01, J-02, J-05) je u `../m11-javno-reference`.

Samo Z-09 ima djelomičan prototip. Raspored postavki obavijesti preuzet je iz izbornika obavijesti u `../pocetna.dc.html` (stupci „U aplikaciji” i „E-pošta”, četiri događaja, rečenica o podsjetnicima) i prebojan prema EQ1 (#87 c.6645288294); boje prototipa nisu preuzete. Ekrani bez prototipa složeni su po svom retku u `docs/design/EKRANI.md` od dijelova `../m5-reference` i `../m5-reference-c`:

- A-07, prototip NEMA, stanja popunjeno, prazno, učitavanje, greška, mobitel i AAI nedostupan;
- A-09, prototip NEMA, stanja popunjeno, prazno, učitavanje, greška i mobitel;
- Z-10, prototip NEMA, stanja popunjeno, prazno, učitavanje, greška, mobitel i poslano;
- Z-12, prototip DJELOMIČNO (uski prikazi iz ranijih paketa), uska širina svih ekrana i dodir ≥ 44 px.

Oznake A-07 i A-09 ovdje su oznake ekrana iz `docs/design/EKRANI.md`. U `docs/FEATURES.md` iste oznake znače drugo (A-07 otvoreni verifikator zapisa, A-09 otvorena specifikacija formata); ove slike nisu te funkcije.

## Stranice

| Stranica | Stanja | Izvori |
|---|---|---|
| `a07-integracije.html` | popunjeno, AAI nedostupan, prazno, učitavanje, greška | D-09, D-200 P1, D-277 NQ10, Q-10, Q-11, DAN-438 |
| `a09-zdravlje-kopije.html` | popunjeno, prazno (proba povrata još nije izvedena), učitavanje, greška | D-277 NQ05 i NQ10, P-01 do P-04 |
| `z09-postavke.html` | popunjeno s temom i obavijestima, prazno (nema kolegija), učitavanje, greška | D-200 P1, D-70, D-247, D-181, PRODUCT §5 pravilo 4, `../pocetna.dc.html` |
| `z10-prijavi-problem.html` | popunjeno, poslano, prazno (nema prijava), učitavanje, greška | D-69, D-09 |
| `z12-mobilni-prikaz.html` | popis radova, rad s trakom spremanja, obrazac (okviri od 360 px) i pravila uske širine | EKRANI Z-12, D-248 |

Mobitel je snimka širine 400 px.

Snimke su u `snimke/<stranica>-<tamna|svijetla>-<1440|400>.png`:

- `a07-tamna-1440.png`, `a07-tamna-400.png`, `a07-svijetla-1440.png`, `a07-svijetla-400.png`
- `a09-tamna-1440.png`, `a09-tamna-400.png`, `a09-svijetla-1440.png`, `a09-svijetla-400.png`
- `z09-tamna-1440.png`, `z09-tamna-400.png`, `z09-svijetla-1440.png`, `z09-svijetla-400.png`
- `z10-tamna-1440.png`, `z10-tamna-400.png`, `z10-svijetla-1440.png`, `z10-svijetla-400.png`
- `z12-tamna-1440.png`, `z12-tamna-400.png`, `z12-svijetla-1440.png`, `z12-svijetla-400.png`

Izrađene su Playwrightovim Chromiumom: cijela stranica, DPR 1, nakon `document.fonts.ready`, bez vodoravnog pomicanja na obje širine. Svijetla ljuska je `data-theme="light"` na `<html>`. Kontrolni zbrojevi su u `SHA256SUMS`. `reference.css` uvozi `../m5-reference-c/reference.css` i dodaje samo dva stupca, oznaku stanja dijela, oznaku otvorene odluke, izbor jedne mogućnosti, mrežu postavki obavijesti, izbor u obrascu i okvir uske širine.

## Odluke u slici

- **Integracije (A-07).**
  - Prijava je samo sustavom AAI@EduHr, koji pruža Srce (D-09); slika kaže da drugog načina prijave nema.
  - Ductura prima ime i prezime, pripadnost ustanovi i adresu e-pošte; adresa služi samo za obavijesti, nikad za prijavu ni spajanje računa (D-200 P1).
  - Stanje je rezultat provjera koje Ductura sama izvodi (D-277 NQ10). Kad AAI@EduHr ne odgovara, slika kaže da prijavljeni korisnici nastavljaju raditi i da probleme s računom rješava AAI administrator fakulteta; nikoga ne imenuje.
  - Lekta (Q-11), uvoz iz Microsoft 365 (DAN-438) i AI pomoćnik (Q-10) označeni su kao otvorene odluke i nisu uključeni.
- **Zdravlje sustava i kopije (A-09).**
  - Prikazane su samo vlastite provjere: poslužitelj prima promjene, obrada u pozadini i provjera roka predaje (D-277 NQ10). Uzbune su samo iz tih provjera.
  - Proba povrata je postupak M11.2-P04 (D-277 NQ05); prazno stanje kaže da još nije izvedena.
  - Pružatelj i lokacija kopija su otvoreni (P-01 do P-04); slika ne navodi zemlju ni pružatelja.
- **Postavke (Z-09).**
  - Profil dolazi iz sustava AAI@EduHr i ne mijenja se u Ducturi; e-pošta služi samo za obavijesti (D-200 P1).
  - Tema i jezik su izbor jedne mogućnosti s `aria-pressed`; odabrana ima puni rub i riječ „(odabrano)”. Engleski dolazi s M11 (D-70); dotad je sučelje samo na hrvatskom (D-247).
  - Obavijesti su samo o komentarima, doradama i rokovima; nikad o tome koliko student piše (PRODUCT §5 pravilo 4). Rečenica iz prototipa prebačena je u oblik „Vi” (D-181).
- **Prijavi problem (Z-10).**
  - Uz opis se šalju samo stanje spremanja i verzija aplikacije; sadržaj rada se ne šalje (D-69).
  - Vrsta problema određuje tko odgovara: održavatelj Ducture, AAI administrator fakulteta ili koordinator pilota. Nitko nije imenovan i rok odgovora se ne obećava.
  - Kad slanje ne uspije, opis ostaje na uređaju dok ga korisnik ponovno ne pošalje.
- **Mobilni prikaz (Z-12).**
  - Polje dodira je najmanje 44 × 44 px (D-248); isprekidani obrub na slici to pokazuje i nije dio sučelja.
  - Tablica postaje popis okvira, glavna radnja je gumb pune širine, a traka spremanja je uvijek vidljiva.

## Granice

- Ikone nisu dio slike; gumbi nose tekst.
- Oznake u velikim slovima („Stanje 1 · …”) i sitne bilješke ispod okvira opisuju referencu i nisu tekst sučelja. Brojevi odluka stoje samo u bilješkama.
- Tipkovnički redoslijed (EQ6) je bilješka na dnu svake stranice.
- Svi su podaci izmišljeni (Student A, vremena provjera, broj prijave, verzija aplikacije, adresa na domeni `example.edu`).

## Provjera rječnika

Tekst svih pet stranica i ovog README-a, uključujući atribute `aria-label`, `title`, `alt`, `placeholder` i `value`, prošao je `findForbiddenTermsInMarkup` i `findForbiddenTerms` iz `scripts/forbidden-terms/terms.ts` bez nalaza (`docs/PRODUCT.md` §5).
