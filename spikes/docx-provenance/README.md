# M8.8: paket za spike podrijetla DOCX-a

Izbor ovisnosti, licence i lockfile: `docs/spikes/M8.8-P01.md`. Odluka: D-198. OSV skeniranje lockfilea, negativna kontrola i čitač: `docs/spikes/M8.8-P02.md`.

```bash
npm ci --ignore-scripts
node gen.mjs out
node --test read.test.mjs
```

Samostalan paket (npm, ne pnpm) izvan aplikacijskog koda. Ne ulazi u build i ne dira korijenski `package.json` ni `pnpm-lock.yaml`. `gen.mjs` piše dvije sintetičke DOCX datoteke s izmišljenim sadržajem, bez mreže i bez sata. Isti ulaz daje iste bajtove u svakoj vremenskoj zoni.

`policy.ts` drži popis pregledanih paketa. `tests/unit/spikes/docx-provenance-policy.test.ts` provjerava manifest i lockfile prema tom popisu, a `gen.mjs` prema SHA-256 pinu pregledanog sadržaja (`GENERATOR_PIN`) i popisu dopuštenih uvoza. Test radi u postojećem CI-ju i ne instalira ovaj paket. Novi ili nadograđeni paket traži novi pregled i izmjenu `REVIEWED` u istom PR-u, a izmjena generatora novi pregled i novi pin.

`read.mjs` čita današnji tekst i vrste revizija iz DOCX datoteke i ništa drugo (D-198 t. 5). Pinan je kao generator (`READER_PIN`). Testovi `read.test.mjs` rade u CI koraku `DOCX provenance spike tests`.
