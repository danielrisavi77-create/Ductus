// B0.2 on the real code (DAN-388, M3.4-P01). One measurement in one process,
// so peak memory belongs to that measurement. Needs `node real/build.mjs` first.
//   node real/bench.mjs gen <words> <granularity> <dir>
//   node real/bench.mjs replay|checkpoint|bounded <dir>
// Prints one JSON line. CHECKPOINT_UNIT (segments or steps, default segments)
// and CHECKPOINT_EVERY (default 500) give the distance between checkpoints,
// e.g. every K segments; see real/spacing.mjs.
import { createReadStream, createWriteStream, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import {
  canonicalizeJcs, createEditStepsV1Replayer, replayEvidenceFromCheckpointV2, replayEvidenceSegmentsV2,
  verifyCanonicalEvidencePayloadV2,
} from '../out/real/real.mjs';
import { generateSession } from './gen.mjs';
import { checkpointIndices, checkpointSpacing } from './spacing.mjs';

const SPACING = checkpointSpacing(process.env.CHECKPOINT_UNIT ?? 'segments', process.env.CHECKPOINT_EVERY ?? 500);
const BOUNDED_RUNS = 21;
const SEED = 2026;

let peakRss = 0;
const sampler = setInterval(() => {
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
}, 10);

function finish(result) {
  clearInterval(sampler);
  peakRss = Math.max(peakRss, process.memoryUsage().rss, process.resourceUsage().maxRSS * 1024);
  console.log(JSON.stringify({ ...result, peakRssMb: mb(peakRss) }));
}

const mb = (bytes) => Math.round((bytes / 1048576) * 10) / 10;
const kb = (bytes) => Math.round(bytes / 1024);
const ms = (start) => Math.round(Number(process.hrtime.bigint() - start) / 1e5) / 10;
const stepsOf = (segment) => segment.events.reduce((sum, event) => sum + event.steps.length, 0);

/** Segments as stored: one JCS payload per line, verified as the ingest verifies it. */
async function readSegments(dir) {
  const segments = [];
  const lines = createInterface({ input: createReadStream(join(dir, 'segments.ndjson')) });
  for await (const line of lines) {
    const verified = await verifyCanonicalEvidencePayloadV2(line);
    if (!verified.ok) throw new Error(`segment ${segments.length} refused: ${verified.reason}`);
    segments.push(verified.segment);
  }
  return segments;
}

const readJson = (dir, name) => JSON.parse(readFileSync(join(dir, name), 'utf8'));

async function gen(words, granularity, dir) {
  const out = createWriteStream(join(dir, 'segments.ndjson'));
  let documentBytes = 0;
  let largestSegment = 0;
  const start = process.hrtime.bigint();
  const session = await generateSession({ words, granularity, seed: SEED }, (built) => {
    // JCS bytes hold no raw line break, so a line is one segment.
    out.write(built.bytes);
    out.write('\n');
    documentBytes += built.document.byteLength;
    largestSegment = Math.max(largestSegment, built.bytes.byteLength);
  });
  const genMs = ms(start);
  await new Promise((resolve) => out.end(resolve));
  writeFileSync(join(dir, 'initial.json'), canonicalizeJcs(session.initial));
  const finalBytes = Buffer.from(canonicalizeJcs(session.final));
  const counts = Object.fromEntries(Object.entries(session).filter(([key]) => key !== 'initial' && key !== 'final'));
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(counts));
  const log = readFileSync(join(dir, 'segments.ndjson'));
  finish({
    ...counts,
    genMs,
    finalDocKb: kb(finalBytes.length),
    largestSegmentKb: kb(largestSegment),
    segmentLogMb: mb(log.length),
    segmentLogGzipMb: mb(gzipSync(log).length),
    // Each commit carries the whole document (ARCHITECTURE §5): what the client sends.
    commitDocumentsMb: mb(documentBytes),
  });
}

/** Full replay from the initial document: verification of the whole chain. */
async function replay(dir) {
  const meta = readJson(dir, 'meta.json');
  const loadStart = process.hrtime.bigint();
  const segments = await readSegments(dir);
  const loadMs = ms(loadStart);
  const start = process.hrtime.bigint();
  const result = await replayEvidenceSegmentsV2(readJson(dir, 'initial.json'), segments, createEditStepsV1Replayer());
  const replayMs = ms(start);
  if (!result.ok) throw new Error(`replay failed: ${result.reason} at segment ${result.segmentIndex}`);
  if (result.documentSha256 !== segments.at(-1).finalDocumentHash) throw new Error('replay hash mismatch');
  finish({
    mode: 'replay', segments: segments.length, events: meta.events, steps: meta.steps,
    loadMs, replayMs, stepsPerSec: Math.round(meta.steps / (replayMs / 1000)),
  });
}

