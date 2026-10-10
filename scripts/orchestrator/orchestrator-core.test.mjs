import assert from "node:assert/strict";
import test from "node:test";

import {
  allRequiredPass, compareSnapshots, countCanonical, d97ManualMatches, d97Matches,
  evaluateChecks, evaluateReady, intersectFiles, latestVerdict, parsePushArgs,
  pushVerdict, snapshot, summarizeThreads,
} from "./orchestrator-core.mjs";

const H1 = "a".repeat(40);
const H2 = "b".repeat(40);
const c = (body, over = {}) => ({
  body,
  author_association: "OWNER",
  user: { login: "x" },
  created_at: "2026-10-10T10:00:00Z",
  ...over,
});
const review = (head, verdict, at) =>
  c(`Agent-Review: claude:b:reviewer\nReview-Head: ${head}\nReview-Verdict: ${verdict}`, { created_at: at });

test("latest review verdict is bound to head and flagged stale otherwise", () => {
  const comments = [
    review(H1, "FAIL", "2026-10-10T10:00:00Z"),
    review(H1, "PASS", "2026-10-10T11:00:00Z"),
  ];
  assert.deepEqual(latestVerdict(comments, "review", H1)?.current, true);
  assert.equal(latestVerdict(comments, "review", H1)?.verdict, "PASS");
  assert.equal(latestVerdict(comments, "review", H2)?.current, false);
  assert.equal(latestVerdict(comments, "qa", H1), null);
});

test("verdicts in code fences, non-first lines and untrusted authors are ignored", () => {
  const comments = [
    c(`text\nAgent-Review: x\nReview-Head: ${H1}\nReview-Verdict: PASS`),
    c("```\nAgent-Review: x\n```"),
    review(H1, "PASS", "2026-10-10T10:00:00Z"),
  ];
  comments[2].author_association = "NONE";
  assert.equal(countCanonical(comments), 0);
});

test("qa verdicts parse separately", () => {
  const qa = c(`QA-Agent: claude:c:qa\nQA-Head: ${H1}\nQA-Verdict: block`);
  assert.equal(latestVerdict([qa], "qa", H1).verdict, "BLOCK");
  assert.equal(countCanonical([qa]), 1);
});

test("snapshot comparison detects verdict, head, and ignores unusable answers", () => {
  const base = snapshot(H1, []);
  assert.equal(compareSnapshots(base, snapshot(H1, [])).verdict, false);
  assert.equal(compareSnapshots(base, snapshot(H1, [review(H1, "PASS", "2026-10-10T10:00:00Z")])).verdict, true);
  assert.equal(compareSnapshots(base, { head: H2, verdicts: 0 }).head, true);
  for (const bad of [null, undefined, {}, { head: "", verdicts: 0 }, { head: H2, verdicts: NaN }]) {
    const r = compareSnapshots(base, bad);
    assert.equal(r.head || r.verdict, false);
  }
  // a deleted comment is not a new verdict
  assert.equal(compareSnapshots({ head: H1, verdicts: 2 }, { head: H1, verdicts: 1 }).verdict, false);
});

test("file intersection and D-97 detection", () => {
  assert.deepEqual(intersectFiles(["a", "b/c"], ["b\\c", "d", "a"]), ["a", "b/c"]);
  assert.deepEqual(intersectFiles(null, ["a"]), []);
  assert.deepEqual(
    d97Matches(["src/x.ts", ".github/workflows/ci.yml", "scripts/engineering/a.mjs", "CLAUDE.md", "docs/PRODUCT.md", "scripts/orchestrator/a.mjs", ".claude/skills/x/SKILL.md", "lefthook.yml"]),
    [".github/workflows/ci.yml", "scripts/engineering/a.mjs", "CLAUDE.md", "scripts/orchestrator/a.mjs", ".claude/skills/x/SKILL.md", "lefthook.yml"],
  );
  assert.deepEqual(d97Matches(["xCLAUDE.md", ".github2/a"]), []);
  assert.deepEqual(d97ManualMatches(["docs/DECISIONS.md", "a"]), ["docs/DECISIONS.md"]);
});

