# Referenca M2.11: A-02 i A-03 (DAN-313, M2.11-P02 i P03)

Prijedlog slike za zaslone administracije ustanove, bez produktnog koda. Spajanje ove mape vlasnikovom porukom „Spoji <n>” znači odobrenje reference (D-183, `docs/SESSIONS.md` §6.1). Dok toga nema, referenca je prijedlog.

Izvori: `docs/PROGRAM-RAZRADA.md` M2.11 i karta zaslona (A-02, A-03), `docs/engineering/PLAN-TOKOVI-2026-10-25.md` C1–C3, D-188, D-200 (P7), D-204, D-203 t. 8, `docs/PRODUCT.md` §5 i §6, `docs/design/DESIGN-SYSTEM.md`, ugovor na #1091 (c.6588472069).

## Sadržaj

| Datoteka | Što je |
|---|---|
| `a02-korisnici-i-uloge.html` | A-02 — Korisnici i uloge: potvrda i opoziv uloge nastavnika, oznaka P7, šest stanja |
| `a03-kolegiji-tim-i-grupe.html` | A-03 — Kolegiji i akademske godine: nastavni tim i seminarske grupe, šest stanja |
| `reference.css` | tokeni „papir i grafit” (DESIGN-SYSTEM §3) i fontovi iz `app/fonts` |
| `snimke/` | PNG snimke, tablica dolje |

## Stanja A-02

| Stanje | Sadržaj |
|---|---|
| 1 popunjeno | „Čekaju potvrdu uloge” (osobe kojima je zadnja prijava preko AAI@EduHr dala pravo nastavnika) i „Potvrđeni nastavnici”; ranije opozvana osoba ponovno čeka potvrdu, s datumom opoziva kao činjenicom |
| 1 oznaka P7 | „Za pregled”: zadnja prijava nije dala pravo nastavnika, uloga nije opozvana i ostaje dok administrator ne odluči (D-200 P7) |
| 2 prazno | „Nitko ne čeka potvrdu uloge.” i „Na ustanovi još nema potvrđenih nastavnika.” |
| 3 potvrda | dijalog s posljedicama i upisom u revizijski trag, zatim ishod u `role="status"` |
| 4 opoziv | dijalog s posljedicama (kolegiji ostaju, ponovna prijava vraća osobu na čekanje, revizijski trag), zatim ishod |
| 5 greška | neuspjelo čitanje s „Pokušaj ponovno”, prekinuta veza nakon radnje u dijalogu (ishod nije poznat, „Provjeri stanje” prije ponavljanja), promijenjeno stanje („više ne čeka potvrdu … Popis je osvježen.”) |
| 6 bez ovlasti | isti 404 kao za nepostojeću adresu, bez trake administracije |

## Stanja A-03

| Stanje | Sadržaj |
|---|---|
| 1 popunjeno | akademska godina s izborom godine; kolegij s brojem upisanih studenata, nositeljem, nastavnim timom i grupama; grupa bez nastavnika označena tekstom „Bez nastavnika” i radnjom „Dodijeli nastavnika”; kolegij bez grupa |
| 2 prazno | „Za ovu akademsku godinu ustanova nema kolegija.” |
| 3 potvrda dodjele | dijalog s izborom koji nudi samo potvrđene nastavnike ustanove (D-204), zatim ishod |
| 4 opoziv dodjele | uklanjanje nastavnika iz grupe; uloga na ustanovi ostaje, opoziv uloge je u A-02 |
| 5 greška | neuspjelo čitanje, prekinuta veza nakon dodjele (ishod nije poznat, „Provjeri stanje”), promijenjeno stanje (odabrana osoba više nema potvrđenu ulogu) |
| 6 bez ovlasti | isti 404 kao u A-02 |

Neuspjelo čitanje na oba zaslona nikad se ne prikazuje kao prazan popis ni kao nule. Kad se veza prekine nakon radnje, ishod se prikazuje kao nepoznat: referenca ne tvrdi ni da je promjena provedena ni da nije.

## Snimke

| Datoteka | Zaslon | Širina | Tema |
|---|---|---|---|
| `snimke/a02-tamna-1440.png` | A-02 | 1440 | tamna |
| `snimke/a02-tamna-400.png` | A-02 | 400 | tamna |
| `snimke/a02-svijetla-1440.png` | A-02 | 1440 | svijetla |
| `snimke/a02-svijetla-400.png` | A-02 | 400 | svijetla |
| `snimke/a03-tamna-1440.png` | A-03 | 1440 | tamna |
| `snimke/a03-tamna-400.png` | A-03 | 400 | tamna |
| `snimke/a03-svijetla-1440.png` | A-03 | 1440 | svijetla |
| `snimke/a03-svijetla-400.png` | A-03 | 400 | svijetla |

Snimljeno Playwrightovim Chromiumom, cijela stranica, `deviceScaleFactor` 1. Svijetla tema je `data-theme="light"` na `<html>`. Prije snimanja čekaju se fontovi (`document.fonts.ready`). Na svakoj snimci provjereno je `scrollWidth <= clientWidth` (nema vodoravnog pomicanja), a na 400 px svaki vidljivi gumb i izbornik visok je najmanje 44 px.

## Granice

- Ljuska je uska bočna traka od 64 px (D-202 t. 1). Ikone iz dizajnerskog paketa nisu korištene (D-203 t. 8), pa stavke trake nose kratak tekst u metama od 44 px. Ispod 800 px traka postaje izbornik iza gumba „Izbornik”.
- Znak „D” na vrhu trake je poveznica na početnu stranicu uloge (D-202 t. 2); na uskom zaslonu prikazuje se puni naziv.
- Svi su podaci izmišljeni: osobe, kolegiji, datumi i brojevi studenata. Nema stvarnih osoba.
- Oznake u velikim slovima („Stanje 3 · potvrda · dijalog i ishod”) opisuju referencu i nisu tekst sučelja.
- Administrator ne vidi radove ni njihov sadržaj (`docs/PRODUCT.md` §6); A-03 prikazuje samo brojeve upisanih studenata po kolegiju i grupi.
- Nije odlučeno uređuje li nastavni tim i grupe administrator ili nositelj kolegija. Referenca crta radnje u A-03 kao administratorove; ako odluka padne drukčije, A-03 postaje samo čitanje, a radnje prelaze na zaslon nositelja.
- Upis promjena tima i grupa u revizijski trag još nije na `main`, pa A-03 namjerno ne tvrdi da se dodjela upisuje u revizijski trag. A-02 to tvrdi za potvrdu i opoziv uloge (`audit.teacher_role_event`).
- Tekst sučelja i atributi (`aria-label`, naslov stranice) provjereni su funkcijom `findForbiddenTermsInMarkup` iz `scripts/forbidden-terms/terms.ts` i nemaju nalaza.
