// Runs every scenario, each measurement in a fresh process, and writes
// results/<label>.json plus a Markdown table to stdout.
//   node run.mjs [label] [--words 15000,80000] [--granularity char,word]
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { cpus, totalmem, platform } from 'node:os';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1].split(',') : fallback;
};
const label = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'local';
const wordCounts = option('words', ['15000', '80000']).map(Number);
const granularities = option('granularity', ['char', 'word']);

const bench = (...args) => JSON.parse(
  execFileSync(process.execPath, ['bench.mjs', ...args.map(String)], { encoding: 'utf8', maxBuffer: 1 << 20 }),
);

const machine = {
  label,
  cpu: cpus()[0].model.trim(),
  cpuCount: cpus().length,
  memoryGb: Math.round(totalmem() / 1073741824),
  platform: platform(),
  node: process.version,
  checkpointEvery: Number(process.env.CHECKPOINT_EVERY ?? 200),
  date: new Date().toISOString(),
};
const results = [];
for (const words of wordCounts) {
  for (const granularity of granularities) {
    const dir = join('out', `${words}-${granularity}`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    console.error(`${words} words, ${granularity}...`);
    const row = { words, granularity, gen: bench('gen', words, granularity, dir) };
    for (const mode of ['replay', 'checkpoint', 'bounded']) row[mode] = bench(mode, dir);
    results.push(row);
  }
}

mkdirSync('results', { recursive: true });
writeFileSync(join('results', `${label}.json`), `${JSON.stringify({ machine, results }, null, 2)}\n`);

const lines = [
  `${machine.label}: ${machine.cpu}, ${machine.cpuCount} CPU, ${machine.memoryGb} GB, Node ${machine.node}, `
    + `kontrolna točka svakih ${machine.checkpointEvery} koraka`,
  '',
  '| Riječi | Koraci | Puni replay | Vrh RSS | Kontrolne točke (kom.) | Zadnja točka (gzip) | Volumen točaka (gzip) | Ograničena rekonstrukcija (medijan / max) | Dnevnik koraka (gzip) |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
];
for (const r of results) {
  lines.push(`| ${r.words} (${r.granularity}) | ${r.gen.steps} | ${r.replay.replayMs} ms | ${Math.max(r.replay.peakRssMb, r.checkpoint.peakRssMb)} MB | `
    + `${r.checkpoint.checkpoints} | ${r.checkpoint.lastCheckpointKb} KB (${r.checkpoint.lastCheckpointGzipKb} KB) | `
    + `${r.checkpoint.volumeRawMb} MB (${r.checkpoint.volumeGzipMb} MB) | ${r.bounded.medianMs} / ${r.bounded.maxMs} ms | `
    + `${r.gen.stepLogMb} MB (${r.gen.stepLogGzipMb} MB) |`);
}
console.log(lines.join('\n'));
