import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runWorkGuard, guardPush } from './work-guard.mjs';

const now = Date.parse('2026-10-13T04:00:00Z');
function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ductus-guard-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q'); git('config', 'user.name', 'Synthetic Test'); git('config', 'user.email', 'synthetic@example.test');
  writeFileSync(join(dir, 'outside.txt'), 'original\n'); git('add', 'outside.txt'); git('commit', '-qm', 'fixture');
  const base = git('rev-parse', 'HEAD').trim(); git('checkout', '-qb', 'platforma/test');
  git('remote', 'add', 'origin', 'https://github.com/danielrisavi77-create/Ductus.git');
  mkdirSync(join(dir, 'scripts')); writeFileSync(join(dir, 'scripts', 'new.mjs'), '// synthetic\n');
  const file = join(tmpdir(), `${dir.split(/[\\/]/).pop()}-contract.json`);
  t.after(() => rmSync(file, { force: true }));
  const contract = { schema: 1, repository: 'danielrisavi77-create/Ductus', issuedAt: new Date(now - 1000).toISOString(),
    expiresAt: new Date(now + 60000).toISOString(), assignments: [{ task: 'DAN-202', agent: 'chatgpt:test:platforma',
      branch: 'platforma/test', baseSha: base, paths: ['scripts/'], pr: null, failures: [], regressions: 0, blockers: [] }] };
  const save = () => writeFileSync(file, JSON.stringify(contract)); save();
  const calls = [];
  const exec = async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === 'gh') return base + '\n';
    assert.equal(cmd, 'git'); return git(...args);
  };
  const options = { contractFile: file, task: 'DAN-202', agent: 'chatgpt:test:platforma' };
  const deps = { exec, loadPrs: async () => [], now: () => now };
  return { dir, git, base, contract, save, file, calls, options, deps };
}

test('real Git fixture: reads committed/staged/untracked paths without mutating the tree', async t => {
  const f = setup(t), before = f.git('status', '--porcelain');
  const r = await runWorkGuard(f.options, f.deps);
  assert.equal(r.ok, true); assert.equal(r.head, f.base); assert.equal(f.git('status', '--porcelain'), before);
  assert.ok(f.calls.some(c => c.includes('--no-renames')));
  assert.equal(f.calls.filter(c => c[0] === 'gh').length, 2);
});

test('committed out-of-scope change cannot be hidden by reverting the worktree', async t => {
  const f = setup(t); writeFileSync(join(f.dir, 'outside.txt'), 'changed\n'); f.git('add', 'outside.txt'); f.git('commit', '-qm', 'bad');
  writeFileSync(join(f.dir, 'outside.txt'), 'original\n');
  const r = await runWorkGuard(f.options, f.deps); assert.equal(r.ok, false); assert.ok(r.reasons.includes('OUT_OF_SCOPE'));
});

test('a rename must be authorized under both names', async t => {
  const f = setup(t); f.git('mv', 'outside.txt', 'scripts/moved.txt');
  const r = await runWorkGuard(f.options, f.deps); assert.equal(r.ok, false); assert.ok(r.reasons.includes('OUT_OF_SCOPE'));
});

test('read/API failure stops and does not expose error text', async t => {
  const f = setup(t); f.deps.loadPrs = async () => { throw new Error('PRIVATE_SENTINEL'); };
  const r = await runWorkGuard(f.options, f.deps); assert.equal(r.ok, false);
  assert.ok(!JSON.stringify(r).includes('PRIVATE_SENTINEL'));
});

test('head movement while reading invalidates the snapshot', async t => {
  const f = setup(t); f.deps.loadPrs = async () => { f.git('add', 'scripts/new.mjs'); f.git('commit', '-qm', 'moves'); return []; };
  const r = await runWorkGuard(f.options, f.deps); assert.equal(r.ok, false); assert.ok(r.reasons.includes('HEAD_MOVED'));
});

test('main movement while reading invalidates the snapshot', async t => {
  const f = setup(t), exec = f.deps.exec; let reads = 0;
  f.deps.exec = (cmd, args) => cmd === 'gh' && ++reads === 2 ? Promise.resolve('c'.repeat(40) + '\n') : exec(cmd, args);
  const r = await runWorkGuard(f.options, f.deps); assert.equal(r.ok, false); assert.ok(r.reasons.includes('BASE_MOVED'));
});

test('contract expiration is checked after collection, not just at startup', async t => {
  const f = setup(t); f.deps.now = () => now + 120000;
  const r = await runWorkGuard(f.options, f.deps); assert.equal(r.ok, false); assert.ok(r.reasons.includes('STALE_CONTRACT'));
});

test('oversized or malformed file gives BLOCK, not a parser diagnostic', async t => {
  const f = setup(t);
  for (const text of ['{', ' '.repeat(32769), '{"secret":"PRIVATE_SENTINEL"}']) {
    writeFileSync(f.file, text); const r = await runWorkGuard(f.options, f.deps); assert.equal(r.ok, false);
    assert.ok(!JSON.stringify(r).includes('PRIVATE_SENTINEL'));
  }
});

test('configured push checks the actual destination and source before proceeding', async t => {
  const f = setup(t);
  const env = { DUCTUS_WORK_CONTRACT: f.file, DUCTUS_WORK_TASK: f.options.task, DUCTUS_WORK_AGENT: f.options.agent };
  const target = { src: 'HEAD', dst: 'platforma/test', remote: 'origin', currentBranch: 'platforma/test' };
  const r = await guardPush(target, env, f.deps); assert.equal(r.ok, true);
  assert.equal((await guardPush({ ...target, src: 'other/ref' }, env, f.deps)).ok, false);
  assert.equal((await guardPush({ ...target, dst: 'platforma/other' }, env, f.deps)).ok, false);
  f.git('remote', 'set-url', '--push', 'origin', 'https://github.com/other/repo.git');
  assert.equal((await guardPush(target, env, f.deps)).ok, false);
});

test('partial configuration blocks; absent configuration preserves the original path', async t => {
  const f = setup(t); assert.equal(await guardPush({}, {}, f.deps), null);
  assert.equal((await guardPush({}, { DUCTUS_WORK_TASK: 'DAN-202' }, f.deps)).ok, false);
});

test('a stale caller branch cannot redirect a checked head to another branch', async t => {
  const f = setup(t);
  const env = { DUCTUS_WORK_CONTRACT: f.file, DUCTUS_WORK_TASK: f.options.task, DUCTUS_WORK_AGENT: f.options.agent };
  const target = { src: 'HEAD', dst: 'platforma/stale', remote: 'origin', currentBranch: 'platforma/stale' };
  assert.equal((await guardPush(target, env, f.deps)).ok, false);
});
