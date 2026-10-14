# Pokretanje lokalnog demoa

Iz korijena repozitorija pokreni:

```sh
pnpm demo:up
```

Naredba podiže lokalni Docker Compose stog, primjenjuje migracije, učitava sintetičke ustanove i pokreće aplikaciju na `http://localhost:3000`. Lokalni OIDC pružatelj dostupan je na `http://localhost:8090`. Zaustavi aplikaciju s `Ctrl+C`; Compose stog ostaje podignut dok ga zasebno ne zaustaviš.

Runner postavlja DB, S3, Mailpit i OIDC na lokalne Compose adrese. Odbija DB URL izvan lokalnog Composea, generira privremenu auth-lozinku ako nije zadana i ne ispisuje je niti zapisuje u datoteku. Nemoj postavljati lažni OIDC pružatelj za produkciju.

Seed trenutačno stvara izmišljene ustanove. Potpuni K-3 seed s nastavnikom, kolegijem, zadatkom, studentima i kontrolnim povijestima dovršava se u zasebnim koracima DAN-88.
