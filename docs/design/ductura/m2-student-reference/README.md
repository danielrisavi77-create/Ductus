# Paket 3: početak toka studenta (S-01 do S-05)

Referentne slike za paket 3 iz `docs/design/EKRANI.md` §4 (redak 3) i §5. Zadatak: DAN-566. Faza M1 do M2.

Ovo je prijedlog slike, ne produktni kod. Slike postaju odobrena referenca tek kad vlasnik spoji PR naredbom „Spoji n” (D-183).

## Izvor rasporeda (EQ1)

Vlasnikova odluka EQ1 (#87 `issuecomment-6645288294`), doslovno: „Ok, solidni su, ali treba prilagoditi našoj boji”. Raspored je preuzet iz starih prototipova, a boje su zamijenjene tokenima „papir i grafit” (D-188, `docs/design/DESIGN-SYSTEM.md` §3):

| Ekran | Prototip (raspored) | Što je preuzeto |
| --- | --- | --- |
| S-01 Prijava | `prijava-v5.dc.html` | uvod i list lijevo, kartica prijave desno, preusmjeravanje s trakom |
| S-02 Studentska početna | `pocetna.dc.html` | datum i pozdrav u sredini, kartica „nastavi”, popis zadataka, upis kodom na dnu |
| S-03 Moji kolegiji | `pocetna.dc.html` | isti popis, grupiran po kolegiju |
| S-04 Upis kodom | `demo-tok-v2.dc.html`, „3 Upis i obavijest” | kartica u sredini, polje koda s gumbom, crta greške ispod |
| S-05 Obavijest o zadatku | `demo-tok-v2.dc.html`, „3 Upis i obavijest” | kartica zadatka, popisi alata ✓ i ×, kvačica i potvrda ispod |

Iz prototipova se ne preuzima tekst. Prototipovi se obraćaju s „ti”, a sučelje s „Vi” (D-181). Tekst obavijesti u prototipu („istraga”, „vrijeme pisanja”) je PRIJEDLOG i ne vrijedi; vrijedi katalog. Stavka „Poruka sebi” s početne nije definirana i nije nacrtana.

## Stranice i stanja

| Stranica | Ekran | Stanja |
| --- | --- | --- |
| `prijava.html` | S-01 | zadano (prazno), učitavanje (preusmjeravanje), greška i odbijena prijava, AAI@EduHr nedostupan, nova osoba bez uloge, pomoć otvorena; svijetla prijava (EQ10) je snimka `prijava-svijetla-*` |
| `pocetna-kolegiji.html` | S-02, S-03 | S-02: popunjeno s rokom blizu, nema kolegija, prazno (kolegij bez zadatka), učitavanje, greška. S-03: popunjeno s više grupa, jedan kolegij, prazno, učitavanje, greška, prijava istekla |
| `upis-obavijest.html` | S-04, S-05 | S-04: zadano, upisivanje, neispravan kod, istekao ili nepostojeći kod, već upisan, greška i bez mreže, upisan u kolegij bez zadatka. S-05: zadano, učitavanje, greška, zadatak još nije otvoren, potvrda obavijesti, promijenjen tekst obavijesti, račun bez prava potvrde |

Stanje „mobitel” iz §5 su snimke na 400 px. Svaka stranica ima snimku na 1440 i 400 px, u tamnoj (zadano) i svijetloj ljusci (`data-theme="light"`): `snimke/<stranica>-<tamna|svijetla>-<1440|400>.png`, ukupno 12. Kontrolni zbrojevi su u `SHA256SUMS`.

## Granice koje slika čuva

- Prijava je samo AAI@EduHr (D-09). Nema prijave e-poštom, kartica uloga, probne prijave ni upisa koda prije prijave; kod se upisuje tek nakon prijave. Kad AAI@EduHr ne odgovara, drugi ulaz se ne nudi.
- Odbijena prijava i druga greška imaju isti tekst jer ih poslužitelj ne razlikuje (`src/server/auth/flow.ts`); samo odgovor 503 dobiva tekst „ne odgovara”.
- Istekao i nepostojeći kod imaju isti tekst (`student.enroll.errors.refused`).
- Dani do roka („Rok za 3 dana”) vidi samo student i ne ulaze u sažetak ni nastavnički prikaz (PRODUCT §5 pravilo 4, iznimka D-63).
- Obavijest S-05 prikazuje sve stavke iz kataloga doslovno, uključujući prikaz uživo i reprodukciju (D-142, D-143), radne zapise mentora (D-130) i rečenicu da Ductura ne procjenjuje autorstvo. Potvrda nije privola i ništa se ne šalje prije potvrde. Nova verzija obavijesti traži novu potvrdu.
- Podaci su izmišljeni: Student A, Kolegij A do C, izmišljeni naslovi zadataka i kodovi.

## Novi tekst koji nije u katalogu

Ovi tekstovi su prijedlog i ulaze u `messages.hr.ts` tek s izvedbom, uz provjeru rječnika:

- S-01: „Preusmjeravamo Vas na AAI@EduHr” (naslov preusmjeravanja).
- S-01: „Prijava je uspjela” i „Ovaj račun još nema dodijeljenu ulogu, pa se Vaš prostor ne može otvoriti.” (nova osoba bez uloge; druga rečenica je `prijava.helpAccessBody`).
- S-02, S-03: „Rok za 3 dana” (prag od 7 dana potvrđuje izvedba).
- S-03: oznake „Seminarska grupa 2” i akademska godina uz kolegij (M2.7).
- S-04: „Već ste upisani u ovaj kolegij.”

## Tipkovnica (EQ6)

Redoslijed fokusa je zapisan ispod zadanog stanja na svakoj stranici. Svi gumbi, polja i `summary` imaju najmanje 44 px visine. Ukrasni list na prijavi čitač zaslona preskače i ne prima fokus. Greške se vežu uz polje i čitaju kao `alert`, stanja učitavanja kao `status`.

## Provjera

- Rječnik zabranjenih izraza (`scripts/forbidden-terms/terms.ts`, PRODUCT §5) nad svim trima stranicama i ovim README-om, pokrenut ručno (`findForbiddenTermsInMarkup`, `findForbiddenTerms`): bez nalaza. `scripts/forbidden-terms/scan.ts` ovu mapu ne čita, pa CI ovu provjeru ne ponavlja; izvedba je dobiva kad tekst uđe u katalog.
- Snimke: Playwright Chromium, cijela stranica, DPR 1, nakon `document.fonts.ready`, bez vodoravnog pomicanja na 400 px.
- Tokeni i fontovi dolaze iz `../m5-reference/reference.css`; `reference.css` ovog paketa dodaje samo raspored i dva tokena stanja iz DESIGN-SYSTEM §3 (`--error`, `--warn`) s vrijednostima za obje ljuske.
