# Ductus

Radno ime platforme koja fakultetima pokazuje kako je studentski rad nastao, bez presude o autorstvu.
Prvi pilot: Fakultet političkih znanosti Sveučilišta u Zagrebu (FPZG).

Plan proizvoda i stanje rada su u `docs/`. Konačno ime proizvoda još nije odabrano.

## Lokalni rad

Treba Node 24, pnpm i Docker. `pnpm install` instalira i git hookove (lefthook).

```bash
pnpm install
pnpm stack:up
export DUCTUS_AUTH_LOCAL_PASSWORD="$(openssl rand -hex 24)"
export AUTH_DATABASE_URL="postgres://ductus_auth_local:${DUCTUS_AUTH_LOCAL_PASSWORD}@127.0.0.1:54329/ductus"
pnpm db:migrate
pnpm db:seed
pnpm test
pnpm test:db
pnpm test:integration
```

`pnpm stack:up` diže `compose.yaml`: Postgres 17, S3 kompatibilnu pohranu (RustFS), Mailpit i lažni OIDC pružatelj ("demo prijava", izmišljeni računi). Sve služi samo lokalno i u CI-ju (D-09). Vrijednosti su u `.env.example`.

Migracije su u `db/migrations` (dbmate; nova s `pnpm db:new <ime>`). `pnpm db:migrate` radi samo prema lokalnoj bazi iz `compose.yaml`; na produkciju se migracije nikad ne primjenjuju odavde (BACKEND §3). Nakon migracija ista naredba stvara lokalnu prijavu aplikacije `ductus_app_local` (članica `ductus_app`, `db/local/app-login.sql`), na koju pokazuje `APP_DATABASE_URL`; zatim prijavu povratnog poziva prijave `ductus_auth_local` (članica `ductus_auth`, `db/local/auth-login.sql`), na koju pokazuje `AUTH_DATABASE_URL`. Njezina lozinka nije u repou: zadaje se kroz `DUCTUS_AUTH_LOCAL_PASSWORD` (najmanje 16 znakova), a CI je generira za svako pokretanje. `pnpm db:seed` upisuje izmišljene ustanove za demo prijavu (`db/local/seed.sql`): `demo.ductus.test` vodi u "Demo fakultet", a nepoznata matična ustanova se odbija. `DATABASE_URL` je superuser stoga i služi samo migracijama i testovima. pgTAP testovi su u `db/tests` i pokreće ih `pnpm test:db` (`pg_prove` u kontejneru baze).