const PO = { currentBranch: "feat/x", defaultBranch: "main" };

test("push args: allow-list of branch forms", () => {
  assert.deepEqual(parsePushArgs([], PO), { remote: "origin", src: "HEAD", dst: "feat/x" });
  assert.deepEqual(parsePushArgs(["origin", "HEAD"], PO), { remote: "origin", src: "HEAD", dst: "feat/x" });
  assert.deepEqual(parsePushArgs(["origin", "feat/y"], PO), { remote: "origin", src: "feat/y", dst: "feat/y" });
  assert.deepEqual(parsePushArgs(["origin", "HEAD:refs/heads/feat/z"], PO), { remote: "origin", src: "HEAD", dst: "feat/z" });
  assert.deepEqual(parsePushArgs(["origin", "loc:rem"], PO), { remote: "origin", src: "loc", dst: "rem" });
});

test("push args: every other form is rejected", () => {
  const bad = [
    ["--force"], ["-f"], ["--force-with-lease"], ["--delete"], ["--mirror"], ["--all"], ["--tags"], ["--prune"],
    ["origin", "--delete"], ["origin", "--all"], ["origin", "+HEAD"], ["origin", "+a:b"], ["origin", "a:+b"],
    ["origin", ":victim"], ["origin", ":refs/heads/victim"], ["origin", "a:"], ["origin", ":"],
    ["origin", "a*"], ["origin", "a:b*"], ["origin", "*:b"], ["origin", "a?"], ["origin", "a[0]"],
    ["origin", "refs/tags/v1"], ["origin", "HEAD:refs/tags/v1"], ["origin", "a:refs/for/x"],
    ["origin", "a:b:c"], ["origin", "a..b"], ["origin", "a b"], ["origin", "-x"], ["origin", "a:-x"],
    ["origin", "a/"], ["origin", "a.lock"], ["origin", "a", "b"], ["-x"], ["bad remote"], ["--x", "HEAD"],
  ];
  for (const b of bad) assert.throws(() => parsePushArgs(b, PO), undefined, b.join(" "));
});

test("push args: main and the repo default branch are always refused", () => {
  const o = { currentBranch: "feat/x", defaultBranch: "trunk" };
  for (const r of ["main", "HEAD:main", "HEAD:refs/heads/main", "a:refs/heads/main", "trunk", "HEAD:trunk"]) {
    assert.throws(() => parsePushArgs(["origin", r], o), undefined, r);
  }
  assert.throws(() => parsePushArgs(["origin", "HEAD"], { currentBranch: "main", defaultBranch: "main" }));
  assert.throws(() => parsePushArgs([], { currentBranch: null, defaultBranch: "main" }));
});

test("verdict summary is per identity: any FAIL/BLOCK on current head wins", () => {
  const rv = (id, head, verdict, at) => ({
    ...c(`Agent-Review: claude:${id}:reviewer\nReview-Head: ${head}\nReview-Verdict: ${verdict}`, { created_at: at }),
    performed_via_github_app: { slug: "claude" },
  });
  const comments = [rv("reviewB", H1, "FAIL", "2026-10-10T10:00:00Z"), rv("review1", H1, "PASS", "2026-10-10T11:00:00Z")];
  assert.equal(latestVerdict(comments, "review", H1).verdict, "FAIL");
  const fixed = [...comments, rv("reviewB", H1, "PASS", "2026-10-10T12:00:00Z")];
  assert.equal(latestVerdict(fixed, "review", H1).verdict, "PASS");
  assert.equal(latestVerdict([...fixed, rv("r3", H1, "BLOCK", "2026-10-10T13:00:00Z")], "review", H1).verdict, "BLOCK");
  const mixed = latestVerdict([rv("r3", H2, "FAIL", "2026-10-10T13:00:00Z"), rv("r1", H1, "PASS", "2026-10-10T10:00:00Z")], "review", H1);
  assert.equal(mixed.verdict, "PASS");
  assert.equal(mixed.current, true);
  assert.equal(latestVerdict([rv("r3", H2, "FAIL", "2026-10-10T13:00:00Z")], "review", H1).current, false);
});

