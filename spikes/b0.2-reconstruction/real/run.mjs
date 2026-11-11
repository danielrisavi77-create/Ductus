// B0.2 on the real code (DAN-388, M3.4-P01): every scenario, each measurement
// in a fresh process. Writes results/real-<label>.json and prints a Markdown
// table. Needs `node real/build.mjs` first.
//   node real/run.mjs [label] [--words 15000,80000] [--granularity char,word]
//                     [--checkpoint-steps 500,2000,8000]
// The checkpoint distance is a parameter (ARCHITECTURE §5 only proposes one),
// so every distance listed is measured.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, platform, totalmem } from 'node:os';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1].split(',') : fallback;
};
const label = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'local';
const wordCounts = option('words', ['15000', '80000']).map(Number);
const granularities = option('granularity', ['char', 'word']);
const checkpointSteps = option('checkpoint-steps', ['500', '2000', '8000']).map(Number);

const bench = (env, ...args) => JSON.parse(execFileSync(
  process.execPath,
  [join('real', 'bench.mjs'), ...args.map(String)],
  { encoding: 'utf8', maxBuffer: 1 << 20, env: { ...process.env, ...env } },
));

const machine = {
  label,
  cpu: cpus()[0].model.trim(),
  cpuCount: cpus().length,
  memoryGb: Math.round(totalmem() / 1073741824),
  platform: platform(),
  node: process.version,
  checkpointSteps,
  date: new Date().toISOString(),
};
const results = [];
for (const words of wordCounts) {
  for (const granularity of granularities) {
    const dir = join('out', `real-${words}-${granularity}`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    console.error(`${words} words, ${granularity}...`);
    const row = { words, granularity, gen: bench({}, 'gen', words, granularity, dir), replay: bench({}, 'replay', dir), checkpoints: [] };
    for (const steps of checkpointSteps) {
      const env = { CHECKPOINT_STEPS: String(steps) };
      const checkpoint = bench(env, 'checkpoint', dir);
      // Too few steps for one checkpoint: nothing to resume from.
      const bounded = checkpoint.checkpoints > 0 ? bench(env, 'bounded', dir) : null;
      row.checkpoints.push({ steps, checkpoint, bounded });
      rmSync(join(dir, 'checkpoint.json'), { force: true });
      rmSync(join(dir, 'checkpoint.meta.json'), { force: true });
    }
    results.push(row);
  }
}

mkdirSync('results', { recursive: true });
writeFileSync(join('results', `real-${label}.json`), `${JSON.stringify({ machine, results }, null, 2)}\n`);

const lines = [
  `${machine.label}: ${machine.cpu}, ${machine.cpuCount} CPU, ${machine.memoryGb} GB, Node ${machine.node}; stvarni kod`,
  '',
  '| Riječi | Segmenti | Događaji | Koraci | Provjera segmenata | Puni replay | Vrh RSS | Dnevnik segmenata (gzip) | Dokumenti u commitovima |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
];
for (const r of results) {
  lines.push(`| ${r.words} (${r.granularity}) | ${r.gen.segments} | ${r.gen.events} | ${r.gen.steps} | ${r.replay.loadMs} ms | `
    + `${r.replay.replayMs} ms | ${r.replay.peakRssMb} MB | ${r.gen.segmentLogMb} MB (${r.gen.segmentLogGzipMb} MB) | ${r.gen.commitDocumentsMb} MB |`);
}
lines.push('', '| Riječi | Razmak (koraci) | Kontrolne točke | Zadnja točka (gzip) | Volumen točaka (gzip) | Od točke: koraci | Od točke (medijan / max) | Vrh RSS |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |');
for (const r of results) {
  for (const { steps, checkpoint: c, bounded: b } of r.checkpoints) {
    lines.push(`| ${r.words} (${r.granularity}) | ${steps} | ${c.checkpoints} | ${c.lastCheckpointKb} KB (${c.lastCheckpointGzipKb} KB) | `
      + `${c.volumeRawMb} MB (${c.volumeGzipMb} MB) | ${b ? b.stepsReplayed : '–'} | ${b ? `${b.medianMs} / ${b.maxMs} ms` : '–'} | `
      + `${Math.max(c.peakRssMb, b?.peakRssMb ?? 0)} MB |`);
  }
}
console.log(lines.join('\n'));
