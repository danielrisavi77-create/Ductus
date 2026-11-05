# Referentne slike M5, dopuna C: S-06, S-07, S-13 (paket 5, DAN-568)

Paket 5 iz `docs/design/EKRANI.md` §4. Ekrani su S-06 Planer rada, S-07 Pravopis i S-13, za koji se dodaje uvoz zapisa. Smjer je „papir i grafit” (D-188, `docs/design/DESIGN-SYSTEM.md`). Spajanje PR-a vlasnikovom porukom „Spoji n” znači odobrenje slika kao reference (D-183). Dotad su prijedlog.

Raspored uvoza preuzet je iz `../editor-v11.dc.html` (Uvezi u kartici Literatura, zalijepljeni zapisi ili datoteka, ishod s brojem uvezenih i već postojećih) i prebojan prema EQ1 (#87 c.6645288294). Boje prototipa nisu preuzete. Planer i pravopis nemaju prototip. Složeni su iz dijelova `../m5-reference` (panel, traka opsega, dijalog, traka stanja).

## Stranice

| Stranica | Stanja | Izvori |
|---|---|---|
| `s06-planer.html` | popunjeno, bez cilja (i bez roka), rok je prošao, prazno, učitavanje i greška | M5.15, D-63 (b), D-60, PRODUCT §5 pravilo 4, EQ7, #1030 (spojen) |
| `s07-pravopis.html` | uključeno na bijelom i tamnom listu, postavka, isključeno, jezik nepoznat, nema rječnika za jezik rada, rječnik se učitava ili nije učitan | M5.11, D-233, D-236, `docs/spikes/M5.11-S.md` |
| `s13-uvoz.html` | uvoz, djelomičan uvoz, ništa nije prepoznato (tekst zadržan u polju), datoteka nečitljiva, popis nakon uvoza | D-59, D-62, `../m5-reference/s13-literatura.html` |

Mobitel je snimka širine 400 px. Zajednička stanja (učitavanje, greška, bez mreže, samo za čitanje) za karticu Literatura već postoje u `../m5-reference/s13-literatura.html` i ovdje se ne ponavljaju.

Snimke su u `snimke/<stranica>-<tamna|svijetla>-<1440|400>.png`. Izrađene su Playwrightovim Chromiumom: cijela stranica, DPR 1, nakon `document.fonts.ready`, bez vodoravnog pomicanja na obje širine. Svijetla ljuska je `data-theme="light"` na `<html>`. Kontrolni zbrojevi su u `SHA256SUMS`. `reference.css` uvozi `../m5-reference/reference.css` i dodaje samo tamni list, crtu pravopisa, izbornik prijedloga i trake planera.

## Odluke u slici

- **Planer.**
  - Brojke su izvedene iz verzija rada na poslužitelju: riječi po danu, riječi na dan do roka, napredak po poglavlju i dani do roka. Iz vremena pojedine promjene ne izvodi se ništa. Nema brzine, pauza ni ritma (D-63 (b)).
  - Planer vidi samo student, pa nosi oznaku „Vidite samo Vi”. Ne ulazi u sažetak procesa, izvoz, predaju ni nastavnički prikaz.
  - Oznaka se odnosi na planer, ne na tekst rada. Tekst mentor vidi uživo (D-142), i nijedna rečenica na slici ne tvrdi drukčije.
  - Ciljevi po poglavlju su iz profila rada u Lekti ili od mentora (D-60), a nastavnik ih smije suziti na verziji zadatka (D-220). Zbroj ciljeva četiriju poglavlja jednak je opsegu rada (6.000 do 8.000).
  - Bez cilja i nakon roka planer ne računa riječi na dan. Ne prikazuje ni opomenu ni boju upozorenja. Vlastiti cilj studenta nije nacrtan jer nije definiran.
- **Pravopis.**
  - Provjera radi samo s rječnikom na uređaju i prema jeziku rada (D-236).
  - Ugrađena provjera preglednika u editoru je isključena (D-233; spike: `spellcheck="false"` jedina je zaštita koju aplikacija kontrolira).
  - Rečenica „Ductura tekst rada ne šalje na vanjsku uslugu za pravopis” govori samo o putu koji aplikacija kontrolira. Proširenja preglednika i sistemske tipkovnice su izvan njega (spike, „Poznate granice”).
  - Ako lokalni rječnik ne dobije potvrdu licence, pravopisa nema (D-233). Tada vrijedi samo stanje 3 ili 4.
  - Prijedlozi ne nude „Dodaj u rječnik” ni „Zanemari”, jer nisu definirani.
- **Uvoz.**
  - Uvoz dodaje izvore samo u popis i nikad ne upisuje u tekst.
  - Već postojeći izvor se ne udvostručuje.
  - Zapis koji se može pročitati uvozi se i kad mu nedostaje autor ili izdavač. Nepotpun opis je neutralna oznaka s isprekidanim rubom (D-62).
  - „Nije prepoznat” je samo zapis koji nije u obliku BibTeX, RIS ni CSL-JSON. Prikazuje se doslovno, s razlogom i radnjom „Dodaj ručno”.
  - Nakon neuspjeha dijalog ostaje otvoren, a popis se ne mijenja.
    - Stanje 3 (ništa nije prepoznato): polje Zapisi zadržava uneseni tekst, pa ga student može ispraviti i ponovno pokušati ili odabrati drugu datoteku.
    - Stanje 3b (datoteka nečitljiva): polje Zapisi je prazno, jer nema pročitanog sadržaja za zadržati; student odabire drugu datoteku ili zalijepi zapise.
  - Broj u ishodu i popis nakon uvoza se slažu: 4 uvezena i 1 već postojeći čine 5 stavki popisa.
  - Izravni dohvat iz Zotera s korisničkim ključem iz prototipa nije nacrtan: Zotero je val 2 (D-227), a rukovanje ključem nije definirano.

## Granice

- Ikone nisu dio slike; gumbi nose tekst.
- Oznake u velikim slovima („Stanje 1 · …”) i sitne bilješke ispod okvira opisuju referencu i nisu tekst sučelja.
- Tipkovnički redoslijed (EQ6) je bilješka na dnu svake stranice.
- Svi su podaci izmišljeni (Autor A, Horvat, A., Primjer, D.).

## Provjera rječnika

Tekst svih triju stranica i ovog README-a prošao je `findForbiddenTermsInMarkup` i `findForbiddenTerms` iz `scripts/forbidden-terms/terms.ts` bez nalaza (`docs/PRODUCT.md` §5).
