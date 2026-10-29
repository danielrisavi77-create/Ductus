import test from "node:test";
import assert from "node:assert/strict";
import { evaluateAutoMergeEligible, evaluatePullRequest } from "./review-gate-core.mjs";

const head = "a".repeat(40);
const ownerLogin = "danielrisavi77-create";
const body = "Agent: claude:a:platforma\nRisk: critical\nTask: B-1\n";
const run = (files) => {
  const pr = { body, head: { sha: head }, changed_files: files.length, auto_merge: null };
  return evaluatePullRequest({ pr, files, comments: [], ownerLogin });
};

// #971: only new test files skip review and may auto-queue; a change to or
// removal of an existing test can weaken a guard (CLAUDE.md, ENGINEERING §5).
test("a PR that only adds test files needs no review and is auto-merge eligible", () => {
  const out = run([{ filename: "src/a.test.ts", status: "added" }]);
  assert.equal(out.result.state, "success");
  assert.equal(out.autoMergeEligible.state, "success");
});

test("a PR that modifies, removes or renames a test still waits for review and is not auto-merge eligible", () => {
  for (const status of ["modified", "removed", "renamed"]) {
    const out = run([
      { filename: "src/b.test.ts", status: "added" },
      { filename: "tests/unit/guard.test.ts", status, previous_filename: status === "renamed" ? "tests/unit/old.test.ts" : undefined },
    ]);
    assert.equal(out.result.state, "pending", status);
    assert.match(out.result.description, /Waiting for independently authenticated review/);
    assert.equal(out.autoMergeEligible.state, "pending", status);
  }
});

test("auto-merge eligibility without file statuses fails closed for tests", () => {
  assert.equal(evaluateAutoMergeEligible({ metadata: { ok: false }, paths: ["src/a.test.ts"], qaExempt: "tests" }).state, "pending");
});

test("a standard PR that only adds test files gets the same exemption and needs no owner command", () => {
  const std = "Agent: claude:a:platforma\nRisk: standard\nTask: B-1\n";
  const files = [{ filename: "src/domain/sync/queue.test.ts", status: "added" }];
  const pr = { body: std, head: { sha: head }, changed_files: 1, auto_merge: null };
  const out = evaluatePullRequest({ pr, files, comments: [], ownerLogin });
  assert.equal(out.result.state, "success");
  assert.equal(out.autoMergeEligible.state, "success");
  assert.equal(out.mergeAuthorization.state, "success");
});

test("a critical PR that only adds test files is merge-authorized without an owner command, but modified tests are not", () => {
  assert.equal(run([{ filename: "src/a.test.ts", status: "added" }]).mergeAuthorization.state, "success");
  assert.equal(run([{ filename: "src/a.test.ts", status: "modified" }]).mergeAuthorization.state, "pending");
});
