#!/usr/bin/env node
// Read-only deterministic helpers for Claude Code. No transcript/body upload or new gate.
// Usage: context --task DAN-N --sha <40hex> --file <path>... | locate --symbol <name>
//        log --file <path> | handoff --file <path> | preflight --pr <n> --sha <40hex>
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SHA = /^[a-f0-9]{40}$/i;
const TASK = /^DAN-\d+$/;
const ROOT_FILES = new Set(['CLAUDE.md', 'AGENTS.md', 'STATE.md', 'README.md']);
const ROOT_DIRS = new Set(['src', 'app', 'db', 'docs', 'tests', 'scripts', 'e2e']);
const MAX_LOG = 10 * 1024 * 1024;
const LIMIT = 25;
const fail = (code) => { throw new Error(code); };

function rootPath(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.includes('\\') || relative.includes('\0')) fail('PATH');
  const segments = relative.split('/');
  if (segments.some(s => !s || s === '.' || s === '..') || !(ROOT_FILES.has(relative) || ROOT_DIRS.has(segments[0]))) fail('PATH');
  if (segments.some(s => /^\.env(?:\.|$)/i.test(s) || /^secrets$/i.test(s) || s === '.git' || s === 'node_modules' || s.endsWith('.age'))) fail('PRIVATE_PATH');
  const p = path.resolve(root, relative);
  const real = fs.realpathSync(p);
  if (!real.startsWith(path.resolve(root) + path.sep) || real !== p || !fs.lstatSync(p).isFile()) fail('PATH');
  return p;
}

