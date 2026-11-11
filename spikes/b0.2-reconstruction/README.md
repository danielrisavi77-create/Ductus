# B0.2: alat za mjerenje rekonstrukcije

Metoda, rezultati i zaključci: `docs/spikes/B0.2.md`.

## Stvarni kod (M3.4-P01, DAN-388)

Workload u `real/` piše u headless Tiptap editor sa stvarnim proširenjima i bilježi ga stvarnim `EvidenceRecorder`om. Mjeri stvarne v2 segmente (`ductus-edit-steps-v1`), stvarnu provjeru i stvarni replay. Kod iz `src/` gradi se korijenskim viteom, pa treba korijenski `pnpm install`:

```bash
# u korijenu repoa
pnpm install
cd spikes/b0.2-reconstruction
npm run test:real                 # gradi out/real/real.mjs i pokreće testove
node real/run.mjs <oznaka-stroja> # 15.000 i 80.000 riječi, char i word
```

`--words`, `--granularity` i `--checkpoint-steps` (zadano `500,2000,8000`) sužavaju ili mijenjaju scenarije. Rezultati idu u `results/real-<oznaka>.json`, a tablice na stdout. Pojedini mod: `node real/bench.mjs gen|replay|checkpoint|bounded …` (upute su na vrhu `real/bench.mjs`).

## Zamjenska shema (3. 10. 2026., povijest)

```bash
npm install
npm test
node run.mjs <oznaka-stroja>
```

Samostalan paket (npm, ne pnpm) jer je spike izvan aplikacijskog koda; ne ulazi u build.
