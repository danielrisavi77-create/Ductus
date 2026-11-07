# Referentne slike M9: S31-AI, N-AI-ATT i A-AI-POL (paket 14, DAN-411)

Paket 14 iz `docs/design/EKRANI.md` §4. Smjer je „papir i grafit” (D-188, `docs/design/DESIGN-SYSTEM.md`). Samo specifikacija sučelja (D-269 O7), bez koda. Spajanje PR-a vlasnikovom porukom „Spoji n” znači odobrenje slika kao reference (D-183); dotad su prijedlog. Podaci su izmišljeni.

## Stranice

| Stranica | Stanja | Izvori |
|---|---|---|
| `s31-ai.html` | nema uporabe, izjavljeno s obveznim razgovorima i putem do pregleda, pregled točnih verzija svih razgovora koji se prilažu (2b), potvrda dostupna tek nakon pregleda, učitavanje, greška (predaja ostaje moguća), Asistent nije dopušten (izjava ostaje), unos i pregled vanjskog razgovora kao izjavljeno (7) | D-40, D-41, D-77, PRODUCT §5 pravila 1, 2, 3, 13 |
| `n-ai-att.html` | popunjeno, obvezni razgovor priložen a ostali nisu, nema uporabe, učitavanje, greška, prazno | D-41, D-58, PRODUCT §5 pravila 1, 2, 3, 12, 13 |
| `a-ai-pol.html` | pregled i uređivanje, pružatelji samo za čitanje, objava nove verzije, neispravan unos, trošak nije podešen, učitavanje i greška | D-267 O5, D-270 O11 |

Snimke su u `snimke/<stranica>-<tamna|svijetla>-<1440|400>.png`: Playwrightov Chromium, cijela stranica, DPR 1, nakon `document.fonts.ready`, bez vodoravnog pomicanja. Svijetla ljuska je `data-theme="light"`. Kontrolni zbrojevi su u `SHA256SUMS`.

## Odluke u slici

- Izjava se sastavlja iz zapisa (D-40). Razgovori iz kojih je tekst prenesen u rad obvezno se prilažu uz izjavu i student prije potvrde vidi njihove točne verzije (D-41, D-263 Q22); ostale razgovore student prilaže sam, razgovor je njegov dok piše.
- Nastavnikov prikaz ima tri osi: izjava, zapis, razgovori. Iznosi činjenice, bez postotka, ocjene i oznake o studentu. Kad se izjava i zapis slažu, to je samo rečenica o slaganju.
- A-AI-POL: administrator mijenja samo pravilo i pragove. Pružatelji su samo za čitanje iz verzionirane konfiguracije `config/faculties` (D-270 O11). Prazna konfiguracija troška znači da je Asistent isključen (D-267 O5). Studentu se razlog ne iznosi.
- N-19 se ne crta.

## Granice

- Stanja su izvedena iz navedenih odluka jer opis zadatka u Linearu nije bio dostupan; vlasnik ih potvrđuje spajanjem.
- Iznosi granica su primjer.
- A-AI-POL nije imao redak u `EKRANI.md`; dodan je uz ovaj paket.

## Provjera rječnika

Tekst je provjeren funkcijom `findForbiddenTerms` (`scripts/forbidden-terms/terms.ts`) nad vidljivim tekstom i atributima `aria-label`, `title`, `alt`, `placeholder`. `scan.ts` ne čita `docs/design/`, pa je provjera pokrenuta izravno. Prvi prolaz je prijavio „spremljeno” bez pojašnjenja u dvije rečenice; tekst je ispravljen i ponovni prolaz nema nalaza.
