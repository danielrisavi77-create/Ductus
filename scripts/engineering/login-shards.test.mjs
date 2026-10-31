import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOGIN_SHARDS, planLoginShards } from "./login-shard-plan.mjs";
import { runLoginShards, testsOf, verifyLoginShards } from "./login-shards.mjs";

// Synthetic Playwright JSON: a.spec.ts has two tests (one in a describe), the
// other files one each. Weights put a and b alone and pair the light files.
const NAMES = ["a", "b", "c", "d", "e", "f", "g"];
const WEIGHTS = { "a.spec.ts": 50, "b.spec.ts": 40, "c.spec.ts": 30, "d.spec.ts": 20, "e.spec.ts": 10, "f.spec.ts": 10, "g.spec.ts": 5 };
const spec = (file, title, status) => ({
  title, file,
  tests: [{ projectName: "login-chromium", ...(status ? { status, results: [{ status: status === "expected" ? "passed" : status }] } : { results: [] }) }],
});
const file = (name, specs, suites = []) => ({ title: name, file: name, specs, suites });
function suite(withStatus) {
  const s = withStatus ?? (() => undefined);
  const all = {};
  for (const n of NAMES) all[n] = file(`${n}.spec.ts`, [spec(`${n}.spec.ts`, "runs", s(`${n}1`))]);
  all.a.suites = [{ title: "sign out", file: "a.spec.ts", specs: [spec("a.spec.ts", "clears", s("a2"))], suites: [] }];
  return all;
}
const inventory = () => ({ config: { shard: null }, errors: [], suites: Object.values(suite()) });
const plan = () => planLoginShards(NAMES.map((n) => `${n}.spec.ts`), WEIGHTS);
const run = (files, statuses = {}) => {
  const all = suite((key) => statuses[key] ?? "expected");
  return { config: { shard: null }, errors: [], stats: { duration: 1000 }, suites: files.map((f) => all[f.replace(".spec.ts", "")]) };
};
const good = () => plan().map((files, i) => ({
  inventory: inventory(), report: run(files), shardPlan: { shard: i + 1, total: LOGIN_SHARDS, files },
}));

test("the ids carry file, describe titles, test title and project", () => {
  assert.deepEqual(testsOf(inventory()).slice(0, 2).map(({ id }) => id), [
    "a.spec.ts › a.spec.ts › runs › login-chromium",
    "a.spec.ts › a.spec.ts › sign out › clears › login-chromium",
  ]);
});

test("shards that together ran the listed suite, each its own plan, pass", () => {
  assert.deepEqual(plan(), [["a.spec.ts"], ["b.spec.ts"], ["c.spec.ts"], ["d.spec.ts", "g.spec.ts"], ["e.spec.ts", "f.spec.ts"]]);
  assert.deepEqual(verifyLoginShards(good(), WEIGHTS), { count: 8, skipped: 0, perShard: [2, 1, 1, 2, 2] });
});

test("a test listed but run in no shard fails", () => {
  const shards = good();
  shards[1].report.suites = [];
  assert.throws(() => verifyLoginShards(shards, WEIGHTS), /Listed but never run: b\.spec\.ts/);
});

test("a file run outside its planned shard fails, even if no other shard ran it", () => {
  const shards = good();
  shards[1].report = run(["b.spec.ts", "c.spec.ts"]);
  assert.throws(() => verifyLoginShards(shards, WEIGHTS), /Shard 2 ran a file outside its plan: c\.spec\.ts/);
  const moved = good();
  moved[2].report = run([]);
  moved[3].report = run(["c.spec.ts", "d.spec.ts"]);
  assert.throws(() => verifyLoginShards(moved, WEIGHTS), /Shard 4 ran a file outside its plan: c\.spec\.ts/);
});

test("a test run twice fails", () => {
  const shards = good();
  shards[0].report.suites.push(shards[0].report.suites[0]);
  assert.throws(() => verifyLoginShards(shards, WEIGHTS), /Ran in two shards/);
});

