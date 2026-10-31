import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compareReport } from "./ui-test-pilot.mjs";

// Three reports from this workflow run, never a count-only coverage check.
// The existing pilot parser validates identities, paths, attempts and stats.
export function mergeShardReports(shards, testedSha) {
  assert.match(testedSha, /^[a-f0-9]{40}$/);
  assert.equal(shards.length, 3, "All three shards are required");
  for (const [index, { report, inventory }] of shards.entries()) {
    for (const input of [report, inventory]) {
      assert.equal(input.config.metadata.testedSha, testedSha, "Wrong tested SHA");
      assert.ok(Array.isArray(input.suites), "Missing suites");
      assert.ok(Array.isArray(input.errors), "Missing errors");
    }
    assert.deepEqual(report.config.shard, { current: index + 1, total: 3 }, "Wrong shard");
    assert.equal(inventory.config.shard, null, "Inventory must enumerate the full suite");
    assert.equal(report.config.rootDir, inventory.config.rootDir, "Wrong inventory root");
    assert.equal(report.config.rootDir, shards[0].report.config.rootDir, "Different roots");
  }
  const reports = shards.map(({ report }) => report);
  const starts = reports.map((r) => Date.parse(r.stats.startTime));
  const ends = reports.map((r, i) => starts[i] + r.stats.duration);
  assert.ok(starts.every(Number.isFinite) && ends.every(Number.isFinite), "Invalid timing");
  return {
    ...reports[0], config: { ...reports[0].config, shard: null },
    suites: reports.flatMap((r) => r.suites), errors: reports.flatMap((r) => r.errors),
    stats: {
      startTime: new Date(Math.min(...starts)).toISOString(),
      // Elapsed span across runners, not summed parallel test work.
      duration: Math.max(...ends) - Math.min(...starts),
      ...Object.fromEntries(["expected", "unexpected", "flaky", "skipped"].map((key) =>
        [key, reports.reduce((n, r) => n + r.stats[key], 0)])),
    },
  };
}

export function verifyShardReports(shards, merged, options) {
  // Each runner independently discovers the entire suite before sharding.
  // All inventories must match the union, including test/browser identities.
  const comparisons = shards.map(({ inventory }) => compareReport(
    { selection: "full" }, merged, { ...options, inventory, requirePilotSpecs: false },
  ));
  for (const comparison of comparisons) {
    assert.ok(comparison.complete, `Incomplete E2E evidence: ${comparison.problems.join(", ")}`);
    assert.equal(comparison.full.failures, 0, "E2E failures remain");
  }
  return comparisons[0];
}

export function runShards(env = process.env, cwd = process.cwd()) {
  const read = (path) => JSON.parse(readFileSync(resolve(cwd, path), "utf8"));
  const shards = [1, 2, 3].map((index) => ({
    report: read(`.ci-reports/shards/e2e-shard-${index}/results.json`),
    inventory: read(`.ci-reports/shards/e2e-shard-${index}/ui-pilot-inventory.json`),
  }));
  const merged = mergeShardReports(shards, env.GITHUB_SHA);
  mkdirSync(resolve(cwd, "test-results"), { recursive: true });
  // Preserve failed results for the advisory pilot even when validation fails.
  writeFileSync(resolve(cwd, "test-results/ui-pilot-full.json"), JSON.stringify(merged));
  writeFileSync(resolve(cwd, ".ci-reports/ui-pilot-inventory.json"), JSON.stringify(shards[0].inventory));
  const result = verifyShardReports(shards, merged, { cwd, projects: env.EVENT_NAME === "pull_request"
    ? ["desktop", "mobile"] : ["desktop", "mobile", "firefox", "webkit"] });
  const summary = `E2E: ${result.full.count} test instances, three shards, SHA ${env.GITHUB_SHA}.\n` +
    `Shard elapsed ms: ${shards.map(({ report }) => report.stats.duration).join(", ")}. ` +
    `Combined elapsed span: ${merged.stats.duration} ms; test work: ${result.full.testWorkMs} ms.\n`;
  console.log(summary);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, summary);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { runShards(); } catch (error) {
    console.error(`E2E shard verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}
