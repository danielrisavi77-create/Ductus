# Referentne slike M10, vlastiti podaci studenta: S-42, S-44 (paket 15, DAN-604)

Paket 15 iz `docs/design/EKRANI.md` (redak paketa za M10). Ekrani su S-42 Dnevnik pristupa (vlastiti) i S-44 Izvoz vlastitih podataka. Smjer je „papir i grafit” (D-188, `docs/design/DESIGN-SYSTEM.md`). Spajanje PR-a vlasnikovom porukom „Spoji n” znači odobrenje slika kao reference (D-183). Dotad su prijedlog. Paket 16 (A-05, A-06, A-08) je u `../m10-admin-reference`.

Nijedan od dva ekrana nema prototip. Složeni su po svom retku u `docs/design/EKRANI.md` od dijelova `../m5-reference` i `../m5-reference-c`:

- S-42, prototip NEMA, stanja popunjeno, opoziv, prazno, učitavanje, greška i mobitel;
- S-44, prototip NEMA, stanja zahtjev, posao u tijeku, preuzimanje, istek, greška i mobitel.

S-18 (vlastita povijest rada) i S-46 (paket zaštite studenta) nisu nacrtani. Oba su uvjetni ekrani (paket U, EQ5) i crtaju se tek kad je uvjet ispunjen. S-18 čeka uvjet U-8, pravno mišljenje D-55 i potvrdu C-19 (M10.8, D-274 MQ09). S-46 je M10.9; ovisi o M7.10 i M10.5 i veže ga uvjet U-5 (`docs/PROGRAM-RAZRADA.md`).

## Stranice

| Stranica | Stanja | Izvori |
|---|---|---|
| `s42-dnevnik-pristupa.html` | popunjeno, opoziv, prazno, učitavanje, greška | PRODUCT §5 pravilo 17, C-4, D-274 MQ10, D-130 |
| `s44-izvoz-podataka.html` | zahtjev, posao u tijeku, preuzimanje, istek, greška | D-173, D-273 MQ08, D-271 MQ02, D-09 |

Mobitel je snimka širine 400 px.

Snimke su u `snimke/<stranica>-<tamna|svijetla>-<1440|400>.png`:

- `s42-tamna-1440.png`, `s42-tamna-400.png`, `s42-svijetla-1440.png`, `s42-svijetla-400.png`
- `s44-tamna-1440.png`, `s44-tamna-400.png`, `s44-svijetla-1440.png`, `s44-svijetla-400.png`

Izrađene su Playwrightovim Chromiumom: cijela stranica, DPR 1, nakon `document.fonts.ready`, bez vodoravnog pomicanja na obje širine. Svijetla ljuska je `data-theme="light"` na `<html>`. Kontrolni zbrojevi su u `SHA256SUMS`. `reference.css` uvozi `../m5-reference-c/reference.css` i dodaje samo dva stupca, naslov dana, redak dnevnika, oznaku otvorene odluke i korake posla izvoza.

## Odluke u slici

- **Dnevnik pristupa (S-42).**
  - Student vidi tko je i kada otvorio njegov rad i što je otvoreno (PRODUCT §5 pravilo 17, C-4).
  - Retci su po 5 minuta, grupirani po danu, najnoviji dan prvi. Nema zbroja posjeta ni trajanja (D-274 MQ10).
  - Mentorove radne bilješke nisu dio dnevnika (D-130); slika to kaže u objašnjenju.
  - Čitatelj je označen ulogom (mentor, nastavnik kolegija); imena su izmišljena.
  - **Opoziv je tumačenje.** `docs/design/EKRANI.md` navodi stanje „opoziv”, ali ga ne opisuje. Slika ga tumači kao prestanak nečijeg pristupa radu (na primjer promjena upisa na kolegiju): dnevnik kaže od kada ta osoba više nema pristup, a retci prije tog datuma ostaju. Ako je mišljen opoziv prava u smislu D-263 Q03 ili nešto treće, stanje se precrtava.
- **Izvoz vlastitih podataka (S-44).**
  - Paket sadrži PDF teksta predane verzije, potpisanu potvrdu predaje i manifest s otiscima; poveznica vrijedi 24 sata (D-173).
  - Izvoz je posao: zahtjev, slaganje paketa, poveznica spremna. Student može zatvoriti stranicu dok se paket slaže.
  - Preuzimanje se upisuje u revizijski trag. Uz poveznicu stoje rok valjanosti i otisak manifesta.
  - Nakon isteka paket je uklonjen; novi izvoz je novi posao nad istom predanom verzijom (D-273 MQ08). Istek i greška kažu da rad i predaja nisu promijenjeni.
  - Bivši student bez računa AAI@EduHr izvoz traži u referadi fakulteta (D-271 MQ02, D-09); slika ne nudi drugi način prijave.
  - Koraci se razlikuju riječju i oblikom oznake: puna točka (gotovo), debeli prsten i podebljan tekst (sada), tanki krug (slijedi).

## Granice

- Ikone nisu dio slike; gumbi nose tekst.
- Oznake u velikim slovima („Stanje 1 · …”) i sitne bilješke ispod okvira opisuju referencu i nisu tekst sučelja. Brojevi odluka stoje samo u bilješkama.
- Tipkovnički redoslijed (EQ6) je bilješka na dnu svake stranice.
- Svi su podaci izmišljeni (Nastavnik B, Nastavnik C, naslov rada, vremena, otisak manifesta, veličina paketa).

## Provjera rječnika

Tekst obje stranice i ovog README-a, uključujući atribute `aria-label`, `title`, `alt`, `placeholder` i `value`, prošao je `findForbiddenTermsInMarkup` i `findForbiddenTerms` iz `scripts/forbidden-terms/terms.ts` bez nalaza (`docs/PRODUCT.md` §5).
