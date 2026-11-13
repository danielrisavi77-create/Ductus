# Referentne slike M12, operater pilota: A-01 i STOP poruka (paket 19, DAN-605)

Paket 19 iz `docs/design/EKRANI.md` (redak „Operater (m12-reference) | A-01 | status pilota, STOP poruka”). Ovdje su A-01, operaterski status pilota, i STOP poruka (u zadatku B-08). Smjer je „papir i grafit” (D-188, `docs/design/DESIGN-SYSTEM.md`). Spajanje PR-a vlasnikovom porukom „Spoji n” znači odobrenje slika kao reference (D-183). Dotad su prijedlog.

Status prototipa po retku u `docs/design/EKRANI.md`: A-01, prototip NEMA. STOP poruka nema svoj redak; traženo stanje „STOP stanje” je u retku A-01. Ekrani su složeni od dijelova `../m5-reference` i `../m5-reference-c`.

## Stranice

| Stranica | Stanja | Izvori |
|---|---|---|
| `a01-status-pilota.html` | popunjeno (pilot radi), prazno (prije faze A), učitavanje, greška, STOP (pilot zaustavljen, uvjeti ponovnog pokretanja) | `docs/OPERATIONS.md` „Pilot (M12)”, `docs/PROGRAM.md` (O05), D-12, `/stanje` (DAN-429) |
| `b08-stop-poruka.html` | operater: potvrda zaustavljanja, učitavanje, greška; student: poruka nakon zaustavljanja; nastavnik: poruka nakon zaustavljanja | `docs/OPERATIONS.md` STOP postupak t. 1 do 4, D-69, D-12 |

Mobitel je snimka širine 400 px.

Snimke su u `snimke/<stranica>-<tamna|svijetla>-<1440|400>.png`:

- `a01-tamna-1440.png`, `a01-tamna-400.png`, `a01-svijetla-1440.png`, `a01-svijetla-400.png`
- `b08-tamna-1440.png`, `b08-tamna-400.png`, `b08-svijetla-1440.png`, `b08-svijetla-400.png`

Izrađene su Playwrightovim Chromiumom: cijela stranica, DPR 1, nakon `document.fonts.ready`, bez vodoravnog pomicanja na obje širine. Svijetla ljuska je `data-theme="light"` na `<html>`. Kontrolni zbrojevi su u `SHA256SUMS`. `reference.css` uvozi `../m5-reference-c/reference.css` i dodaje tokene upozorenja i greške (DESIGN-SYSTEM §3; m5 ih ne definira), oznaku stanja dijela, okvire STOP i zaustavljanja, gumb za zaustavljanje, skupinu izbora i popis uvjeta.

## Odluke u slici

- **A-01, status pilota.**
  - Stranica pokazuje ono što dnevni zapis iz `docs/OPERATIONS.md` traži: fazu, zamrznuto izdanje (SHA), spremnost četiri dijela (`database`, `storage`, `signing`, `queue` iz `/api/ready`) i pokazatelje s pragovima (rekonstrukcija 100 %, izgubljen rad, neovlašten pristup i lažan status 0).
  - Stanje dijela ima riječ i oblik oznake: puna točka „Radi”, prsten „Ne radi”, crtica „Nije uključeno”. Riječi su iste kao na `/stanje` (DAN-429), boja nije jedini nositelj.
  - Greška učitavanja kaže da ne znači da pilot ne radi, i ostavlja gumb „Zaustavi pilot”: zaustavljanje ne smije ovisiti o tome je li se status učitao.
  - U STOP stanju vidi se vrijeme (lokalno i UTC), okidač, ID incidenta i izdanje okidača, kako traži STOP postupak t. 1. Pojedinosti incidenta su samo u zapisu incidenta.
  - Ponovno pokretanje je onemogućeno dok nema zapisa incidenta i izdanja s potvrđenim ispravkom; razlog se čita uz gumb.
- **STOP poruka.**
  - Operater bira okidač iz zatvorenog skupa (tri okidača iz `docs/OPERATIONS.md`) i upisuje samo ID zapisa incidenta. Izdanje i vrijeme bilježe se sami.
  - Greška kaže da pilot i dalje radi i zadržava upisano.
  - Student vidi tri tvrdnje koje STOP postupak jamči: Ductura je privremeno zaustavljena, zaustavljanje nema posljedica za studenta (t. 2), ništa se ne briše (t. 4, D-12). Poruka ne govori o stanju rada ni predaje, jer bi kod okidača „gubitak rada” takva tvrdnja bila lažan status.
  - Nastavnik vidi istu poruku i upute za predaju i rokove; obavijest studentima šalje FPZG (t. 3).
  - Okidač, izdanje i ID incidenta vidi samo operater.

## Tumačenje i otvoreni ulazi

- **„B-08” iz zadatka** nema redak u `docs/design/EKRANI.md`. Tumačim ga kao STOP poruku iz retka paketa 19, kako je navedeno u ugovoru na #1836 (c.6863219039).
- Ulazi koji nisu odlučeni stoje u slici kao `{…}, otvoreno` s isprekidanim rubom. Ne izmišljam ih:
  - tko smije zaustaviti pilot (Q-13) i tko odobrava ponovno pokretanje (prijedlog O05 u `docs/PROGRAM.md`: koordinator FPZG-a ili operater zaustavlja, ponovno pokretanje traži oba);
  - zamjenski postupak predaje (D-69, FPZG) i kanal obavijesti (STOP postupak t. 3);
  - tko na FPZG-u odlučuje o produljenju roka;
  - što student može otvoriti dok je pilot zaustavljen (čitanje vlastitog rada ili ništa);
  - oblik oznake izdanja i izvor brojeva pokazatelja (dnevni zapis ili mjerenje u aplikaciji).
- Mehanizam zaustavljanja u aplikaciji planiran je za M12 (STOP postupak t. 4); slika ne određuje kako se gasi ni što se zaključava.
- STOP postupak u `docs/OPERATIONS.md` je PRIJEDLOG. Promjena okidača ili pragova mijenja i ove slike.

## Granice

- Ikone nisu dio slike; gumbi nose tekst.
- Oznake u velikim slovima („Stanje 1 · …”) i sitne bilješke ispod okvira opisuju referencu i nisu tekst sučelja. Brojevi odluka stoje samo u bilješkama.
- Tipkovnički redoslijed (EQ6) je bilješka na dnu svake stranice.
- Svi su podaci izmišljeni (datumi, vremena, SHA izdanja, INC-0003, brojevi pokazatelja).

## Provjera rječnika

Tekst obje stranice i ovog README-a, uključujući atribute `aria-label`, `title`, `alt`, `placeholder` i `value`, prošao je `findForbiddenTermsInMarkup` i `findForbiddenTerms` iz `scripts/forbidden-terms/terms.ts` bez nalaza (`docs/PRODUCT.md` §5).