test("push verdict requires success and equal SHAs", () => {
  assert.equal(pushVerdict(true, H1, H1).ok, true);
  assert.equal(pushVerdict(false, H1, H1).ok, false);
  assert.equal(pushVerdict(true, H1, H2).ok, false);
  assert.equal(pushVerdict(true, H1, null).ok, false);
});

test("threads summary and CI evaluation", () => {
  const t = summarizeThreads([
    { isResolved: false, comments: { nodes: [{ author: { login: "bot" } }] } },
    { isResolved: true, comments: { nodes: [{ author: { login: "z" } }] } },
    { isResolved: false, comments: { nodes: [{ author: { login: "bot" } }] } },
  ]);
  assert.deepEqual(t, { count: 2, authors: ["bot"] });
  const ck = evaluateChecks([
    { name: "lint", conclusion: "SUCCESS" },
    { name: "e2e", conclusion: "FAILURE" },
    { name: "x", status: "IN_PROGRESS", conclusion: "" },
    { context: "Engineering review gate", state: "PENDING" },
    { context: "legacy", state: "SUCCESS" },
  ]);
  assert.equal(ck.total, 4);
  assert.deepEqual(ck.bad.map((b) => b.name), ["e2e", "x"]);
});

const ready = (over = {}) => ({
  head: H1,
  gate: { state: "success", description: "ok" },
  rollup: [{ name: "lint", conclusion: "SUCCESS" }],
  base: "main",
  mergeable: "MERGEABLE",
  overlap: [],
  threads: { count: 0, authors: [] },
  autoMerge: false,
  files: ["src/a.ts"],
  agent: "claude:a:platforma",
  draft: false,
  ...over,
});

test("readiness: all pass, and each failure blocks", () => {
  const ok = evaluateReady(ready());
  assert.equal(allRequiredPass(ok), true);
  assert.match(ok.find((x) => x.id === "agent").text, /claude:a/);
  for (const [id, over] of [
    ["gate", { gate: { state: "pending", description: "waiting" } }],
    ["gate", { gate: null }],
    ["ci", { rollup: [{ name: "t", conclusion: "FAILURE" }] }],
    ["ci", { rollup: [] }],
    ["base", { base: "dev" }],
    ["mergeable", { mergeable: "CONFLICTING" }],
    ["overlap", { overlap: ["a.ts"] }],
    ["overlap", { overlap: null }],
    ["threads", { threads: { count: 1, authors: ["r"] } }],
    ["threads", { threads: null }],
    ["automerge", { autoMerge: true }],
  ]) {
    const r = evaluateReady(ready(over));
    assert.equal(r.find((x) => x.id === id).level, "FAIL", id);
    assert.equal(allRequiredPass(r), false);
  }
});

test("D-97 and draft are INFO only", () => {
  const r = evaluateReady(ready({ files: [".github/a.yml", "docs/DECISIONS.md"], draft: true }));
  assert.equal(allRequiredPass(r), true);
  assert.match(r.find((x) => x.id === "d97").text, /Daniel/);
  assert.ok(r.find((x) => x.id === "d97-manual"));
  assert.equal(r.find((x) => x.id === "draft").text, "draft");
});

test("the orchestrator tools and the agent plugin are D-97 paths in any spelling", () => {
  const files = ["scripts/orchestrator/orchestrator-core.mjs", "plugins/ductura-engineering/skills/x/SKILL.md"];
  assert.deepEqual(d97Matches(files), files);
  assert.match(evaluateReady(ready({ files })).find((x) => x.id === "d97").text, /orchestrator-core\.mjs, plugins\/ductura-engineering/);
  assert.deepEqual(d97Matches(["./Scripts\\Orchestrator\\gh.mjs", "claude.md", ".GITHUB/x"]), ["Scripts/Orchestrator/gh.mjs", "claude.md", ".GITHUB/x"]);
  assert.deepEqual(d97ManualMatches(["Docs/decisions.md"]), ["Docs/decisions.md"]);
});

test("an unread file list fails readiness instead of reporting no D-97 paths", () => {
  const r = evaluateReady(ready({ files: null }));
  assert.equal(r.find((x) => x.id === "files").level, "FAIL");
  assert.equal(allRequiredPass(r), false);
  assert.equal(evaluateReady(ready({ files: [] })).find((x) => x.id === "files"), undefined);
});

