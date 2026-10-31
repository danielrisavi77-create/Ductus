import assert from "node:assert/strict";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const LOGIN_SHARDS = 3;

// Every test of a Playwright JSON report as "file › suite titles › test › project".
export function testsOf(report) {
  const out = [];
  const walk = (suite, titles) => {
    const path = suite.title ? [...titles, suite.title] : titles;
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        out.push({ id: [spec.file, ...path, spec.title, test.projectName].join(" › "), test });
      }
    }
    for (const child of suite.suites ?? []) walk(child, path);
  };
  assert.ok(Array.isArray(report?.suites), "Missing suites");
  for (const suite of report.suites) walk(suite, []);
  return out;
}

// Every shard ran its part, the parts are disjoint, and together they are
// exactly the suite each runner listed in full before sharding.
export function verifyLoginShards(shards) {
  assert.equal(shards.length, LOGIN_SHARDS, "Every login shard is required");
  const listed = shards.map(({ inventory }, index) => {
    assert.equal(inventory.config?.shard ?? null, null, `Shard ${index + 1}: the inventory must list the full suite`);
    assert.deepEqual(inventory.errors ?? [], [], `Shard ${index + 1}: the inventory has errors`);
    return testsOf(inventory).map(({ id }) => id).sort();
  });
  assert.ok(listed[0].length > 0, "The login inventory is empty");
  assert.equal(new Set(listed[0]).size, listed[0].length, "The login inventory repeats a test");
  for (const other of listed.slice(1)) assert.deepEqual(other, listed[0], "The shards listed different suites");

  const ran = new Map();
  let skipped = 0;
  for (const [index, { report }] of shards.entries()) {
    assert.deepEqual(report.config?.shard, { current: index + 1, total: LOGIN_SHARDS }, `Shard ${index + 1}: wrong shard`);
    assert.deepEqual(report.errors ?? [], [], `Shard ${index + 1}: the run has errors`);
    for (const { id, test } of testsOf(report)) {
      assert.ok(!ran.has(id), `Ran in two shards: ${id}`);
      ran.set(id, index + 1);
      if (test.status === "skipped") { skipped += 1; continue; }
      assert.equal(test.status, "expected", `Not passed (${test.status}): ${id}`);
      assert.ok((test.results ?? []).length > 0, `No result: ${id}`);
    }
  }
  const missing = listed[0].filter((id) => !ran.has(id));
  assert.deepEqual(missing, [], `Listed but never run: ${missing.join("; ")}`);
  const extra = [...ran.keys()].filter((id) => !listed[0].includes(id));
  assert.deepEqual(extra, [], `Run but not listed: ${extra.join("; ")}`);
  return { count: listed[0].length, skipped, perShard: shards.map((_, i) => [...ran.values()].filter((s) => s === i + 1).length) };
}

export function runLoginShards(env = process.env, cwd = process.cwd()) {
  const read = (path) => JSON.parse(readFileSync(resolve(cwd, path), "utf8"));
  const shards = Array.from({ length: LOGIN_SHARDS }, (_, i) => ({
    inventory: read(`.ci-reports/login/login-shard-${i + 1}/inventory.json`),
    report: read(`.ci-reports/login/login-shard-${i + 1}/results.json`),
  }));
  const result = verifyLoginShards(shards);
  const summary = `Login E2E: ${result.count} tests, per shard ${result.perShard.join(" + ")}, skipped ${result.skipped}. ` +
    `Shard elapsed ms: ${shards.map(({ report }) => report.stats?.duration).join(", ")}.\n`;
  console.log(summary);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, summary);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { runLoginShards(); } catch (error) {
    console.error(`Login E2E shard verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}
