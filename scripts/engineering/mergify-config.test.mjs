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
];

test("queue and merge conditions require every required status of main", () => {
  const checks = lines
    .map((line) => /^\s*- check-success=(.+)$/.exec(line)?.[1])
    .filter(Boolean);
  assert.deepEqual(checks, REQUIRED);
  assert.match(body, /merge_conditions: \*required/);
  assert.match(body, /- base=main/);
  assert.match(body, /- -draft/);
});

test("only the owner can queue or requeue a PR, and nothing queues by itself", () => {
  assert.doesNotMatch(body, /pull_request_rules:/);
  for (const command of ["queue", "requeue"]) {
    assert.match(body, new RegExp(`\\n  ${command}:\\n    conditions:\\n      - sender=danielrisavi77-create\\n`));
  }
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