// DAN-118. Shape of `gh pr view --json statusCheckRollup` for PR #145 on head 13a47cae.
const run = (name, conclusion, startedAt, completedAt, workflowName = "CI") =>
  ({ __typename: "CheckRun", name, conclusion, status: conclusion ? "COMPLETED" : "IN_PROGRESS", startedAt, completedAt, workflowName });
const LINT = "Lint, typecheck, test and build";
const RERUN = [
  run(LINT, "FAILURE", "2026-10-10T14:34:37Z", "2026-10-10T14:34:57Z"),
  run(LINT, "SUCCESS", "2026-10-10T14:37:20Z", "2026-10-10T14:38:15Z"),
  run("Dependency review", "SUCCESS", "2026-10-10T14:31:31Z", "2026-10-10T14:31:38Z", "Dependency review"),
  run("Dependency review", "SUCCESS", "2026-10-10T14:37:20Z", "2026-10-10T14:37:24Z", "Dependency review"),
];

test("CI: only the newest run of each check counts", () => {
  assert.deepEqual(evaluateChecks(RERUN), { total: 2, bad: [] });
  assert.deepEqual(evaluateChecks([...RERUN].reverse()), { total: 2, bad: [] });
  const r = evaluateReady(ready({ rollup: RERUN }));
  assert.equal(r.find((x) => x.id === "ci").text, "CI green (2 checks)");
  assert.equal(allRequiredPass(r), true);
});

test("CI: a newer failing or unfinished run of a check is not hidden by an older green one", () => {
  const green = run(LINT, "SUCCESS", "2026-10-10T14:34:37Z", "2026-10-10T14:34:57Z");
  for (const [state, newer] of [
    ["FAILURE", run(LINT, "FAILURE", "2026-10-10T14:37:20Z", "2026-10-10T14:38:15Z")],
    ["IN_PROGRESS", run(LINT, "", "2026-10-10T14:37:20Z", null)],
    ["CANCELLED", run(LINT, "CANCELLED", "2026-10-10T14:37:20Z", "2026-10-10T14:37:21Z")],
  ]) {
    for (const rollup of [[green, newer], [newer, green]]) {
      assert.deepEqual(evaluateChecks(rollup), { total: 1, bad: [{ name: LINT, state }] });
    }
  }
});

test("CI: runs are never merged across workflows, and unknown order keeps the failure", () => {
  const other = run(LINT, "FAILURE", "2026-10-10T14:00:00Z", "2026-10-10T14:01:00Z", "Other workflow");
  assert.deepEqual(evaluateChecks([other, ...RERUN]).bad, [{ name: LINT, state: "FAILURE" }]);
  const undated = [{ name: "t", conclusion: "FAILURE" }, { name: "t", conclusion: "SUCCESS" }];
  for (const rollup of [undated, [...undated].reverse()]) {
    assert.deepEqual(evaluateChecks(rollup), { total: 1, bad: [{ name: "t", state: "FAILURE" }] });
  }
  const statuses = [
    { context: "legacy", state: "FAILURE", startedAt: "2026-10-10T14:00:00Z" },
    { context: "legacy", state: "SUCCESS", startedAt: "2026-10-10T14:05:00Z" },
  ];
  assert.deepEqual(evaluateChecks(statuses), { total: 1, bad: [] });
});

test("readiness: an unreadable gate is reported as a read error, not as a missing status", () => {
  const r = evaluateReady(ready({ gate: { error: "HTTP 502: Bad Gateway" } }));
  const gate = r.find((x) => x.id === "gate");
  assert.equal(gate.level, "FAIL");
  assert.match(gate.text, /gate could not be read on aaaaaaaa \(read error, not a missing status; retry\): HTTP 502/);
  assert.doesNotMatch(gate.text, /gate missing/);
  assert.equal(allRequiredPass(r), false);
  assert.match(evaluateReady(ready({ gate: null })).find((x) => x.id === "gate").text, /^gate missing on aaaaaaaa$/);
});
