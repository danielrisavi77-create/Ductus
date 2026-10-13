import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { guardPush, runWorkGuard } from './work-guard.mjs';

const repoUrl = 'https://github.com/danielrisavi77-create/Ductus.git';
const now = Date.parse('2026-10-13T04:00:00Z');
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ductus-guard-boundary-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const work = join(dir, 'work'); mkdirSync(work);
  const git = (...args) => execFileSync('git', args, { cwd: work, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q'); git('checkout', '-qb', 'platforma/test');
  git('config', 'user.name', 'Synthetic Test'); git('config', 'user.email', 'synthetic@example.test');
  writeFileSync(join(work, 'outside.txt'), 'original\n');
  git('add', 'outside.txt'); git('commit', '-qm', 'fixture');
  const base = git('rev-parse', 'HEAD'); git('remote', 'add', 'origin', repoUrl);
  const contract = { schema: 1, repository: 'danielrisavi77-create/Ductus',
    issuedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 60000).toISOString(),
    assignments: [{ task: 'DAN-202', agent: 'chatgpt:test:platforma', branch: 'platforma/test',
      baseSha: base, paths: ['scripts/'], pr: null, failures: [], regressions: 0, blockers: [] }] };
  const contractFile = join(dir, 'contract.json');
  const save = () => writeFileSync(contractFile, JSON.stringify(contract)); save();
  const options = { contractFile, task: 'DAN-202', agent: 'chatgpt:test:platforma' };
  // Git is real; only the GitHub read boundary is synthetic and no network runs.
  const deps = { now: () => now, loadPrs: async () => [],
    exec: async (cmd, args) => cmd === 'gh' ? base : git(...args) };
  const env = { DUCTUS_WORK_CONTRACT: contractFile, DUCTUS_WORK_TASK: options.task, DUCTUS_WORK_AGENT: options.agent };
  const target = { src: 'HEAD', dst: 'platforma/test', remote: 'origin', currentBranch: 'platforma/test' };
  return { dir, work, git, base, contract, save, options, deps, env, target };
}

test('staged out-of-scope content stays visible after a worktree-only restoration', async t => {
  const f = fixture(t);
  writeFileSync(join(f.work, 'outside.txt'), 'staged change\n'); f.git('add', 'outside.txt');
  writeFileSync(join(f.work, 'outside.txt'), 'original\n');
  assert.equal(f.git('diff', '--name-only', 'HEAD'), '');
  assert.equal(f.git('diff', '--cached', '--name-only'), 'outside.txt');
  const before = f.git('status', '--porcelain');
  const r = await runWorkGuard(f.options, f.deps);
  assert.equal(r.ok, false); assert.ok(r.reasons.includes('OUT_OF_SCOPE'));
  assert.equal(f.git('status', '--porcelain'), before);
});

test('branch change between the push entry check and snapshot read cannot redirect a valid task', async t => {
  const f = fixture(t), exec = f.deps.exec;
  f.contract.assignments[0].branch = 'platforma/other'; f.save();
  f.deps.exec = async (cmd, args) => {
    const out = await exec(cmd, args);
    if (cmd === 'git' && args[0] === 'remote') f.git('checkout', '-qb', 'platforma/other');
    return out;
  };
  const r = await guardPush(f.target, f.env, f.deps);
  assert.equal(r.ok, false); assert.ok(r.reasons.includes('PUSH_TARGET'));
});

test('successful guard hands the caller its exact validated push URL', async t => {
  const f = fixture(t);
  const r = await guardPush(f.target, f.env, f.deps);
  assert.equal(r.ok, true); assert.equal(r.head, f.base); assert.equal(r.pushUrl, repoUrl);
});

// Exercise the real push caller and real Git transfers between local bare repos.
// Only guard output and unchanged metadata helpers are controlled seams here;
// runtime tests above exercise the real guard. This is not a live GitHub pilot.
for (const mode of ['retargeted remote name', 'different fetch and push URL', 'unconfigured legacy path']) {
  test(`push caller uses and verifies the intended repository: ${mode}`, t => {
    const f = fixture(t), approved = join(f.dir, 'approved.git'), other = join(f.dir, 'other.git');
    f.git('init', '--bare', '-q', approved); f.git('init', '--bare', '-q', other);
    const legacy = mode === 'unconfigured legacy path';
    f.git('remote', 'set-url', 'origin', legacy ? approved : other);
    if (mode === 'different fetch and push URL') f.git('remote', 'set-url', '--push', 'origin', approved);
    copyFileSync(new URL('push-verify.mjs', import.meta.url), join(f.work, 'push-verify.mjs'));
    writeFileSync(join(f.work, 'orchestrator-core.mjs'), `
      export const resolvePushTarget = () => ({ remote: 'origin', src: 'HEAD', dst: 'platforma/test' });
      export const parseLsRemote = out => out.trim().split(/\\s+/)[0] || null;
      export const pushVerdict = (pushed, local, remote) => ({ ok: pushed && local === remote, reason: 'fixture' });
    `);
    const result = legacy ? null : { ok: true, state: 'ALLOWED', head: f.base, pushUrl: approved };
    writeFileSync(join(f.work, 'guard-result.json'), JSON.stringify(result));
    writeFileSync(join(f.work, 'work-guard.mjs'), `
      import { readFileSync } from 'node:fs';
      export const guardPush = async () => JSON.parse(readFileSync(new URL('./guard-result.json', import.meta.url), 'utf8'));
    `);
    const guardSource = readFileSync(join(f.work, 'work-guard.mjs'), 'utf8');
    assert.ok(!guardSource.includes(f.base), 'fixture commit must be data, not generated code');
    assert.ok(!guardSource.includes(approved), 'fixture destination must be data, not generated code');
    const child = spawnSync(process.execPath, [join(f.work, 'push-verify.mjs')], {
      cwd: f.work, encoding: 'utf8', timeout: 10000,
      env: { ...process.env, GIT_ALLOW_PROTOCOL: 'file' },
    });
    assert.equal(child.status, 0, child.stdout + child.stderr);
    const intended = f.git('--git-dir=' + approved, 'show-ref');
    assert.equal(intended, f.base + ' refs/heads/platforma/test');
    const otherRefs = f.git('--git-dir=' + other, 'for-each-ref', '--format=%(refname)');
    assert.equal(otherRefs, '');
  });
}
