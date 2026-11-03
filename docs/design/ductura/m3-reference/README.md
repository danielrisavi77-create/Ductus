# Referenca M3: S-10 i Z-11 (DAN-504, M3.UX-R)

Ova mapa je prijedlog slike za korak M3.UX-R i ne sadrži produktni kod. Kad vlasnik spoji mapu porukom „Spoji <n>”, referenca je odobrena (D-183, `docs/SESSIONS.md` §6.1). Do tada je samo prijedlog.

Izvori:
- issuei #1332 do #1335;
- izvještaj UX prolaza M3 (DAN-493) i komentar BLOK s10 na #1091 (c.6586483666);
- odluke D-181, D-183, D-188, D-203 t. 8 i D-207 do D-216;
- `docs/PRODUCT.md` §5 (rječnik i pravilo 10), `src/domain/sync/labels.ts`, `src/lib/i18n/messages.hr.ts` i `docs/design/DESIGN-SYSTEM.md`.

## Sadržaj

| Datoteka | Što je |
|---|---|
| `s10-stanja-spremanja.html` | S-10: stanja spremanja u editoru (statusna traka i obavijest iznad lista) |
| `z11-druga-kartica-i-bez-mreze.html` | Z-11: druga kartica i rad bez mreže |
| `reference.css` | tokeni „papir i grafit” (DESIGN-SYSTEM §3) i fontovi iz `app/fonts` |
| `snimke/` | PNG snimke, popis je u tablici dolje |

## Stanja

| Stanje | Issue | Sadržaj |
|---|---|---|
| S-10 1a slanje | — | „Sinkroniziram”, postojeća oznaka i ton; služi za usporedbu |
| S-10 1b potvrda čeka potpis | #1332 | „Primljeno na poslužitelju, čeka potvrdu”. Točka je prsten u boji poslužitelja, ne pulsira i ne postaje puna. Ne piše „spremljeno na poslužitelju” |
| S-10 1c nakon praga | #1332 | ton prelazi u upozorenje: „Primljeno na poslužitelju, potvrda kasni”. Obavijest kaže da je tekst na uređaju i da se može nastaviti pisati. Prag se predlaže na 10 minuta i čeka vlasnikovu potvrdu |
| S-10 2a–2c neuspjeh spremanja | #1333 | oznaka „Ne sprema se na uređaj” sama kaže posljedicu, a uz nju je radnja „Izvezi tekst”. Svaki razlog ima svoju obavijest: nema prostora (s jednim korakom za oslobađanje prostora i napomenom da se podaci ove stranice ne brišu), pohrana nedostupna, granica zapisa |
| S-10 usporedba | #1333 | „Potreban oporavak” ostaje kakav je i razlikuje se od neuspjeha riječju i bojom točke |
| Z-11 1 druga kartica | #1334 | kratka oznaka „Pisanje je u drugoj kartici” i jedna obavijest umjesto dvije. List je samo za čitanje. Radnja „Preuzmi pisanje ovdje” je prijedlog koji vlasnik prihvaća ili odbacuje |
| Z-11 2a bez mreže, sprema se | #1335 | dvije rečenice: što je sigurno (tekst je na uređaju) i što se događa po povratku mreže. Zapis koji vide i student i nastavnik ostaje označen kao napisan bez mreže (pravilo 10) |
| Z-11 2b bez mreže, ne sprema se | #1335 | traka kaže da se tekst ne sprema nigdje i upućuje na izvoz. Obavijest i oznaka su one iz S-10 |

Pravila prijelaza za #1332:
- 1a prelazi u 1b kad poslužitelj odgovori da je zapis primljen i čeka potpis.
- 1b prelazi u 1c kad potpisana potvrda ne stigne u pragu.
- Iz 1b ili 1c prelazi se u „Spremljeno na poslužitelju” tek kad stigne potpisana potvrda (ARCHITECTURE §5 t. 5).

## Snimke

| Datoteka | Zaslon | Širina | Tema |
|---|---|---|---|
| `snimke/s10-tamna-1440.png` | S-10 | 1440 | tamna |
| `snimke/s10-tamna-400.png` | S-10 | 400 | tamna |
| `snimke/s10-svijetla-1440.png` | S-10 | 1440 | svijetla |
| `snimke/s10-svijetla-400.png` | S-10 | 400 | svijetla |
| `snimke/z11-tamna-1440.png` | Z-11 | 1440 | tamna |
| `snimke/z11-tamna-400.png` | Z-11 | 400 | tamna |
| `snimke/z11-svijetla-1440.png` | Z-11 | 1440 | svijetla |
| `snimke/z11-svijetla-400.png` | Z-11 | 400 | svijetla |

Snimke su napravljene Playwrightovim Chromiumom, uvijek cijela stranica, uz `deviceScaleFactor` 1. Svijetla tema uključuje se atributom `data-theme="light"` na `<html>`. Prije snimanja čeka se da se fontovi učitaju (`document.fonts.ready`). Ni na jednoj širini nema vodoravnog pomicanja.

## Granice

- Okvir prikazuje gornju traku, traku bez mreže, obavijest, list i statusnu traku. Bočna traka i panel su izostavljeni jer ova stanja ne mijenjaju.
- Ikone iz dizajnerskog paketa nisu korištene (D-203 t. 8). Jedina ikona je precrtani signal koji `OfflineNotice` već koristi.
- Svi su podaci izmišljeni: naslov rada, grad i tekst. Nema stvarnih osoba.
- Oznake u velikim slovima, npr. „Stanje 1b · … · #1332”, i bilješke ispod okvira opisuju referencu. Nisu tekst sučelja.
- Za „Preuzmi pisanje ovdje” zadnja promjena u drugoj kartici mora biti zapisana u lokalni dnevnik prije predaje pisanja. To je uvjet za izvedbu, a ne dio ove slike.
- Test pravila 10 ostaje Backendu (D-216 t. 3).
- Izvedba (`SYNC_STATE_LABELS`, poruke, stilovi) dolazi u novim uskim zadacima nakon „Spoji”.
- Tekst sučelja provjeren je funkcijom `findForbiddenTerms` iz `scripts/forbidden-terms/terms.ts` i nema nalaza.
