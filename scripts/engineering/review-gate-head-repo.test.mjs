import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { evaluatePullRequest } from "./review-gate-core.mjs";

// F-010, F-027 (gate part, DAN-574 PR A): the gate core judges only a PR whose
// head lives in this repository. Every other class of head fails closed before
// any verdict, override, command or D-189 exemption is read. The input classes
// are the contract on #1091 (c.6702002871); each one runs through every scenario.
const REPO = "owner1/repo1";
const ownerLogin = "owner1";
const head = "c".repeat(40);
const STATUSES = ["result", "mergeAuthorization", "autoMergeEligible"];

let counter = 0;
const comment = (text, appSlug = null) => ({
  body: text,
  user: { login: ownerLogin, type: "User" },
  author_association: "OWNER",
  performed_via_github_app: appSlug ? { slug: appSlug } : null,
  created_at: new Date(1_700_000_000_000 + counter++ * 1000).toISOString(),
});
const review = () => comment(`Agent-Review: claude:r1:reviewer\nReview-Head: ${head}\nReview-Verdict: PASS\n`, "claude");
const qa = () => comment(`QA-Agent: chatgpt:q1:qa\nQA-Head: ${head}\nQA-Verdict: PASS\nQA-Scope: offline\n`, "chatgpt-codex-connector");
const override = () => comment(`Owner-Override: PASS\nOverride-Head: ${head}\nOverride-Reason: test\n`);
const command = () => comment(`Owner-Command: merge\nCommand-Head: ${head}\nDatum: 2026-11-07\n`);

const bodyFor = (risk) => `Agent: claude:w1:platforma\nRisk: ${risk}\nTask: DAN-1\n`;
const file = (filename, status = "modified") => ({ filename, status });

// Each scenario but the last is green in at least one status for a head in this
// repository (checked below), so a failure for an outside head is the guard's
// doing. The last one fails for its own reason; the guard must still speak first.
const SCENARIOS = [
  { name: "low, documents only, no review (D-189)", risk: "low", files: [file("docs/BACKEND.md")], comments: () => [] },
  { name: "critical, only new tests, no review (D-189)", risk: "critical", files: [file("tests/unit/new.test.ts", "added")], comments: () => [] },
  { name: "standard, review PASS", risk: "standard", files: [file("src/domain/example.ts")], comments: () => [review()] },
  { name: "critical, review and QA PASS", risk: "critical", files: [file("src/server/auth/example.ts")], comments: () => [review(), qa()] },
  { name: "critical D-97, review, QA and Owner-Command", risk: "critical", files: [file("scripts/engineering/review-gate-core.mjs")], comments: () => [review(), qa(), command()] },
  { name: "critical D-97, Owner-Override and Owner-Command", risk: "critical", files: [file("scripts/engineering/review-gate-core.mjs")], comments: () => [override(), command()] },
  { name: "standard, review PASS, auto-merge on", risk: "standard", files: [file("src/domain/example.ts")], comments: () => [review()], autoMerge: true },
  { name: "standard, review PASS, incomplete file list", risk: "standard", files: [file("src/domain/example.ts")], comments: () => [review()], changedFiles: 2, failsAnyway: true },
];

const pr = (scenario, shape) => ({
  body: bodyFor(scenario.risk),
  head: { sha: head, repo: { full_name: REPO } },
  base: { ref: "main", repo: { full_name: REPO } },
  user: { login: ownerLogin, type: "User" },
  changed_files: scenario.changedFiles ?? scenario.files.length,
  auto_merge: scenario.autoMerge ? { merge_method: "squash" } : null,
  ...shape,
});
const run = (scenario, value) =>
  evaluatePullRequest({ pr: value, files: scenario.files, comments: scenario.comments(), ownerLogin });

