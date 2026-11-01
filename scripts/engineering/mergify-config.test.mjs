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
  const checks = lines
    .map((line) => /^\s*- check-success=(.+)$/.exec(line)?.[1])
    .filter(Boolean);
  assert.deepEqual(checks, REQUIRED);
  assert.match(body, /merge_conditions: \*required/);
  assert.match(body, /- base=main/);
  assert.match(body, /- -draft/);
});

test("serial speculation preserves every intermediate result and rejects edited carriers", () => {
  assert.match(body, /mode: serial\n/);
  // DAN-447: one check at a time, each a batch of up to five PRs (one CI run).
  assert.match(body, /max_parallel_checks: 1\n/);
  assert.match(body, /\n    batch_size: 5\n/);
  assert.match(body, /\n    batch_max_wait_time: 3 min\n/);
  assert.match(body, /max_checks_retries: 0\n/);
  assert.match(body, /allow_queue_branch_edit: false\n/);
  assert.match(body, /branch_protection_injection_mode: queue\n/);
  assert.match(body, /reset_on_external_merge: always\n/);
  assert.match(body, /skip_intermediate_results: false\n/);
  assert.doesNotMatch(body, /draft_bot_account:|queue_branch_prefix:|merge_bot_account:/);
});

// D-177: a failed batch is split until the failing PR is isolated, and each
// source PR still merges as its own squash commit behind its own approvals.
test("a batch merges its PRs one by one and a failed batch is split, never dropped whole", () => {
  // Unset means Mergify keeps splitting; 0 would drop every PR of the batch.
  assert.doesNotMatch(body, /batch_max_failure_resolution_attempts:/);
  assert.equal(body.match(/^\s*merge_method: (.+)$/m)?.[1], "squash");
  assert.doesNotMatch(body, /merge-batch|fast-forward/);
  // A batch is never larger than five and never a range that could grow.
  assert.equal(body.match(/batch_size:/g)?.length, 1);
  assert.doesNotMatch(body, /batch_size:\s*\n\s+(min|max):/);
  // Mergify checks a PR in place, merging main into the original branch, only
  // with batch_size 1 and one check. A batch above one keeps every check on a
  // draft carrier, so the queue never moves an original head (DAN-447).
  assert.ok(Number(body.match(/\n    batch_size: (\d+)\n/)?.[1]) > 1);
  // Each source PR is admitted only on its own green Merge authorization.
  assert.match(body, /queue_conditions: &required\n(?: {6}- .+\n)*? {6}- check-success=Merge authorization\n/);
});

test("only the owner can queue or requeue by command", () => {
  for (const command of ["queue", "requeue"]) {
    assert.match(body, new RegExp(`\\n  ${command}:\\n    conditions:\\n      - sender=danielrisavi77-create\\n`));
  }
});

// The rules under pull_request_rules: name -> condition lines.
function rules() {
  const start = body.indexOf("pull_request_rules:");
  if (start === -1) return [];
  return body.slice(start)
    .split(/\n  - name: /)
    .slice(1)
    .map((block) => ({
      name: block.split("\n")[0],
      conditions: [...block.matchAll(/^      - (.+)$/gm)].map((m) => m[1]),
      queue: /actions:\n      queue:\n        name: main/.test(block),
    }));
}

// F-114, F-165: Mergify sees only statuses, not the risk. No rule queues a PR
// by itself; a PR enters the queue only by the owner's `@Mergifyio queue`.
test("no rule auto-queues a PR; only the owner's command queues (F-165)", () => {
  const all = rules();
  assert.deepEqual(all.filter((rule) => rule.queue).map((rule) => rule.name), []);
  assert.doesNotMatch(body, /actions:\n\s+queue:/);
  assert.doesNotMatch(body, /Auto-merge eligible/);
  assert.match(body, /commands_restrictions:\n  queue:\n    conditions:\n      - sender=danielrisavi77-create/);
});
// DAN-447: no rule updates a waiting PR when main moves (each update started
// full CI on it); a PR is updated once, at merge time, under D-156.
test("no rule updates, rebases or otherwise acts on a PR by itself (DAN-447)", () => {
  assert.deepEqual(rules(), []);
  assert.doesNotMatch(body, /^pull_request_rules:/m);
  assert.doesNotMatch(body, /\bupdate: \{|\brebase: \{|\bactions:/);
});

test("Mergify never reads the description, a label or a file name (review of #565)", () => {
  assert.doesNotMatch(body, /body~=|label=|files~=|-files|-body/);
});

test("the queue squashes and retains merge updates for waiting source PRs (D-101)", () => {
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
