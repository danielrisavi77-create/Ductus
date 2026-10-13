# Ductus — scratch pilot editora i spremanja

**DAN-203 · GitHub #351 · 13. 10. 2026. · status: prototip za pregled, ne produkcijska funkcija.**

Jedna lokalna HTML datoteka za Danielovu procjenu iskustva prije promjene pravog editora.
Odobrenje ovog pilota ne odobrava novi dizajn, produkcijsku implementaciju, merge ni deploy.
Nema novog agenta, skilla, CI gatea, produkcijske rute ni aplikacijske ovisnosti.

## Otvori i isprobaj

Otvori `index.html` u pregledniku na računalu. Ne treba build, račun ni poslužitelj.
Piši samo izmišljeni tekst: unos je isključivo u memoriji, a odabir scenarija,
reset, osvježavanje ili zatvaranje ga odbacuju. Za otvaranje na mobitelu prijenos
HTML datoteke i podrška lokalnom HTML-u ovise o pregledniku/aplikaciji.

1. U scenariju **Pisanje** promijeni tekst. Klikni **Pokreni lokalno spremanje**,
   pa **Završi lokalno spremanje**. Poruka treba jasno značiti samo uređaj.
2. Klikni **Pošalji spremljenu verziju**. Dostavi nepotpisanu, neispravnu i stariju
   potvrdu: nijedna ne smije dati poruku o potvrđenom spremanju na poslužitelju.
   Tek **Dostavi valjanu potvrdu** potvrđuje trenutačni simulirani tekst.
3. Odaberi **Slanje u tijeku**, promijeni tekst pa dostavi potvrdu prethodnog slanja.
   Stanje ostaje **Uređivanje**. U **Rad bez mreže** samo vrati vezu: ni to nije potvrda.
   Nakon slanja i potvrde oznaka nastanka bez mreže ostaje.

Ostali scenariji: prazan dokument, učitavanje, lokalno spremanje, sukob, pogreška
prostora, potreban oporavak i druga kartica. Sukob i oporavak traže izričitu odluku;
prototip prikazuje samo nedestruktivni izbor zadržavanja lokalnog primjera.
Klizač u **Puls i predaja odluke** mijenja samo animaciju, nikad vrijeme spremanja.
Smanjeno kretanje iz postavki preglednika ima prednost.

## Izvori i granice

Zamrznuta referenca: `76b085506898e5410377badc784bf794bec803d3`.

| Izvor | Preuzeto / primjena |
| --- | --- |
| `app/globals.css` | v6 tokeni (D-89), neutralna podloga, list rada i raspored; sistemski fontovi kao fallback |
| `app/rad/page.tsx` | okvir studentskog radnog prostora; nije uvoz React komponente |
| `src/domain/sync/labels.ts` | svih osam naziva stanja i razlika neutralnog lokalnog / potvrđenog poslužiteljskog stanja |
| `src/domain/sync/states.ts` | odabrani prijelazi za UX demonstraciju, ne kopija pune domenske logike |
| `.claude/skills/ductus-sync-states/SKILL.md` | nova izmjena i stara potvrda; offline oznaka; bez implicitnog SYNCED |
| `docs/UX-EVAL.md` | pitanja što je opaženo, što nije i kada je spremanje potvrđeno |
| `docs/PRODUCT.md` §5 | neutralan opis, bez zaključaka o studentu |

HTML nema vanjske resurse, mrežne pozive, prijavu, trajnu pohranu ni stvarne potpise.
CSP zabranjuje mrežu i dopušta samo dva ugrađena skripta po SHA-256 sažetku.
Nakon izmjene skripta treba obnoviti njegov hash u CSP metaoznaci; ne uklanjati CSP.

Kontrole scenarija, brojevi verzija i dijagnostika pripadaju **laboratoriju prototipa**,
ne prijedlogu studentskog sučelja. Učitavanje i druga kartica zasebni su UI uvjeti,
ne deveto/deseto stanje sinkronizacije. Naslovi strukture su statičan izmišljeni primjer.
Tekst se unosi u običan textarea: ovo nije Tiptap, provjera kriptografije, implementacija
recoveryja ni dokaz točnosti produkcijskog spremanja. `signed`/`valid` su izmišljeni ishodi
provjere, nikad stvarne potvrde. Ne uvoziti ovaj model u `app/` ili `src/`.

## Provjere

Iz korijena repozitorija:

```sh
node --test docs/ux-prototypes/editor-sync/prototype.test.mjs
node docs/ux-prototypes/editor-sync/browser-check.mjs chromium
```

Prva naredba koristi samo ugrađene Node alate. Druga koristi postojeći
`@playwright/test` i instalirani preglednik. Za druge dostupne Playwright preglednike
zamijeni `chromium` s `firefox` ili `webkit`; to nije tvrdnja da su već testirani.
Verifikator po potrebi prima `DUCTUS_PLAYWRIGHT_MODULE` (instalirani modul) i
`DUCTUS_BROWSER_EXECUTABLE` (lokalni izvršni program). Ne mijenja aplikacijske postavke.
Snimke i JSON izvještaj zapisuje u novu privremenu mapu čiju putanju ispisuje.

Browser provjera učitava sadržaj u memoriju (`setContent`), provjerava CSP, klikove,
te širine 390/760/1024/1440 px. **Ne provjerava otvaranje preko file://, stvarni iPhone,
produkcijsku aplikaciju, punu pristupačnost ni trajni oporavak nakon pada preglednika.**
Rezultati za konkretan head idu u PR. Naredbe iznad nisu dodane globalnom CI-ju i
ne zamjenjuju `pnpm lint`, `pnpm typecheck`, `pnpm test` ni `pnpm build` nad cijelim repo-om.

## Predaja vizualne odluke

Daniel ocjenjuje prikaz, a ne implementacijsku ispravnost. U DAN-203 zabilježiti:

```text
Scenarij i verzija prototipa:
Što sam mislio da poruka znači:
Što je u tom trenutku potvrđeno, a što nije:
Što treba promijeniti:
Kriterij prihvaćanja za ponovljeni pokušaj:
Puls (ako relevantno): --pulse: 900ms;
Odluka: prihvaćeno / dorada / odbačeno
```

Postojeći Product/UX proces pretvara opažanja u kriterije; zaseban frontend zadatak
prenosi samo prihvaćeni prikaz u stvarne komponente i prolazi postojeće review/QA gateove.
Linear ostaje izvor statusa, repo prihvaćenih odluka, a GitHub izvedbe i dokaza.
Ne označavati DAN-49, transport, potpise ili demo gotovim zbog ovog pilota.
Učinak na vrijeme i potrošnju zasad je **neizmjeren**: pratiti vrijeme do odluke i
broj naknadnih dorada umjesto izmišljanja postotka uštede.