test("a shard plan that differs from the recomputed plan fails", () => {
  const shards = good();
  shards[4].shardPlan = { ...shards[4].shardPlan, files: ["e.spec.ts"] };
  assert.throws(() => verifyLoginShards(shards, WEIGHTS), /Shard 5: wrong plan/);
  const swapped = good();
  swapped[0].shardPlan = { ...swapped[0].shardPlan, shard: 2 };
  assert.throws(() => verifyLoginShards(swapped, WEIGHTS), /Shard 1: wrong plan/);
  // Different weights in the results job recompute a different plan.
  assert.throws(() => verifyLoginShards(good(), { ...WEIGHTS, "g.spec.ts": 500 }), /wrong plan/);
});

test("a run that used --shard instead of the plan fails", () => {
  const shards = good();
  shards[0].report.config.shard = { current: 1, total: LOGIN_SHARDS };
  assert.throws(() => verifyLoginShards(shards, WEIGHTS), /must follow the plan/);
});

test("a failed or flaky test fails the reconciliation", () => {
  for (const status of ["unexpected", "flaky"]) {
    const shards = good();
    shards[0].report = run(["a.spec.ts"], { a2: status });
    assert.throws(() => verifyLoginShards(shards, WEIGHTS), new RegExp(`Not passed \\(${status}\\)`));
  }
});

test("a passed test without a result fails", () => {
  const shards = good();
  shards[1].report.suites[0].specs[0].tests[0].results = [];
  assert.throws(() => verifyLoginShards(shards, WEIGHTS), /No result/);
});

test("a skipped test is counted, not hidden", () => {
  const shards = good();
  shards[1].report = run(["b.spec.ts"], { b1: "skipped" });
  assert.equal(verifyLoginShards(shards, WEIGHTS).skipped, 1);
});

test("a missing shard or a sharded inventory fails closed", () => {
  assert.throws(() => verifyLoginShards(good().slice(0, LOGIN_SHARDS - 1), WEIGHTS), /Every login shard/);
  const partial = good();
  partial[0].inventory.config.shard = { current: 1, total: LOGIN_SHARDS };
  assert.throws(() => verifyLoginShards(partial, WEIGHTS), /must list the full suite/);
});

test("shards that listed different suites or an empty suite fail", () => {
  const differ = good();
  differ[1].inventory.suites.pop();
  assert.throws(() => verifyLoginShards(differ, WEIGHTS), /listed different suites/);
  const empty = good().map((s) => ({ ...s, inventory: { config: {}, errors: [], suites: [] }, report: run([]) }));
  assert.throws(() => verifyLoginShards(empty, WEIGHTS), /inventory is empty/);
});

test("a run with a global error (e.g. a file that failed to load) fails", () => {
  const shards = good();
  shards[0].report.errors = [{ message: "SyntaxError in a.spec.ts" }];
  assert.throws(() => verifyLoginShards(shards, WEIGHTS), /run has errors/);
});

test("the CLI reads every shard artifact with the repository weights and a missing file fails", () => {
  const cwd = mkdtempSync(join(tmpdir(), "login-shards-"));
  const write = (shards) => {
    for (const [i, { inventory: inv, report, shardPlan }] of shards.entries()) {
      const dir = join(cwd, `.ci-reports/login/login-shard-${i + 1}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "inventory.json"), JSON.stringify(inv));
      writeFileSync(join(dir, "results.json"), JSON.stringify(report));
      writeFileSync(join(dir, "plan.json"), JSON.stringify(shardPlan));
    }
  };
  // The repository weights do not know these files, so all weigh the mean:
  // the plan is then name order, round robin over the shards.
  const flat = planLoginShards(NAMES.map((n) => `${n}.spec.ts`), { "x.spec.ts": 1 });
  write(flat.map((files, i) => ({ inventory: inventory(), report: run(files), shardPlan: { shard: i + 1, total: LOGIN_SHARDS, files } })));
  assert.equal(runLoginShards({}, cwd).count, 8);
  writeFileSync(join(cwd, ".ci-reports/login/login-shard-2/plan.json"), "{");
  assert.throws(() => runLoginShards({}, cwd));
});
