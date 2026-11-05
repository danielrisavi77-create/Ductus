# Referenca paketa 4: početak toka za nastavnika (DAN-567)

Prijedlog slike za ekrane N-01, N-02, N-03, N-04 i N-16, bez produktnog koda. Spajanje ove mape vlasnikovom porukom „Spoji <n>” znači odobrenje reference (D-183, `docs/SESSIONS.md` §6.1). Dok toga nema, referenca je prijedlog.

Izvori: `docs/design/EKRANI.md` §4 (redak 4) i §5, `docs/PROGRAM-RAZRADA.md` M2.4 i M2.5, `docs/PRODUCT.md` §4 i §5, `docs/design/DESIGN-SYSTEM.md`, `docs/design/ductura/README.md` §5.3, D-142, D-188, EQ1 (#87 c.6645288294).

## Prototip i ugovor

EQ1: raspored se preuzima iz starih `.dc.html` prototipa, a boje ne. **Ekrani bez prototipa crtani su po ugovoru iz `EKRANI.md`:**

| Ekran | Prototip | Kako je nacrtan |
|---|---|---|
| N-01 Moji kolegiji | NEMA | po ugovoru iz EKRANI.md; kartice kolegija preuzimaju obrazac iz m2-reference (A-03) |
| N-02 Novi kolegij i zadatak | DJELOMIČNO: `demo-tok-v2.dc.html`, zaslon 2 | raspored obrasca iz prototipa, prebojan; stanja valjanosti i greške po ugovoru |
| N-03 Čarobnjak zadatka | DJELOMIČNO: isti zaslon (uporaba alata, „Kako vidi student”) | popis alata i bočna kartica iz prototipa; četiri koraka i pregled po ugovoru |
| N-04 Popis studenata | NEMA | po ugovoru; seminarska grupa po M2.7 |
| N-16 Radovi uz mentora (podaci) | NEMA | po ugovoru; mentor vidi rad uživo (D-142) |

## Sadržaj

| Datoteka | Ekrani |
|---|---|
| `n01-moji-kolegiji.html` | N-01: popunjeno, prazno, učitavanje, greška, mobitel |
| `n02-n03-kolegij-i-zadatak.html` | N-02: prazno, valjanost obrasca, učitavanje, greška, mobitel. N-03: prazno (korak 1), koraci čarobnjaka, dopuštena uporaba alata, pregled, učitavanje, greška, mobitel |
| `n04-n16-studenti-i-radovi.html` | N-04: popunjeno, seminarska grupa. N-04 i N-16: prazno, učitavanje, greška (uključujući prekinut prikaz uživo), mobitel. N-16: popunjeno |
| `reference.css` | tokeni „papir i grafit” (DESIGN-SYSTEM §3) i fontovi iz `app/fonts` |
| `snimke/` | PNG snimke i `SHA256SUMS` |

## Pravila koja slika drži

- Mentor vidi rad uživo (D-142). Nijedan tekst ne tvrdi da mentor vidi rad tek nakon slanja; popis N-16 označava prikaz uživo i prikazuje prekid uživo kao grešku.
- Popis studenata je abecedan, bez mjera, bez sortiranja po brojevima i bez oznaka koje procjenjuju radove. Stanje rada je u prvoj rečenici retka (PRODUCT §4 t. 4).
- Uporaba alata: pravilo kolegija polazi od pravila fakulteta i nastavnik ga smije pooštriti i ublažiti (D-175); pravilo zadatka smije samo suziti pravilo kolegija (D-52); fiksni popis zabranjenog ne mijenja se. Tekst stavki je sažetak, u aplikaciji ide doslovno iz Pravilnika.
- Greška čitanja nikad se ne prikazuje kao prazan popis ni kao nule. Prekinuta veza nakon objave zadatka je „ishod nije poznat” s radnjom „Provjeri stanje”.
- Učitavanje i greška su zajednički uzorak iz paketa 1 (Z-06), primijenjen na svaki ekran. Posebno je prikazan ishod prekinute objave jer samo ondje ishod može biti nepoznat.

## Snimke

| Datoteka | Ekran | Širina | Tema |
|---|---|---|---|
| `snimke/n01-tamna-1440.png` | N01 | 1440 | tamna |
| `snimke/n01-tamna-400.png` | N01 | 400 | tamna |
| `snimke/n01-svijetla-1440.png` | N01 | 1440 | svijetla |
| `snimke/n01-svijetla-400.png` | N01 | 400 | svijetla |
| `snimke/n02-n03-tamna-1440.png` | N02-N03 | 1440 | tamna |
| `snimke/n02-n03-tamna-400.png` | N02-N03 | 400 | tamna |
| `snimke/n02-n03-svijetla-1440.png` | N02-N03 | 1440 | svijetla |
| `snimke/n02-n03-svijetla-400.png` | N02-N03 | 400 | svijetla |
| `snimke/n04-n16-tamna-1440.png` | N04-N16 | 1440 | tamna |
| `snimke/n04-n16-tamna-400.png` | N04-N16 | 400 | tamna |
| `snimke/n04-n16-svijetla-1440.png` | N04-N16 | 1440 | svijetla |
| `snimke/n04-n16-svijetla-400.png` | N04-N16 | 400 | svijetla |

Snimljeno Playwrightovim Chromiumom, cijela stranica, `deviceScaleFactor` 1. Svijetla tema je `data-theme="light"` na `<html>`. Prije snimanja čekaju se fontovi. Na svakoj snimci provjereno je da nema vodoravnog pomicanja, a da je svaki vidljivi gumb, poveznica-gumb, polje, izbornik i oznaka potvrdnog okvira velik najmanje 44 × 44 px. Zbroj provjere je u `snimke/SHA256SUMS`.

## Granice

- Ljuska je uska bočna traka od 64 px (D-202 t. 1) sa stavkama „Kolegiji” i „Mentorstva”. Ikone nisu korištene (D-203 t. 8). Ispod 800 px traka je izbornik iza gumba „Izbornik”.
- Uloga komentora, povjerenstva (N-08, N-09) i ostalih nastavničkih ekrana nisu u ovom paketu.
- Svi su podaci izmišljeni: osobe, kolegiji, kodovi, datumi i brojevi.