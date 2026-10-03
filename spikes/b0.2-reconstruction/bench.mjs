// One measurement in one process, so peak memory belongs to that measurement.
//   node bench.mjs gen <words> <granularity> <dir>
//   node bench.mjs replay|checkpoint|bounded <dir>
// Prints one JSON line with the result.
import { createReadStream, createWriteStream, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { Node } from 'prosemirror-model';
import { Step } from 'prosemirror-transform';
import { schema, canonicalize, sha256, emptyDoc } from './lib.mjs';
import { generateSession } from './gen.mjs';

const CHECKPOINT_EVERY = Number(process.env.CHECKPOINT_EVERY ?? 200);

let peakRss = 0;
const sampler = setInterval(() => {
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
}, 10);

function finish(result) {
  clearInterval(sampler);
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
  const maxRssKb = process.resourceUsage().maxRSS;
  console.log(JSON.stringify({ ...result, peakRssMb: mb(Math.max(peakRss, maxRssKb * 1024)) }));
}

const mb = (bytes) => Math.round((bytes / 1048576) * 10) / 10;
const ms = (start) => Math.round(Number(process.hrtime.bigint() - start) / 1e5) / 10;

async function* readSteps(dir) {
  const lines = createInterface({ input: createReadStream(join(dir, 'steps.ndjson')) });
  for await (const line of lines) yield Step.fromJSON(schema, JSON.parse(line));
}

function applyStep(doc, step, index) {
  const result = step.apply(doc);
  if (result.failed) throw new Error(`step ${index} failed: ${result.failed}`);
  return result.doc;
}

async function gen(words, granularity, dir) {
  const out = createWriteStream(join(dir, 'steps.ndjson'));
  const start = process.hrtime.bigint();
  const session = generateSession({ words, granularity, seed: 2026 }, (step) => {
    out.write(`${JSON.stringify(step.toJSON())}\n`);
  });
  await new Promise((resolve) => out.end(resolve));
  const canonical = canonicalize(session.doc.toJSON());
  const meta = { words: session.words, steps: session.steps, finalHash: sha256(canonical) };
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta));
  const log = readFileSync(join(dir, 'steps.ndjson'));
  finish({
    ...meta,
    genMs: ms(start),
    finalDocKb: Math.round(Buffer.byteLength(canonical) / 1024),
    stepLogMb: mb(log.length),
    stepLogGzipMb: mb(gzipSync(log).length),
  });
}

// Full replay from the empty document: the worst case (whole chain verification).
async function replay(dir) {
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
  const start = process.hrtime.bigint();
  let doc = emptyDoc();
  let i = 0;
  for await (const step of readSteps(dir)) doc = applyStep(doc, step, i++);
  const replayMs = ms(start);
  const hash = sha256(canonicalize(doc.toJSON()));
  if (hash !== meta.finalHash) throw new Error('replay hash mismatch');
  finish({ mode: 'replay', steps: i, replayMs, stepsPerSec: Math.round(i / (replayMs / 1000)) });
}

// Replay that also writes a canonical checkpoint every CHECKPOINT_EVERY steps,
// as the server does on ingest. Measures checkpoint cost and stored volume.
async function checkpoint(dir) {
  const start = process.hrtime.bigint();
  let doc = emptyDoc();
  let i = 0;
  let count = 0;
  let rawBytes = 0;
  let gzipBytes = 0;
  let canonNs = 0n;
  let last = null;
  for await (const step of readSteps(dir)) {
    doc = applyStep(doc, step, i++);
    if (i % CHECKPOINT_EVERY === 0) {
      const t = process.hrtime.bigint();
      const text = canonicalize(doc.toJSON());
      sha256(text);
      canonNs += process.hrtime.bigint() - t;
      const size = Buffer.byteLength(text);
      rawBytes += size;
      gzipBytes += gzipSync(text).length;
      count++;
      last = { step: i, text };
    }
  }
  writeFileSync(join(dir, 'last-checkpoint.json'), JSON.stringify(last));
  finish({
    mode: 'checkpoint',
    totalMs: ms(start),
    checkpoints: count,
    lastCheckpointKb: Math.round(Buffer.byteLength(last.text) / 1024),
    lastCheckpointGzipKb: Math.round(gzipSync(last.text).length / 1024),
    avgCanonicalizeHashMs: Math.round(Number(canonNs / BigInt(count)) / 1e4) / 100,
    volumeRawMb: mb(rawBytes),
    volumeGzipMb: mb(gzipBytes),
  });
}

// Submission path: load the latest checkpoint, apply the remaining steps,
// canonicalize and compare with the client hash. Repeated for a stable median.
async function bounded(dir) {
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
  const last = JSON.parse(readFileSync(join(dir, 'last-checkpoint.json'), 'utf8'));
  const tail = [];
  let i = 0;
  for await (const step of readSteps(dir)) if (++i > last.step) tail.push(JSON.stringify(step.toJSON()));
  const runs = [];
  for (let r = 0; r < 21; r++) {
    const start = process.hrtime.bigint();
    let doc = Node.fromJSON(schema, JSON.parse(last.text));
    tail.forEach((json, k) => {
      doc = applyStep(doc, Step.fromJSON(schema, JSON.parse(json)), last.step + k);
    });
    if (sha256(canonicalize(doc.toJSON())) !== meta.finalHash) throw new Error('bounded hash mismatch');
    runs.push(ms(start));
  }
  runs.sort((a, b) => a - b);
  finish({ mode: 'bounded', tailSteps: tail.length, medianMs: runs[10], maxMs: runs[20] });
}

const [mode, ...args] = process.argv.slice(2);
const modes = {
  gen: () => gen(Number(args[0]), args[1], args[2]),
  replay: () => replay(args[0]),
  checkpoint: () => checkpoint(args[0]),
  bounded: () => bounded(args[0]),
};
if (!modes[mode]) {
  console.error('usage: node bench.mjs gen <words> <char|word> <dir> | replay|checkpoint|bounded <dir>');
  process.exit(2);
}
await modes[mode]();
