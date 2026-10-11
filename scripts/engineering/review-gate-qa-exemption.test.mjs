import test from "node:test";
import assert from "node:assert/strict";

import { evaluateGate, evaluatePullRequest } from "./review-gate-core.mjs";
import { changedPaths, qaExemption } from "./protected-paths.mjs";

const head = "a".repeat(40);
const earlier = "b".repeat(40);
const ownerLogin = "danielrisavi77-create";
const body = (risk = "critical") => `Agent: claude:a:platforma\nRisk: ${risk}\nTask: B-1\n`;

let counter = 0;
const comment = (text, { appSlug = "claude", login = ownerLogin } = {}) => ({
  body: text,
  user: { login },
  author_association: "OWNER",
  performed_via_github_app: appSlug ? { slug: appSlug } : null,
  created_at: new Date(1_700_000_000_000 + counter++ * 1000).toISOString(),
});
const review = (sha, verdict = "PASS", agent = "claude:b:reviewer") =>
  comment(`Agent-Review: ${agent}\nReview-Head: ${sha}\nReview-Verdict: ${verdict}\n`);
const qa = (sha, verdict = "PASS") =>
  comment(`QA-Agent: chatgpt:c:qa\nQA-Head: ${sha}\nQA-Verdict: ${verdict}\nQA-Scope: offline\n`, {
    appSlug: "chatgpt-codex-connector",
    login: "chatgpt-codex-connector[bot]",
  });

const pullRequest = (filenames, comments, extra = {}) => {
  const files = filenames.map((filename) => ({ filename, status: "modified" }));
  const pr = { body: body(), head: { sha: head }, changed_files: files.length, auto_merge: null };
  return evaluatePullRequest({ pr, files, comments, ownerLogin, ...extra }).result;
};

test("only test files are a tests-only change", () => {
  assert.equal(
    qaExemption([
      "tests/unit/auth/test-idp.ts",
      "tests/property/setup.ts",
      "e2e/login/login.spec.ts",
      "db/tests/030-institution-access-matrix.sql",
      "db/tests/fixtures/institution.inc",
      "src/domain/sync/queue.test.ts",
      "scripts/engineering/review-gate.test.mjs",
      "scripts/orchestrator/health.test.mjs",
    ]),
    "tests",
  );
});

test("only Markdown files, gate and rule documents included, are a docs-only change", () => {
  assert.equal(
    qaExemption([
      "docs/ENGINEERING_SYSTEM.md",
      "CLAUDE.md",
      "AGENTS.md",
      ".claude/skills/ductus-orchestrator/SKILL.md",
      ".claude/uloge/qa.md",
      "Docs/Notes.MD",
    ]),
    "docs",
  );
});

test("a mix of tests and documents, or either with any other file, is not exempt", () => {
  assert.equal(qaExemption(["tests/unit/a.test.ts", "docs/TESTING.md"]), null);
  assert.equal(qaExemption(["tests/unit/a.test.ts", "src/domain/a.ts"]), null);
  assert.equal(qaExemption(["docs/A.md", ".github/workflows/ci.yml"]), null);
  assert.equal(qaExemption(["scripts/engineering/review-gate.test.mjs", "scripts/engineering/review-gate-core.mjs"]), null);
  assert.equal(qaExemption([]), null);
  assert.equal(qaExemption(undefined), null);
});

test("files a test loads from outside the test paths are not tests", () => {
  for (const file of [
    "vitest.config.ts",
    "playwright.config.ts",
    "infra/fake-oidc/server.mjs",
    "scripts/engineering/laya/tests/test_routing.py",
    "package.json",
    "src/domain/sync/queue.ts",
  ]) {
    assert.equal(qaExemption([file]), null, file);
  }
});

test("a rename counts under both names, so code renamed to a test name is not exempt", () => {
  const paths = changedPaths([
    { filename: "src/domain/a.test.ts", previous_filename: "src/domain/a.ts", status: "renamed" },
  ]);
  assert.equal(qaExemption(paths), null);
});

test("a critical docs-only PR passes on an independent review without QA", () => {
  const result = pullRequest(["docs/ENGINEERING_SYSTEM.md", "CLAUDE.md"], [review(head)]);
  assert.equal(result.state, "success");
  assert.match(result.description, /critical, docs only: QA not required/);
});

test("a critical tests-only PR passes on an independent review without QA", () => {
  const result = pullRequest(["scripts/engineering/review-gate.test.mjs", "tests/unit/a.test.ts"], [review(head)]);
  assert.equal(result.state, "success");
  assert.match(result.description, /critical, tests only: QA not required/);
});

test("a critical PR with any other file still waits for QA", () => {
  const result = pullRequest(["docs/ENGINEERING_SYSTEM.md", "scripts/engineering/review-gate-core.mjs"], [review(head)]);
  assert.equal(result.state, "pending");
  assert.match(result.description, /waiting for separately authenticated QA PASS/);
});

test("the exemption never replaces the independent review", () => {
  assert.equal(pullRequest(["docs/A.md"], []).state, "pending");
  // The author's own principal cannot review its PR, exempt or not.
  const self = pullRequest(["docs/A.md"], [review(head, "PASS", "claude:a:reviewer")]);
  assert.equal(self.state, "pending");
});

test("a current QA FAIL or BLOCK still holds an exempt PR", () => {
  for (const verdict of ["FAIL", "BLOCK"]) {
    const result = pullRequest(["docs/A.md"], [review(head), qa(head, verdict)]);
    assert.equal(result.state, "pending", verdict);
    assert.match(result.description, new RegExp(`QA ${verdict.toLowerCase()}`));
  }
});

test("the body cannot claim the exemption: without the file list the gate requires QA", () => {
  const result = evaluateGate({
    body: `${body()}QA-Exempt: docs\n`,
    headSha: head,
    ownerLogin,
    comments: [review(head)],
  });
  assert.equal(result.state, "pending");
});

test("an exempt PR reports a review carried from an earlier head", () => {
  const result = pullRequest(["docs/A.md"], [review(earlier)], { carriedHeads: new Set([earlier]) });
  assert.equal(result.state, "success");
  assert.match(result.description, /Carried from bbbbbbb/);
  assert.ok(result.description.length <= 140, result.description);
});

test("a spec file outside e2e/ is a test", () => {
  assert.equal(qaExemption(["src/domain/sync/queue.spec.ts"]), "tests");
});

test("through the gate, a rename from code or gate code into a test or document still waits for QA", () => {
  for (const [filename, previous_filename] of [
    ["tests/unit/a.test.ts", "src/domain/a.ts"],
    ["docs/A.md", "scripts/engineering/review-gate-core.mjs"],
  ]) {
    const files = [{ filename, previous_filename, status: "renamed" }];
    const pr = { body: body(), head: { sha: head }, changed_files: 1, auto_merge: null };
    const { result } = evaluatePullRequest({ pr, files, comments: [review(head)], ownerLogin });
    assert.equal(result.state, "pending", filename);
    assert.match(result.description, /waiting for separately authenticated QA PASS/, filename);
  }
});

test("the exemption note is only for critical PRs", () => {
  for (const risk of ["low", "standard"]) {
    const pr = { body: body(risk), head: { sha: head }, changed_files: 1, auto_merge: null };
    const files = [{ filename: "docs/A.md", status: "modified" }];
    const { result } = evaluatePullRequest({ pr, files, comments: [review(head)], ownerLogin });
    assert.equal(result.state, "success", risk);
    assert.doesNotMatch(result.description, /QA not required/, risk);
  }
});
