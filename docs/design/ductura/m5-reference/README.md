# Referenca M5 (DAN-510, M5.UX-R)

Prijedlog slike za korak M5.UX-R, bez produktnog koda. Spajanje ove mape vlasnikovom porukom „Spoji <n>” znači odobrenje reference (D-183, `docs/SESSIONS.md` §6.1). Dok toga nema, referenca je prijedlog. Oblik je isti kao u `../m4-reference` (#1403). Mapa je podijeljena u dva PR-a; ovaj dio sadrži kartice i popise (A), drugi traku, fokus, opseg, vodič i Strukturu (B).

Izvori: odluka vlasnika na #87 (c.6580438138, O11), UX prolaz M5 (DAN-502), issuei #1382 do #1395, D-62, D-137, D-183, D-188, D-201, D-203 t. 8, D-231, `docs/design/DESIGN-SYSTEM.md`.

## Sadržaj

| Datoteka | Što je | Issue |
|---|---|---|
| `s13-literatura.html` | S-13, kartica Literatura, stanja 1 do 6 | #1382 |
| `navodi-bibliografija.html` | navod u tekstu i bibliografija, stanja 1 do 6 | #1384 |
| `fusnote.html` | fusnote: list s oznakama, popis u railu, prazno, predano, mobitel | #1386 |
| `tablice-slike.html` | tablice i slike, stanja 1 do 7 | #1388 |
| `reference.css` | tokeni „papir i grafit” (DESIGN-SYSTEM §3) i fontovi iz `app/fonts` | |
| `snimke/` | PNG snimke: svaka stranica × 1440 i 400 px × tamna i svijetla tema | |

Snimke su imenovane `<stranica>-<tamna|svijetla>-<1440|400>.png`.

## Odluke u slici

- Oznake poput „Izvor nije u popisu”, „Nije citirano u tekstu”, „Opis nije upisan” i „Prikaz ne postoji” neutralni su podaci s isprekidanim rubom, bez crvene (D-62); značenje nosi tekst.
- Provjera DOI-ja i URL-a ima tri ishoda i nikad ne ocjenjuje izvor; „Nije pronađeno” ne tvrdi da izvor ne postoji.
- Pregled prije predaje završava rečenicom „Informativno. Ne utječe na predaju.”
- Zlato je samo glavna radnja; ostale radnje su obrubljene ili tekstualne.
- Slike: okvir zadržava omjer; odbijanje navodi razlog i potvrđuje da tekst rada nije zahvaćen. Podržane su sve vrste slika (#87, O7); razlozi odbijanja su iz fiksnog popisa (D-231).
- Široka tablica pomiče se vodoravno unutar okvira, stranica se ne pomiče.

## Granice

- Ikone iz dizajnerskog paketa nisu korištene (D-203 t. 8).
- Svi su podaci izmišljeni: izvori, autori, naslovi i brojevi. Nema stvarnih osoba.
- Oznake u velikim slovima („Stanje 3 · …”) opisuju referencu i nisu tekst sučelja.
- Snimljeno Playwrightovim Chromiumom, cijela stranica, `deviceScaleFactor` 1, čekaju se fontovi; ni na jednoj širini nema vodoravnog pomicanja stranice. Svijetla tema je `data-theme="light"` na `<html>`.
- Tekst sučelja provjeren je funkcijom `findForbiddenTermsInMarkup` iz `scripts/forbidden-terms/terms.ts` i nema nalaza.
