import test from 'node:test';
import assert from 'node:assert/strict';
import { collectWorkPrs } from './work-guard.mjs';
const repo = 'danielrisavi77-create/Ductus';
const pr = () => ({ number: 12, state: 'open', head: { ref: 'platforma/test', repo: { full_name: repo } } });
const file = () => ({ status: 'renamed', filename: 'new.mjs', previous_filename: 'old.mjs' });
const listing = (prs = [pr()], files = [file()]) => async path => path.includes('/files?') ? files : prs;
test('REST adapter preserves fork identity, old/new rename names and explicit repository', async () => {
  const calls = [], list = listing();
  const r = await collectWorkPrs(async path => { calls.push(path); return list(path); });
  assert.deepEqual(r, [{ number: 12, headRefName: 'platforma/test', headRepository: repo, paths: ['new.mjs', 'old.mjs'] }]);
  assert.ok(calls.every(p => p.startsWith(`repos/${repo}/`)));
  const fork = pr(); fork.head.repo.full_name = 'other/fork';
  assert.equal((await collectWorkPrs(listing([fork])))[0].headRepository, 'other/fork');
});
for (const [label, prs, files] of [
  ['non-array list', {}, []], ['missing head', [{ number: 12, state: 'open' }], []],
  ['incomplete rename', [pr()], [{ status: 'renamed', filename: 'new.mjs' }]],
  ['missing filename', [pr()], [{ status: 'modified' }]],
  ['unknown status', [pr()], [{ status: 'surprise', filename: 'new.mjs' }]],
  ['empty file response', [pr()], []], ['GitHub file cap', [pr()], Array.from({ length: 3000 }, file)],
  ['closed PR in open snapshot', [{ ...pr(), state: 'closed' }], [file()]],
]) test(`REST adapter fails closed: ${label}`, async () => {
  await assert.rejects(collectWorkPrs(listing(prs, files)));
});
test('empty, successfully read open PR list is valid', async () => {
  assert.deepEqual(await collectWorkPrs(listing([], [])), []);
});
