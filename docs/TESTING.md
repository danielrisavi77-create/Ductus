# Ductus: sustav testiranja povjerenja

Verzija 1.0 · 4. 10. 2026.

Ductus ne testira samo radi li funkcija, nego može li se vjerovati zapisu, ovlastima, spremanju i granicama onoga što proizvod tvrdi.

## 1. Slojevi

| Sloj | Vlasnik | Dokazuje |
| --- | --- | --- |
| Unit | writer | lokalna funkcija radi |
| Property/fuzz | writer + QA | ponašanje vrijedi kroz veliki prostor ulaza |
| pgTAP | Backend + QA | pogrešna uloga ne može do podataka |
| Contract | writer | svi adapteri poštuju isti ugovor |
| Integration | Backend/Platform | Postgres + object storage + API/worker rade zajedno |
| E2E | QA | stvarni korisnički tok radi |
| Offline/recovery | QA | prekid mreže ili procesa ne gubi rad |
| Concurrency | QA | više tabova/uređaja/retrya ne krši invariant |
| Chaos | QA/Platform | kvar worker/DB/S3/KMS daje definirano ponašanje |
| Security | Reviewer + QA | authz, CSRF, XSS, injection, upload granice |
| Accessibility | Frontend + QA | axe, tipkovnica, screen reader |
| Browser | QA | Chromium, Firefox, WebKit/Safari |
| Load | Platform + QA | rokovi i burst predaje |
| Restore | Platform + QA | backup je stvarno povrativ |
| Human UX | Product/UX | ljudi pravilno razumiju što Ductus pokazuje |

## 2. Browser politika

CI profil (D-160): `scripts/engineering/ci-docs-scope.mjs`, izvršen iz točnog SHA-a zaštićenog `main`, dopušta izostavljanje samo runtime koraka Local stack za PR prema `main` čiji potpuni diff točnih SHA-ova sadrži isključivo obične neizvršne datoteke s njegovog uskog popisa (`README.md`, `docs/UX-EVAL.md` i šest postojećih Markdown dokumenata `docs/privacy/`). Required posao se izvršava i izričito javlja da DB/browser testovi nisu izvedeni. Build, lint, typecheck, unit/property, engineering/orchestrator testovi i skeneri ostaju. Nepoznata putanja, pravila, fixture, promjena tipa/moda ili prazan diff traže puni profil; greška klasifikacije blokira. Preimenovanje se provjerava pod oba imena. PR prema drugoj grani, `push` na main i noćni run uvijek su puni. Novi push i dalje otkazuje stare skupe korake; otkazivanje ne daje zeleni Local stack. To nije QA izuzeće niti promjena risk floora.

Standardni E2E (`stack-e2e`) i login E2E (`stack-login`) izvršavaju se paralelno, svaki na zasebnom runneru s vlastitim Compose stogom, migracijama, demo podacima i čišćenjem. PgTAP, integration i produkcijski build ostaju u standardnom poslu; login koristi `next dev` i zasebnu Next predmemoriju. Obvezni status `Local stack (compose.yaml)` čeka oba posla: puni profil prolazi samo uz oba uspješna rezultata, a docs profil samo uz oba očekivano preskočena posla. Neuspješan klasifikator, nepoznat profil, kvar, neočekivano preskakanje ili otkazivanje ne daju prolaz.

- CI (P1-3, 12. 10. 2026.): na PR-u se E2E vrti samo na Chromiumu (desktop i mobilni viewport); na `main` i u noćnom pokretanju vrte se sva tri enginea (Chromium, Firefox, WebKit). Crveni Firefox ili WebKit na `main` ili noću je nalaz za sljedeći dan, ne tiha regresija.
- Chromium: svaki frontend/E2E PR, u CI-ju PR-a.
- Firefox: editor, sync, journal, clipboard, auth i submission PR-ovi. CI PR-a ga ne pokreće, pa dokaz daje QA (lokalni ili ručno pokrenut prolaz na headu PR-a, zapisan u QA nalazu).
- WebKit: editor, IndexedDB/Dexie, offline, Web Locks, clipboard, auth i submission PR-ovi. Dokaz kao za Firefox.
- QA obveza: PR koji dira `src/lib/journal/`, sync, prijavu ili odjavu ne dobiva QA PASS bez dokaza o prolazu na sva tri enginea na aktualnom headu.
- Prije pilota cijeli acceptance path mora proći na Chromiumu, Firefoxu i WebKitu.
- Iznimka samo za demo (D-98 dopuna, 10. 10. 2026.): demo spec K-4 obvezan je do 1. 11. samo na Chromiumu; Firefox i WebKit prolaze informativno i ne blokiraju spajanje. Pravilo za pilot se ne mijenja.
- Mobilni viewport je dodatak, ne zamjena za WebKit.
- Iznimka po odluci vlasnika: puni tok prijave preko lažnog OIDC-a („Demo prijava”, `e2e/login/`, `pnpm test:e2e:login`) radi nad `next dev`, jer produkcijski build lažnog pružatelja odbija (D-09), i obvezan je samo na Chromiumu. Odbijanje u produkcijskom buildu (`e2e/auth.spec.ts`) i dalje prolazi sva tri enginea. Pokretanje: složaj iz `compose.yaml` (baza i lažni pružatelj na 8090), `pnpm db:migrate`, `pnpm db:seed` i `AUTH_DATABASE_URL` iz `.env.example`.

