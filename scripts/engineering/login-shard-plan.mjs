import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// DAN-375: the login E2E suite is split over the CI matrix by the measured
// duration of each spec file, not by test count (Playwright's --shard). The
// weights only balance the shards; the inventory decides what runs, and
// login-shards.mjs proves every listed test ran exactly once in its planned shard.
export const LOGIN_SHARDS = 6;
export const WEIGHTS_PATH = fileURLToPath(new URL("./login-shard-weights.json", import.meta.url));

// A flat spec file name under e2e/login. Anything else (a subfolder, a space,
// a shell or test-list delimiter such as "›" or ">") stops the plan.
const SPEC_FILE = /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.spec\.ts$/;

export function checkWeights(weights) {
  assert.ok(weights && typeof weights === "object" && !Array.isArray(weights), "The login shard weights are not an object");
  const entries = Object.entries(weights);
  assert.ok(entries.length > 0, "The login shard weights are empty");
  for (const [file, seconds] of entries) {
    assert.match(file, SPEC_FILE, `Unexpected weight entry: ${file}`);
    assert.ok(Number.isFinite(seconds) && seconds > 0, `Weight of ${file} is not a positive number`);
  }
  return weights;
}

// Spec files of a Playwright JSON report or listing, sorted and unique.
export function specFilesOf(report) {
  assert.ok(Array.isArray(report?.suites), "Missing suites");
  const files = new Set();
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) files.add(spec.file);
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report.suites) walk(suite);
  return [...files].sort();
}

// Longest file first onto the lightest shard; ties by name and by shard index,
// so every runner computes the same plan. A file without a measured weight
// counts as the mean weight, so a new spec still runs, only less balanced.
export function planLoginShards(files, weights, total = LOGIN_SHARDS) {
  checkWeights(weights);
  assert.ok(Number.isInteger(total) && total > 0, "Invalid shard total");
  const unique = [...new Set(files)].sort();
  assert.equal(unique.length, files.length, "A spec file is listed twice");
  for (const file of unique) assert.match(file, SPEC_FILE, `Unexpected login spec file: ${file}`);
  assert.ok(unique.length >= total, `Fewer spec files (${unique.length}) than shards (${total})`);
  const known = Object.values(weights);
  const fallback = known.reduce((a, b) => a + b, 0) / known.length;
  const weightOf = (file) => (Object.hasOwn(weights, file) ? weights[file] : fallback);
  const order = [...unique].sort((a, b) => weightOf(b) - weightOf(a) || (a < b ? -1 : 1));
  const loads = Array(total).fill(0);
  const shards = Array.from({ length: total }, () => []);
  for (const file of order) {
    const lightest = loads.indexOf(Math.min(...loads));
    shards[lightest].push(file);
    loads[lightest] += weightOf(file);
  }
  return shards.map((list) => list.sort());
}

export function runLoginShardPlan(argv = process.argv.slice(2), cwd = process.cwd()) {
  const shard = Number(argv[0]);
  assert.ok(Number.isInteger(shard) && shard >= 1 && shard <= LOGIN_SHARDS, `Shard must be 1..${LOGIN_SHARDS}, got ${argv[0]}`);
  const inventory = JSON.parse(readFileSync(resolve(cwd, ".ci-reports/inventory.json"), "utf8"));
  assert.equal(inventory.config?.shard ?? null, null, "The inventory must list the full suite");
  const weights = JSON.parse(readFileSync(WEIGHTS_PATH, "utf8"));
  const files = planLoginShards(specFilesOf(inventory), weights)[shard - 1];
  mkdirSync(resolve(cwd, ".ci-reports"), { recursive: true });
  writeFileSync(resolve(cwd, ".ci-reports/plan.json"), `${JSON.stringify({ shard, total: LOGIN_SHARDS, files }, null, 2)}\n`);
  // Playwright --test-list: one spec file per line, relative to the testDir.
  writeFileSync(resolve(cwd, ".ci-reports/test-list.txt"), `${files.join("\n")}\n`);
  console.log(`Login shard ${shard}/${LOGIN_SHARDS}: ${files.join(", ")}`);
  return files;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { runLoginShardPlan(); } catch (error) {
    console.error(`Login shard plan failed: ${error.message}`);
    process.exitCode = 1;
  }
}
