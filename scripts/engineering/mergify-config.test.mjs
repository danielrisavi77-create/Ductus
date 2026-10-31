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
  assert.deepEqual(checks, REQUIRED);
  assert.match(body, /merge_conditions: \*required/);
  assert.match(body, /- base=main/);
  assert.match(body, /- -draft/);
});

test("serial speculation preserves every intermediate result and rejects edited carriers", () => {
  assert.match(body, /mode: serial\n/);
  assert.match(body, /max_parallel_checks: 3\n/);
  // D-177: batches of up to three PRs, one CI run per batch.
  assert.match(body, /\n    batch_size: 3\n/);
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
  // A batch is never larger than three and never a range that could grow.
  assert.equal(body.match(/batch_size:/g)?.length, 1);
  assert.doesNotMatch(body, /batch_size:\s*\n\s+(min|max):/);
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

// F-114: Mergify sees only statuses, not the risk. Auto-queue is allowed only
// for the explicit "auto-queue low and test-only PRs" rule that requires the
// gate-published "Auto-merge eligible" status.
test("only the low/test-only rule may auto-queue a PR", () => {
  const all = rules();
  const queuing = all.filter((rule) => rule.queue);
  assert.equal(queuing.length, 1);
  assert.equal(queuing[0].name, "auto-queue low and test-only PRs");
  assert.ok(queuing[0].conditions.includes("check-success=Auto-merge eligible"));
  // #971: a fork never auto-queues, even if the status were green.
  assert.ok(queuing[0].conditions.includes("head-repo-full-name=danielrisavi77-create/Ductus"));
  assert.match(body, /commands_restrictions:\n  queue:\n    conditions:\n      - sender=danielrisavi77-create/);
});
test("the refresh rule still exists and a draft or conflict is left alone", () => {
  const others = rules();
  assert.ok(others.length >= 1);
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
