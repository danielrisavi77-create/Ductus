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

### Informativni UI/design odabir testova (DAN-241)

CI nakon punog standardnog E2E prolaza uspoređuje hipotetski odabir s istim
rezultatima, bez drugog pokretanja aplikacije. Dodatni JSON reporter uključuje
se samo uz `UI_TEST_PILOT=1`; sažetak je u Actions prikazu i datoteci
`ui-test-pilot.json` unutar postojećeg artefakta `playwright-report`.

Prije punog E2E prolaza Playwright `--list` bez pokretanja testova
izdvaja neovisni očekivani inventar svih testnih instanci po pregledniku u
privremenu `.ci-reports/ui-pilot-inventory.json` (izvan direktorija koji
Playwright briše prije testa). Postproces zahtijeva potpuno podudaranje
očekivanih i opaženih ID-eva, putanja i preglednika. Nedostajući cijeli
neodabrani spec ili pojedinačni test, i uz konzistentan `stats`, daje
`inconclusive`; neuspjelo otkrivanje inventara ne zaustavlja obvezni puni
E2E, ali ne može dati `no-miss-observed`.

Prvi kandidat je samo obična izmjena postojeće
`src/components/landing/Landing.module.css`. Mapira se na cijele specove
`landing`, `home`, `shell`, `accessibility` i `screenshots`: svi provjeravaju
javnu početnu stranicu. Dodatna/nepoznata datoteka, dodavanje, brisanje,
preimenovanje, promjena moda, nečitljiv/prazan diff ili događaj izvan PR-a
prema mainu traže puni skup. Diff koristi točne base/head SHA-ove; bilježi se
i SHA stvarno testiranog merge commita. To je informativni helper s PR heada,
bez ovlasti za promjenu CI profila ili preskakanje testova.

`miss-observed` označava pad izvan odabira; `inconclusive` nepotpune ili
nevaljane rezultate; `no-miss-observed` samo izostanak opaženog propuštenog
kvara u tom cjelovitom prolazu. `not-applicable` znači puni odabir. Izvještaj
čuva rezultate po testu i pregledniku, probleme, odabrane/ostale testove i
njihov testni rad. Zbroj trajanja testova nije procjena ubrzanja CI-ja.
`candidateInventory` pokazuje veličinu početnog kandidatnog skupa i kad diff
zahtijeva full, bez tvrdnje da je takav diff prihvatljiv za uži odabir.

Puni standardni/login E2E, ostali slojevi i main/noćni browser opseg ostaju
obvezni. Snapshot specovi prilažu snimke bez usporedbe s referentnim slikama.
Jedan zeleni prolaz ne opravdava stvarno preskakanje: širenje traži pregled
uvoza/potrošača CSS-a, dokaze iz kandidatnih PR-ova i zaseban zadatak.

### Lokalni Playwright UI Mode, trag i izvještaj (DAN-248, dio A)

Iz korijena repozitorija, u PowerShellu s Nodeom iz `.nvmrc`, instaliraj
postojeće ovisnosti (`pnpm install --frozen-lockfile`) i Chromium preglednik
(`pnpm exec playwright install chromium`). Provjeri da su slobodni portovi
3000–3004 (standardni E2E), 3000 (login), 8090 (lokalni lažni OIDC),
54329 (Postgres) i 9100 (lokalna pohrana). Koristi samo sintetičke podatke i
lokalni `compose.yaml`; za punu lokalnu pripremu u **istoj** PowerShell sesiji:

```powershell
$bytes = New-Object byte[] 24
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
$authPassword = [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
$env:DUCTUS_AUTH_LOCAL_PASSWORD = $authPassword
$env:AUTH_DATABASE_URL = "postgres://ductus_auth_local:${authPassword}@127.0.0.1:54329/ductus"
pnpm demo:prepare
```

`demo:prepare` podiže lokalni Compose, migrira bazu, postavlja sintetičke
ustanove te priprema lokalni potpis i pohranu. Lozinka ostaje u sesiji i ne ide
u repozitorij. Za UI Mode pokreni **jednu** od naredbi, nakon što prethodna
završi i kad port 3000 nije zauzet:

```powershell
pnpm exec playwright test --ui --project=desktop
pnpm exec playwright test --config playwright.login.config.ts --ui --project=login-chromium
```

Prva naredba koristi `playwright.config.ts`: produkcijski build i pet lokalnih
servera na 3000–3004. Druga koristi `playwright.login.config.ts`: `next dev`
na 3000 i puni tok prijave preko lokalnog lažnog OIDC-a. UI Mode je lokalni
interaktivni odabir/proba, ne zamjena za obvezni puni `pnpm test:e2e` i
`pnpm test:e2e:login` ni za browser politiku gore. Ako želiš ispitati jedan
postojeći spec iz naredbenog retka, primjer je
`pnpm test:e2e landing.spec.ts --project=desktop`; za login koristi
`pnpm test:e2e:login prijava.spec.ts`. Ne uključuj `E2E_REUSE_SERVER=1` osim
ako si provjerio da na portu radi baš tražena verzija i vrsta servera.

Za reprodukciju pada odaberi test u UI Modeu i ponovno ga pokreni, ili pokreni
isti spec iz CLI-ja. Obje konfiguracije već imaju `trace: "retain-on-failure"`,
`screenshot: "only-on-failure"` i lokalni video pri padu. Po završetku
neuspjelog testa nađi njegov `trace.zip` i otvori Trace Viewer; uz trag su
vremenska crta, koraci, mreža i snimke stanja:

```powershell
$trace = Get-ChildItem .\test-results, .\test-results-login -Recurse -Filter trace.zip -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
pnpm exec playwright show-trace $trace
pnpm exec playwright show-report playwright-report
pnpm exec playwright show-report playwright-report-login
```

Otvori samo izvještaj odgovarajuće konfiguracije; login zapisuje
`test-results-login/` i `playwright-report-login/`, standardni E2E
`test-results/` i `playwright-report/`. Ako test prođe, prema postojećoj
postavci nema zadržanog traga. Snimke iz `e2e/screenshots/` zasad su prilozi
izvještaju, bez usporedbe s referentnim slikama.

U GitHub Actions otvori konkretni CI run i preuzmi artefakt
`playwright-report` iz posla **Standard E2E and database** ili `playwright-report-login` iz
posla **Login E2E**. Artefakti punog profila čuvaju se 14 dana i prenose se
i nakon pada testa ako run nije otkazan. Primjer za već poznat ID runa:

```powershell
$runId = 123456789 # zamijeni ID-om iz adrese konkretnog Actions runa
gh run download $runId -n playwright-report -D .\work\playwright-report-ci
pnpm exec playwright show-report .\work\playwright-report-ci
```

Za login zamijeni ime artefakta i odredište s `playwright-report-login`.
Preuzeti izvještaj otvara pripadajuće tragove kroz vlastite privitke; izvan
punog CI profila ili kod otkazanog runa artefakt možda ne postoji. Postojeći
interaktivni browser CLI provjeri s `pnpm exec playwright cli --help`, zatim
koristi `pnpm exec playwright cli open http://localhost:3000`,
`pnpm exec playwright cli snapshot` i na kraju
`pnpm exec playwright cli close` prema
`.agents/skills/ductus-browser-cli/SKILL.md`. CLI
koristi već instalirani Playwright 1.63; ne instalira se zaseban paket.

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
