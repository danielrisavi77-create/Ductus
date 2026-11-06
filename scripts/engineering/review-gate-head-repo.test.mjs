import test from "node:test";
import assert from "node:assert/strict";

import { evaluatePullRequest } from "./review-gate-core.mjs";

// F-010: the gate core judges only a PR whose head lives in this repository.
// Every other class of head fails closed, whatever the verdicts say.
const REPO = "owner1/repo1";
const ownerLogin = "owner1";
const head = "c".repeat(40);
let counter = 0;
const comment = (text, appSlug = "claude") => ({
  body: text,
  user: { login: ownerLogin, type: "User" },
  author_association: "OWNER",
  performed_via_github_app: { slug: appSlug },
  created_at: new Date(1_700_000_000_000 + counter++ * 1000).toISOString(),
});
const passes = () => [
  comment(`Agent-Review: claude:r1:reviewer\nReview-Head: ${head}\nReview-Verdict: PASS\n`),
  comment(`QA-Agent: chatgpt:q1:qa\nQA-Head: ${head}\nQA-Verdict: PASS\nQA-Scope: offline\n`, "chatgpt-codex-connector"),
];
const files = [{ filename: "src/domain/example.ts", status: "modified" }];
const pr = (over) => ({
  body: "Agent: claude:w1:backend\nRisk: standard\nTask: DAN-1\n",
  head: { sha: head, repo: { full_name: REPO } },
  base: { ref: "main", repo: { full_name: REPO } },
  user: { login: ownerLogin, type: "User" },
  changed_files: 1,
  auto_merge: null,
  ...over,
});
const run = (value) => evaluatePullRequest({ pr: value, files, comments: passes(), ownerLogin });

const sameRepo = [
  ["same repository, owner author", pr({})],
  ["same repository, another author", pr({ user: { login: "helper1", type: "User" } })],
  ["same repository, app author", pr({ user: { login: "dependabot[bot]", type: "Bot" } })],
];

const outside = [
  ["fork", pr({ head: { sha: head, repo: { full_name: "outsider/repo1" } } })],
  ["deleted fork (head.repo null)", pr({ head: { sha: head, repo: null } })],
  ["head.repo missing", pr({ head: { sha: head } })],
  ["head.repo.full_name null", pr({ head: { sha: head, repo: { full_name: null } } })],
  ["head.repo.full_name empty", pr({ head: { sha: head, repo: { full_name: "" } } })],
  ["head.repo.full_name not a string", pr({ head: { sha: head, repo: { full_name: 42 } } })],
  ["base.repo missing", pr({ base: { ref: "main" } })],
  ["base.repo null", pr({ base: { ref: "main", repo: null } })],
  ["both repository names missing", pr({ head: { sha: head, repo: {} }, base: { ref: "main", repo: {} } })],
  ["same name in other letter case", pr({ head: { sha: head, repo: { full_name: "Owner1/Repo1" } } })],
];

for (const [name, value] of sameRepo) {
  test(`F-010 head class "${name}": judged by verdicts as before`, () => {
    const { result } = run(value);
    assert.equal(result.state, "success", result.description);
  });
}

for (const [name, value] of outside) {
  test(`F-010 head class "${name}": fails closed`, () => {
    const out = run(value);
    assert.equal(out.result.state, "failure");
    assert.match(out.result.description, /head is not in this repository/i);
    assert.notEqual(out.mergeAuthorization?.state, "success");
    assert.notEqual(out.autoMergeEligible?.state, "success");
  });
}

test("F-010: a missing pr object part never throws past the guard", () => {
  const out = run(pr({ head: { sha: head, repo: undefined }, base: undefined }));
  assert.equal(out.result.state, "failure");
});
