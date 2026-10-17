import test from 'node:test';
import assert from 'node:assert/strict';
import { checkWork } from './work-guard-core.mjs';

const now = Date.parse('2026-10-13T04:00:00Z');
const base = 'a'.repeat(40), head = 'b'.repeat(40);
function fixture() {
  const assignment = { task: 'DAN-202', agent: 'chatgpt:workguard:platforma',
    branch: 'platforma/dan-202-work-guard', baseSha: base,
    paths: ['scripts/orchestrator/'], pr: null, failures: [], regressions: 0, blockers: [] };
  return {
    contract: { schema: 1, repository: 'danielrisavi77-create/Ductus',
      issuedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 60000).toISOString(),
      assignments: [assignment] },
    evidence: { task: assignment.task, agent: assignment.agent, branch: assignment.branch,
      head, baseSha: base, paths: ['scripts/orchestrator/work-guard.mjs'], prs: [], now },
  };
}
const result = (f) => checkWork(f.contract, f.evidence);
const block = (f, code) => {
  const r = result(f);
  assert.equal(r.ok, false); assert.equal(r.state, 'BLOCKED');
  assert.ok(r.reasons.includes(code), JSON.stringify(r));
  assert.notEqual(r.next, 'merge');
};
function other(overrides = {}) {
  return { ...fixture().contract.assignments[0], task: 'DAN-189', agent: 'claude:cloudB:backend',
    branch: 'backend/dan-189', paths: ['db/migrations/'], ...overrides };
}
const fail = (id, root, round = 1) => ({ id, root, round, head });

test('an isolated confirmed task permits work, not merge or formal review', () => {
  const r = result(fixture());
  assert.equal(r.ok, true); assert.equal(r.state, 'ALLOWED');
  assert.equal(r.next, 'assigned-step'); assert.deepEqual(r.reasons, []);
  assert.equal(r.task, 'DAN-202'); assert.equal(r.head, head);
});
for (const [name, change] of [
  ['missing failure history', f => { delete f.contract.assignments[0].failures; }],
  ['unknown field', f => { f.contract.assignments[0].allowMerge = true; }],
  ['wrong repository', f => { f.contract.repository = 'elsewhere/repo'; }],
  ['invalid version', f => { f.contract.schema = 2; }],
  ['missing assignments', f => { delete f.contract.assignments; }],
  ['empty assignments', f => { f.contract.assignments = []; }],
  ['duplicate task', f => { f.contract.assignments.push(other({ task: 'DAN-202' })); }],
  ['duplicate branch', f => { f.contract.assignments.push(other({ branch: f.evidence.branch })); }],
  ['duplicate OpenAI principal alias', f => { f.contract.assignments.push(other({ agent: 'codex:WORKGUARD:platforma' })); }],
  ['default branch', f => { f.contract.assignments[0].branch = 'main'; }],
  ['path traversal', f => { f.contract.assignments[0].paths = ['src/../scripts/']; }],
  ['absolute path', f => { f.contract.assignments[0].paths = ['C:\\repo\\src']; }],
  ['git metadata', f => { f.contract.assignments[0].paths = ['.git/config']; }],
  ['wildcard scope', f => { f.contract.assignments[0].paths = ['**']; }],
  ['duplicate failure event', f => { f.contract.assignments[0].failures = [fail('x', 'r'), fail('x', 'r')]; }],
  ['nonfinite regression count', f => { f.contract.assignments[0].regressions = NaN; }],
  ['malformed timestamp', f => { f.contract.issuedAt = 'yesterday'; }],
]) test(`rejects malformed contract: ${name}`, () => { const f = fixture(); change(f); block(f, 'INVALID_CONTRACT'); });

for (const [name, change] of [
  ['expired', c => { c.expiresAt = new Date(now).toISOString(); }],
  ['future', c => { c.issuedAt = new Date(now + 1).toISOString(); }],
  ['overlong lease', c => { c.expiresAt = new Date(now + 900001).toISOString(); }],
]) test(`blocks ${name} snapshot`, () => { const f = fixture(); change(f.contract); block(f, 'STALE_CONTRACT'); });

for (const [key, value, code] of [
  ['task', 'DAN-999', 'UNASSIGNED'], ['agent', 'claude:someone:platforma', 'WRONG_AGENT'],
  ['branch', 'platforma/another', 'WRONG_BRANCH'], ['baseSha', 'c'.repeat(40), 'STALE_BASE'],
  ['paths', ['package.json'], 'OUT_OF_SCOPE'], ['paths', ['scripts/orchestrator-other/x'], 'OUT_OF_SCOPE'],
  ['head', null, 'INVALID_EVIDENCE'], ['prs', null, 'INVALID_EVIDENCE'],
]) test(`blocks evidence ${key}: ${code}`, () => { const f = fixture(); f.evidence[key] = value; block(f, code); });

test('scope normalization is case/slash aware, directory boundary is real', () => {
  const f = fixture(); f.evidence.paths = ['.\\Scripts\\Orchestrator\\work-guard.mjs'];
  assert.equal(result(f).ok, true);
  f.contract.assignments[0].paths = ['scripts/orchestrator/work-guard.mjs'];
  f.evidence.paths = ['scripts/orchestrator/work-guard.mjs/child']; block(f, 'OUT_OF_SCOPE');
});

