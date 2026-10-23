// Independent QA: codex:qa606web1:qa, source 2437564a504a21a541966800fae2dcb2a44c344f.
// Invented data only. No application, workflow, dependency or gate changes.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test, before, after } from "node:test";
import { playwrightMetrics, renderPlaywrightMetrics } from "../../../scripts/orchestrator/playwright-metrics.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const work = mkdtempSync(resolve(tmpdir(), "qa606web1-"));
const source = "2437564a504a21a541966800fae2dcb2a44c344f";
const cliPath = resolve(root, "scripts/orchestrator/pr-metrics.mjs");
const pw = resolve(root, "node_modules/@playwright/test/cli.js");
const pwImport = JSON.stringify(pathToFileURL(resolve(root, "node_modules/@playwright/test/index.mjs")).href);
const allSpecs = (r) => r.suites.flatMap(function walk(s) { return [...s.specs, ...(s.suites ?? []).flatMap(walk)]; });
const instances = (r) => allSpecs(r).flatMap((s) => s.tests);
const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const exec = (file, args, env = {}) => {
  const run = spawnSync(process.execPath, [file, ...args], { cwd: work, encoding: "utf8", timeout: 90_000, env: { ...process.env, ...env } });
  assert.equal(run.error, undefined, `child execution unavailable: ${run.error}`);
  assert.equal(run.signal, null, run.stderr);
  return run;
};
const cli = (path, json = true) => exec(cliPath, ["--playwright-report", path, ...(json ? ["--json"] : [])], { PATH: "" });
const save = (name, r) => { const p = resolve(work, name); writeFileSync(p, JSON.stringify(r)); return p; };
let native, nativePath;
before(() => {
  writeFileSync(resolve(work, "package.json"), '{"type":"module"}');
  writeFileSync(resolve(work, "a.spec.ts"), `import { test, expect } from ${pwImport};
    test.describe('outer', () => { test.describe('inner', () => {
      test('twin', async () => { await new Promise(r => setTimeout(r, 12)); });
      test('known failure', () => { test.fail(); expect(2).toBe(3); });
      test('unexpected pass', () => { test.fail(); });
      test.skip('declared skip', () => {});
      test('runtime skip', () => { test.skip(); });
      test('timeout', async () => { test.setTimeout(60); await new Promise(() => {}); });
      test.describe('two retries', () => {
        test.describe.configure({ retries: 2 });
        test('third attempt succeeds', ({}, info) => { expect(info.retry).toBe(2); });
      });
    }); });`);
  writeFileSync(resolve(work, "b.spec.ts"), `import { test } from ${pwImport}; test('twin', () => {});`);
  writeFileSync(resolve(work, "native.config.ts"), `import login from ${JSON.stringify(resolve(root, "playwright.login.config.ts"))};
    export default { ...login, testDir: '.', webServer: undefined, projects: [{name: 'alpha'}, {name: 'beta'}] };`);
  const run = exec(pw, ["test", "-c", "native.config.ts"], { GITHUB_SHA: source, DOCKER_HOST: "synthetic://qa606-no-storage" });
  assert.equal(run.status, 1, run.stdout + run.stderr);
  nativePath = resolve(work, "playwright-report-login/results.json");
  native = read(nativePath);
  console.log("QA606 native", JSON.stringify({ stats: native.stats, tests: instances(native).length, html: existsSync(resolve(work, "playwright-report-login/index.html")) }));
});
after(() => rmSync(work, { recursive: true, force: true }));

test("QA606 native nested two-project outcomes preserve two retries, expected failure and unexpected pass", () => {
  const unchanged = JSON.stringify(native);
  const m = playwrightMetrics(native);
  assert.equal(JSON.stringify(native), unchanged);
  assert.equal(m.tests, 16);
  assert.equal(m.attempts, 20);
  assert.deepEqual(m.outcomes, { expected: 6, unexpected: 4, flaky: 2, skipped: 4 });
  assert.deepEqual(m.attemptStatuses, { passed: 8, failed: 6, timedOut: 2, skipped: 4, interrupted: 0 });
  assert.equal(m.workMs, instances(native).flatMap(t => t.results).reduce((sum, r) => sum + r.duration, 0));
  assert.equal(m.files.find(f => f.file === "a.spec.ts").tests, 14);
  assert.equal(m.files.find(f => f.file === "b.spec.ts").tests, 2);
  assert.ok(existsSync(resolve(work, "playwright-report-login/index.html")));
  assert.equal(m.testedSha, source);
  console.log("QA606 accounting", JSON.stringify(m));
});

