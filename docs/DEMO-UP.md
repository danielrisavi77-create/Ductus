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

## Eksplicitna prijava demo računa (DAN-88 K-3b1)

Nakon `pnpm demo:prepare`, dok aplikacija već radi na `http://localhost:3000` i postojeći lažni OIDC na `http://localhost:8090`, lokalni operator ili CI može pokrenuti:

```powershell
pnpm demo:bootstrap-accounts
```

Naredba kroz stvarnu prijavu i callback otvara četiri postojeća izmišljena računa, provjerava njihovu sesiju i ustanovu u lokalnoj bazi, potvrđuje oba nastavnička računa postojećim lokalnim operatorom (`provision-teacher.mjs`, za drugi s argumentom `demo-teacher-2`) i odjavljuje sva četiri računa. Ponovno pokretanje čuva njihove identitete i po jednu aktivnu nastavničku ulogu. Odbija udaljene HTTP ciljeve i Docker kontekst koji nije lokalni. Ne ispisuje ni sprema kolačiće ili tokene. Zahtijeva već pokrenut lokalni stog i aplikaciju; ne pokreće ih sama. Ovaj korak još ne stvara kolegije, zadatke ni kontrolne povijesti, a `demo:prepare` zadržava početno nepotvrđeno stanje nastavnika.

## Bez Dockera (Windows)

`pnpm demo:up:native` podiže isti demo na Windowsu bez Dockera (DAN-324, #799): PostgreSQL 17 i rustfs iz zaključanih Windows paketa te lokalni OIDC pružatelj pod Node.js-om. Migracije, sintetičke ustanove, ključ i spremnik evidencije te izmišljeni kolegij K-3 prolaze isti redoslijed kao u `pnpm demo:up`.

Jednokratno, s administratorskim pravima: instaliraj Microsoft Visual C++ Redistributable (x64) za Visual Studio 2015–2022 s `https://aka.ms/vs/17/release/vc_redist.x64.exe`. Bez njega se PostgreSQL ne pokreće. Ostalo ne traži administratora: Node.js 24 (npr. ZIP ili instalacija samo za korisnika) i pnpm 10.33.0.

Jednom iz korijena repozitorija:

```powershell
pnpm install --frozen-lockfile
pnpm --dir infra/fake-oidc install --frozen-lockfile
```

Svako pokretanje:

```powershell
pnpm demo:up:native
```

- Prvo pokretanje preuzima PostgreSQL 17.11-1 (oko 340 MB, EDB) i rustfs 1.0.0 (oko 105 MB, GitHub). Svaki paket i svaka raspakirana datoteka provjeravaju se prema manifestu u `scripts/demo/native/tools.mjs` (veličina, SHA-256 i sažetak stabla). Ako se ijedan bajt ne slaže, ništa se ne pokreće i poruka kaže koju mapu treba obrisati; obriši je i pokreni ponovno.
- Alati i podaci su u `%LOCALAPPDATA%\Ductus` (`native` za alate, `native-data` za bazu, spremnik i dnevnike u `native-data\logs`), nikad u repozitoriju. Cijeli demo brišeš brisanjem te mape.
- Sve usluge slušaju samo na `127.0.0.1`: baza na 54329, rustfs na 9100, OIDC na 8090, aplikacija na 3000. Ako je neki od tih portova zauzet, runner odbija start. `psql` se s bazom spaja samo preko lokalnog socketa, nikad preko TCP-a.
- Windows SmartScreen ili Defender mogu pri prvom pokretanju pitati smije li `postgres.exe` ili `rustfs.exe` raditi; dopusti samo lokalnu (privatnu) mrežu.
- `Ctrl+C` zaustavlja aplikaciju i sve tri usluge. `pnpm demo:up:native --prepare-only` priprema sve osim K-3 i aplikacije i usluge ostavlja podignute; zaustavi ih s `pnpm demo:up:native --stop`, koji pomaže i nakon zatvorenog prozora.
- Drugo pokretanje koristi isti ključ evidencije, istu oznaku spremnika i ne dodaje retke K-3.

Poznate granice: nema lokalne pošte (Mailpit), pa se pošta u ovom načinu ne šalje ni ne prikazuje. Način radi samo na Windowsu i odbija se uz `NODE_ENV=production`. Prijava je ista kao uz Docker, preko lažnog OIDC pružatelja koji radi samo lokalno (D-09).
