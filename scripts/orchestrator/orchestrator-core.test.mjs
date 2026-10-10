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
    [".github/workflows/ci.yml", "scripts/engineering/a.mjs", "CLAUDE.md", ".claude/skills/x/SKILL.md", "lefthook.yml"],
  );
  assert.deepEqual(d97Matches(["xCLAUDE.md", ".github2/a"]), []);
  assert.deepEqual(d97ManualMatches(["docs/DECISIONS.md", "a"]), ["docs/DECISIONS.md"]);
});

test("push args reject force in every spelling", () => {
  assert.deepEqual(parsePushArgs([]), { remote: "origin", refspec: "HEAD" });
  assert.deepEqual(parsePushArgs(["origin", "HEAD:refs/heads/x"]), { remote: "origin", refspec: "HEAD:refs/heads/x" });
  for (const bad of [["--force"], ["-f"], ["--force-with-lease"], ["origin", "+HEAD"], ["origin", "a:+b"], ["origin", "a", "b"], ["--delete"], ["bad remote"]]) {
    assert.throws(() => parsePushArgs(bad), undefined, bad.join(" "));
  }
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
