// Independent offline QA; source must remain byte-identical to SOURCE_HEAD.
// Run: node tests/qa613web1/probe.mjs
// A failed product assertion stays failed; all observations are saved.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, chmodSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { jobMinutes, queueMinutes, runShape, summarizeRuns, parseTwinArgs, renderTwin, shardWhatIf } from '../../scripts/orchestrator/ci-twin-core.mjs';
import { median, percentile } from '../../scripts/orchestrator/metrics-core.mjs';
import { ghList } from '../../scripts/orchestrator/gh.mjs';

const SOURCE_HEAD = '98471f3ba5fafe112dab510edce5eef488944351';
const cwd = resolve(import.meta.dirname, '../..');
const scratch = mkdtempSync(join(tmpdir(), 'qa613web1-'));
const bin = join(scratch, 'bin'); mkdirSync(bin);
copyFileSync(join(import.meta.dirname, 'fake-gh.mjs'), join(bin, 'gh')); chmodSync(join(bin, 'gh'), 0o755);
const report = { sourceHead: SOURCE_HEAD, node: process.version, cases: [], executions: [], observations: {} };
const check = async (name, fn) => {
  try { await fn(); report.cases.push({ name, status: 'PASS' }); console.log('PASS', name); }
  catch (e) { report.cases.push({ name, status: 'FAIL', error: e.stack }); console.log('FAIL', name, e.message); }
};
const iso = n => new Date(Date.UTC(2026, 9, 23) + n * 60000).toISOString();
const job = (name = 'unit', minutes = 1, extra = {}) => ({ name, status: 'completed', conclusion: 'success', created_at: iso(0), started_at: iso(0), completed_at: iso(minutes), ...extra });
const run = (id = 1, minutes = 5, extra = {}) => ({ id, status: 'completed', conclusion: 'success', created_at: iso(0), run_started_at: iso(0), updated_at: iso(minutes), ...extra });
const fixture = (count, makeJobs = i => [job('unit', i)]) => ({ runs: Array.from({ length: count }, (_, i) => run(i + 1, i + 1)), jobs: Object.fromEntries(Array.from({ length: count }, (_, i) => [i + 1, makeJobs(i + 1)])) });
function cli(args, data, { pnpm = false } = {}) {
  const id = report.executions.length;
  const input = join(scratch, `input-${id}.json`), trace = join(scratch, `trace-${id}.jsonl`);
  writeFileSync(input, JSON.stringify(data)); writeFileSync(trace, '');
  const cmd = pnpm ? 'pnpm' : process.execPath;
  const argv = pnpm ? ['--silent', 'orch:twin', ...args] : ['scripts/orchestrator/ci-twin.mjs', ...args];
  const result = spawnSync(cmd, argv, { cwd, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, PATH: bin + ':' + process.env.PATH, QA_FIXTURE: input, QA_TRACE: trace,
      pnpm_config_verify_deps_before_run: 'false' } });
  const calls = readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean).map(x => JSON.parse(x));
  const entry = { command: [cmd, ...argv], status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr, calls };
  report.executions.push(entry);
  assert.equal(result.error, undefined); assert.equal(result.signal, null);
  for (const call of calls) { assert.equal(call.length, 2); assert.equal(call[0], 'api'); assert.match(call[1], /^repos\/\{owner\}\/\{repo\}\/actions\//); }
  return entry;
}
const args = (limit, json = true) => ['--since', '2026-10-23', '--limit', String(limit), ...(json ? ['--json'] : [])];
const decoded = e => { assert.equal(e.status, 0, e.stderr); return JSON.parse(e.stdout); };

await check('source blobs and package caller are exact', () => {
  const expected = {
    'package.json': '12b0aa51f775c6a76530759ce026068de935c384',
    'scripts/orchestrator/ci-twin-core.mjs': '72df07a6011c257dce3f23fa6f49f5e2a9c27cf1',
    'scripts/orchestrator/ci-twin-core.test.mjs': '720a83bedd0e3e128eb03168a85651fe609824f7',
    'scripts/orchestrator/ci-twin.mjs': '5ca70b02eae35b6b9f919653c41d1f6354b310ca',
  };
  for (const [path, sha] of Object.entries(expected)) { const b = readFileSync(join(cwd, path)); assert.equal(createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex'), sha); }
  assert.equal(JSON.parse(readFileSync(join(cwd, 'package.json'))).scripts['orch:twin'], 'node scripts/orchestrator/ci-twin.mjs');
});
await check('median and nearest-rank p95: empty, singleton, odd/even, n=19/20/21/100/200', () => {
  for (const n of [0, 1, 2, 3, 19, 20, 21, 100, 200]) {
    const a = Array.from({ length: n }, (_, i) => n - i);
    assert.equal(median(a), n ? (n + 1) / 2 : null);
    assert.equal(percentile(a, 95), n ? Math.ceil(n * 0.95) : null);
    const s = summarizeRuns(a.map(i => runShape(run(i, i), [job('unit', i)])));
    assert.deepEqual(s.wall, { n, p50: n ? (n + 1) / 2 : null, p95: n ? Math.ceil(n * .95) : null });
    if (n) assert.equal(s.jobs[0].p50, (n + 1) / 2);
    assert.deepEqual(a, Array.from({ length: n }, (_, i) => n - i));
  }
});
await check('skip incomplete/nonfinal conclusions and invalid/reversed timestamps; accept zero', () => {
  for (const conclusion of [null, undefined, 'skipped', 'cancelled', 'neutral', 'timed_out', 'action_required', 'startup_failure', 'stale']) assert.equal(jobMinutes(job('x', 3, { conclusion })), null);
  for (const status of ['queued', 'in_progress', 'waiting']) assert.equal(jobMinutes(job('x', 3, { status, conclusion: null, completed_at: null })), null);
  for (const fields of [{ started_at: null }, { completed_at: null }, { started_at: 'invalid' }, { started_at: iso(4) }]) assert.equal(jobMinutes(job('x', 3, fields)), null);
  assert.equal(jobMinutes(job('x', 0)), 0); assert.equal(jobMinutes(job('x', 3, { conclusion: 'failure' })), 3);
  assert.equal(runShape(run(), [job('x', 1, { conclusion: 'skipped' })]), null);
});
await check('negative/invalid wall excluded, valid job retained; zero wall included', () => {
  const bad = [run(1, -1), run(2, 1, { updated_at: null }), run(3, 1, { run_started_at: 'bad' })].map(r => runShape(r, [job()]));
  for (const s of bad) assert.equal(s.wall, null);
  assert.deepEqual(summarizeRuns(bad).wall, { n: 0, p50: null, p95: null });
  assert.equal(summarizeRuns(bad).jobs[0].n, 3);
  assert.equal(runShape(run(4, 0), [job()]).wall, 0);
});
await check('matrix names remain distinct and tied critical names deterministic', () => {
  const s = runShape(run(), [job('X', 2), job('X (1/2)', 4), job('X (2/2)', 4)]);
  assert.deepEqual(s.jobs, { X: 2, 'X (1/2)': 4, 'X (2/2)': 4 }); assert.equal(s.critical, 'X (1/2)');
});
await check('queueMinutes library boundaries', () => {
  assert.equal(queueMinutes(job('x', 3, { created_at: iso(-2) })), 2);
  assert.equal(queueMinutes(job()), 0);
  for (const f of [{ created_at: null }, { started_at: 'bad' }, { created_at: iso(2) }]) assert.equal(queueMinutes(job('x', 3, f)), null);
  assert.equal(queueMinutes(job('x', 3, { conclusion: null, completed_at: null, created_at: iso(-2) })), 2);
});
await check('shardWhatIf library formula and documented rejection boundaries', () => {
  assert.deepEqual(shardWhatIf({ jobMinutes: 10, setupMinutes: 2, shards: 2 }), { shards: 2, wall: 6, runnerMinutes: 12, savedWall: 4, extraRunnerMinutes: 2 });
  for (const v of [{ jobMinutes: 1, setupMinutes: 2, shards: 2 }, { jobMinutes: 1, setupMinutes: -1, shards: 2 }, { jobMinutes: 1, setupMinutes: 0, shards: 0 }]) assert.throws(() => shardWhatIf(v));
  assert.equal(shardWhatIf({ jobMinutes: 2, setupMinutes: 2, shards: 2 }).savedWall, 0);
  report.observations.libraryOnly = { fractional: shardWhatIf({ jobMinutes: 10, setupMinutes: 2, shards: 1.5 }), infinite: shardWhatIf({ jobMinutes: 10, setupMinutes: 2, shards: Infinity }), nonfinalWithInconsistentSuccess: jobMinutes(job('x', 3, { status: 'in_progress' })) };
});
await check('parser valid leap day/date edges, default and limit boundaries', () => {
  for (const since of ['2024-02-29', '2026-01-01', '2026-12-31']) assert.equal(parseTwinArgs(['--since', since]).since, since);
  assert.equal(parseTwinArgs(['--since', '2026-10-23']).limit, 40);
  for (const limit of [1,100,101,199,200]) assert.equal(parseTwinArgs(args(limit)).limit, limit);
});
await check('invalid calendar dates rejected by parser', () => {
  const invalid = ['2026-02-29', '2026-02-30', '2026-04-31', '2026-13-01', '2026-00-01', '2026-10-00'];
  report.observations.invalidDates = invalid.map(since => { try { return { since, accepted: parseTwinArgs(['--since', since]) }; } catch { return { since, rejected: true }; } });
  for (const since of invalid) assert.throws(() => parseTwinArgs(['--since', since]), undefined, since);
});
await check('all invalid CLI limits/unknown/missing arguments exit 2 before gh', () => {
  const cases = [[], ['--since'], ['--since','2026-1-01'], ['--since','2026-10-23','--nope'], ['--since','2026-10-23','--shards','2'], ['--since','2026-10-23','--queue']];
  for (const limit of ['0','-1','201','1.5','NaN','Infinity','abc','']) cases.push(['--since','2026-10-23','--limit',limit]);
  cases.push(['--since','2026-10-23','--limit']);
  for (const a of cases) { const e=cli(a, fixture(0)); assert.equal(e.status,2); assert.equal(e.stdout,''); assert.match(e.stderr,/ci-twin failed:/); assert.deepEqual(e.calls,[]); }
});
for (const limit of [1,100,101,150,200]) await check(`real pnpm caller offline: --limit ${limit}, pages, JSON statistics`, () => {
  const e=cli(args(limit),fixture(200),{pnpm:true}), out=decoded(e);
  assert.equal(out.summary.runs,limit); assert.equal(out.shapes.length,limit);
  assert.deepEqual(out.summary.wall,{n:limit,p50:(limit+1)/2,p95:Math.ceil(limit*.95)});
  assert.equal(out.summary.jobs[0].p50,(limit+1)/2); assert.equal(out.summary.jobs[0].p95,Math.ceil(limit*.95));
  const runCalls=e.calls.filter(c=>c[1].includes('/workflows/'));
  assert.equal(runCalls.length,Math.ceil(limit/100));
  assert.ok(runCalls.every((c,i)=>c[1].endsWith(`&page=${i+1}`)));
  assert.equal(e.calls.length,Math.ceil(limit/100)+limit);
  assert.deepEqual(out.shapes.map(s=>s.id),Array.from({length:limit},(_,i)=>i+1));
  assert.ok(!('queueMinutes' in out) && !('whatIfs' in out));
});
await check('short run page stops below requested limit; default takes 40', () => {
  const e=cli(args(200),fixture(103)), out=decoded(e);
  assert.equal(out.summary.runs,103); assert.equal(e.calls.filter(c=>c[1].includes('/workflows/')).length,2);
  assert.equal(decoded(cli(['--since','2026-10-23','--json'],fixture(50))).summary.runs,40);
});
await check('jobs paginate 100+1 and exact 100 with trailing empty page', () => {
  for (const n of [100,101]) {
    const e=cli(args(1),fixture(1,()=>Array.from({length:n},(_,i)=>job(`j${i}`,i+1))));
    assert.equal(decoded(e).summary.jobs.length,n); assert.equal(e.calls.filter(c=>c[1].includes('/jobs?')).length,2);
  }
});
await check('empty/all skipped JSON and text; text rounding and no library-only output', () => {
  for (const f of [fixture(0),fixture(1,()=>[job('skipped',3,{conclusion:'skipped'})])]) {
    const out=decoded(cli(args(1),f)); assert.deepEqual(out.summary,{runs:0,wall:{n:0,p50:null,p95:null},jobs:[]});
    const e=cli(args(1,false),f,{pnpm:true}); assert.equal(e.status,0); assert.match(e.stdout,/0 uspjesnih prolaza/); assert.match(e.stdout,/Zid: p50 - min, p95 - min \(n=0\)/); assert.doesNotMatch(e.stdout,/Model podjele|queueMinutes/);
  }
  const e=cli(args(2,false),fixture(2),{pnpm:true}); assert.equal(e.status,0); assert.match(e.stdout,/Zid: p50 1.5 min, p95 2.0 min \(n=2\)/); assert.match(e.stdout,/unit \| 2 \| 1.5 \| 2.0 \| 2/);
});
await check('since inclusive date query is forwarded exactly at year/leap boundaries', () => {
  for (const since of ['2024-02-29','2026-01-01','2026-12-31']) { const e=cli(['--since',since,'--json'],fixture(0)); assert.equal(decoded(e).since,since); assert.ok(e.calls[0][1].includes(`created=>=${since}&`)); }
});
await check('invalid calendar date CLI exits 2 without gh', () => {
  const e=cli(['--since','2026-02-30','--json'],fixture(0),{pnpm:true}); assert.equal(e.status,2); assert.deepEqual(e.calls,[]);
});
await check('REST failures/malformed JSON exit 2 without partial success output', () => {
  for (const kind of ['failure','malformed']) for (const at of ['runs','jobs']) { const f=fixture(1); f[kind]=at; const e=cli(args(1),f); assert.equal(e.status,2); assert.equal(e.stdout,''); assert.match(e.stderr,/ci-twin failed:/); }
});
await check('ghList rejects malformed keyed body and page cap rather than truncating', async () => {
  await assert.rejects(ghList('x?per_page=100',async()=>JSON.stringify({jobs:null}),{key:'jobs'}),/unexpected response/);
  let calls=0; await assert.rejects(ghList('x?per_page=100',async()=>{calls++;return JSON.stringify({jobs:Array(100).fill(job())});},{key:'jobs'}),/more than 50 pages/); assert.equal(calls,50);
});
await check('CLI mixed skipped/incomplete/negative wall and matrix names', () => {
  const f=fixture(2,()=>[job('X',2),job('X (1/2)',4),job('skip',3,{conclusion:'skipped'}),job('pending',3,{conclusion:null,completed_at:null}),job('backwards',-1)]); f.runs[0].updated_at=iso(-1);
  const out=decoded(cli(args(2),f)); assert.equal(out.summary.runs,2); assert.equal(out.summary.wall.n,1); assert.deepEqual(out.summary.jobs.map(j=>j.name),['X (1/2)','X']); assert.equal(out.shapes[0].wall,null);
});
await check('valid GitHub job name __proto__ retained by actual pnpm caller', () => {
  const e=cli(args(1),fixture(1,()=>[job('__proto__',7)]),{pnpm:true}); const out=decoded(e);
  assert.equal(out.summary.runs,1); assert.equal(out.summary.jobs.length,1); assert.equal(out.summary.jobs[0].name,'__proto__'); assert.equal(out.summary.jobs[0].p50,7);
});
await check('ordinary Object member job names retained', () => {
  const s=runShape(run(),[job('constructor',2),job('toString',3)]); assert.deepEqual(Object.keys(s.jobs),['constructor','toString']);
});
report.observations.numericArguments = ['1e2','0x64',' 2 '].map(limit=>({limit,parsed:parseTwinArgs(['--since','2026-10-23','--limit',limit])}));
report.summary = { pass: report.cases.filter(x=>x.status==='PASS').length, fail: report.cases.filter(x=>x.status==='FAIL').length };
writeFileSync(join(import.meta.dirname,'results.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report.summary));
process.exitCode=report.summary.fail ? 1 : 0;