export function contextPack(root, task, head, paths, currentSha) {
  if (!TASK.test(task) || !SHA.test(head) || head !== currentSha) fail('STALE_SHA');
  if (!paths.length || paths.length > LIMIT || new Set(paths).size !== paths.length) fail('FILES');
  const files = paths.map(f => {
    const content = fs.readFileSync(rootPath(root, f));
    if (content.length > 256_000) fail('LARGE_FILE');
    const text = content.toString('utf8');
    const headings = f.endsWith('.md') ? text.split('\n').flatMap((line, i) => /^#{1,3}\s/.test(line) ? [{ line: i + 1, level: line.match(/^#+/)[0].length }] : []) : [];
    return { path: f, bytes: content.length, lines: text.split('\n').length,
      sha256: createHash('sha256').update(content).digest('hex'), headings: headings.slice(0, 40) };
  });
  return { task, head, kind: 'index-only', files, note: 'Read canonical sections from source; headings are locations, not evidence of correctness.' };
}

export function locate(root, symbol) {
  if (typeof symbol !== 'string' || !/^[a-zA-Z_$][a-zA-Z0-9_$.:/-]{0,99}$/.test(symbol)) fail('SYMBOL');
  const command = ['grep', '-n', '-F', '--', symbol, '--', 'src', 'app', 'db', 'tests', 'scripts', 'e2e'];
  const res = spawnSync('git', command, { cwd: root, encoding: 'utf8', timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
  if (res.error || (res.status !== 0 && res.status !== 1)) fail('GIT_GREP');
  const lines = (res.stdout || '').split('\n').filter(Boolean);
  const places = lines.slice(0, LIMIT).flatMap(s => { const m = /^([^\n]+?):(\d+):/.exec(s); return m ? [`${m[1]}:${m[2]}`] : []; });
  return { symbol, locations: [...new Set(places)], truncated: lines.length > LIMIT, note: 'Only tracked-file locations, not code or a semantic review.' };
}

export function digestLog(root, relative) {
  const p = rootPath(root, relative);
  const size = fs.statSync(p).size;
  if (size > MAX_LOG) fail('LARGE_LOG');
  const log = fs.readFileSync(p, 'utf8');
  const patterns = [ ['TYPE_ERROR', /\bTS\d{4}\b/], ['ASSERTION', /\bAssertionError\b/],
    ['EXCEPTION', /\b(?:TypeError|ReferenceError|SyntaxError)\b/], ['FAILED', /\b(?:FAIL|FAILED|failed)\b/],
    ['EXIT_ERROR', /\bERR_[A-Z_]+\b/] ];
  const findings = [];
  log.split('\n').forEach((line, i) => {
    const ptn = patterns.find(([, regex]) => regex.test(line));
    if (ptn && findings.length < LIMIT) findings.push({ line: i + 1, kind: ptn[0] });
  });
  return { file: relative, bytes: size, findings, truncated: findings.length === LIMIT,
    note: 'Diagnostic locations only; never substitutes for a complete test/CI result.' };
}

export function compactHandoff(root, relative) {
  const p = rootPath(root, relative);
  if (fs.statSync(p).size > 65536) fail('LARGE_REPORT');
  const body = fs.readFileSync(p, 'utf8');
  const keys = ['PR', 'Agent', 'Testovi', 'Review', 'QA', 'Otvoreno ili blokira', 'Treba Daniel'];
  const fields = Object.fromEntries(keys.map(k => [k, new RegExp(`^${k}:\\s*\\S`, 'm').test(body)]));
  const sha = /\b[0-9a-f]{40}\b/i.test(body);
  return { file: relative, shaPresent: sha, sectionsPresent: fields,
    complete: sha && fields.PR && fields.Agent && fields.Testovi && fields.Review && fields.QA,
    note: 'Presence audit only; fields must be verified against canonical PR/GitHub evidence.' };
}

export function checkedPreflight(root, pr, sha, runner = spawnSync) {
  if (!Number.isSafeInteger(pr) || pr < 1 || !SHA.test(sha)) fail('PR_SHA');
  const script = path.join(root, 'scripts', 'orchestrator', 'preflight.mjs');
  const res = runner(process.execPath, [script, String(pr), '--head', sha],
    { cwd: root, encoding: 'utf8', timeout: 90000, maxBuffer: 1024 * 1024 });
  if (res.error || ![0,1,2].includes(res.status)) return { exitCode: 2, note: 'Preflight could not be executed.' };
  return { exitCode: res.status, note: res.status === 0 ? 'Existing orch:preflight PASS' : 'Existing orch:preflight not PASS',
    details: String(res.stdout || '').split('\n').filter(x => /^PREFLIGHT /.test(x)).slice(-1) };
}

export function parseOptions(args) {
  const [mode, ...rest] = args;
  if (!['context', 'locate', 'log', 'handoff', 'preflight'].includes(mode)) fail('USAGE');
  const opts = { mode, files: [] };
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i], val = rest[i+1];
    if (!val || !/^--(?:task|sha|file|symbol|pr)$/.test(key)) fail('USAGE');
    if (key === '--file') opts.files.push(val);
    else if (Object.hasOwn(opts,key.slice(2))) fail('USAGE');
    else opts[key.slice(2)] = val;
  }
  return opts;
}

function main() {
  try {
    const o = parseOptions(process.argv.slice(2));
    const root = execFileSync('git', ['rev-parse','--show-toplevel'], { encoding:'utf8' }).trim();
    const head = execFileSync('git', ['rev-parse','HEAD'], { cwd:root, encoding:'utf8' }).trim();
    let out;
    if (o.mode === 'context') out = contextPack(root,o.task,o.sha,o.files,head);
    else if (o.mode === 'locate') out = locate(root,o.symbol);
    else if (o.mode === 'log' && o.files.length === 1) out = digestLog(root,o.files[0]);
    else if (o.mode === 'handoff' && o.files.length === 1) out = compactHandoff(root,o.files[0]);
    else if (o.mode === 'preflight') out = checkedPreflight(root,Number(o.pr),o.sha);
    else fail('USAGE');
    console.log(JSON.stringify(out));
    if (o.mode === 'preflight') process.exitCode = out.exitCode;
  } catch (e) { console.error(`CLAUDE_WORKFLOW ${String(e.message).replace(/[^A-Z_]/g,'').slice(0,40) || 'ERROR'}`); process.exitCode = 2; }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
