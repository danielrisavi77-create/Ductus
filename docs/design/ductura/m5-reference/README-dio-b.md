# Referenca M5, dio B (DAN-510, M5.UX-R)

Drugi dio prijedloga slike za M5.UX-R, bez produktnog koda. Prvi dio (kartice i popisi, #1382 do #1388) je u zasebnom PR-u i ima `README.md`; `reference.css` je isti u oba dijela. Spajanje vlasnikovom porukom „Spoji <n>” znači odobrenje (D-183, `docs/SESSIONS.md` §6.1). Oblik je isti kao u `../m4-reference` (#1403).

Izvori: odluka vlasnika na #87 (c.6580438138), UX prolaz M5 (DAN-502), issuei #1390 do #1395, D-183, D-188, D-201, D-203 t. 8, D-234, `docs/design/DESIGN-SYSTEM.md`.

## Sadržaj

| Datoteka | Što je | Issue |
|---|---|---|
| `trazi-zamijeni.html` | traži i zamijeni, stanja 1 do 5 i 7 | #1390 |
| `fokus.html` | način fokusa, stanja 1 do 5 | #1392 |
| `opseg-poglavlja.html` | opseg poglavlja, stanja 1 do 6 | #1393 |
| `vodic-s45.html` | uvodni vodič S-45, koraci 1 do 4, prazan rad, redoslijed, mobitel | #1394 |
| `struktura-s14.html` | kartica Struktura i prikaz Prve rečenice, stanja 1 do 9 | #1395 |
| `reference.css` | tokeni „papir i grafit” i fontovi iz `app/fonts` | |
| `snimke/` | PNG: svaka stranica × 1440 i 400 px × tamna i svijetla tema | |

Snimke su imenovane `<stranica>-<tamna|svijetla>-<1440|400>.png`.

## Odluke u slici

- Vodič: obavijest o praćenju, pa Započni rad, pa vodič; „Preskoči” je u svakom koraku, bez potvrde; stanje spremanja ostaje vidljivo; ponovno otvaranje je stavka „Vodič” u izborniku Više.
- Struktura: samo podaci uz rečenicu (broj riječi), bez ocjene i pragova (D-234); „Vidite samo Vi.” u opisu kartice; ispod 1000 px otvara se preko teksta.
- Fokus: stanje spremanja vidljivo u svakom stanju.
- Zlato je samo glavna radnja.

## Granice

- Ikone iz dizajnerskog paketa nisu korištene (D-203 t. 8).
- Svi su podaci izmišljeni; nema stvarnih osoba.
- Oznake „Stanje n · …” opisuju referencu i nisu tekst sučelja.
- Otvorena pitanja 5/7/8 iz `PANEL-NACRT-SPEC.md` ostaju kod Daniela.
- Snimljeno Playwrightovim Chromiumom, cijela stranica; ni na jednoj širini nema vodoravnog pomicanja. Svijetla tema je `data-theme="light"` na `<html>`.
- Tekst sučelja provjeren funkcijom `findForbiddenTermsInMarkup`; bez nalaza.
