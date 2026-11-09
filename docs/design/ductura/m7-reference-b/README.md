# Referentne slike M7, paket 7 (B): N-05, N-10, N-11, N-13 (DAN-600)

Ovo je paket 7 iz `docs/design/EKRANI.md` §4 (Sažetak i pregled, nastavnik). Sadrži ekrane N-05 Brz put, N-10 Karta podrijetla, N-11 Usporedba verzija i N-13 Produljenje roka. Paket 6 (S-15, S-30 do S-33) je u `../m7-reference`.

Smjer je „papir i grafit” (D-188, `docs/design/DESIGN-SYSTEM.md`). Spajanje PR-a vlasnikovom porukom „Spoji n” znači da su slike odobrene kao referenca (D-183). Dotad su prijedlog.

Ulaz je M7 UX prolaz, issuei #1779 do #1790; za ovaj paket najviše #1784, #1785, #1786 i #1789. Stari prototipi `../pregled-radova-v2.dc.html` (N-05), `../analiza.dc.html` i `../demo-tok-v2.dc.html` (N-10) te `../editor-v11.dc.html` (N-11) nisu odobrena referenca (DESIGN-SYSTEM §1 t. 4). Iz njih nisu preuzeti ni raspored ni boje. Za N-13 prototipa nema.

Stranice su složene iz dijelova `../m2-nastavnik-reference` (ljuska nastavnika, popis, kartica, dijalog, kostur učitavanja) i tokena DESIGN-SYSTEM §3.

## Stranice

| Stranica | Stanja | Izvori |
|---|---|---|
| `n05-brz-put.html` | popunjeno (tekst rada), popunjeno (sažetak procesa), prazno, učitavanje, greška i zastarjeli popis, mobitel | #1785, #1789, D-170, D-128, pravilo 5, `src/lib/i18n/messages.hr.ts` (`fastPath`) |
| `n10-karta-podrijetla.html` | popunjeno, pojedinosti oznake, „Napisano u Ducturi” uključeno, prazno, učitavanje, greška, mobitel | #1786, D-57, D-61, D-127, D-137, pravilo 5 |
| `n11-usporedba-verzija.html` | popunjeno, zaglavlja verzija (runde), prazno, učitavanje, greška, mobitel | D-202 t. 3, D-237, D-263 Q08, pravilo 5 |
| `n13-produljenje-roka.html` | popunjeno, sukob s rokom, što vidi student, prazno, učitavanje, greška, mobitel | #1784, D-128, D-263 Q07, PRODUCT §6 t. 10, Q-5 (ADR `docs/adr/2026-11-06-zabiljezeni-pristup-podrske.md` §8a do 8d) |

Mobitel je snimka širine 400 px. Snimke su u `snimke/<stranica>-<tamna|svijetla>-<1440|400>.png`. Izrađene su Playwrightovim Chromiumom:

- cijela stranica, DPR 1, nakon `document.fonts.ready`;
- bez vodoravnog pomicanja na obje širine.

Svijetla ljuska je `data-theme="light"` na `<html>`. Kontrolni zbrojevi su u `SHA256SUMS`. `reference.css` uvozi `../m2-nastavnik-reference/reference.css` i dodaje samo:

- tokene podrijetla (`--p-internal`, `--p-unknown`, `--p-ai`) za obje ljuske;
- list rada u boji papira;
- oznake podrijetla, legendu i poglavlja karte;
- oznake dodanog i uklonjenog u usporedbi;
- širinu padajućeg izbornika.

## Odluke u slici

### Brz put (N-05)

- Tekstovi su iz kataloga aplikacije (`fastPath`): „Brz put”, „Studenti · po prezimenu”, „Tekst rada” / „Sažetak procesa”, „Zadnja promjena”, „Lijepljenja bez izvora”.
- Kartica studenta ima dva retka i stanje zapisa (D-170). Studenti su poredani po prezimenu, ne po nekom svojstvu rada.
- Stanja studenta su tekst: „Obavijest još nije potvrđena”, „U pisanju”, „Predano … nakon roka”, „Predaja u obradi”, produljen rok. „Nakon roka” nema boju (D-128).
- Prethodni i Sljedeći student nose ime, da nastavnik zna kamo ide.
- Nastavnik ne vidi gumb za pregled razgovora studenta s AI pomoćnikom. Slika ne izmišlja taj pristup.

### Karta podrijetla (N-10)

- Oznake se razlikuju oblikom crte i tekstom, ne samo bojom. Svaka ima riječ uz sebe.
- Legenda je u stalnom redoslijedu: Zalijepljeno (izvor nije opažen), Uvezeno iz datoteke, Preneseno iz AI pomoćnika, Izmjena nastavnika, Mjesto za izvor.
- „Zalijepljeno (izvor nije opažen)” i „mjesto za izvor” su odvojeni (D-137). Mjesto za izvor je zaseban okvir iza zalijepljenog odlomka.
- Karta nema zbroj, udio ni postotak (D-57).
- Poglavlja nose vrste događaja bez broja (vidi „Otvoreno za vlasnika”).
- „Napisano u Ducturi” je prekidač, isključen u slici. Uz njega uvijek stoji „Ductus ne zna tko je tipkao” (D-127).
- Pojedinosti oznake: model „M-2” i vrijeme za prijenos iz AI pomoćnika, „oznaka podrijetla nije dodana” za zalijepljeno, ime nastavnika za izmjenu. Vrsta dokaza je „opaženo”.

