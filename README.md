# Ductus

Radno ime platforme koja fakultetima pokazuje kako je studentski rad nastao, bez presude o autorstvu.
Prvi pilot: Fakultet političkih znanosti Sveučilišta u Zagrebu (FPZG).

Plan proizvoda i stanje rada su u `docs/`. Konačno ime proizvoda još nije odabrano.

## Lokalni rad

Treba Node 24, pnpm i Docker. `pnpm install` instalira i git hookove (lefthook).

```bash
pnpm install
pnpm stack:up
pnpm test
pnpm test:integration
```

`pnpm stack:up` diže `compose.yaml`: Postgres 17, S3 kompatibilnu pohranu (RustFS), Mailpit i lažni OIDC pružatelj ("demo prijava", izmišljeni računi). Sve služi samo lokalno i u CI-ju (D-09). Vrijednosti su u `.env.example`.
