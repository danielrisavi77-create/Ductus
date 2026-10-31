import test from "node:test";
import assert from "node:assert/strict";
import { evaluateAutoMergeEligible, evaluatePullRequest, sameRepositoryHead } from "./review-gate-core.mjs";
import { classifyDiff } from "./ci-docs-scope.mjs";

const head = "a".repeat(40);
const ownerLogin = "danielrisavi77-create";
const repo = { full_name: "danielrisavi77-create/Ductus" };
const fork = { full_name: "stranger/Ductus" };
const evaluate = (risk, files, { headRepo = repo, comments = [] } = {}) => {
  const pr = {
    body: `Agent: claude:a:platforma\nRisk: ${risk}\nTask: B-1\n`,
    head: { sha: head, repo: headRepo },
    base: { repo },
    user: { login: headRepo === repo ? ownerLogin : "stranger" },
    changed_files: files.length,
    auto_merge: null,
  };
  return evaluatePullRequest({ pr, files, comments, ownerLogin });
};
const run = (files, opts) => evaluate("critical", files, opts);

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
  const out = evaluate("standard", [{ filename: "src/domain/sync/queue.test.ts", status: "added" }]);
  assert.equal(out.result.state, "success");
  assert.equal(out.autoMergeEligible.state, "success");
  assert.equal(out.mergeAuthorization.state, "success");
});

test("a critical PR that only adds test files is merge-authorized without an owner command, but modified tests are not", () => {
  assert.equal(run([{ filename: "src/a.test.ts", status: "added" }]).mergeAuthorization.state, "success");
  assert.equal(run([{ filename: "src/a.test.ts", status: "modified" }]).mergeAuthorization.state, "pending");
});

// #971 point 4: D-189 (2) names standard and critical. The floor already puts
// src/, tests/ and e2e/ above low, and "Auto-merge eligible" no longer ignores
// the risk, so the gate and the status agree even without the floor.
test("a low PR that only adds tests is neither exempt nor auto-merge eligible", () => {
  for (const filename of ["src/a.test.ts", "tests/unit/x.test.ts", "src/x.spec.ts"]) {
    const out = evaluate("low", [{ filename, status: "added" }]);
    assert.equal(out.result.state, "failure", filename);
    assert.notEqual(out.autoMergeEligible?.state, "success", filename);
    const eligible = evaluateAutoMergeEligible({
      metadata: { ok: true, risk: "low", minimumRisk: "low" },
      paths: [filename],
      qaExempt: "tests",
      testsAddedOnly: true,
      sameRepository: true,
    });
    assert.equal(eligible.state, "pending", filename);
  }
});

// #971 QA F1 and review: the floor lists what is dangerous, so a low PR skips
// review only when it changes documents nothing serves or executes.
const runLow = (files, opts) => evaluate("low", files, opts);

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