test("QA606 real local CLI without gh: JSON and text, spaces/Unicode path, exit 0 despite failed tests", () => {
  const path = save("izvještaj s razmakom.json", native);
  const json = cli(path), text = cli(path, false);
  assert.equal(json.status, 0, json.stderr);
  assert.equal(text.status, 0, text.stderr);
  assert.deepEqual(JSON.parse(json.stdout), playwrightMetrics(native));
  assert.match(text.stdout, /unexpected=4 flaky=2 skipped=4/);
  assert.match(text.stdout, /passed=8 failed=6 timedOut=2 skipped=4 interrupted=0/);
  assert.match(text.stdout, /not CI wall time or a speedup estimate/);
});

test("QA606 incomplete/malformed inputs and ambiguous CLI return 2 without success output", () => {
  const first = (r) => instances(r)[0];
  const mutations = [
    r => { delete r.stats; }, r => { r.stats.expected += 1; },
    r => { first(r).results = []; }, r => { delete first(r).projectId; },
    r => { first(r).results[0].retry = -1; }, r => { first(r).results[0].duration = "10"; },
    r => { first(r).results[0].status = "success"; },
    r => { r.config.shard = {current: 0, total: 2}; },
    r => { r.suites.push(r.suites[0]); },
  ];
  for (const [i, mutate] of mutations.entries()) {
    const r = structuredClone(native); mutate(r);
    const run = cli(save(`invalid-${i}.json`, r));
    assert.equal(run.status, 2, `mutation ${i}: ${run.stdout}`);
    assert.equal(run.stdout, "");
  }
  writeFileSync(resolve(work, "broken.json"), '{"suites":');
  for (const name of ["broken.json", "absent.json"]) assert.equal(cli(resolve(work, name)).status, 2);
  for (const args of [[], ["--json"], ["--since", "2026-10-01", "--playwright-report", nativePath], ["--playwright-report", nativePath, "--json", "--json"]]) {
    const run = exec(cliPath, args, {PATH: ""});
    assert.equal(run.status, 2); assert.equal(run.stdout, "");
  }
});

test("QA606 interrupt, global error, local SHA, shard and elapsed remain separate", () => {
  const r = structuredClone(native);
  r.config.metadata = {}; r.config.workers = 4; r.config.shard = {current: 2, total: 3};
  r.stats.duration = 1; r.errors = [{message: "invented setup interruption"}];
  instances(r).find(t => t.status === "unexpected").results[0].status = "interrupted";
  const m = playwrightMetrics(r), text = renderPlaywrightMetrics(m).join("\n");
  assert.equal(m.globalErrors, 1); assert.equal(m.attemptStatuses.interrupted, 1);
  assert.equal(m.testedSha, null); assert.equal(m.reportedElapsedMs, 1); assert.ok(m.workMs > 1);
  assert.match(text, /unknown\/local; workers=4; shard=2\/3/);
});

test("QA606 old --since mode executes unchanged through an invented gh transport", () => {
  const bin = resolve(work, "bin"); mkdirSync(bin);
  const calls = resolve(work, "gh-calls.txt");
  writeFileSync(resolve(bin, "gh"), `#!${process.execPath}\nimport fs from 'node:fs'; fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(process.argv.slice(2))+'\\n'); console.log('[]');`, {mode: 0o755});
  const run = exec(cliPath, ["--since", "2026-10-01", "--json"], {PATH: bin});
  assert.equal(run.status, 0, run.stderr);
  const out = JSON.parse(run.stdout); assert.equal(out.since, "2026-10-01"); assert.deepEqual(out.rows, []);
  assert.match(readFileSync(calls, "utf8"), /pulls\?state=closed&base=main/);
});

test("QA606 valid native --repeat-each=2 report counts repeated measurements", () => {
  const run = exec(pw, ["test", "-c", "native.config.ts", "b.spec.ts", "--repeat-each=2"], {GITHUB_SHA: source, DOCKER_HOST: "synthetic://qa606-no-storage"});
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const r = read(nativePath), reported = cli(nativePath);
  console.log("QA606 repeated native report", JSON.stringify({stats: r.stats, specs: allSpecs(r).map(s => ({id:s.id, file:s.file, tests:s.tests.map(t => ({projectId:t.projectId, status:t.status, results:t.results}))})), cliExit:reported.status, cliError:reported.stderr}));
  assert.equal(reported.status, 0, reported.stderr);
  assert.equal(JSON.parse(reported.stdout).tests, 4);
});

test("QA606 duplicated retry attempt must not silently inflate measured work", () => {
  const r = structuredClone(native);
  const t = instances(r).find(t => t.status === "flaky");
  t.results.splice(1, 0, structuredClone(t.results[0]));
  const run = cli(save("duplicate-attempt.json", r));
  console.log("QA606 duplicate retry", JSON.stringify({cliExit:run.status, stdout:run.stdout, stderr:run.stderr}));
  assert.equal(run.status, 2, "duplicate retry was accepted as additional test work");
});