// Shapes are merged over the base PR, so a key set to undefined drops that part.
const SAME = [
  ["S1 same repository, owner author", {}],
  ["S2 same repository, another author", { user: { login: "helper1", type: "User" } }],
  ["S3 same repository, app author", { user: { login: "dependabot[bot]", type: "Bot" } }],
];
const repoHead = (repo) => ({ head: { sha: head, repo } });
const OUTSIDE = [
  ["O1 fork of another owner", repoHead({ full_name: "outsider/repo1", fork: true })],
  ["O2 same repository name under another owner", repoHead({ full_name: "outsider1/repo1" })],
  ["O3 deleted fork (head.repo null)", repoHead(null)],
  ["O4 head.repo missing", { head: { sha: head } }],
  ["O5 no head", { head: undefined }],
  ["O7 head full_name is a number", repoHead({ full_name: 42 })],
  ["O7 head full_name is an object", repoHead({ full_name: { toString: () => REPO } })],
  ["O8 same name in other letter case", repoHead({ full_name: "Owner1/Repo1" })],
  ["O9 trailing space", repoHead({ full_name: `${REPO} ` })],
  ["O9 suffix", repoHead({ full_name: `${REPO}-fork` })],
  ["O10 head full_name null", repoHead({ full_name: null })],
  ["O10 head full_name empty", repoHead({ full_name: "" })],
  ["O11 base.repo missing", { base: { ref: "main" } }],
  ["O11 base.repo null", { base: { ref: "main", repo: null } }],
  ["O11 no base", { base: undefined }],
  ["O12 both names missing", { head: { sha: head, repo: {} }, base: { ref: "main", repo: {} } }],
  ["O13 both names empty", { head: { sha: head, repo: { full_name: "" } }, base: { ref: "main", repo: { full_name: "" } } }],
];

const assertClosed = (out, label) => {
  assert.equal(out.result.state, "failure", label);
  assert.match(out.result.description, /head is not in this repository/i, label);
  for (const status of STATUSES) assert.notEqual(out[status]?.state, "success", `${label}: ${status}`);
};

test("every scenario is green somewhere for a head in this repository (positive control)", () => {
  for (const scenario of SCENARIOS) {
    const out = run(scenario, pr(scenario, {}));
    const green = STATUSES.some((status) => out[status]?.state === "success");
    assert.equal(green, !scenario.failsAnyway, scenario.name);
  }
});

for (const [name, shape] of SAME) {
  test(`head class "${name}": judged as before`, () => {
    for (const scenario of SCENARIOS) {
      const out = run(scenario, pr(scenario, shape));
      const baseline = run(scenario, pr(scenario, {}));
      for (const status of STATUSES) assert.equal(out[status]?.state, baseline[status]?.state, `${scenario.name}: ${status}`);
      assert.doesNotMatch(out.result.description, /head is not in this repository/i, scenario.name);
    }
  });
}

for (const [name, shape] of OUTSIDE) {
  test(`head class "${name}": fails closed in every scenario`, () => {
    for (const scenario of SCENARIOS) assertClosed(run(scenario, pr(scenario, shape)), scenario.name);
  });
}

test('head class "O6 pr is null or undefined": fails closed without throwing', () => {
  for (const value of [null, undefined]) {
    assertClosed(evaluatePullRequest({ pr: value, files: [], comments: [review()], ownerLogin }), String(value));
  }
});

// Property: whatever shapes the two repositories take, a green status in any
// of the three means the head names, as a non-empty string, the base repository.
const name = fc.oneof(
  fc.constantFrom(REPO, "Owner1/Repo1", `${REPO} `, "outsider/repo1", "", "owner1/repo2"),
  fc.string({ maxLength: 12 }),
  fc.constantFrom(null, undefined, 42, true, {}),
);
const repoShape = fc.oneof(
  name.map((full_name) => ({ full_name })),
  fc.constantFrom(null, undefined, {}, "owner1/repo1"),
);

test("property: no status is green unless the head is in the base repository", () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: SCENARIOS.length - 1 }), repoShape, repoShape, (index, headRepo, baseRepo) => {
      const scenario = SCENARIOS[index];
      const value = pr(scenario, { head: { sha: head, repo: headRepo }, base: { ref: "main", repo: baseRepo } });
      const out = run(scenario, value);
      const green = STATUSES.some((status) => out[status]?.state === "success");
      const inside = typeof headRepo?.full_name === "string" && headRepo.full_name !== "" && headRepo.full_name === baseRepo?.full_name;
      return !green || inside;
    }),
    { numRuns: 500 },
  );
});
