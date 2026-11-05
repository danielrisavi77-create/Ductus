# M0.5c: vizualna potvrda ljuske (D-183, DAN-344)

Snimke stvarne aplikacije na `main` `061fce2d` (PR #1431), cijela stranica, svijetla i tamna tema × 1440 i 400 px. Postupak: `docs/SESSIONS.md` §6; referenca: `docs/design/DESIGN-SYSTEM.md` („papir i grafit”, D-188). Sav tekst je sintetički (lokalni demo, bez stvarnih osobnih podataka).

## Uvjeti snimanja

- Produkcijska gradnja (`pnpm build`), `next start` s `DUCTUS_LOCAL_DEMO_JOURNAL=1`, `DUCTUS_DEPLOYMENT=local`; `APP_DATABASE_URL` je samo lažni niz (baza nije spojena).
- Playwright Chromium (`@playwright/test` 1.63.0 iz repoa), Linux, DPR 1, hr-HR, `fullPage`, visina prozora 900 px.
- Tema je cijeli dokument (Z-13a): `localStorage["ductura.theme"]` = `light` ili `dark`; `data-theme` na `<html>` izmjeren je u svakoj snimci.
- Na `/rad` i `/` snimke „svijetla” imaju Bijeli list, a „tamna” Tamni list (prekidač lista). Dodatno `rad-tamna-bijeli-list-*` prikazuje zadanu kombinaciju (tamna ljuska, bijeli list).
- **Nije snimljeno:** stanje nakon prijave (lažni OIDC). Traži Docker stog (`pnpm stack:*`), a u ovom okruženju nema Dockera. Snimljene rute su `/` (javna naslovnica), `/prijava` i `/rad` (lokalni uređivač bez prijave). Prijavljena naslovnica i studentski/nastavnički ekrani ostaju za sesiju sa stogom.
- **Referenca:** snimke su uspoređene s pisanom specifikacijom DESIGN-SYSTEM (izmjereni `--ground` `#242422` / `#f3f2ee`, list `#fcfbf8`, tinta) i pregledom slika. Odobrene PNG reference ljuske `/rad` nema u repou (`screenshots-v3` je povijesna bordo/bakar paleta, `m3-` i `m4-reference` ne pokrivaju ljusku), pa usporedba slika uz sliku nije izvedena; to je nepotpun dio provjere, ne tvrdnja „izgleda isto”.

## Tablica: ruta × tema × širina → ishod

**Pažnja:** „odgovara specifikaciji” znači samo da se izmjerene boje i raspored slažu s pisanim DESIGN-SYSTEM-om. Usporedba sa odobrenom slikom nije izvedena (slike ljuske `/rad` nema u repou), pa to nije potvrda vizualne podudarnosti.

| Ruta | Tema | Širina | Ishod (prema pisanoj specifikaciji, ne prema odobrenoj slici) | Opis |
| --- | --- | --- | --- | --- |
| `/rad` | svijetla | 1440 | odgovara specifikaciji | Tlo `#f3f2ee`, bijeli list `#fcfbf8`, tamno zlato; tri stupca, traka stanja dolje. |
| `/rad` | svijetla | 400 | odstupa (malo) | Navigacija iza gumba izbornika, upute/literatura i struktura u harmonikama pod listom. Ispod harmonika do trake stanja ostaje prazna ploha (kao u tamnoj temi). Stavka 2. |
| `/rad` | tamna | 1440 | odgovara specifikaciji | Grafit `#242422`, tamni list s tintom `#faf9f5`; zadana kombinacija je u `rad-tamna-bijeli-list-1440.png`. |
| `/rad` | tamna | 400 | odstupa (malo) | Isti raspored kao svijetla. Ispod harmonika do trake stanja ostaje prazna ploha druge nijanse od tla. Stavka 2. |
| `/` | svijetla | 1440 | odstupa | Stranica ostaje tamna iako je `data-theme="light"`. Stavka 1. |
| `/` | svijetla | 400 | odstupa | Isto. Sadržaj se uredno prelama. |
| `/` | tamna | 1440 | odgovara specifikaciji | Grafit, zlato samo za glavnu radnju, bijeli list u primjeru. |
| `/` | tamna | 400 | odgovara specifikaciji | Jedan stupac. |
| `/prijava` | svijetla | 1440 | odstupa | Tamna iako je tema svijetla (stavka 1). Kompozicija Archivum odgovara. |
| `/prijava` | svijetla | 400 | odstupa | Isto (stavka 1). |
| `/prijava` | tamna | 1440 | odgovara specifikaciji | Archivum u paleti papir i grafit; jedina radnja je „Prijava sustavom AAI@EduHr” (D-09). |
| `/prijava` | tamna | 400 | odgovara specifikaciji | Jedan stupac. |

## Odstupanja za zasebne stavke (kod se ovdje ne popravlja)

1. **Naslovnica i `/prijava` ne prate svijetlu temu.** DESIGN-SYSTEM to navodi kao privremeno („zasad ostaju tamne, do #1024 i J-01”), pa to nije kršenje specifikacije nego otvoren posao: #1024 je spojen, a stranice su i dalje tamne. Treba odluku: svijetla varijanta ili ažuriranje specifikacije.
2. **`/rad` 400 px: prazna ploha ispod harmonika** (vidljivo u obje teme): provjeriti treba li popuniti istim tlom do trake stanja ili je namjerno. Isto u svijetloj temi (`rad-svijetla-400.png`).
3. **Prijavljeno stanje nije snimljeno** (nema Dockera): ponoviti `/` kao prijavljen korisnik i studentske/nastavničke rute uz stog.

Snimke su u `snimke/` (`<ruta>-<tema>-<širina>.png`).
