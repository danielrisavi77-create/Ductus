import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import test, { after, before } from "node:test";
import { mergeShardReports, verifyShardReports } from "./e2e-shards.mjs";
import { compareReport, UI_SPECS } from "./ui-test-pilot.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const sha = "a".repeat(40), projects = ["desktop", "mobile"];
let cwd, shards;
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const specs = (r) => r.suites.flatMap(function visit(s) {
  return [...s.specs, ...(s.suites ?? []).flatMap(visit)];
});

// Exercise the installed Playwright serializer/sharder, not a hand-written
// approximation of its JSON. These synthetic tests need no browser or stack.
before(() => {
  mkdirSync(resolve(tmpdir(), "ductus-dan240"), { recursive: true });
  cwd = mkdtempSync(resolve(tmpdir(), "ductus-dan240/native-"));
  writeFileSync(resolve(cwd, "package.json"), '{"type":"module"}');
  mkdirSync(resolve(cwd, "e2e"));
  for (const path of [...UI_SPECS, "e2e/other.spec.ts"]) {
    writeFileSync(resolve(cwd, path), `import { test, expect } from ${JSON.stringify(pathToFileURL(resolve(root, "node_modules/@playwright/test/index.mjs")).href)};
      test('synthetic one', () => expect(1).toBe(1));
      test('synthetic two', () => expect(2).toBe(2));`);
  }
  writeFileSync(resolve(cwd, "playwright.config.mjs"), `export default {
    testDir: './e2e', workers: 1, retries: 0, metadata: { testedSha: process.env.GITHUB_SHA },
    projects: [{ name: 'desktop' }, { name: 'mobile' }],
  };`);
  function run(name, args) {
    const output = resolve(cwd, `${name}.json`);
    execFileSync(process.execPath, [resolve(root, "node_modules/@playwright/test/cli.js"),
      "test", "--config", resolve(cwd, "playwright.config.mjs"), "--reporter=json", ...args], {
      cwd, env: { ...process.env, GITHUB_SHA: sha, PLAYWRIGHT_JSON_OUTPUT_FILE: output },
      stdio: "pipe",
    });
    return read(output);
  }
  const inventory = run("inventory", ["--list"]);
  shards = [1, 2].map((index) => ({ inventory: structuredClone(inventory),
    report: run(`shard-${index}`, [`--shard=${index}/2`]) }));
});
after(() => { if (cwd) rmSync(cwd, { recursive: true, force: true }); });

test("native shards reconcile the full inventory and preserve the advisory pilot", () => {
  const merged = mergeShardReports(shards, sha);
  const result = verifyShardReports(shards, merged, { cwd, projects });
  assert.equal(result.full.count, 24);
  assert.equal(result.full.failures, 0);
  assert.equal(merged.config.shard, null);
  const pilot = compareReport({ selection: "candidate", specs: UI_SPECS }, merged,
    { cwd, projects, inventory: shards[0].inventory });
  assert.equal(pilot.comparison, "no-miss-observed");
  assert.equal(pilot.selected.count, 20);
});

test("required coverage follows discovery, not the advisory pilot's spec mapping", () => {
  const input = structuredClone(shards);
  for (const { report, inventory } of input) for (const r of [report, inventory]) {
    for (const spec of specs(r)) spec.file = "renamed.spec.ts";
  }
  assert.equal(verifyShardReports(input, mergeShardReports(input, sha), { cwd, projects }).full.count, 24);
});

test("missing, duplicate or wrong-SHA shard evidence cannot merge", () => {
  for (const mutate of [
    (s) => s.pop(),
    (s) => { s[1] = structuredClone(s[0]); },
    (s) => { s[1].report.config.metadata.testedSha = "b".repeat(40); },
    (s) => { s[1].inventory.config.metadata.testedSha = "b".repeat(40); },
    (s) => { s[1].report.config.shard.total = 3; },
    (s) => { s[1].inventory.config.shard = { current: 2, total: 2 }; },
    (s) => { s[1].inventory.config.rootDir = "/wrong/e2e"; },
  ]) {
    const input = structuredClone(shards); mutate(input);
    assert.throws(() => mergeShardReports(input, sha), undefined, mutate.toString());
  }
  assert.throws(() => mergeShardReports(shards, ""));
});

