import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { D97_PATHS, matchesPath } from "./protected-paths.mjs";

// D-161: the Mergify queue merges only on the owner's command and only when
// every required status of `main` is green.
const config = readFileSync(new URL("../../.github/mergify.yml", import.meta.url), "utf8");
const lines = config.split(/\r?\n/).filter((line) => !line.trimStart().startsWith("#"));
const body = lines.join("\n");

const REQUIRED = [
  "Lint, typecheck, test and build",
  "Local stack (compose.yaml)",
  "Security scanners",
  "Dependency review",
  "Engineering review gate",
  "Merge authorization",
];

test("queue and merge conditions require every required status of main", () => {
  const queueRules = lines.slice(0, lines.findIndex((line) => line.startsWith("pull_request_rules:")));
  const checks = queueRules
    .map((line) => /^\s*- check-success=(.+)$/.exec(line)?.[1])
    .filter(Boolean);
  // The queue conditions list every status; the merge conditions (the batch
  // branch) list only the CI ones, because the gate runs on the PR (DAN-240).
  const ci = REQUIRED.filter((name) => !name.startsWith("Engineering") && !name.startsWith("Merge auth"));
  assert.deepEqual(checks, [...REQUIRED, ...ci]);
  assert.match(body, /queue_conditions: &required/);
  assert.match(body, /- base=main/);
  assert.match(body, /- -draft/);
});

test("the queue tests a small batch together and never rebases (DAN-240)", () => {
  assert.match(body, /batch_size: 3\n/);
  assert.match(body, /max_parallel_checks: 2\n/);
});

test("only the owner can queue or requeue by command", () => {
  for (const command of ["queue", "requeue"]) {
    assert.match(body, new RegExp(`\\n  ${command}:\\n    conditions:\\n      - sender=danielrisavi77-create\\n`));
  }
});

// The rules under pull_request_rules: name -> condition lines.
function rules() {
  const text = body.slice(body.indexOf("pull_request_rules:"));
  return text
    .split(/\n  - name: /)
    .slice(1)
    .map((block) => ({
      name: block.split("\n")[0],
      conditions: [...block.matchAll(/^      - (.+)$/gm)].map((m) => m[1]),
      queue: /actions:\n      queue:\n        name: main/.test(block),
    }));
}

test("one rule queues a PR, and it reads only the two statuses the gate publishes", () => {
  const all = rules().filter((rule) => rule.queue);
  assert.equal(all.length, 1);
  assert.deepEqual(all[0].conditions, [
    "base=main",
    "-draft",
    "check-success=Engineering review gate",
    "check-success=Merge authorization",
  ]);
});

test("the other rule only refreshes a waiting PR with a green gate, a draft or conflict is left alone", () => {
  const others = rules().filter((rule) => !rule.queue);
  assert.equal(others.length, 1);
  assert.deepEqual(others[0].conditions, [
    "base=main",
    "-draft",
    "-conflict",
    '"#commits-behind>0"',
    "check-success=Engineering review gate",
    "-check-success=Merge authorization",
  ]);
  assert.match(body, /actions:\n      update: \{\}/);
});

test("Mergify never reads the description, a label or a file name (review of #565)", () => {
  assert.doesNotMatch(body, /body~=|label=|files~=|-files|-body/);
});

test("the queue squashes and refreshes the branch by merging main (D-101)", () => {
  assert.match(body, /merge_method: squash/);
  assert.match(body, /update_method: merge/);
  assert.doesNotMatch(body, /update_method: rebase/);
});

test("the configuration is a D-97 path and no earlier file shadows it", () => {
  // Mergify looks for .mergify.yml, then .mergify/config.yml, then this file.
  assert.ok(matchesPath(".github/mergify.yml", D97_PATHS));
  for (const path of [".mergify.yml", ".mergify/config.yml"]) {
    assert.equal(existsSync(new URL(`../../${path}`, import.meta.url)), false, path);
  }
});
