// Independent QA for PR #610. No source modifications, no real network.
// Run from the exact source checkout: node --test /path/to/qa610-cli.test.mjs
// QA_EVIDENCE_DIR optionally preserves every fixture, request and CLI result.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(process.env.QA_SOURCE ?? process.cwd());
const NOW = Date.parse('2026-10-24T00:00:00Z');
const SHA = 'e9da8cd1d0f61ab468054f6079314133d9ef4bae';
const { planParallel, DEMO_FIRST_UNTIL } = await import(pathToFileURL(join(root, 'scripts/orchestrator/plan-core.mjs')));
const { contractState, checkWork } = await import(pathToFileURL(join(root, 'scripts/orchestrator/work-guard-core.mjs')));
const { overlapPairs } = await import(pathToFileURL(join(root, 'scripts/orchestrator/orchestrator-core.mjs')));
const output = process.env.QA_EVIDENCE_DIR ?? mkdtempSync(join(tmpdir(), 'qa610web1-'));
mkdirSync(output, { recursive: true });
let serial = 0;
const body = (n, role = 'platforma', writer = `codex:s${n}`) => `Agent: ${writer}:${role}\nRisk: critical\nTask: DAN-${n}`;
const pr = (n, path = `scripts/p${n}.mjs`, role = 'platforma', extra = {}) => ({ number: n, title: `synthetic ${n}`, state: 'open', draft: true, body: body(n, role), base: { ref: 'main' }, head: { ref: `qa/${n}`, sha: SHA }, paths: [path], ...extra });
const assignment = (p, extra = {}) => ({ task: `DAN-${p.number}`, agent: p.body.split('\n')[0].slice(7), branch: p.head.ref, baseSha: SHA, paths: p.paths.length ? p.paths : ['scripts/'], pr: p.number, failures: [], regressions: 0, blockers: [], ...extra });
const contract = (ps, extra = {}) => ({ schema: 1, repository: 'danielrisavi77-create/Ductus', issuedAt: new Date(NOW - 60_000).toISOString(), expiresAt: new Date(NOW + 60_000).toISOString(), assignments: ps.map(p => assignment(p)), ...extra });
const files = p => p.paths.map(filename => ({ filename, status: 'modified' }));
const fixture = ps => ({ prs: ps.map(({ paths, ...p }) => p), files: Object.fromEntries(ps.map(p => [p.number, files(p)])) });
const shim = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.QA_CALLS, JSON.stringify(args)+'\\n');
if (args.length !== 2 || args[0] !== 'api' || !/^repos\\/\\{owner\\}\\/\\{repo\\}\\/pulls(?:\\?state=open&per_page=100&page=\\d+|\\/\\d+\\/files\\?per_page=100&page=\\d+)$/.test(args[1])) { console.error('QA denied non-GET or non-pulls call'); process.exit(97); }
const f=JSON.parse(fs.readFileSync(process.env.QA_FIXTURE,'utf8'));
const m=args[1].match(/pulls\\/(\\d+)\\/files/), n=m?.[1];
if ((!n && f.listFail) || (n && f.failFiles?.includes(Number(n)))) { console.error('HTTP 403 synthetic unavailable'); process.exit(1); }
if (n && f.rawFiles?.[n] !== undefined) { process.stdout.write(f.rawFiles[n]); process.exit(0); }
const page=Number(new URLSearchParams(args[1].split('?')[1]).get('page'));
const data=n ? f.files[n] : f.prs;
process.stdout.write(JSON.stringify(Array.isArray(data) ? data.slice((page-1)*100,page*100) : data));
`;
function run(name, ps, options = {}) {
  const dir = join(output, `${String(++serial).padStart(3, '0')}-${name}`);
  mkdirSync(dir, { recursive: true });
  const bin = join(dir, 'bin'); mkdirSync(bin);
  writeFileSync(join(bin, 'gh'), shim, { mode: 0o755 });
  const f = options.fixture ?? fixture(ps);
  writeFileSync(join(dir, 'fixture.json'), JSON.stringify(f, null, 2));
  const c = options.contract === undefined ? contract(ps) : options.contract;
  const cfile = join(dir, 'contract.json');
  if (options.rawContract !== undefined) writeFileSync(cfile, options.rawContract);
  else if (c !== null) writeFileSync(cfile, JSON.stringify(c));
  const clock = join(dir, 'clock.mjs'); writeFileSync(clock, `Date.now = () => ${options.now ?? NOW};\n`);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, QA_FIXTURE: join(dir, 'fixture.json'), QA_CALLS: join(dir, 'calls.jsonl') };
  delete env.DUCTUS_WORK_CONTRACT; delete env.NODE_OPTIONS;
  if (options.envContract) env.DUCTUS_WORK_CONTRACT = cfile;
  const args = options.args ?? ['--plan', '--json', ...(c !== null || options.rawContract !== undefined ? ['--contract', options.contractPath === 'directory' ? dir : cfile] : []), ...(options.independent ?? []).flatMap(pair => ['--independent', pair])];
  if (options.pnpm) env.NODE_OPTIONS = `--import=${clock}`;
  const command = options.pnpm ? 'pnpm' : process.execPath;
  const argv = options.pnpm ? ['--silent', 'orch:overlap', ...args] : ['--import', clock, join(root, 'scripts/orchestrator/pr-overlap.mjs'), ...args];
  const beforeContract = existsSync(cfile) ? readFileSync(cfile) : null;
  const child = spawnSync(command, argv, { cwd: root, env, encoding: 'utf8', timeout: 15000, maxBuffer: 8 * 1024 * 1024 });
  const result = { status: child.status, signal: child.signal, error: child.error?.message, stdout: child.stdout, stderr: child.stderr };
  writeFileSync(join(dir, 'result.json'), JSON.stringify({ command, argv, ...result }, null, 2));
  if (beforeContract) assert.deepEqual(readFileSync(cfile), beforeContract, 'contract must be unchanged');
  const calls = existsSync(env.QA_CALLS) ? readFileSync(env.QA_CALLS, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  assert.ok(calls.every(a => a.length === 2 && a[0] === 'api' && a[1].startsWith('repos/{owner}/{repo}/pulls')), 'GET only');
  let data; try { data = JSON.parse(result.stdout); } catch { /* negative CLI cases */ }
  return { ...result, data, calls, dir };
}
const verdict = r => r.data.plan.rows.map(x => x.verdict);
const expect = (r, status, vs) => { assert.equal(r.status, status, JSON.stringify(r)); if (vs) assert.deepEqual(verdict(r), vs, JSON.stringify(r.data)); };
const unknown = r => { assert.ok(r.status === 0 || r.status === 1 || r.status === 2); if (r.data?.plan) assert.ok(r.data.plan.rows.every(p => p.verdict !== 'PARALELNO'), JSON.stringify(r.data)); };

test('actual pnpm caller + valid contract + deterministic retry + no fixture writes', () => {
  const ps = [pr(1), pr(2, 'e2e/a.spec.ts', 'frontend')];
  const a = run('pnpm-valid', ps, { pnpm: true }); const b = run('retry', ps);
  expect(a, 0, ['PARALELNO', 'PARALELNO']); assert.equal(a.stdout, b.stdout);
});
test('contract environment default and explicit override', () => {
  const ps = [pr(1)]; expect(run('env-contract', ps, { envContract: true, args: ['--plan', '--json'] }), 0, ['PARALELNO']);
  expect(run('explicit-missing', ps, { envContract: true, args: ['--plan', '--json', '--contract', '/nonexistent/qa610.json'] }), 0, ['NEPROVJERENO']);
});
for (const [name, options] of [
  ['missing', { contract: null }], ['invalid-json', { rawContract: '{' }], ['null-json', { rawContract: 'null' }],
  ['bad-utf8', { rawContract: Buffer.from([0xff, 0xfe]) }], ['directory', { contractPath: 'directory' }],
  ['oversize', { rawContract: ' '.repeat(32769) }],
]) test(`unreadable contract ${name} never grants parallel`, () => expect(run(name, [pr(1)], options), 0, ['NEPROVJERENO']));

for (const [name, mutate] of [
  ['wrong-repo', c => c.repository = 'evil/repo'], ['unknown-key', c => c.admin = true],
  ['empty-assignments', c => c.assignments = []], ['wrong-role', c => c.assignments[0].agent = 'codex:s1:backend'],
  ['wrong-task', c => c.assignments[0].task = 'DAN-999'], ['absent-pr', c => c.assignments[0].pr = 999],
  ['traversal-path', c => c.assignments[0].paths = ['../.git/config']], ['wildcard', c => c.assignments[0].paths = ['*']],
  ['bad-blocker', c => c.assignments[0].blockers = ['override']], ['invalid-agent', c => c.assignments[0].agent = 'attacker'],
  ['non-array-paths', c => c.assignments[0].paths = null], ['unsafe-pr', c => c.assignments[0].pr = 2 ** 53],
  ['expired', c => c.expiresAt = new Date(NOW).toISOString()], ['future', c => c.issuedAt = new Date(NOW + 1).toISOString()],
  ['long-window', c => { c.issuedAt = new Date(NOW - 1).toISOString(); c.expiresAt = new Date(NOW + 900000).toISOString(); }],
]) test(`invalid/expired assignment ${name}`, () => { const ps=[pr(1)], c=contract(ps); mutate(c); expect(run(name, ps, { contract: c }), 0, ['NEPROVJERENO']); });

test('work-guard deadline parity at issue, expiry and fifteen minutes', () => {
  const ps=[pr(1)], c=contract(ps, { issuedAt: new Date(NOW).toISOString(), expiresAt: new Date(NOW + 900000).toISOString() });
  const evidence={ now: NOW, task:'DAN-1', agent:'codex:s1:platforma', branch:'qa/1', head:SHA, baseSha:SHA, paths:ps[0].paths, prs:[{ number:1, headRefName:'qa/1', headRepository:c.repository, paths:ps[0].paths }] };
  for (const [now, state] of [[NOW-1,'STALE_CONTRACT'], [NOW,'VALID'], [NOW+899999,'VALID'], [NOW+900000,'STALE_CONTRACT'], [NaN,'STALE_CONTRACT']]) {
    assert.equal(contractState(c,now),state);
    const w=checkWork(c,{...evidence,now}); assert.equal(w.ok,state==='VALID');
  }
});
test('all explicit blockers wait', () => { for (const blocker of ['infrastructure','decision','ownership','dependency']) { const ps=[pr(1)],c=contract(ps);c.assignments[0].blockers=[blocker];expect(run(blocker,ps,{contract:c}),0,['ČEKA OVISNOST']); } });
test('metadata in fenced/indented code cannot grant a writer', () => { for(const b of ['```\n'+body(1)+'\n```','    '+body(1).replaceAll('\n','\n    '),'Agent: codex:s1:reviewer\nTask: DAN-1','Agent: codex:s1:platforma\nTask: #87']) { const ps=[pr(1)],c=contract(ps);ps[0].body=b;expect(run('bad-metadata',ps,{contract:c}),0,['NEPROVJERENO']); } });
test('non-main and named open dependencies wait, closed refs do not', () => {
  for (const phrase of ['ovisi o #2','depends on #2','čeka #2','stacked on #2']) { const ps=[pr(1),pr(2)];ps[0].body+='\n'+phrase;expect(run('dependency',ps),0,['ČEKA OVISNOST','PARALELNO']); }
  expect(run('stacked',[pr(1,undefined,undefined,{base:{ref:'qa/parent'}})]),0,['ČEKA OVISNOST']);
  expect(run('closed',[pr(1,undefined,undefined,{body:body(1)+'\ndepends on #999'})]),0,['PARALELNO']);
});
test('shared files, migrations, DB tests and rename old path cannot be overridden', () => {
  for(const [a,b] of [['src/a.ts','src/a.ts'],['db/migrations/a.sql','db/migrations/b.sql'],['db/tests/a.sql','db/tests/b.sql']]) expect(run('collision',[pr(1,a),pr(2,b)],{independent:['1:2']}),0,['PREKLAPANJE','PREKLAPANJE']);
  const ps=[pr(1,'src/new.ts'),pr(2,'src/old.ts')],f=fixture(ps);f.files[1][0]={filename:'src/new.ts',previous_filename:'src/old.ts',status:'renamed'};
  expect(run('rename',ps,{fixture:f}),0,['PREKLAPANJE','PREKLAPANJE']);
});
test('shared contracts require the exact independent pair in either order', () => {
  const ps=[pr(1,'app/api/test/route.ts','backend'),pr(2,'src/lib/api.ts','frontend'),pr(3)];
  // D-107 also holds the tooling draft while the two demo drafts wait.
  // v1's mistaken tooling expectation is preserved with its failed run.
  expect(run('pair-unknown',ps),0,['NEPROVJERENO','NEPROVJERENO','ČEKA OVISNOST']);
  expect(run('pair-wrong',ps,{independent:['1:3']}),0,['NEPROVJERENO','NEPROVJERENO','ČEKA OVISNOST']);
  expect(run('pair-reversed',ps,{independent:['2:1']}),0,['PARALELNO','PARALELNO','PARALELNO']);
});
test('independent cannot override invalid contracts or declared dependencies', () => {
  const ps=[pr(1,'app/api/x/route.ts','backend'),pr(2,'app/page.tsx','frontend')];
  expect(run('independent-missing',ps,{contract:null,independent:['1:2']}),0,['NEPROVJERENO','NEPROVJERENO']);
  ps[1].body+='\novisi o #1';expect(run('independent-dep',ps,{independent:['1:2']}),0,['PARALELNO','ČEKA OVISNOST']);
});
test('different principals in the same role still have a contract dependency', () => expect(run('same-role',[pr(1,'src/domain/a.ts','frontend'),pr(2,'src/editor/a.ts','frontend')]),0,['NEPROVJERENO','NEPROVJERENO']));
test('same runtime:slot with two assignments is invalid under work guard', () => {
  const ps=[pr(1,'src/domain/a.ts','frontend'),pr(2,'src/editor/a.ts','frontend',{body:body(2,'frontend','codex:s1')})];
  expect(run('same-principal',ps),0,['NEPROVJERENO','NEPROVJERENO']);
});
test('same writer pair rule on a single assigned PR does not add shared-contract reason', () => {
  const ps=[pr(1,'src/domain/a.ts','frontend'),pr(2,'src/editor/a.ts','frontend',{body:body(2,'frontend','codex:s1')})];
  const r=run('same-writer-single-assignment',ps,{contract:contract([ps[0]])});expect(r,0,['PARALELNO','NEPROVJERENO']);assert.ok(r.data.plan.rows.every(x=>!x.reasons.some(y=>y.includes('shared contract'))));
});
test('GET failure and malformed JSON files propagate unknown to all rows, exit one', () => {
  const ps=[pr(1),pr(2)];for(const extra of [{failFiles:[1]},{rawFiles:{1:'{'}}]) expect(run('unread-files',ps,{fixture:{...fixture(ps),...extra}}),1,['NEPROVJERENO','NEPROVJERENO']);
});
test('list GET failure yields exit two and no output plan', () => { const r=run('list-failure',[pr(1)],{fixture:{...fixture([pr(1)]),listFail:true}});assert.equal(r.status,2);assert.equal(r.stdout,''); });
test('all pages read, last-page overlap preserved; 3000 file cap fails closed', () => {
  const ps=[pr(1),pr(2,'src/f236.ts')],f=fixture(ps);f.files[1]=Array.from({length:237},(_,i)=>({filename:`src/f${i}.ts`,status:'modified'}));
  const r=run('pagination',ps,{fixture:f});expect(r,0,['PREKLAPANJE','PREKLAPANJE']);assert.equal(r.calls.length,5);
  f.files[1]=Array.from({length:3000},(_,i)=>({filename:`src/f${i}.ts`,status:'modified'}));expect(run('api-cap',ps,{fixture:f}),1,['NEPROVJERENO','NEPROVJERENO']);
});
test('D-107 blocked or unassigned demo draft holds tooling, and deadline is exact', () => {
  const ps=[pr(1,'src/feature.ts','frontend'),pr(2)],c=contract(ps);c.assignments[0].blockers=['decision'];
  expect(run('demo-blocked',ps,{contract:c}),0,['ČEKA OVISNOST','ČEKA OVISNOST']);
  expect(run('demo-unassigned',ps,{contract:contract([ps[1]])}),0,['NEPROVJERENO','ČEKA OVISNOST']);
  const prs=ps.map(p=>({...p,isDraft:p.draft,baseRefName:p.base.ref}));
  for(const [now,expected] of [[DEMO_FIRST_UNTIL-1,'ČEKA OVISNOST'],[DEMO_FIRST_UNTIL,'PARALELNO']]) { const cc={...c,issuedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+1000).toISOString()};assert.equal(planParallel({prs,pairs:overlapPairs(prs),contract:cc,now}).rows[1].verdict,expected); }
});
test('gate capacity prioritizes demo draft even when tooling number is lower', () => {
  const ps=[pr(1),pr(2,'src/demo.ts','frontend'),pr(3,'scripts/3.mjs','platforma',{draft:false}),pr(4,'scripts/4.mjs','platforma',{draft:false})];
  expect(run('gate-priority',ps),0,['ČEKA OVISNOST','PARALELNO','PARALELNO','PARALELNO']);
});
test('full gate admits no draft', () => { const ps=[1,2,3].map(n=>pr(n,undefined,undefined,{draft:false}));ps.push(pr(4));expect(run('full-gate',ps),0,['PARALELNO','PARALELNO','PARALELNO','ČEKA OVISNOST']); });
test('bad arguments fail before any GitHub call and cannot execute shell input', () => {
  for(const args of [['--plan','--independent','1:1'],['--plan','--independent','1:2;touch /tmp/qa610-injection'],['--plan','--independent','-1:2'],['--contract'],['--plan','--bad'],['--plan','--contract','--json']]) {const r=run('bad-args',[pr(1)],{args});assert.equal(r.status,2);assert.equal(r.calls.length,0);}
});

// Contract assertions below deliberately retain failures. No expectation is
// weakened to match an observed implementation result.
test('F1 wrong assigned principal with the same role must stay NEPROVJERENO', () => {
  const ps=[pr(1)],c=contract(ps);c.assignments[0].agent='claude:assigned:platforma';
  expect(run('F1-wrong-writer',ps,{contract:c,pnpm:true}),0,['NEPROVJERENO']);
});
test('F1 spoofing the same runtime:slot cannot suppress a shared-contract check', () => {
  const ps=[pr(1,'src/domain/a.ts','frontend'),pr(2,'src/editor/a.ts','frontend')],c=contract(ps);
  ps[1].body=body(2,'frontend','codex:s1');
  expect(run('F1-spoofed-pair',ps,{contract:c}),0,['NEPROVJERENO','NEPROVJERENO']);
});
for(const [name,records] of [['empty',[]],['missing-filename',[{status:'modified'}]],['non-string',[{filename:123,status:'modified'}]],['rename-without-old',[{filename:'src/new.ts',status:'renamed'}]]]) test(`F2 incomplete file list ${name} must never grant parallel`,()=>{const ps=[pr(1)],f=fixture(ps);f.files[1]=records;unknown(run('F2-'+name,ps,{fixture:f}));});
test('F3 overfull gate must not call four current PRs parallel',()=>{const ps=[1,2,3,4].map(n=>pr(n,undefined,undefined,{draft:false}));const r=run('F3-overfull',ps);assert.equal(r.status,0);assert.equal(r.data.plan.overfull,true);assert.ok(verdict(r).filter(v=>v==='PARALELNO').length<=3,JSON.stringify(r.data));});
test('F4 missing base cannot prove main',()=>{const ps=[pr(1,undefined,undefined,{base:{}})];unknown(run('F4-missing-base',ps));});