### Usporedba verzija (N-11)

- Uspoređuju se samo poslane verzije: poslane na pregled ili predane (D-202 t. 3). Popis to kaže.
- Usporedba je ista u oba profila, bez oznake i bez ocjene (D-237). Student i mentor vide istu (pravilo 5).
- Dodano je podvučeno i nosi riječ „dodano”; uklonjeno je precrtano i nosi riječ „uklonjeno”. Nema zelene i crvene.
- „Dodano 214 riječi” i „Uklonjeno 58 riječi” su opis, bez praga i bez boje.
- Zaglavlja verzija nose rundu ili reviziju i vrijeme (D-263 Q08).

### Produljenje roka (N-13)

- Gumb „Produlji rok” je u retku studenta. Dijalog ima „Novi rok” (datum i sat, Europe/Zagreb) i „Razlog”.
- Uz razlog stoji: „Razlog vidite samo Vi i ovaj student. Ne upisujte zdravstvene podatke; dovoljno je ‚opravdani razlog’.” (#1784).
- Sukob s rokom: kad je predaja već zatražena, dijalog kaže da produljenje ne mijenja tu predaju i bilježi se kao dopuna uz nju (Q07). Bez boje i bez upozoravajućeg znaka (D-128).
- Student vidi „Rok: {datum} (produljen, izvorni rok {datum})”. Dok produljenje vrijedi, napomena o predaji nakon roka se ne prikazuje.
- Greška spremanja kaže koji rok vrijedi.

## Otvoreno za vlasnika

Slika ova pitanja označava kao otvorena i ne odlučuje ih:

- **Oblik razloga produljenja (Q-5).** Slobodan tekst ili kategorije, tko još vidi razlog i koliko se čuva odlučuje ADR §8a do 8d (rok 30. 11. 2026.). Slika crta slobodan tekst s uputom. Prema #1784 nijedan UI PR za N-13 ne ide prije Q-5.
- **Tko traži produljenje (#1784).** Nije specificirano; slika crta samo nastavnika koji ga daje.
- **Broj lijepljenja u N-05.** „Lijepljenja bez izvora: 2” slijedi aplikaciju (`src/components/teacher/fast-path.ts`) i D-170. Stoji blizu pravila PRODUCT §5 o broju uz izvor. Treba potvrdu da je broj događaja dopušten.
- **Brojevi uz događaje poglavlja (D-61, #1786).** Primjer u D-61 stavlja broj ispred prijenosa iz AI pomoćnika, a rječnik ne dopušta broj uz AI. Slika crta vrste događaja bez broja dok orkestrator ili vlasnik ne potvrde oblik.
- **Naziv u legendi.** D-137 kaže „mjesto za izvor”, #1786 i D-61 „otvoreno mjesto”. Slika koristi „Mjesto za izvor”.
- **Zadano stanje „Napisano u Ducturi” (D-127, O-2).** Slika crta isključeno.
- **Nazivi stanja (#1782).** „Predaja u obradi” je iz prijedloga u #1782, koji još nije potvrđen.
- **Usporedba u oba profila.** PRODUCT (redak 189 te 197 i 198) i D-237 se ne slažu; upis ide kroz Q-18.
- **Oznake ekrana.** U `docs/FEATURES.md` N-05, N-10 i N-11 znače druge funkcije (promjene od zadnjeg pregleda, predlošci, pregled kolegija). Slika koristi oznake iz `docs/design/EKRANI.md`.

## Nije nacrtano

- Cijeli sažetak procesa (S-33) dolazi u zasebnom PR-u paketa 6 u `../m7-reference`.
- Reprodukcija procesa i međustanja verzija nisu dio N-11.
- Koordinatorski i podrškin prikaz razloga produljenja čekaju Q-5.
- Studentski radni prostor; ovdje je samo redak roka.

## Granice

- Ikone nisu dio slike; gumbi nose tekst.
- Oznake u velikim slovima („N-05 · stanje 1 · …”) i sitne bilješke ispod okvira opisuju referencu i nisu tekst sučelja.
- Tipkovnički redoslijed (EQ6) je u zaglavlju svake stranice.
- Svi su podaci izmišljeni: imena studenata i nastavnika, radovi, datumi, oznaka modela i tekst rada.
- Datumi 20. 11. do 4. 12. 2026. su primjer, ne stvarni rokovi.

## Provjera rječnika

Tekst i atributi svih četiriju stranica i tekst ovog README-a prošli su provjeru bez nalaza (`docs/PRODUCT.md` §5). Korištene su `findForbiddenTermsInMarkup` i `findForbiddenTerms` iz `scripts/forbidden-terms/terms.ts`. Kontrolni prolaz s umetnutim zabranjenim izrazom javio je nalaz.
