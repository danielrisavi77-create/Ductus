import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLoginShards, testsOf, verifyLoginShards } from "./login-shards.mjs";

// Synthetic Playwright JSON: file a.spec.ts has two tests (one in a describe), b.spec.ts and c.spec.ts one each.
const spec = (file, title, status) => ({
  title, file,
  tests: [{ projectName: "login-chromium", ...(status ? { status, results: [{ status: status === "expected" ? "passed" : status }] } : { results: [] }) }],
});
const file = (name, specs, suites = []) => ({ title: name, file: name, specs, suites });
function suite(withStatus) {
  const s = withStatus ?? (() => undefined);
  return {
    a: file("a.spec.ts", [spec("a.spec.ts", "signs in", s("a1"))], [{ title: "sign out", file: "a.spec.ts", specs: [spec("a.spec.ts", "clears", s("a2"))], suites: [] }]),
    b: file("b.spec.ts", [spec("b.spec.ts", "submits", s("b1"))]),
    c: file("c.spec.ts", [spec("c.spec.ts", "exports", s("c1"))]),
  };
}
const inventory = () => { const { a, b, c } = suite(); return { config: { shard: null }, errors: [], suites: [a, b, c] }; };
const run = (current, files, statuses = {}) => {
  const all = suite((key) => statuses[key] ?? "expected");
  return { config: { shard: { current, total: 3 } }, errors: [], stats: { duration: 1000 }, suites: files.map((f) => all[f]) };
};
const good = () => [1, 2, 3].map((n) => ({ inventory: inventory(), report: run(n, [["a"], ["b"], ["c"]][n - 1]) }));

test("the ids carry file, describe titles, test title and project", () => {
  assert.deepEqual(testsOf(inventory()).map(({ id }) => id), [
    "a.spec.ts › a.spec.ts › signs in › login-chromium",
    "a.spec.ts › a.spec.ts › sign out › clears › login-chromium",
    "b.spec.ts › b.spec.ts › submits › login-chromium",
    "c.spec.ts › c.spec.ts › exports › login-chromium",
  ]);
});

test("three shards that together ran the listed suite pass", () => {
  assert.deepEqual(verifyLoginShards(good()), { count: 4, skipped: 0, perShard: [2, 1, 1] });
});

test("a test listed but run in neither shard fails", () => {
  const shards = good();
  shards[1].report.suites = [];
  assert.throws(() => verifyLoginShards(shards), /Listed but never run: b\.spec\.ts/);
});

test("a test run in both shards fails", () => {
  const shards = good();
  shards[1].report = run(2, ["a", "b"]);
  assert.throws(() => verifyLoginShards(shards), /Ran in two shards/);
});

test("a failed or flaky test fails the reconciliation", () => {
  for (const status of ["unexpected", "flaky"]) {
    const shards = good();
    shards[0].report = run(1, ["a"], { a2: status });
    assert.throws(() => verifyLoginShards(shards), new RegExp(`Not passed \\(${status}\\)`));
  }
});

test("a passed test without a result fails", () => {
  const shards = good();
  shards[1].report.suites[0].specs[0].tests[0].results = [];
  assert.throws(() => verifyLoginShards(shards), /No result/);
});

test("a skipped test is counted, not hidden", () => {
  const shards = good();
  shards[1].report = run(2, ["b"], { b1: "skipped" });
  assert.equal(verifyLoginShards(shards).skipped, 1);
});

test("a missing shard, a wrong shard number or a sharded inventory fails closed", () => {
  assert.throws(() => verifyLoginShards(good().slice(0, 1)), /Every login shard/);
  const wrong = good();
  wrong[1].report.config.shard = { current: 2, total: 2 };
  assert.throws(() => verifyLoginShards(wrong), /wrong shard/);
  const partial = good();
  partial[0].inventory.config.shard = { current: 1, total: 3 };
  assert.throws(() => verifyLoginShards(partial), /must list the full suite/);
});

test("shards that listed different suites or an empty suite fail", () => {
  const differ = good();
  differ[1].inventory.suites.pop();
  assert.throws(() => verifyLoginShards(differ), /listed different suites/);
  const empty = [1, 2, 3].map((n) => ({ inventory: { config: {}, errors: [], suites: [] }, report: run(n, []) }));
  assert.throws(() => verifyLoginShards(empty), /inventory is empty/);
});

test("a run with a global error (e.g. a file that failed to load) fails", () => {
  const shards = good();
  shards[0].report.errors = [{ message: "SyntaxError in a.spec.ts" }];
  assert.throws(() => verifyLoginShards(shards), /run has errors/);
});

test("the CLI reads every shard artifact and a missing file fails", () => {
  const cwd = mkdtempSync(join(tmpdir(), "login-shards-"));
  for (const [i, { inventory: inv, report }] of good().entries()) {
    const dir = join(cwd, `.ci-reports/login/login-shard-${i + 1}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "inventory.json"), JSON.stringify(inv));
    writeFileSync(join(dir, "results.json"), JSON.stringify(report));
  }
  assert.equal(runLoginShards({}, cwd).count, 4);
  writeFileSync(join(cwd, ".ci-reports/login/login-shard-2/results.json"), "{");
  assert.throws(() => runLoginShards({}, cwd));
});
