# Referentna slika M9: A-AI-POL (paket 14, DAN-411)

Paket 14 iz `docs/design/EKRANI.md` §4, ovdje samo ekran A-AI-POL; S31-AI i N-AI-ATT idu u zasebne PR-ove. Smjer je „papir i grafit” (D-188, `docs/design/DESIGN-SYSTEM.md`). Samo specifikacija sučelja (D-269 O7), bez koda. Spajanje PR-a vlasnikovom porukom „Spoji n” znači odobrenje slika kao reference (D-183); dotad su prijedlog. Podaci su izmišljeni.

## Stranice

| Stranica | Stanja | Izvori |
|---|---|---|
| `a-ai-pol.html` | pregled i uređivanje, pružatelji samo za čitanje, objava nove verzije, neispravan unos, trošak nije podešen, učitavanje i greška | D-267 O5, D-270 O11 |

Snimke su u `snimke/<stranica>-<tamna|svijetla>-<1440|400>.png`: Playwrightov Chromium, cijela stranica, DPR 1, nakon `document.fonts.ready`, bez vodoravnog pomicanja. Svijetla ljuska je `data-theme="light"`. Kontrolni zbrojevi su u `SHA256SUMS`.

## Odluke u slici

- A-AI-POL: administrator mijenja samo pravilo i pragove. Pružatelji su samo za čitanje iz verzionirane konfiguracije `config/faculties` (D-270 O11). Prazna konfiguracija troška znači da je Asistent isključen (D-267 O5). Studentu se razlog ne iznosi.
- N-19 se ne crta.

## Granice

- Stanja su izvedena iz navedenih odluka jer opis zadatka u Linearu nije bio dostupan; vlasnik ih potvrđuje spajanjem.
- Iznosi granica su primjer.
- A-AI-POL nije imao redak u `EKRANI.md`; dodan je uz ovaj paket.

## Provjera rječnika

Tekst je provjeren funkcijom `findForbiddenTerms` (`scripts/forbidden-terms/terms.ts`) nad vidljivim tekstom i atributima `aria-label`, `title`, `alt`, `placeholder`. `scan.ts` ne čita `docs/design/`, pa je provjera pokrenuta izravno. Prvi prolaz je prijavio „spremljeno” bez pojašnjenja u dvije rečenice; tekst je ispravljen i ponovni prolaz nema nalaza.
