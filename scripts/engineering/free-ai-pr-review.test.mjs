import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addedLines, redactPatch, selectPatches, validateFindings, report } from './free-ai-pr-review.mjs';

const patch = '@@ -2,2 +2,3 @@\n unchanged\n-old\n+new\n+second\n kept';
const file = { filename: 'src/server/demo.ts', patch, status: 'modified' };

function finding(overrides = {}) {
  return { severity: 'important', path: file.filename, line: 3, what: 'Neispravna kontrola identiteta',
    scenario: 'Napadač šalje neovlašten zahtjev', reachable: 'POST handler dopušta ovaj ulaz',
    suggestion: 'Dodati provjeru identiteta', ...overrides };
}

test('addedLines tracks only new code, not deletions or context', () => {
  assert.deepEqual([...addedLines(patch)], [3, 4]);
});

test('changed line validation rejects hallucinated paths and lines', () => {
  const { selected } = selectPatches([file]);
  assert.deepEqual(validateFindings({ findings: [finding({ line: 30 }), finding({ path: 'foo.ts' }), finding()] }, selected), [finding()]);
});

test('validation rejects unsupported verdict, missing scenario and duplicates', () => {
  const { selected } = selectPatches([file]);
  assert.deepEqual(validateFindings({ findings: [finding({ severity: 'PASS' }), finding({ reachable: '' }), finding(), finding()] }, selected), [finding()]);
});

test('truncated review reports partial coverage', () => {
  const huge = { ...file, patch: '@@ -1 +1 @@\n+' + 'x'.repeat(12000) };
  const result = selectPatches([huge]);
  assert.equal(result.partial, true);
  assert.equal(result.selected[0].truncated, true);
});

test('binary files, lockfiles and secret files are not sent to model', () => {
  const result = selectPatches([{ filename: 'artifact.bin' }, { filename: '.env.production', patch },
    { filename: 'pnpm-lock.yaml', patch }, file]);
  assert.deepEqual(result.selected.map(x => x.path), [file.filename]);
  assert.equal(result.partial, true);
});

test('policy paths are prioritized over documentation', () => {
  const result = selectPatches([{ filename: 'README.md', patch }, file]);
  assert.deepEqual(result.selected.map(x => x.path), [file.filename, 'README.md']);
});

test('credential-like lines are redacted before external inference', () => {
  const input = '+token = "ghp_' + 'x'.repeat(28) + '"\n+const ok = true';
  const out = redactPatch(input);
  assert.equal(out.includes('ghp_'), false);
  assert.match(out, /redacted/);
  assert.match(out, /const ok = true/);
});

test('report does not mark unconfigured AI as no findings', () => {
  const text = report({ repo: 'abc/test', head: 'a'.repeat(40), number: 12, files: 1,
    selected: [file], partial: false, findings: [], status: 'Preskočeno: GROQ_API_KEY nije postavljen.' });
  assert.match(text, /AI nalaz nije dostupan/);
  assert.doesNotMatch(text, /Bez potvrđenih nalaza/);
});

test('report sanitizes model-supplied markdown and never prints control verdicts', () => {
  const text = report({ repo: 'abc/test', head: 'a'.repeat(40), number: 12, files: 1,
    selected: [file], partial: false, findings: [finding({ what: '# [danger](https://evil.test)' })], status: 'Izvršeno' });
  assert.doesNotMatch(text, /\[danger\]\(https/);
  assert.match(text, /Dohvatljivo kroz:/);
  assert.match(text, /#L3/);
});

test('workflow rejects fork PRs before secret access and executes only trusted default branch', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/free-ai-pr-review.yml', import.meta.url), 'utf8');
  assert.match(workflow, /^on: # zizmor: ignore\[dangerous-triggers\]/m);
  assert.match(workflow, /^    if: github\.event\.pull_request\.draft == false && github\.event\.pull_request\.head\.repo\.full_name == github\.repository$/m);
  assert.ok(workflow.includes('ref: $' + '{{ github.event.repository.default_branch }}'));
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /^  contents: read$/m);
  assert.match(workflow, /^  pull-requests: read$/m);
  assert.doesNotMatch(workflow, /\b(?:issues|statuses|contents|pull-requests): write\b/);
});

test('workflow never checks out attacker-controlled PR refs', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/free-ai-pr-review.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(workflow, /ref:\s*\$\{\{\s*(?:github\.event\.pull_request|github\.head_ref|github\.event\.issue)/);
});