## 3. Obvezni adversarial scenariji prije pilota

Svaki scenarij dobiva test ili zapis ručne probe.

1. dva taba istog rada;
2. dva uređaja istog studenta;
3. offline uređivanje pa povrat mreže;
4. browser crash tijekom lokalnog savea;
5. istek sesije tijekom offline rada;
6. prijava drugog korisnika u istom pregledniku;
7. IndexedDB quota/eviction;
8. private browsing ograničenja;
9. stari frontend vraća se online nakon novog deploya;
10. ponovno slanje istog ID-a s istim sadržajem;
11. ponovno slanje istog ID-a s drugim sadržajem;
12. korumpiran object-storage objekt;
13. worker pada prije i poslije potpisa;
14. baza nedostupna;
15. object storage nedostupan;
16. KMS nedostupan;
17. nastavniku je ukinuto članstvo dok je stranica otvorena;
18. malicious HTML pri pasteu;
19. paste od 100.000+ znakova;
20. zero-width/bidi znakovi;
21. programski umetnut tekst / browser extension input;
22. promjena sata/DST oko roka;
23. 100 studenata predaje u posljednjih 15 minuta;
24. povrat baze i bucketa nakon simuliranog gubitka primarnog okruženja.

## 4. Falsification tests

Ductus mora regression testovima dokazivati i ono što **ne može zaključiti**.

Kanonski par:

- A: student samostalno tipka tekst;
- B: student gleda tuđi/AI tekst na drugom uređaju i ručno ga pretipkava.

Ako su Ductusu opaženi događaji isti, javna projekcija procesa mora biti ista. Nijedan budući feature ne smije povijest B označiti kao rizičniju, sumnjiviju ili manje autentičnu.

Kad `projection` modul postoji, ovaj par postaje executable regression fixture nad stvarnom funkcijom projekcije. Do tada se vodi kao obvezni acceptance scenarij demoa.

Dodatni falsification parovi:
- diktiranje OS-a vs tipkanje kad Ductus ne opaža razliku;
- legitimno lijepljenje vlastitih bilješki vs vanjski AI kad izvor nije opažen;
- prekid mreže vs namjerno offline pisanje.

Pravilo: **nepoznato ostaje nepoznato**.

## 5. Security negativni testovi

Critical backend PR mora imati barem jedan test koji bi prošao da zaštita ne postoji, a zatim dokaz da zaštita taj scenarij odbija.

Primjeri:
- greškom dodijeljen `SELECT` + RLS ipak vraća 0 redaka;
- `SECURITY DEFINER` bez praznog `search_path` ruši test;
- isti transaction ID s drugim payloadom se odbija;
- tuđi student/document ID u parametru ne mijenja actor identitet;
- nedostajući/pogrešan `Origin` ili `Sec-Fetch-Site` se odbija;
- modificirani segment ruši hash/JCS provjeru.

## 6. Chaos očekivanja

| Kvar | Očekivano |
| --- | --- |
| web/VM | lokalni journal nastavlja; korisnik vidi čekanje |
| worker | ingest može nastaviti; receipt ostaje pending |
| DB | ingest vraća kontrolirani 503; nema potvrde |
| S3 | nema potvrde ni metadata commita |
| KMS | pending signature, retry idempotentan |
| deploy | stari klijent dobiva verzionirani odgovor ili kontrolirani incompatibility |
| backup account | restore runbook dokazuje drugi put |

## 7. QA komentar za critical PR

QA PASS mora navesti aktualni head i što je stvarno pokušano:

```
QA-Agent: <runtime>:<slot>:qa
QA-Head: <sha>
QA-Verdict: PASS
QA-Scope:
- offline + reconnect
- duplicate request
- wrong actor
```

"CI je zelen" nije QA PASS.

## 8. Post-merge smoke

Na `main` se nakon relevantnog mergea provjerava:
- build;
- osnovni student flow;
- osnovni nastavnik flow;
- save status;
- nema console errora;
- nema novog security/scanner nalaza.

## 9. Release/pilot gate

Stvarni studenti ne ulaze dok su svi GO uvjeti iz `PROGRAM.md` zeleni. Test koji povremeno prolazi smatra se padom dok se flaky uzrok ne ukloni.

Za trust-critical funkciju ne vrijedi "works on my machine": dokaz mora postojati kao CI artefakt, pgTAP/property rezultat, staging zapis ili restore zapis.
