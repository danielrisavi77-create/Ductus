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

// #971 QA F1 and review: the floor lists what is dangerous, so a low PR skips
// review only when it changes documents nothing serves or executes.
const runLow = (files) => {
  const low = "Agent: claude:a:platforma\nRisk: low\nTask: B-1\n";
  const pr = {
    body: low,
    head: { sha: head },
    changed_files: files.length,
    auto_merge: null,
  };
  return evaluatePullRequest({ pr, files, comments: [], ownerLogin });
};

test("a low PR that changes only documents needs no review and is auto-merge eligible", () => {
  const out = runLow([{ filename: "docs/FEATURES.md", status: "modified" }]);
  assert.equal(out.result.state, "success");
  assert.equal(out.autoMergeEligible.state, "success");
});

test("a low PR with any runtime, config or served file still waits for review", () => {
  for (const [filename, status] of [
    ["next.config.js", "added"],
    ["next.config.mjs", "added"],
    ["middleware.js", "added"],
    ["instrumentation.ts", "added"],
    [".npmrc", "added"],
    [".pnpmfile.cjs", "added"],
    ["pnpm-workspace.yaml", "added"],
    [".nvmrc", "modified"],
    ["public/sw.js", "added"],
    ["public/x.html", "added"],
    ["public/notes.md", "added"],
    ["config/faculties/fpzg/citation.json", "modified"],
    ["docs/diagram.svg", "added"],
  ]) {
    const out = runLow([
      { filename: "docs/FEATURES.md", status: "modified" },
      { filename, status },
    ]);
    assert.notEqual(out.result.state, "success", filename);
    assert.equal(out.autoMergeEligible.state, "pending", filename);
  }
});

test("a low PR that renames code into a document still waits for review", () => {
  const out = runLow([
    {
      filename: "docs/old.md",
      status: "renamed",
      previous_filename: "next.config.js",
    },
  ]);
  assert.notEqual(out.result.state, "success");
  assert.equal(out.autoMergeEligible.state, "pending");
});

// #971 QA F2 and review: only new files with a test name count as "only adds tests".
test("a new helper, fixture or pgTAP file in a test directory is not a test-only PR", () => {
  for (const filename of [
    "tests/unit/auth/test-idp.mjs",
    "tests/unit/helpers.mjs",
    "e2e/login/support.js",
    "db/tests/001-aaa.sql",
    "db/tests/rls.test.ts",
  ]) {
    const out = run([{ filename, status: "added" }]);
    assert.equal(out.result.state, "pending", filename);
    assert.match(
      out.result.description,
      /Waiting for independently authenticated review/,
      filename,
    );
    assert.equal(out.mergeAuthorization.state, "pending", filename);
    assert.equal(out.autoMergeEligible.state, "pending", filename);
  }
});

test("a new test under a D-97 path still waits for review", () => {
  for (const filename of [
    "scripts/engineering/x.test.mjs",
    ".claude/hooks/x.test.mjs",
  ]) {
    assert.equal(
      run([{ filename, status: "added" }]).result.state,
      "pending",
      filename,
    );
  }
});

test("new unit and e2e specs remain exempt", () => {
  const out = run([
    { filename: "tests/unit/auth/new-guard.test.ts", status: "added" },
    { filename: "e2e/login/new.spec.ts", status: "added" },
  ]);
  assert.equal(out.result.state, "success");
  assert.equal(out.autoMergeEligible.state, "success");
});
