import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOGIN_SHARDS, WEIGHTS_PATH, checkWeights, planLoginShards, runLoginShardPlan, specFilesOf } from "./login-shard-plan.mjs";

const repoWeights = JSON.parse(readFileSync(WEIGHTS_PATH, "utf8"));
const files = (n) => Array.from({ length: n }, (_, i) => `f${String(i).padStart(2, "0")}.spec.ts`);
const flatten = (plan) => plan.flat().sort();

test("every file is planned exactly once and no shard is empty", () => {
  for (const n of [LOGIN_SHARDS, 7, 36, 60]) {
    const plan = planLoginShards(files(n), { "f00.spec.ts": 100, "f01.spec.ts": 3 });
    assert.equal(plan.length, LOGIN_SHARDS);
    assert.deepEqual(flatten(plan), files(n));
    for (const shard of plan) assert.ok(shard.length > 0);
  }
});

test("a new spec file without a weight is still planned", () => {
  const known = Object.keys(repoWeights);
  const plan = planLoginShards([...known, "zz-new.spec.ts"].sort(), repoWeights);
  assert.deepEqual(flatten(plan), [...known, "zz-new.spec.ts"].sort());
  assert.equal(plan.filter((s) => s.includes("zz-new.spec.ts")).length, 1);
});

test("a weight for a file that no longer exists changes nothing but balance", () => {
  const plan = planLoginShards(files(6), { "gone.spec.ts": 999, "f00.spec.ts": 5 });
  assert.deepEqual(flatten(plan), files(6));
});

test("the plan is deterministic: same input in any order gives the same plan", () => {
  const known = Object.keys(repoWeights);
  const a = planLoginShards(known, repoWeights);
  const b = planLoginShards([...known].reverse(), Object.fromEntries(Object.entries(repoWeights).reverse()));
  assert.deepEqual(a, b);
  // equal weights break ties by name and by shard index
  assert.deepEqual(planLoginShards(files(8), { "x.spec.ts": 1 }), [["f00.spec.ts", "f06.spec.ts"], ["f01.spec.ts", "f07.spec.ts"], ["f02.spec.ts"], ["f03.spec.ts"], ["f04.spec.ts"], ["f05.spec.ts"]]);
});

test("the measured weights balance the real suite within 5% of an even split", () => {
  const plan = planLoginShards(Object.keys(repoWeights), repoWeights);
  const loads = plan.map((s) => s.reduce((sum, f) => sum + repoWeights[f], 0));
  const total = loads.reduce((a, b) => a + b, 0);
  assert.ok(Math.max(...loads) <= (total / LOGIN_SHARDS) * 1.05, `loads ${loads}`);
});

test("the weights file names only flat login spec files with positive weights", () => {
  checkWeights(repoWeights);
  const specs = new Set(readdirSync(new URL("../../e2e/login/", import.meta.url)).filter((f) => f.endsWith(".spec.ts")));
  // Not every spec must be listed (a new file falls back to the mean), but a
  // listed one must exist, so the file is refreshed when a spec is renamed.
  for (const f of Object.keys(repoWeights)) assert.ok(specs.has(f), `weight for a missing spec: ${f}`);
});

test("bad weights, odd file names, duplicates and too few files stop the plan", () => {
  for (const weights of [null, [], {}, { "a.spec.ts": 0 }, { "a.spec.ts": -1 }, { "a.spec.ts": "5" }, { "a.spec.ts": Infinity }, { "../a.spec.ts": 1 }]) {
    assert.throws(() => planLoginShards(files(6), weights));
  }
  for (const name of ["sub/a.spec.ts", "a b.spec.ts", "a›b.spec.ts", "a>b.spec.ts", "a$(id).spec.ts", "a\nb.spec.ts", ".a.spec.ts", "a.test.ts", "A.spec.ts"]) {
    assert.throws(() => planLoginShards([...files(6), name], { "f00.spec.ts": 1 }), /Unexpected login spec file/, name);
  }
  assert.throws(() => planLoginShards([...files(6), "f00.spec.ts"], { "f00.spec.ts": 1 }), /listed twice/);
  assert.throws(() => planLoginShards(files(LOGIN_SHARDS - 1), { "f00.spec.ts": 1 }), /Fewer spec files/);
});

test("spec files come from every nested suite of a listing", () => {
  const listing = { suites: [{ file: "b.spec.ts", specs: [{ file: "b.spec.ts" }], suites: [{ specs: [{ file: "a.spec.ts" }], suites: [] }] }] };
  assert.deepEqual(specFilesOf(listing), ["a.spec.ts", "b.spec.ts"]);
  assert.throws(() => specFilesOf({}), /Missing suites/);
});

test("the CLI writes the plan and the test list of one shard and refuses a bad shard", () => {
  const cwd = mkdtempSync(join(tmpdir(), "login-shard-plan-"));
  mkdirSync(join(cwd, ".ci-reports"));
  const listing = { config: { shard: null }, suites: Object.keys(repoWeights).map((f) => ({ file: f, specs: [{ file: f }], suites: [] })) };
  writeFileSync(join(cwd, ".ci-reports/inventory.json"), JSON.stringify(listing));
  const expected = planLoginShards(Object.keys(repoWeights), repoWeights);
  for (let shard = 1; shard <= LOGIN_SHARDS; shard++) {
    assert.deepEqual(runLoginShardPlan([String(shard)], cwd), expected[shard - 1]);
    assert.deepEqual(JSON.parse(readFileSync(join(cwd, ".ci-reports/plan.json"), "utf8")), { shard, total: LOGIN_SHARDS, files: expected[shard - 1] });
    assert.equal(readFileSync(join(cwd, ".ci-reports/test-list.txt"), "utf8"), `${expected[shard - 1].join("\n")}\n`);
  }
  for (const bad of ["0", String(LOGIN_SHARDS + 1), "1.5", "", "1; id"]) assert.throws(() => runLoginShardPlan([bad], cwd), /Shard must be/);
  writeFileSync(join(cwd, ".ci-reports/inventory.json"), JSON.stringify({ ...listing, config: { shard: { current: 1, total: 3 } } }));
  assert.throws(() => runLoginShardPlan(["1"], cwd), /full suite/);
});
