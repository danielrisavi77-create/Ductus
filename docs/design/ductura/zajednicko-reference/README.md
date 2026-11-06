# Zajednička referenca: stanja i fokus (paket 1, DAN-565)

Prijedlog slike, bez produktnog koda. Spajanje ove mape vlasnikovom porukom „Spoji <n>” znači odobrenje reference (D-183, `docs/SESSIONS.md` §6.1). Dok toga nema, referenca je prijedlog. Boje su „papir i grafit” (D-188), tokeni iz `docs/design/DESIGN-SYSTEM.md` §3; raspored stranice preuzet je iz `../m2-reference`, odluke EQ3, EQ6 i EQ8 su u `docs/design/EKRANI.md`.

## Sadržaj

| Datoteka | Sadržaj |
| --- | --- |
| `reference.css` | tokeni (tamna i svijetla ljuska) kao u m2-reference, uz kostur, dijalog i prsten fokusa |
| `zajednicka-stanja.html` | Z-03, Z-04, Z-05, Z-06, Z-08 i zajedničko učitavanje i greška za A-02, A-03, A-04 |
| `fokus-i-tipkovnica.html` | prsten fokusa, preskok na sadržaj, fokus nije zaklonjen, fokus u dijalogu, redoslijed tipkovnice |
| `snimke/` | PNG snimke i `SHA256SUMS` |

## Stanja

| Ekran | Stanja |
| --- | --- |
| Z-03 | sesija istekla (2 sata neaktivnosti ili najviše 12 sati, D-200; istek nije odjava; uz izmjene samo na uređaju), odjavljen u drugoj kartici, bez mreže |
| Z-04 | stranica ne postoji, greška poslužitelja s oznakom za podršku |
| Z-05 | nema ovlasti |
| Z-06 | kostur popisa, dugo učitavanje, smanjeno kretanje (kostur miruje) |
| Z-08 | slanje na pregled (nastavak pisanja dopušten), konačna predaja (zaključava rad), opasna radnja, dijalog s poljem (fokus u dijalogu) |
| A-02, A-03, A-04 | učitavanje i greška za svaki od tri ekrana (šest okvira); ostala stanja ostaju u m2-reference |
| Fokus | prsten 3 px / razmak 4 px, preskok na sadržaj, fokus nije zaklonjen (WCAG 2.2, 2.4.11), redoslijed tipkovnice 1 do 5 |

## Snimke

Za oba lista (`stanja-`, `fokus-`): `tamna` i `svijetla` ljuska, širine 1440 i 400 px, ukupno 8 datoteka u `snimke/`.

Playwright Chromium, cijela stranica, DPR 1, `data-theme="light"` za svijetle snimke, nakon `document.fonts.ready`. Provjereno: nema vodoravnog prelijevanja (`scrollWidth <= clientWidth`) i sve radnje imaju najmanje 44×44 px.

## Granice

- Podaci su izmišljeni; nijedan stvarni rad ni osoba.
- Oznake `.ref-tag` nisu tekst sučelja.
- Tekstovi su provjereni skenerom zabranjenih izraza.