test("omissions, duplicates, altered identities and invalid outcomes fail closed", () => {
  for (const mutate of [
    (s) => { specs(s[0].report)[0].tests = []; s[0].report.stats.expected--; },
    (s) => { const rows = specs(s[0].report); Object.assign(rows[1], rows[0]); },
    (s) => { specs(s[0].report)[0].file = "other.spec.ts"; },
    (s) => { specs(s[0].report)[0].tests[0].projectName = "webkit"; },
    (s) => { specs(s[1].inventory)[0].tests = []; },
    (s) => { s[0].report.errors.push({ message: "synthetic teardown failure" }); },
    (s) => { s[1].inventory.errors.push({ message: "synthetic discovery failure" }); },
    (s) => { specs(s[0].report)[0].tests[0].results = []; },
    (s) => { const t = specs(s[0].report)[0].tests[0]; t.results.push(t.results[0]); },
    ...["failed", "timedOut", "interrupted", "skipped"].map((status) => (s) => {
      const t = specs(s[0].report)[0].tests[0];
      t.status = status === "skipped" ? "skipped" : "unexpected";
      t.results[0].status = status;
      s[0].report.stats.expected--; s[0].report.stats[t.status]++;
    }),
  ]) {
    const input = structuredClone(shards); mutate(input);
    assert.throws(() => verifyShardReports(input, mergeShardReports(input, sha), { cwd, projects }),
      undefined, mutate.toString());
  }
});

test("CLI preserves failures for the pilot and rejects missing or corrupt artifact files", () => {
  function put(input) {
    input.forEach(({ report, inventory }, i) => {
      const dir = resolve(cwd, `.ci-reports/shards/e2e-shard-${i + 1}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(resolve(dir, "results.json"), JSON.stringify(report));
      writeFileSync(resolve(dir, "ui-pilot-inventory.json"), JSON.stringify(inventory));
    });
  }
  const cli = () => spawnSync(process.execPath, [resolve(root, "scripts/engineering/e2e-shards.mjs")],
    { cwd, encoding: "utf8", env: { ...process.env, GITHUB_SHA: sha, EVENT_NAME: "pull_request" } });
  put(shards);
  assert.equal(cli().status, 0);
  const input = structuredClone(shards);
  const failing = specs(input[1].report).find((s) => s.file === "other.spec.ts").tests[0];
  failing.status = "unexpected"; failing.results[0].status = "failed";
  input[1].report.stats.expected--; input[1].report.stats.unexpected++;
  put(input);
  assert.equal(cli().status, 1);
  assert.equal(compareReport({ selection: "candidate", specs: UI_SPECS },
    read(resolve(cwd, "test-results/ui-pilot-full.json")),
    { cwd, projects, inventory: input[0].inventory }).comparison, "miss-observed");
  const file = resolve(cwd, ".ci-reports/shards/e2e-shard-2/results.json");
  writeFileSync(file, "{broken"); assert.equal(cli().status, 1);
  rmSync(file); assert.equal(cli().status, 1);
});

test("workflow requires both shards and reconciliation without changing Mergify or login", () => {
  const ci = readFileSync(resolve(root, ".github/workflows/ci.yml"), "utf8");
  const job = (name) => ci.split(`\n  ${name}:\n`)[1].split(/^ {2}[\w-]+:\n/m)[0];
  assert.match(job("stack-e2e"), /strategy:\n {6}fail-fast: false\n {6}matrix:\n {8}shard: \[1, 2\]/);
  assert.match(job("stack-e2e"), /E2E_SHARD: \$\{\{ matrix.shard \}\}/);
  assert.doesNotMatch(job("stack-e2e"), /continue-on-error|UI test selection pilot|--grep|--only-changed/);
  assert.match(job("stack-e2e"), /name: e2e-shard-\$\{\{ matrix.shard \}\}/);
  assert.match(job("stack-e2e"), /include-hidden-files: true\n {10}if-no-files-found: error/);
  const results = job("stack-e2e-results");
  assert.match(results, /needs: \[scope, stack-e2e\]/);
  assert.match(results, /if: \$\{\{ always\(\) && !cancelled\(\) && needs.scope.result == 'success' && needs.scope.outputs.profile == 'full' \}\}/);
  assert.match(results, /pattern: e2e-shard-\*\n {10}path: .ci-reports\/shards/);
  assert.match(results, /run: node scripts\/engineering\/e2e-shards.mjs/);
  assert.doesNotMatch(results, /continue-on-error|merge-multiple: true|run-id:|ref:/);
  assert.match(readFileSync(resolve(root, "playwright.login.config.ts"), "utf8"), /workers: 1/);
  assert.doesNotMatch(ci, /merge_group/);
});
