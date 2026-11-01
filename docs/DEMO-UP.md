# Pokretanje lokalnog demoa

## Prvi start

Potrebni su Node.js 24, pnpm 10.33.0 i Docker Compose v2 s pokrenutim Docker Desktop Linux engineom. Jednom iz korijena repozitorija instaliraj zaključane ovisnosti:

```powershell
pnpm install --frozen-lockfile
```

## Svako pokretanje

Iz korijena repozitorija pokreni:

```powershell
pnpm demo:up
```

Naredba podiže lokalni Docker Compose stog, primjenjuje migracije, učitava sintetičke ustanove i pokreće aplikaciju na `http://localhost:3000`. Lokalni OIDC pružatelj dostupan je na `http://localhost:8090`. Zaustavi aplikaciju s `Ctrl+C`; Compose stog ostaje podignut dok ga zasebno ne zaustaviš.

Na stranici „Demo prijava” dostupni su računi `Demo nastavnik`, `Demo nastavnica`, `Demo studentica` i `Demo student 2`. `Demo nastavnica` je druga nastavnica iste ustanove za korak K-4d (#655); nakon promjene računa lokalno ponovno izgradi sliku s `docker compose build oidc`. Svi su izmišljeni i služe isključivo lokalnom razvoju i CI-ju. Zaustavi Compose usluge s `docker compose stop`; time se baza ne briše.

Runner postavlja DB, S3, Mailpit i OIDC na lokalne Compose adrese. Odbija DB URL izvan lokalnog Composea, generira privremenu auth-lozinku ako nije zadana i ne ispisuje je niti zapisuje u datoteku. Ako sam zadaš `DUCTUS_AUTH_LOCAL_PASSWORD` ili lozinku u `AUTH_DATABASE_URL`, ona ne smije sadržavati znak `%`; runner je odbija prije postava. Nemoj postavljati lažni OIDC pružatelj za produkciju.

## Evidencija (prijem odsječaka)

`pnpm demo:up` i `pnpm demo:prepare` nakon seeda sami pokreću `db/local/evidence-signing-key.mjs` i `db/local/evidence-storage-domain.mjs`, pa rute `/api/evidence/open` i `/api/evidence/commit` rade bez ručnih koraka:

- razvojni ključ za potvrde (seed od 32 bajta) nastaje jednom u `~/.ductus/demo-evidence-signing.seed`, izvan repozitorija, i upisuje se kao javni ključ domene evidencije ustanove `demo-fakultet`. Drugo pokretanje koristi isti seed i isti ključ. Želiš li drugu datoteku, postavi `DUCTUS_DEV_SIGNING_KEY_FILE` na apsolutnu putanju izvan repozitorija, u okolini procesa prije pokretanja, npr. `$env:DUCTUS_DEV_SIGNING_KEY_FILE = "C:\ductus-kljucevi\demo.seed"` pa `pnpm demo:up`. `pnpm demo:up` čita samo okolinu procesa, ne `.env.local`;
- lokalni S3 spremnik `ductus-evidence-demo-fakultet` dobiva oznaku identiteta ustanove, a `EVIDENCE_STORAGE_DOMAINS` i `EVIDENCE_S3_LOCAL_*` runner prosljeđuje aplikaciji kroz njezinu okolinu. Ništa se ne zapisuje u `.env.local`.

Obje skripte rade samo lokalno i pri ponovnom pokretanju ništa ne mijenjaju. Skripte same odbijaju `NODE_ENV=production`, ali `pnpm demo:up` uvijek postavlja `NODE_ENV=development`, pa tu zaštitu ne nosi. Zato `pnpm demo:up` odbija pokretanje ako su postavljeni `DUCTUS_PSQL_CONTAINER`, `DOCKER_HOST` ili `DOCKER_CONTEXT` (mogli bi uputiti skripte na tuđi Docker), kao i relativan `DUCTUS_DEV_SIGNING_KEY_FILE`. Ako aplikaciju pokrećeš zasebno s `pnpm dev`, ta okolina ne postoji; koristi `pnpm demo:up`.

## Izmišljeni kolegij i zadatak (DAN-88 K-3b2)

`pnpm demo:up` prije pokretanja aplikacije učitava `db/local/demo-k3.sql` (pokretač `node db/local/demo-k3.mjs`). U bazi zatim postoje potvrđeni `Demo nastavnik`, kolegij „Lokalne javne politike (izmišljeni kolegij)” i zadatak „Seminarski rad: gradske knjižnice kao javni prostor” (1500 do 2500 riječi). `Demo studentica` i `Demo student 2` upisani su u taj kolegij i potvrdili su obavijest zadatka. Svaki redak nastaje kroz isti RPC koji koristi aplikacija, pod sesijom izmišljenog računa, a te se sesije na kraju zatvaraju. Ponovno pokretanje ne dodaje ništa novo.

`pnpm demo:prepare` (CI) ovaj korak ne izvodi jer E2E testovi počinju od nepotvrđenog nastavnika. Dvije izmišljene povijesti prikazuju se kao unaprijed pripremljen primjer (PLAN-DEMO §5, rez 1). Skripta ne stvara evidenciju ni potvrde (#635).

## Eksplicitna prijava probnih računa (DAN-88 K-3b1)

Nakon `pnpm demo:prepare`, dok aplikacija već radi na `http://localhost:3000` i postojeći lažni OIDC na `http://localhost:8090`, lokalni operator ili CI može pokrenuti:

```powershell
pnpm demo:bootstrap-accounts
```

Naredba kroz stvarnu prijavu i callback otvara četiri postojeća izmišljena računa, provjerava njihovu sesiju i ustanovu u lokalnoj bazi, potvrđuje oba nastavnička računa postojećim lokalnim operatorom (`provision-teacher.mjs`, za drugi s argumentom `demo-teacher-2`) i odjavljuje sva četiri računa. Ponovno pokretanje čuva njihove identitete i po jednu aktivnu nastavničku ulogu. Odbija udaljene HTTP ciljeve i Docker kontekst koji nije lokalni. Ne ispisuje ni sprema kolačiće ili tokene. Zahtijeva već pokrenut lokalni stog i aplikaciju; ne pokreće ih sama. Ovaj korak još ne stvara kolegije, zadatke ni kontrolne povijesti, a `demo:prepare` zadržava početno nepotvrđeno stanje nastavnika.

## Bez Dockera (Windows)

Za prijenosno računalo bez Dockera (DAN-324, #799). Pokreće istu aplikaciju kao `pnpm demo:up`, s istim izmišljenim podacima i istim lažnim OIDC pružateljem, ali PostgreSQL 17, rustfs i lažni OIDC rade kao obični procesi.

Preduvjeti: Windows 10 1803+ ili Windows 11 (zbog `tar.exe` i Unix socketa), Node 24 i pnpm. PostgreSQL treba Microsoft Visual C++ Redistributable; ako nedostaje, instaliraj ga s Microsoftove stranice (to može tražiti administratora, runner to ne zaobilazi). Windows Defender ili SmartScreen mogu pri prvom pokretanju tražiti potvrdu za `postgres.exe` ili `rustfs.exe`.

```powershell
pnpm install --frozen-lockfile
pnpm --dir infra/fake-oidc install --frozen-lockfile
pnpm demo:up:native
```

- Prvo pokretanje preuzima PostgreSQL 17.11-1 (get.enterprisedb.com, oko 340 MB) i rustfs 1.0.0 (GitHub izdanje) u `%LOCALAPPDATA%\Ductus\native\`. Prije raspakiranja provjeravaju se veličina i SHA-256 arhive, a prije svakog pokretanja hash raspakiranih datoteka. Ako se razlikuje i jedan bajt, runner odbija start i traži da obrišeš tu mapu. Ništa se ne preuzima u repozitorij.
- Podaci su u `%LOCALAPPDATA%\Ductus\native-data\` (baza, objekti, zapisi). Za potpuno nov početak zaustavi runner i obriši tu mapu.
- Svi portovi (PostgreSQL 54329, rustfs 9100, OIDC 8090, aplikacija 3000) slušaju samo na `127.0.0.1`. `psql` se spaja samo kroz lokalni socket, nikad kroz TCP.
- Ctrl+C zaustavlja aplikaciju, OIDC, rustfs i PostgreSQL. `pnpm demo:up:native --stop` zaustavlja procese prethodnog pokretanja koje je prekid ostavio. Proces gasi samo ako su mu ime i vrijeme nastanka jednaki zapisanima; proces koji je nakon restarta dobio isti PID ostavlja i to javlja.
- `pnpm demo:up:native --prepare-only` samo priprema bazu (kao `demo:prepare`), a `--no-demo-data` preskače izmišljeni kolegij i zadatak (K-3b2). Windows CI posao prijavni E2E pokreće s probnim podacima, jer K-3 potvrđuje ulogu "Demo nastavnik".
- Automatska provjera probnog prolaza (DAN-346): dok runner radi, u drugom prozoru pokreni `$env:E2E_REUSE_SERVER="1"; $env:E2E_DEMO_NATIVE="1"; pnpm exec playwright test --config playwright.login.config.ts e2e/login/demo-flow.spec.ts`. Spec tada nastavnika potvrđuje s `node scripts/demo/provision-teacher.mjs --native`, kroz lokalni socket nativne baze, a ne kroz Docker. CI ovaj prolaz ne pokreće.

Granice: Mailpit se ne pokreće, pa lokalna pošta ne postoji. `pnpm test:db` (pgTAP), `pnpm demo:bootstrap-accounts` i E2E testovi koji traže Docker i dalje trebaju Compose. Iznimka je `demo-flow.spec.ts` uz `E2E_DEMO_NATIVE=1`. Baza koristi ugrađeni locale `C.UTF-8` (PG17), a ne `en_US.utf8` iz Composea, pa redoslijed po zadanoj kolaciji može biti drukčiji; migracije koriste izričit `COLLATE "C"`. rustfs pri startu provjerava ima li novije verzije (`version.rustfs.com`) i to se ne može isključiti. Pokretanje na Windowsima dokazuje posao `Demo native` u CI-ju.
