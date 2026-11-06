# M8.8: paket za spike podrijetla DOCX-a

Izbor ovisnosti, licence i lockfile: `docs/spikes/M8.8-P01.md`. Odluka: D-198.

```bash
npm ci --ignore-scripts
node gen.mjs out
```

Samostalan paket (npm, ne pnpm) izvan aplikacijskog koda. Ne ulazi u build i ne dira korijenski `package.json` ni `pnpm-lock.yaml`. `gen.mjs` piše dvije sintetičke DOCX datoteke s izmišljenim sadržajem, bez mreže i bez sata. Isti ulaz daje iste bajtove u svakoj vremenskoj zoni.

`policy.ts` drži popis pregledanih paketa. `tests/unit/spikes/docx-provenance-policy.test.ts` provjerava manifest, lockfile i uvoze u generatoru prema tom popisu. Test radi u postojećem CI-ju i ne instalira ovaj paket. Novi ili nadograđeni paket traži novi pregled i izmjenu `REVIEWED` u istom PR-u.