/**
 * Replay segment by segment, as the ingest receives them, keeping a checkpoint
 * (JCS bytes of the document a segment starts from) every SPACING.every
 * segments or steps. Measures checkpoint cost and stored volume; writes the
 * newest one.
 */
async function checkpoint(dir) {
  const segments = await readSegments(dir);
  const replayer = createEditStepsV1Replayer();
  let document = readJson(dir, 'initial.json');
  const indices = checkpointIndices(segments.map(stepsOf), SPACING);
  const due = new Set(indices);
  let count = 0;
  let rawBytes = 0;
  let gzipBytes = 0;
  let checkpointMs = 0;
  let last = null;
  const start = process.hrtime.bigint();
  for (let index = 0; index < segments.length; index++) {
    if (due.has(index)) {
      const cpStart = process.hrtime.bigint();
      const bytes = Buffer.from(canonicalizeJcs(document));
      checkpointMs += ms(cpStart);
      count++;
      rawBytes += bytes.length;
      gzipBytes += gzipSync(bytes).length;
      last = { index, hash: segments[index].initialDocumentHash, bytes };
    }
    const result = await replayEvidenceSegmentsV2(document, [segments[index]], replayer);
    if (!result.ok) throw new Error(`replay failed: ${result.reason} at segment ${index}`);
    // canonicalDocument is the JCS text; the next segment starts from its value.
    document = JSON.parse(result.canonicalDocument);
  }
  const totalMs = ms(start);
  if (last) {
    writeFileSync(join(dir, 'checkpoint.json'), last.bytes);
    writeFileSync(join(dir, 'checkpoint.meta.json'), JSON.stringify({ index: last.index, hash: last.hash }));
  }
  finish({
    mode: 'checkpoint', checkpointUnit: SPACING.unit, checkpointEvery: SPACING.every, checkpoints: count,
    firstCheckpointAt: indices[0] ?? null, lastCheckpointAt: last?.index ?? null,
    totalMs, checkpointMs: Math.round(checkpointMs),
    lastCheckpointKb: last ? kb(last.bytes.length) : 0,
    lastCheckpointGzipKb: last ? kb(gzipSync(last.bytes).length) : 0,
    volumeRawMb: mb(rawBytes), volumeGzipMb: mb(gzipBytes),
  });
}

/**
 * The submission path: replayEvidenceFromCheckpointV2 from the newest
 * checkpoint to the end, with the hash checked. Median and max of 21 runs.
 */
async function bounded(dir) {
  const segments = await readSegments(dir);
  const initial = readJson(dir, 'initial.json');
  const { hash, index } = readJson(dir, 'checkpoint.meta.json');
  const checkpoints = new Map([[hash, new Uint8Array(readFileSync(join(dir, 'checkpoint.json')))]]);
  const replayer = createEditStepsV1Replayer();
  const times = [];
  let resumedAt = null;
  for (let run = 0; run < BOUNDED_RUNS; run++) {
    const start = process.hrtime.bigint();
    const result = await replayEvidenceFromCheckpointV2(initial, segments, replayer, checkpoints);
    times.push(ms(start));
    if (!result.ok) throw new Error(`bounded replay failed: ${result.reason}`);
    if (result.documentSha256 !== segments.at(-1).finalDocumentHash) throw new Error('bounded hash mismatch');
    resumedAt = result.resumedAt;
  }
  if (resumedAt !== index) throw new Error(`resumed at ${resumedAt}, checkpoint is at ${index}`);
  const sorted = [...times].sort((a, b) => a - b);
  finish({
    mode: 'bounded', resumedAt, segmentsReplayed: segments.length - resumedAt,
    stepsReplayed: segments.slice(resumedAt).reduce((sum, segment) => sum + stepsOf(segment), 0),
    // The replay digests the document after every event, so events drive the cost.
    eventsReplayed: segments.slice(resumedAt).reduce((sum, segment) => sum + segment.events.length, 0),
    medianMs: sorted[Math.floor(sorted.length / 2)], maxMs: sorted.at(-1),
  });
}

const [mode, ...args] = process.argv.slice(2);
const modes = { gen: () => gen(Number(args[0]), args[1], args[2]), replay: () => replay(args[0]), checkpoint: () => checkpoint(args[0]), bounded: () => bounded(args[0]) };
if (!modes[mode]) {
  console.error('usage: node real/bench.mjs gen <words> <char|word> <dir> | replay|checkpoint|bounded <dir>');
  process.exit(2);
}
await modes[mode]();
