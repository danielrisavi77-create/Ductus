import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test, { after, before } from "node:test";
import { parseMetricsArgs } from "./metrics-core.mjs";
import { playwrightMetrics, renderPlaywrightMetrics } from "./playwright-metrics.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url)), sha = "a".repeat(40);
let cwd, report;
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const specs = (r) => r.suites.flatMap(function visit(s) { return [...s.specs, ...(s.suites ?? []).flatMap(visit)]; });
const instances = (r) => specs(r).flatMap((s) => s.tests);
const cli = (args) => spawnSync(process.execPath, [resolve(root, "scripts/orchestrator/pr-metrics.mjs"), ...args], {
  cwd, encoding: "utf8", env: { ...process.env, PATH: "" }, timeout: 30_000,
});

before(() => {
  mkdirSync(resolve(tmpdir(), "ductus-dan262"), { recursive: true });
  cwd = mkdtempSync(resolve(tmpdir(), "ductus-dan262/native-"));
  writeFileSync(resolve(cwd, "package.json"), '{"type":"module"}');
  const imports = `import { test, expect } from ${JSON.stringify(pathToFileURL(resolve(root, "node_modules/@playwright/test/index.mjs")).href)};`;
  writeFileSync(resolve(cwd, "one.spec.ts"), `${imports}
    test.describe('nested', () => {
      test('same title', () => expect(1).toBe(1));
      test('expected failure', () => { test.fail(); expect(1).toBe(2); });
      // A real failure prevents the following serial fixture from running.
      test.describe.serial('stopped group', () => {
        test('failure', () => expect(1).toBe(2));
        test('not reached after failure', () => expect(1).toBe(1));
      });
      test('timeout', async () => { test.setTimeout(50); await new Promise(() => {}); });
    });
    test.describe('retry', () => {
      test.describe.configure({ retries: 1 });
      test('flaky', ({}, info) => expect(info.retry).toBe(1));
    });`);
  writeFileSync(resolve(cwd, "two.spec.ts"), `${imports} test('same title', () => expect(1).toBe(1));`);
  // Real login reporter configuration, real Playwright serialization; no browser/DB needed.
  writeFileSync(resolve(cwd, "native.config.ts"), `import login from ${JSON.stringify(resolve(root, "playwright.login.config.ts"))};
    export default { ...login, testDir: '.', webServer: undefined,
      projects: [{ name: 'one' }, { name: 'two' }] };`);
  const run = spawnSync(process.execPath, [resolve(root, "node_modules/@playwright/test/cli.js"), "test", "--config", "native.config.ts"], {
    // The demo guard refuses this target before any storage/DB setup is attempted.
    cwd, encoding: "utf8", env: { ...process.env, GITHUB_SHA: sha, DOCKER_HOST: "synthetic://disabled" }, timeout: 60_000,
  });
  assert.equal(run.status, 1, run.stdout + run.stderr); // deliberate failed/timedOut fixtures
  report = read(resolve(cwd, "playwright-report-login/results.json"));
});
after(() => { if (cwd) rmSync(cwd, { recursive: true, force: true }); });

test("native login reporters preserve HTML and count nested tests, projects, retries and outcomes", () => {
  assert.ok(existsSync(resolve(cwd, "playwright-report-login/index.html")));
  const m = playwrightMetrics(report);
  assert.equal(m.testedSha, sha);
  assert.equal(m.workers, 1);
  assert.deepEqual(m.projects, ["one", "two"]);
  assert.equal(m.tests, 14);
  assert.equal(m.attempts, 16);
  assert.deepEqual(m.outcomes, { expected: 6, unexpected: 4, flaky: 2, skipped: 2 });
  assert.deepEqual(m.attemptStatuses, { passed: 6, failed: 6, timedOut: 2, skipped: 2, interrupted: 0 });
  assert.equal(m.workMs, instances(report).flatMap((t) => t.results).reduce((n, r) => n + r.duration, 0));
  assert.equal(m.files.find((f) => f.file === "one.spec.ts").tests, 12);
  assert.equal(m.files.find((f) => f.file === "two.spec.ts").tests, 2);
  assert.equal(m.reportedElapsedMs, report.stats.duration);
});

