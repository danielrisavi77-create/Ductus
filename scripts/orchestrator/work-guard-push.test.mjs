import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

test('real push caller blocks before git push on incomplete session configuration', t => {
  const dir = mkdtempSync(join(tmpdir(), 'ductus-push-guard-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git('init', '-q'); git('checkout', '-qb', 'platforma/test');
  git('remote', 'add', 'origin', 'https://github.com/danielrisavi77-create/Ductus.git');
  // RED must never reach the network either. Trace still records an attempted push.
  git('config', 'protocol.https.allow', 'never');
  for (const name of ['push-verify.mjs', 'work-guard.mjs', 'work-guard-core.mjs']) {
    copyFileSync(new URL(name, import.meta.url), join(dir, name));
  }
  // Only the unchanged CLI argument/status helpers are isolated here; the caller,
  // guard, process launching and Git are real. The repo suite tests these helpers.
  writeFileSync(join(dir, 'orchestrator-core.mjs'), `
    export const resolvePushTarget = () => ({remote:'origin', src:'HEAD', dst:'platforma/test'});
    export const parseLsRemote = () => null;
    export const pushVerdict = () => ({ok:false, reason:'fixture'});
  `);
  const trace = join(dir, 'trace.log'), env = { ...process.env, GIT_TRACE: trace, DUCTUS_WORK_TASK: 'DAN-202' };
  delete env.DUCTUS_WORK_CONTRACT; delete env.DUCTUS_WORK_AGENT;
  const child = spawnSync(process.execPath, [join(dir, 'push-verify.mjs')], { cwd: dir, env, encoding: 'utf8', timeout: 5000 });
  assert.equal(child.status, 1);
  assert.ok(child.stdout.includes('"state":"BLOCKED"'), child.stdout + child.stderr);
  assert.ok(!/built-in: git push\b/.test(readFileSync(trace, 'utf8')));
  assert.ok(!child.stderr.includes('git push failed'));
});

test('configured pushes use the approved SHA, not a moving source ref', () => {
  const source = readFileSync(new URL('push-verify.mjs', import.meta.url), 'utf8');
  assert.match(source, /const pushSource = guard\?\.ok \? guard\.head : srcRef/);
  assert.match(source, /await git\("push", remote, `\$\{pushSource\}:refs\/heads\/\$\{dst\}`\)/);
});
