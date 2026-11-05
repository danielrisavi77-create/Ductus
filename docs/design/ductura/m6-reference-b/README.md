# Referenca M6, dio B: N-08 i N-12 (DAN-514, M6.UX-R, PR 2 od 3)

Prijedlog slike za korake M6.3, M6.4, M6.5 (N-08: komentari, prijedlozi, zahtjevi za doradu) i M6.9 (N-12: konzultacije), bez produktnog koda. Spajanje ove mape vlasnikovom porukom „Spoji n” znači odobrenje reference (D-183, `docs/SESSIONS.md` §6.1). Dok toga nema, referenca je prijedlog.

Izvori: issue #1426 (izvještaj UX prolaza #1091), D-21, D-34, D-45, D-47, D-135 (uvjetno, D-55), D-188, D-244, D-248, `docs/PRODUCT.md` §5 pravila 2, 4, 5 i 8, `docs/design/DESIGN-SYSTEM.md`.

Opseg po odluci orkestratora (#1091): PR 1 M6.2 (S-34, N-09), PR 2 ovaj, PR 3 M6.6/M6.7 i M6.10. Ekrani s postojećom referencom (`komentari-mobitel.dc.html`, `povjerenstvo.dc.html`) ne rade se ponovno. Naziv N-12: `docs/FEATURES.md` ga drugačije opisuje od `docs/PROGRAM-RAZRADA.md`; ovdje vrijedi PROGRAM-RAZRADA (konzultacije, M6.9), kako je dodijeljeno.

## Sadržaj

| Datoteka | Što je |
|---|---|
| `n08-komentari-prijedlozi-dorada.html` | N-08, petnaest stanja |
| `n12-konzultacije.html` | N-12, devet stanja |
| `reference.css` | tokeni „papir i grafit” (DESIGN-SYSTEM §3), fontovi iz `app/fonts` |
| `snimke/` | PNG snimke, osam komada |

## Stanja

| Ekran | Stanja |
|---|---|
| N-08 | komentar nastavnika; prijedlog (prekriženo i umetnuto, `aria-live`); prihvaćen prijedlog s izvorom „primijenjeni prijedlog” (D-34); izravne izmjene isključene i uključene (D-244, vidljivo i opozivo); zahtjev za doradu: otvoren, student navodi da je proveden, nastavnik prihvatio, ponovno otvoren, student ne pristaje uz obrazloženje (D-45); „promijenjeno nakon prihvaćanja”; učitavanje, prazno, pogreška, nema pristupa |
| N-12 | popis konzultacija; zapis (datum, tema, verzija rada, dogovoreno) za mentora; isti zapis za studenta; novi zapis; „Bilješka mentora (privatno)” kao uvjetno stanje izvan zadanog prikaza (D-135, ovisi o D-55); učitavanje, prazno, pogreška, nema pristupa |

Student vidi isto što i nastavnik (pravilo 5); svaka je izmjena pripisana autoru (pravilo 8).

## Snimke

Osam datoteka u `snimke/`:

| Datoteka | Ekran | Tema | Širina |
|---|---|---|---|
| `n08-svijetla-1440.png` | N-08 | svijetla | 1440 px |
| `n08-svijetla-400.png` | N-08 | svijetla | 400 px |
| `n08-tamna-1440.png` | N-08 | tamna | 1440 px |
| `n08-tamna-400.png` | N-08 | tamna | 400 px |
| `n12-svijetla-1440.png` | N-12 | svijetla | 1440 px |
| `n12-svijetla-400.png` | N-12 | svijetla | 400 px |
| `n12-tamna-1440.png` | N-12 | tamna | 1440 px |
| `n12-tamna-400.png` | N-12 | tamna | 400 px |

 Playwrightov Chromium, cijela stranica, `deviceScaleFactor` 1, svijetla tema je `data-theme="light"` na `<html>`, fontovi pričekani s `document.fonts.ready`. Ni na jednoj širini ni u jednoj temi nema vodoravnog pomicanja.

## Granice

- Nema ikona, skripti ni vanjskih resursa; samo tekstualne kontrole.
- Nema ocjena, postotaka ni mjere vremena ili ritma (pravila 2 i 4).
- Svi su podaci izmišljeni; nema stvarnih osoba.
- Oznake „Stanje n · …” opisuju referencu i nisu tekst sučelja.
- Tekst provjeren funkcijama iz `scripts/forbidden-terms/terms.ts` (`tests/unit/m6-reference-b.test.ts`).
- Engleska varijanta nije u opsegu (D-247).