// #971 review: an agent loads CLAUDE.md and AGENTS.md from any directory.
// F-039: such a file is critical, so a low declaration fails outright, and
// the correct declaration still waits for review and is not auto-merge eligible.
test("a low PR with an agent instruction file in any directory still waits for review", () => {
  for (const [filename, status] of [
    ["docs/CLAUDE.md", "added"],
    ["docs/x/AGENTS.md", "added"],
    ["docs/notes/claude.md", "added"],
    ["docs/CLAUDE.local.md", "added"],
    ["docs/x/AGENTS.override.md", "modified"],
  ]) {
    const low = runLow([{ filename, status }]);
    assert.equal(low.result.state, "failure", filename);
    assert.match(low.result.description, /below minimum critical/, filename);
    const out = evaluate("critical", [{ filename, status }]);
    assert.equal(out.result.state, "pending", filename);
    assert.equal(out.autoMergeEligible.state, "pending", filename);
  }
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

// #971 QA: `next start` answers 200 on /api/qa-probe.test for
// pages/api/qa-probe.test.ts, so a test name where Next.js builds routes, or
// anywhere outside src/, tests/ and e2e/, is code under review.
test("a new test file on a path Next.js serves, or outside the test directories, still waits for review", () => {
  for (const filename of [
    "pages/api/qa-probe.test.ts",
    "pages/x.test.tsx",
    "app/api/x.test.ts",
    "app/(student)/rad/page.test.tsx",
    "src/app/x.test.ts",
    "src/pages/api/x.test.ts",
    "public/x.test.js",
    "infra/fake-oidc/x.test.mjs",
    "scripts/local/x.test.mjs",
    "x.test.ts",
  ]) {
    for (const risk of ["standard", "critical"]) {
      const out = evaluate(risk, [{ filename, status: "added" }]);
      assert.equal(out.result.state, "pending", `${risk} ${filename}`);
      assert.equal(out.mergeAuthorization.state, "pending", `${risk} ${filename}`);
      assert.equal(out.autoMergeEligible.state, "pending", `${risk} ${filename}`);
    }
  }
});

test("new unit tests and specs under src/ and tests/unit/ remain exempt", () => {
  const out = run([
    { filename: "tests/unit/auth/new-guard.test.ts", status: "added" },
    { filename: "src/domain/sync/new.spec.ts", status: "added" },
  ]);
  assert.equal(out.result.state, "success");
  assert.equal(out.autoMergeEligible.state, "success");
});

// #971 review: anyone can open a PR from a fork, and the gate workflow runs on
// pull_request_target, so no D-189 exemption reaches a head outside this repository.
test("a PR from a fork gets no D-189 exemption", () => {
  for (const [risk, file] of [
    ["critical", { filename: "docs/CLAUDE.md", status: "added" }],
    ["low", { filename: "docs/BACKEND.md", status: "modified" }],
    ["standard", { filename: "src/lib/x.test.ts", status: "added" }],
    ["critical", { filename: "tests/unit/y.test.ts", status: "added" }],
  ]) {
    for (const headRepo of [fork, null]) {
      const label = `${risk} ${file.filename} ${headRepo?.full_name ?? "deleted fork"}`;
      const out = evaluate(risk, [file], { headRepo });
      assert.equal(out.result.state, "pending", label);
      assert.match(out.result.description, /Waiting for independently authenticated review/, label);
      assert.equal(out.mergeAuthorization.state, "pending", label);
      assert.equal(out.autoMergeEligible.state, "pending", label);
    }
  }
});

test("a reviewed fork PR that only adds tests is still not auto-merge eligible and needs the owner command", () => {
  const review = {
    body: `Agent-Review: claude:b:reviewer\nReview-Head: ${head}\nReview-Verdict: PASS\n`,
    user: { login: ownerLogin },
    author_association: "OWNER",
    performed_via_github_app: { slug: "claude" },
    created_at: new Date(1_700_000_000_000).toISOString(),
  };
  const out = run([{ filename: "tests/unit/y.test.ts", status: "added" }], { headRepo: fork, comments: [review] });
  assert.equal(out.result.state, "success");
  assert.equal(out.mergeAuthorization.state, "pending");
  assert.equal(out.autoMergeEligible.state, "pending");
});

test("only a head in the base repository counts as the same repository", () => {
  assert.equal(sameRepositoryHead({ head: { repo }, base: { repo } }), true);
  for (const pr of [
    { head: { repo: fork }, base: { repo } },
    { head: { repo: null }, base: { repo } },
    { head: {}, base: { repo } },
    { head: { repo: { full_name: "" } }, base: { repo: { full_name: "" } } },
    { head: { repo }, base: {} },
    {},
  ]) {
    assert.equal(sameRepositoryHead(pr), false, JSON.stringify(pr));
  }
});

test("a low PR that changes only the root README.md needs no review", () => {
  const out = runLow([{ filename: "README.md", status: "modified" }]);
  assert.equal(out.result.state, "success");
  assert.equal(out.mergeAuthorization.state, "success");
  assert.equal(out.autoMergeEligible.state, "success");
});

// #971 contract t. 1 and 2 (owner option A): the exemptions are allowlists, so
// anything not on them waits for review whatever its risk, and the CI profile
// "tests" reads the same list (t. 3 and 4).
const record = (path) => `:000000 100644 ${"0".repeat(40)} ${"b".repeat(40)} A\0${path}\0`;

test("contract t. 5: no status is green without review and classifyDiff gives full", () => {
  for (const filename of [
    "docs/.claude/skills/x/SKILL.md",
    "docs/.claude/agents/x.md",
    "docs/.agents/skills/x/SKILL.md",
    "docs/GEMINI.md",
    "docs/sub/x.md",
    "src/pages/api/x.test.ts",
    "src/app/x.test.ts",
    "tests/e2e/x.spec.ts",
    "e2e/x.spec.ts",
  ]) {
    for (const risk of ["low", "standard", "critical"]) {
      const label = `${risk} ${filename}`;
      const out = evaluate(risk, [{ filename, status: "added" }]);
      assert.notEqual(out.result.state, "success", label);
      assert.notEqual(out.mergeAuthorization?.state, "success", label);
      assert.notEqual(out.autoMergeEligible?.state, "success", label);
    }
    assert.equal(classifyDiff(record(filename)), "full", filename);
  }
});

test("other agent instruction files, dot directories, DECISIONS and paths outside the allowlist wait for review", () => {
  for (const filename of [
    "docs/DECISIONS.md",
    "docs/ENGINEERING_SYSTEM.md",
    "docs/AGENTS.override.md",
    "docs/gemini-notes.md",
    "docs/copilot-instructions.md",
    "docs/review.instructions.md",
    "docs/.notes.md",
    "README.MD",
    "readme.md",
    "Docs/FEATURES.md",
    "src/README.md",
    "notes.md",
    ".claude/rules/x.md",
  ]) {
    const out = runLow([{ filename, status: "modified" }]);
    assert.notEqual(out.result.state, "success", filename);
    assert.notEqual(out.autoMergeEligible?.state, "success", filename);
  }
  for (const filename of [
    "src/.hidden/x.test.ts",
    "src/node_modules/x.test.ts",
    "src/App/x.test.ts",
    "src/Pages/x.test.ts",
    "tests/integration/x.test.ts",
    "tests/property/x.test.ts",
    "tests/x.test.ts",
    "src/ui/Card.test.tsx",
    "src/x.test.js",
  ]) {
    const out = run([{ filename, status: "added" }]);
    assert.equal(out.result.state, "pending", filename);
    assert.equal(out.mergeAuthorization.state, "pending", filename);
    assert.equal(out.autoMergeEligible.state, "pending", filename);
    assert.equal(classifyDiff(record(filename)), "full", filename);
  }
});

test("the CI profile tests takes only exempt paths that the unit project runs", () => {
  assert.equal(classifyDiff(record("src/domain/x.test.ts")), "tests");
  assert.equal(classifyDiff(record("tests/unit/x.test.ts")), "tests");
  // Exempt from review, but outside the vitest unit project: full CI.
  for (const path of ["src/x.spec.ts", "src/x.property.test.ts", "src/x.integration.test.ts"]) {
    assert.equal(classifyDiff(record(path)), "full", path);
  }
});
