import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { D97_MANUAL_PATHS, D97_PATHS, matchesPath } from "./protected-paths.mjs";

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
  const queueRules = lines.slice(0, lines.findIndex((line) => line.startsWith("pull_request_rules:")));
  const checks = queueRules
    .map((line) => /^\s*- check-success=(.+)$/.exec(line)?.[1])
    .filter(Boolean);
  assert.deepEqual(checks, REQUIRED);
  assert.match(body, /merge_conditions: \*required/);
  assert.match(body, /- base=main/);
  assert.match(body, /- -draft/);
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

test("two rules queue a PR, each only once the engineering gate is green", () => {
  const all = rules();
  assert.equal(all.length, 2);
  for (const rule of all) {
    assert.ok(rule.queue, rule.name);
    assert.ok(rule.conditions.includes("check-success=Engineering review gate"), rule.name);
    assert.ok(rule.conditions.includes("base=main") && rule.conditions.includes("-draft"), rule.name);
  }
});

test("the owner-command rule needs the label spoji-me and nothing else queues a critical PR", () => {
  const [auto, owner] = rules();
  assert.ok(owner.conditions.includes("label=spoji-me"));
  assert.ok(auto.conditions.includes("-label=spoji-me"));
  assert.ok(auto.conditions.includes("body~=(?m)^Risk:\\s+(low|standard)\\s*$"));
  assert.ok(auto.conditions.includes("-body~=(?m)^Risk:\\s+critical"));
});

test("the automatic rule excludes every D-97 path and docs/DECISIONS.md, whatever the case", () => {
  const [auto] = rules();
  const condition = auto.conditions.find((line) => line.startsWith("-files~="));
  assert.ok(condition);
  const source = condition.slice("-files~=".length);
  assert.ok(source.startsWith("(?i)"));
  const pattern = new RegExp(source.slice("(?i)".length), "i");
  for (const path of [...D97_PATHS, ...D97_MANUAL_PATHS]) {
    const file = path.endsWith("/") ? `${path}some/file.txt` : path;
    assert.match(file, pattern, file);
    assert.match(file.toUpperCase(), pattern, file.toUpperCase());
  }
  for (const file of ["src/editor/a.ts", "tests/unit/a.test.ts", "docs/PRODUCT.md", "e2e/a.spec.ts", "db/migrations/1.sql", "README.md", "scripts/demo/up.mjs"]) {
    assert.doesNotMatch(file, pattern, file);
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
