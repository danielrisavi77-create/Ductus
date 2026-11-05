# Referenca M6: S-34 i N-09, reprodukcija rada (DAN-514, M6.UX-R, PR 1 od 3)

Prijedlog slike za korak M6.2, bez produktnog koda. Spajanje ove mape vlasnikovom porukom „Spoji <n>” znači odobrenje reference (D-183, `docs/SESSIONS.md` §6.1). Dok toga nema, referenca je prijedlog.

Izvori: issue #1426 (izvještaj UX prolaza #1091), D-63, D-143, D-154, D-188, D-238, D-239, `docs/PRODUCT.md` §5 pravila 4, 5 i 7, `docs/design/DESIGN-SYSTEM.md`.

Opseg M6.UX-R po odluci orkestratora (#1091): PR 1 M6.2 (S-34, N-09); PR 2 M6.3/M6.4/M6.5 (N-08) i M6.9 (N-12); PR 3 M6.6/M6.7 (S-41, Z-07) i M6.10 (N-17). Ekrani s postojećom referencom (`komentari-mobitel.dc.html`, `povjerenstvo.dc.html`) ne rade se ponovno.

## Sadržaj

| Datoteka | Što je |
|---|---|
| `n09-reprodukcija-nastavnik.html` | N-09: reprodukcija za mentora i nastavnika zadatka, sva stanja kao varijante |
| `s34-reprodukcija-student.html` | S-34: isti prikaz za studenta vlastitog rada |
| `reference.css` | tokeni „papir i grafit” (DESIGN-SYSTEM §3), fontovi iz `app/fonts` |
| `snimke/` | PNG snimke, osam komada |

## Stanja

| Stanje | Sadržaj |
|---|---|
| glavni prikaz | uvod pri prvom otvaranju; kontrola „Promjena n od N” (klizač po redoslijedu, bez vremenske osi); brzina reprodukcije 1×, 2×, 4×; oznaka izvora promjene; opis promjene u `aria-live` |
| oznake izvora | utipkano, zalijepljeno (izvor nije opažen), uvezeno, iz AI pomoćnika, izmjena nastavnika, primijenjeni prijedlog |
| skok po sesijama | „Sesija n” bez trajanja i bez riječi o stankama (D-63) |
| učitavanje, prazno, pogreška | „Učitavam promjene rada.”, „Nema zabilježenih promjena.”, pogreška koja studentu potvrđuje da rad može pisati i predati |
| praznina u zapisu | „Praznina u zapisu” bez objašnjenja uzroka |
| nema pristupa | „Reprodukcija nije dostupna ovom računu.”; isti tekst za povjerenstvo (D-238) |
| veliki rad | prikaz po odlomcima, reprodukcija se ne blokira; tekst odabranog odlomka prikazan je tijekom reprodukcije |
| smanjeno kretanje | korak po koraku bez animacije; tipkovnica: razmaknica, strelice |
| mentorovo gledanje (S-34) | u glavnom prikazu blok „Kad je Vaš mentor gledao reprodukciju”: datum i vrijeme svakog otvaranja i opseg (cijeli rad ili odlomak), bez trajanja; popis je dio dnevnika pristupa (`docs/PRODUCT.md` §6, D-56 uvjet 4, pravilo 17, D-150); stanje 3f „Vaš mentor još nije gledao reprodukciju.” |
| napomena uz promjenu (S-34) | u glavnom prikazu unos „Napomena uz promjenu 1.284” s gumbom „Spremi napomenu”; stanje 1b prikazuje spremljenu napomenu bez uređivanja i brisanja (`docs/PRODUCT.md` §6: napomene se samo dodaju); ispravak je nova napomena s vezom na prethodnu, koja ostaje sačuvana (D-56 uvjet 4); napomena je vezana uz broj promjene, bez trajanja |
| povijest odlomka (N-09, S-34) | u glavnom prikazu tablica „Povijest odlomka 2”: prethodne verzije odlomka, čime su zamijenjene i podrijetlo (oznaka izvora); ista za obje uloge (D-56 uvjet 6) |
| oznaka prilagodbe (N-09, S-34) | stanje 7: uz reprodukciju stoji oznaka „Odobrena prilagodba”, samo oznaka bez razloga; student vidi „Na ovom radu označili ste odobrenu prilagodbu.”, mentor i nastavnik „Student je na ovom radu označio odobrenu prilagodbu.” (D-50, D-56 uvjet 5) |
| stalni tekst | „Ritam pisanja ne govori ništa o autorstvu ni o trudu.” (`docs/PRODUCT.md` §6) u svakom stanju s reprodukcijom, uključujući prazninu u zapisu i veliki rad |

Primjer je dosljedan kroz sva stanja: početci sesija su promjene 1, 640, 1.201, 2.071 i 3.012 (od 3.906); u svakoj su slici označene samo dionice trenutačne promjene (umetnuto s okvirom, obrisano prekriženo), a ranije promjene su običan tekst. Promjene 1.284 (utipkano) i 1.285 (zalijepljeno) su u sesiji 3, a 2.640 (primijenjeni prijedlog) u sesiji 4; skok na sesiju 3 prikazuje promjenu 1.201.

Student vidi isti prikaz i rečenicu „Isti prikaz vidi i Vaš mentor.” (pravilo 5 i 7). Obrisani tekst prikazan je prekriženo uz objašnjenje.

## Snimke

`snimke/{n09,s34}-{tamna,svijetla}-{1440,400}.png`: osam datoteka (dva ekrana, obje teme, 1440 i 400 px). Playwrightov Chromium, cijela stranica, `deviceScaleFactor` 1, svijetla tema je `data-theme="light"` na `<html>`, fontovi pričekani s `document.fonts.ready`. Ni na jednoj širini nema vodoravnog pomicanja.

## Granice

- Nema ikona iz dizajnerskog paketa (D-203 t. 8); samo tekstualne kontrole.
- Nema vremenske osi, trajanja, brzine tipkanja ni mjere osobe (pravilo 4, D-239).
- Svi su podaci izmišljeni; nema stvarnih osoba.
- Oznake u velikim slovima („Stanje 1 · …”) opisuju referencu i nisu tekst sučelja.
- Tekst sučelja provjeren je funkcijom `findForbiddenTerms` iz `scripts/forbidden-terms/terms.ts` nad svim tekstualnim čvorovima obiju stranica i nema nalaza.
- Engleska varijanta nije u opsegu reference (D-70, jezik tek uz engleski).