test('active claims overlap before any PR exists; disjoint claims pass', () => {
  const f = fixture(); f.contract.assignments.push(other()); assert.equal(result(f).ok, true);
  f.contract.assignments[1].paths = ['scripts/']; block(f, 'CLAIM_OVERLAP');
});

test('migration and db test domains serialize even different files', () => {
  for (const directory of ['db/migrations/', 'db/tests/']) {
    const f = fixture(); f.contract.assignments[0].paths = [directory + 'one.sql'];
    f.evidence.paths = []; f.contract.assignments.push(other({ paths: [directory + 'two.sql'] }));
    block(f, 'CLAIM_OVERLAP');
  }
});

test('four active writers require a separate approved policy, never silent expansion', () => {
  const f = fixture();
  for (let i = 1; i <= 3; i++) f.contract.assignments.push(other({ task: `DAN-${i}`,
    agent: `claude:w${i}:backend`, branch: `backend/task-${i}`, paths: [`src/a${i}/`] }));
  block(f, 'WIP_LIMIT');
});

test('open drafts and renamed old/new paths block overlapping planned work', () => {
  const f = fixture(); f.evidence.paths = [];
  f.evidence.prs = [{ number: 900, isDraft: true, headRefName: 'other/work', paths: ['old.txt', 'scripts/orchestrator/new.mjs'] }];
  block(f, 'PR_OVERLAP');
  f.evidence.prs[0].paths = null; block(f, 'INCOMPLETE_PR_FILES');
});

test('only explicit own PR on the correct branch is excluded, missing own PR blocks', () => {
  const f = fixture(); f.contract.assignments[0].pr = 900;
  f.evidence.prs = [{ number: 900, headRefName: f.evidence.branch, headRepository: 'danielrisavi77-create/Ductus', paths: f.evidence.paths }];
  assert.equal(result(f).ok, true);
  f.evidence.prs[0].headRefName = 'someone/else'; block(f, 'WRONG_PR');
  f.evidence.prs = []; block(f, 'WRONG_PR');
});

test('unknown file lists cannot pass even for the own PR', () => {
  const f = fixture(); f.contract.assignments[0].pr = 900;
  f.evidence.prs = [{ number: 900, headRefName: f.evidence.branch, headRepository: 'danielrisavi77-create/Ductus', paths: null }];
  block(f, 'INCOMPLETE_PR_FILES');
});

test('two failures on one root block even across changed heads', () => {
  const f = fixture(); f.contract.assignments[0].failures = [fail('e1', 'root')];
  assert.equal(result(f).ok, true);
  f.contract.assignments[0].failures.push({ ...fail('e2', 'root', 2), head: 'c'.repeat(40) });
  block(f, 'REPEATED_FAILURE');
});

test('third round and consecutive regressions escalate even for different roots', () => {
  const f = fixture(); f.contract.assignments[0].failures = [fail('e1', 'one', 1), fail('e2', 'two', 2)];
  block(f, 'ROUND_LIMIT');
  f.contract.assignments[0].failures = []; f.contract.assignments[0].regressions = 2;
  block(f, 'REGRESSION_LIMIT');
});

for (const reason of ['infrastructure', 'decision', 'ownership', 'dependency']) test(`stops immediately for ${reason}`, () => {
  const f = fixture(); f.contract.assignments[0].blockers.push(reason); block(f, 'EXPLICIT_BLOCKER');
});

test('compact output never leaks arbitrary input or raw paths', () => {
  const f = fixture(); const secret = 'PRIVATE_SENTINEL_NOT_A_TOKEN';
  f.contract.assignments[0].paths = [secret];
  const output = JSON.stringify(result(f)); assert.ok(output.length < 1024); assert.ok(!output.includes(secret));
});

for (const key of ['task', 'agent', 'baseSha']) test(`does not coerce assignment ${key} from an array`, () => {
  const f = fixture(); f.contract.assignments[0][key] = [f.contract.assignments[0][key]];
  block(f, 'INVALID_CONTRACT');
});
for (const key of ['task', 'agent', 'head', 'baseSha']) test(`does not coerce evidence ${key} from an array`, () => {
  const f = fixture(); f.evidence[key] = [f.evidence[key]]; block(f, 'INVALID_EVIDENCE');
  assert.ok(!Array.isArray(result(f)[key]));
});
test('null evidence blocks without throwing', () => {
  assert.equal(checkWork(fixture().contract, null).ok, false);
});
test('an unrelated PR from a fork main branch does not block isolated work', () => {
  const f = fixture(); f.evidence.prs = [{ number: 1, headRefName: 'main', paths: ['other.txt'] }];
  assert.equal(result(f).ok, true);
});
test('an own PR must also belong to this repository, not a same-named fork branch', () => {
  const f = fixture(); f.contract.assignments[0].pr = 900;
  f.evidence.prs = [{ number: 900, headRefName: f.evidence.branch, headRepository: 'other/fork', paths: f.evidence.paths }];
  block(f, 'WRONG_PR');
});

test('review and QA observations of the same failed round count as one attempt', () => {
  const f = fixture(); f.contract.assignments[0].failures = [fail('review-1', 'root', 1), fail('qa-1', 'root', 1)];
  assert.equal(result(f).ok, true);
});
