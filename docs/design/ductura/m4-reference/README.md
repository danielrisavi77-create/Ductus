# Referenca M4: S-11 i A-04 (DAN-503, M4.UX-R)

Prijedlog slike za korak M4.UX-R, bez produktnog koda. Spajanje ove mape vlasnikovom porukom „Spoji <n>” znači odobrenje reference (D-183, `docs/SESSIONS.md` §6.1). Dok toga nema, referenca je prijedlog.

Izvori: odluka vlasnika na #87 (c.6584669075, t. 1–7), issuei #1380–#1391, izvještaj UX prolaza #1091 (c.6584565751), D-62, D-126, D-181, D-188, D-203 t. 8, D-217 do D-222, `docs/design/DESIGN-SYSTEM.md`.

## Sadržaj

| Datoteka | Što je |
|---|---|
| `s11-panel-upute-i-provjera-oblika.html` | S-11 — Panel Upute i provjera oblika, šest stanja kao varijante |
| `a04-pravila-fakulteta.html` | A-04 — Pravila fakulteta, samo čitanje |
| `reference.css` | tokeni „papir i grafit” (DESIGN-SYSTEM §3) i fontovi iz `app/fonts` |
| `snimke/` | PNG snimke, tablica dolje |

## Stanja S-11

| Stanje | Issue | Sadržaj |
|---|---|---|
| 1a učitavanje, 1b neuspjeh | #1380 | „Učitavam pravila za ovu vrstu rada.”; neuspjeh ne kaže da nalaza nema i potvrđuje da se rad može pisati i predati |
| 2 nije uključeno | #1381 | student vidi samo „nije uključeno”; uzrok je u A-04 (odluka t. 2) |
| 3 nalazi | #1383 | pravilo, izbrojeno stanje, poveznica na mjesto, izvor pravila; bez kvačica, križića i brojača (D-62, D-221) |
| 4 zastarjelo | #1385 | raniji nalazi ostaju vidljivi, označeni tekstom „Zastarjelo, dokument je promijenjen”, uz radnju „Provjeri ponovno” (t. 3); novija verzija paketa samo kao činjenica |
| 5a–5c nepokriveno | #1387 | rečenica iz D-219; kod djelomične pokrivenosti popis pokrivenih pravila kao činjenica (t. 4); neodređena vrsta rada kao isti prikaz s drugim uzrokom |
| 6 opseg | #1389 | raspon i suženje nastavnika (D-220), uz izbrojeni broj riječi, bez postotka (t. 5) |

Svako stanje s nalazima završava rečenicom „Informativno. Ne utječe na predaju.” (D-222).

## A-04

Prikazuje što studenti i nastavnici vide po vrsti rada, s uzrokom. Varijanta pokazuje uzrok stanja „nije uključeno” za cijelu ustanovu (licenca, paket, valjanost). Slijede podaci o paketu (verzija, datum uvoza, izdavač, pokrivene vrste rada i ono što nije pokriveno), puni tekst pravila s doslovnim navodom u označenom polju (t. 6) i povijest verzija bez usporedbe „bolje ili lošije”. Postavke koje uređuje administrator stoje odvojeno. Uvoz paketa nije radnja na zaslonu (D-217). Nema brojeva studenata ni sažetaka po radu.

## Snimke

| Datoteka | Zaslon | Širina | Tema |
|---|---|---|---|
| `snimke/s11-tamna-1440.png` | S-11 | 1440 | tamna |
| `snimke/s11-tamna-400.png` | S-11 | 400 | tamna |
| `snimke/s11-svijetla-1440.png` | S-11 | 1440 | svijetla |
| `snimke/s11-svijetla-400.png` | S-11 | 400 | svijetla |
| `snimke/a04-tamna-1440.png` | A-04 | 1440 | tamna |
| `snimke/a04-tamna-400.png` | A-04 | 400 | tamna |
| `snimke/a04-svijetla-1440.png` | A-04 | 1440 | svijetla |
| `snimke/a04-svijetla-400.png` | A-04 | 400 | svijetla |

Snimljeno Playwrightovim Chromiumom, cijela stranica, `deviceScaleFactor` 1. Svijetla tema je `data-theme="light"` na `<html>`. Prije snimanja čekaju se fontovi (`document.fonts.ready`). Ni na jednoj širini nema vodoravnog pomicanja.

## Granice

- Ikone iz dizajnerskog paketa nisu korištene (D-203 t. 8); jedina oznaka je tipografska strelica „↗” uz vanjsku poveznicu.
- Svi su podaci izmišljeni: pravilnici, članci, verzije, datumi i brojevi riječi. Nema stvarnih osoba.
- Oznake u velikim slovima („Stanje 3 · nalazi · #1383”) opisuju referencu i nisu tekst sučelja.
- Tekst sučelja provjeren je funkcijom `findForbiddenTerms` iz `scripts/forbidden-terms/terms.ts` i nema nalaza.
