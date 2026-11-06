# Referentne slike M9: S-16 Panel Asistent i S16-BUD (paket 13, DAN-411)

Paket 13 iz `docs/design/EKRANI.md` §4. Smjer je „papir i grafit” (D-188, `docs/design/DESIGN-SYSTEM.md`). Samo specifikacija sučelja (D-269 O7); nema koda AI pomoćnika. Spajanje PR-a vlasnikovom porukom „Spoji n” znači odobrenje slika kao reference (D-183). Dotad su prijedlog. Svi podaci su izmišljeni (Autor A, „Primjer d.o.o.”, „Model A”).

## Stranice

| Stranica | Stanja | Izvori |
|---|---|---|
| `s16-asistent.html` | 1 izbor svrhe, 2 unos uz svrhu, 3 čekanje odgovora, 4 odgovor s radnjom „Prenesi u rad”, 5 usporedba prije primjene, 6 preneseno u rad, 7 pomoćnik koji pita, 8 svrha razine 2 nije uključena, 9 Asistent nije dostupan, 10 greška pružatelja, 11 bez mreže, 12 pravo nije potvrđeno | D-41, D-42, D-46, D-58, D-64, D-268 O2 i O4, PRODUCT §5 pravila 13 i 15 |
| `s16-bud.html` | B1 dovoljno, B2 blizu granice, B3 granica po zadatku, B4 dnevna granica, B5 granica usluge, B6 učitavanje | D-267 O5, BACKEND §4.5, PRODUCT §5 pravilo 15 |

Snimke su u `snimke/<stranica>-<tamna|svijetla>-<1440|400>.png`: Playwrightov Chromium, cijela stranica, DPR 1, nakon `document.fonts.ready`, bez vodoravnog pomicanja. Svijetla ljuska je `data-theme="light"`. Kontrolni zbrojevi su u `SHA256SUMS`.

## Odluke u slici

- Katalog ima 10 svrha u dvije razine (D-268 O2). Razina 1 je ponuđena; razina 2 je zadano isključena i uključuje je nastavnik, pa se prikazuje kao onemogućena s objašnjenjem (stanje 8).
- Svaki prijenos bilježi pružatelja, model i svrhu (D-42). Nastavnik vidi vrijeme, pružatelja, model, svrhu i preneseni tekst; razgovor je studentov dok piše i ide uz izjavu (D-41).
- Prije primjene lekture ili prijevoda uspoređuju se brojke, citati i oznake izvora, a student potvrđuje (D-46, stanje 5).
- Preneseni tekst nosi podrijetlo „iz AI pomoćnika” (D-58); oznaka podudaranja ostaje isključena (D-268 O6).
- Bez mreže razgovor se čita s uređaja, a novi prijenos čeka provjeru prava na poslužitelju (D-268 O4, stanja 11 i 12).
- Proračun: brojač zahtjeva po zadatku, po danu i granica usluge. Iznosi nisu prikazani; student nikad ne plaća (pravilo 15). Granice su ilustrativne, iznose određuje vlasnik nakon mjerenja (D-267 O5). Prazna konfiguracija troška znači da je Asistent isključen (stanje 9).
- Zapis o uporabi nikad ne ide uz postotak ni ocjenu (pravila 1, 2, 3).

## Granice

- Stanja i brojke S-16 koje opis zadatka ne navodi odabrana su iz navedenih odluka; vlasnik ih potvrđuje spajanjem.
- Web pretraga samo kroz Ductusov alat, a transkripcija i alati pružatelja iza prekidača ustanove (D-267 O9, O10) nisu posebno nacrtani. Gumb za snimanje ne postoji.
- Ne crta se N-19. S31-AI, N-AI-ATT i A-AI-POL su paket 14.

## Provjera rječnika

Tekst stranica provjeren je funkcijom `findForbiddenTerms` iz `scripts/forbidden-terms/terms.ts`: bez nalaza. `scripts/forbidden-terms/scan.ts` ne čita `docs/design/`, pa je provjera pokrenuta izravno nad tekstom i atributima `aria-label`, `title`, `alt` i `placeholder`; ispravnost je potvrđena kontrolnim tekstom s zabranjenim izrazima, koji je prijavljen.