test("parallel elapsed is not summed work; errors, interrupts, shard and unknown SHA stay visible", () => {
  const r = structuredClone(report);
  r.config.workers = 4;
  r.config.metadata = {};
  r.config.shard = { current: 1, total: 2 };
  r.stats.duration = 2;
  r.errors.push({ message: "synthetic global failure" });
  instances(r).find((t) => t.status === "unexpected").results[0].status = "interrupted";
  const m = playwrightMetrics(r), text = renderPlaywrightMetrics(m).join("\n");
  assert.equal(m.reportedElapsedMs, 2);
  assert.ok(m.workMs > 2);
  assert.equal(m.attemptStatuses.interrupted, 1);
  assert.equal(m.globalErrors, 1);
  assert.equal(m.testedSha, null);
  assert.match(text, /SHA unknown\/local; workers=4; shard=1\/2/);
  assert.match(text, /global errors=1/);
  assert.match(text, /not CI wall time or a speedup estimate/);
  assert.match(text, /Coverage needs a separate inventory/);
});

test("malformed, incomplete, duplicate, discovery-only or inconsistent evidence is rejected", () => {
  for (const mutate of [
    (r) => { delete r.suites; }, (r) => { r.suites = []; }, (r) => { delete r.errors; },
    (r) => { r.stats.duration = -1; }, (r) => { r.stats.duration = NaN; },
    (r) => { r.stats.startTime = "bad"; }, (r) => { r.stats.expected++; },
    (r) => { r.config.workers = 0; }, (r) => { r.config.metadata.testedSha = "abc"; },
    (r) => { r.config.shard = { current: 3, total: 2 }; },
    (r) => { specs(r)[0].file = ""; }, (r) => { specs(r)[0].tests.push(specs(r)[0].tests[0]); },
    (r) => { instances(r)[0].results = []; }, (r) => { instances(r)[0].status = "unknown"; },
    (r) => { instances(r)[0].results[0].status = "unknown"; },
    (r) => { delete instances(r)[0].results[0].duration; },
    (r) => { instances(r)[0].results[0].duration = Infinity; },
  ]) {
    const r = structuredClone(report); mutate(r);
    assert.throws(() => playwrightMetrics(r), /Invalid Playwright report/, mutate.toString());
  }
});

test("CLI reads local report without gh, returns useful text/JSON and fails on bad inputs", () => {
  const path = resolve(cwd, "playwright-report-login/results.json");
  const json = cli(["--playwright-report", path, "--json"]);
  assert.equal(json.status, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout), playwrightMetrics(report));
  const text = cli(["--playwright-report", path]);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /unexpected=4 flaky=2 skipped=2/);
  writeFileSync(resolve(cwd, "bad.json"), "{");
  writeFileSync(resolve(cwd, "empty.json"), "{}");
  for (const name of ["missing.json", "bad.json", "empty.json"]) {
    const bad = cli(["--playwright-report", resolve(cwd, name)]);
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /pr-metrics failed:/);
    assert.equal(bad.stdout, "");
  }
});

test("args preserve PR metrics and reject ambiguous, duplicated, missing or unknown options", () => {
  assert.deepEqual(parseMetricsArgs(["--playwright-report", "a.json"]), { playwrightReport: "a.json", json: false });
  assert.deepEqual(parseMetricsArgs(["--json", "--since", "2026-10-01"]), { since: "2026-10-01", json: true });
  for (const args of [
    ["--playwright-report"], ["--playwright-report", "--json"],
    ["--since", "2026-10-01", "--playwright-report", "a.json"],
    ["--playwright-report", "a.json", "--json", "--json"],
    ["--playwright-report", "a.json", "--typo"],
    ["--since", "2026-10-01", "--since", "2026-10-02"],
  ]) assert.throws(() => parseMetricsArgs(args), /usage/);
});
