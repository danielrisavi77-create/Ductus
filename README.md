# Ductus

Radno ime platforme koja fakultetima pokazuje kako je studentski rad nastao, bez presude o autorstvu.
Prvi pilot: Fakultet političkih znanosti Sveučilišta u Zagrebu (FPZG).

Plan proizvoda i stanje rada su u `docs/`. Konačno ime proizvoda još nije odabrano.

## Lokalni rad

Treba Node 24, pnpm i Docker. `pnpm install` instalira i git hookove (lefthook).

```bash
pnpm install
pnpm stack:up
pnpm db:migrate
pnpm test
pnpm test:db
pnpm test:integration
```

`pnpm stack:up` diže `compose.yaml`: Postgres 17, S3 kompatibilnu pohranu (RustFS), Mailpit i lažni OIDC pružatelj ("demo prijava", izmišljeni računi). Sve služi samo lokalno i u CI-ju (D-09). Vrijednosti su u `.env.example`.

Migracije su u `db/migrations` (dbmate; nova s `pnpm db:new <ime>`). `pnpm db:migrate` radi samo prema lokalnoj bazi iz `compose.yaml`; na produkciju se migracije nikad ne primjenjuju odavde (BACKEND §3). pgTAP testovi su u `db/tests` i pokreće ih `pnpm test:db` (`pg_prove` u kontejneru baze).
