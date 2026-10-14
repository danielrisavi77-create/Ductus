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

Na stranici „Demo prijava” dostupni su računi `Demo nastavnik`, `Demo studentica` i `Demo student 2`. Svi su izmišljeni i služe isključivo lokalnom razvoju i CI-ju. Zaustavi Compose usluge s `docker compose stop`; time se baza ne briše.

Runner postavlja DB, S3, Mailpit i OIDC na lokalne Compose adrese. Odbija DB URL izvan lokalnog Composea, generira privremenu auth-lozinku ako nije zadana i ne ispisuje je niti zapisuje u datoteku. Nemoj postavljati lažni OIDC pružatelj za produkciju.

Seed trenutačno stvara izmišljene ustanove. Potpuni K-3 seed s nastavnikom, kolegijem, zadatkom, studentima i kontrolnim povijestima dovršava se u zasebnim koracima DAN-88.
