import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

// Guards the CI step that runs the node:test suites (attack plan #195).
// A node --test glob that matches nothing exits 0, so the step must fail on
// an empty glob (failglob), keep its job and step names (branch protection
// requires the job name) and must not be skippable.
const ciPath = new URL("../../.github/workflows/ci.yml", import.meta.url);
const orchestratorDir = new URL("../orchestrator/", import.meta.url);

const JOB_NAME = "Lint, typecheck, test and build";
const STEP_NAME = "Engineering system unit tests";

async function stepBlock() {
  const ci = await readFile(ciPath, "utf8");
  assert.ok(ci.includes(`    name: ${JOB_NAME}\n`), "the required job must keep its name");
  const start = ci.indexOf(`      - name: ${STEP_NAME}\n`);
  assert.ok(start >= 0, "the step must keep its name");
  const rest = ci.slice(start + 1);
  const next = rest.search(/\n {6}- /);
  return rest.slice(0, next < 0 ? undefined : next);
}

test("CI node:test step fails on an empty glob and covers both suites", async () => {
  const step = await stepBlock();
  const run = step.match(/^ {8}run: (.+)$/m)?.[1];
  assert.ok(run, "step has a one-line run command");
  assert.match(run, /^shopt -s failglob; node --test /);
  assert.ok(run.includes("scripts/engineering/*.test.mjs"));
  assert.ok(run.includes("scripts/orchestrator/*.test.mjs"));
  assert.doesNotMatch(run, /--test-only|\|\||;\s*true|--test-skip/);
});

test("CI node:test step cannot be skipped or made non-blocking", async () => {
  const step = await stepBlock();
  assert.doesNotMatch(step, /^ {8}if:/m);
  assert.doesNotMatch(step, /continue-on-error/);
  assert.doesNotMatch(step, /working-directory/);
  assert.doesNotMatch(step, /shell:/);
});

test("orchestrator tests are not skipped, todo or focused with only", async () => {
  const names = (await readdir(orchestratorDir)).filter((n) => n.endsWith(".test.mjs"));
  assert.ok(names.length > 0);
  const bad = /\b(?:test|describe|it|t)\.(?:skip|todo|only)\b|[{,]\s*(?:skip|todo|only)\s*:/;
  for (const name of names) {
    const src = await readFile(new URL(name, orchestratorDir), "utf8");
    assert.doesNotMatch(src, bad, `${name} must not skip, todo or focus tests`);
  }
});
