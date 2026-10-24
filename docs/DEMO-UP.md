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

Seed trenutačno stvara izmišljene ustanove. Potpuni K-3 seed s nastavnikom, kolegijem, zadatkom, studentima i kontrolnim povijestima dovršava se u zasebnim koracima DAN-88.

## Eksplicitna prijava demo računa (DAN-88 K-3b1)

Nakon `pnpm demo:prepare`, dok aplikacija već radi na `http://localhost:3000` i postojeći lažni OIDC na `http://localhost:8090`, lokalni operator ili CI može pokrenuti:

```powershell
pnpm demo:bootstrap-accounts
```

Naredba kroz stvarnu prijavu i callback otvara četiri postojeća izmišljena računa, provjerava njihovu sesiju i ustanovu u lokalnoj bazi, potvrđuje oba nastavnička računa postojećim lokalnim operatorom (`provision-teacher.mjs`, za drugi s argumentom `demo-teacher-2`) i odjavljuje sva četiri računa. Ponovno pokretanje čuva njihove identitete i po jednu aktivnu nastavničku ulogu. Odbija udaljene HTTP ciljeve i Docker kontekst koji nije lokalni. Ne ispisuje ni sprema kolačiće ili tokene. Zahtijeva već pokrenut lokalni stog i aplikaciju; ne pokreće ih sama. Ovaj korak još ne stvara kolegije, zadatke ni kontrolne povijesti, a `demo:prepare` zadržava početno nepotvrđeno stanje nastavnika.
