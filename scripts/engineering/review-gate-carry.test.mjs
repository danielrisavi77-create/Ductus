import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_CARRIED_HEADS,
  MAX_MERGE_STEPS,
  carriedHeadCandidates,
  evaluateGate,
  evaluatePullRequest,
  onlyBaseMerges,
  sameChange,
} from "./review-gate-core.mjs";

const head = "a".repeat(40);
const earlier = "b".repeat(40);
const ownerLogin = "danielrisavi77-create";
const body = (risk = "standard") => `Agent: claude:a:backend\nRisk: ${risk}\nTask: B-1\n`;

let counter = 0;
const comment = (text, { appSlug = "claude", login = "claude[bot]", association = "COLLABORATOR" } = {}) => ({
  body: text,
  user: { login },
  author_association: association,
  performed_via_github_app: appSlug ? { slug: appSlug } : null,
  created_at: new Date(1_700_000_000_000 + counter++ * 1000).toISOString(),
});
const review = (sha, verdict = "PASS") =>
  comment(`Agent-Review: claude:b:reviewer\nReview-Head: ${sha}\nReview-Verdict: ${verdict}\n`);
const qa = (sha, verdict = "PASS") =>
  comment(`QA-Agent: chatgpt:c:qa\nQA-Head: ${sha}\nQA-Verdict: ${verdict}\nQA-Scope: offline\n`, {
    appSlug: "chatgpt-codex-connector",
    login: "chatgpt-codex-connector[bot]",
  });
const override = (sha) =>
  comment(`Owner-Override: PASS\nOverride-Head: ${sha}\nOverride-Reason: demo\n`, {
    appSlug: null,
    login: ownerLogin,
    association: "OWNER",
  });

const file = (filename, patch = "@@ -1 +1 @@\n-a\n+b") => ({ filename, status: "modified", patch, sha: "1".repeat(40) });

test("verdicts on a carried earlier head count for the current head", () => {
  const comments = [review(earlier), qa(earlier)];
  const carried = evaluateGate({ body: body("critical"), headSha: head, ownerLogin, comments, carriedHeads: new Set([earlier]) });
  assert.equal(carried.state, "success");
  const strict = evaluateGate({ body: body("critical"), headSha: head, ownerLogin, comments });
  assert.equal(strict.state, "pending");
});

test("a carried FAIL holds the gate like a current one", () => {
  const result = evaluateGate({
    body: body(),
    headSha: head,
    ownerLogin,
    comments: [review(earlier, "FAIL")],
    carriedHeads: new Set([earlier]),
  });
  assert.equal(result.state, "pending");
  assert.match(result.description, /fail/);
});

test("Owner Override never carries to a later head", () => {
  const result = evaluateGate({
    body: body(),
    headSha: head,
    ownerLogin,
    comments: [override(earlier)],
    carriedHeads: new Set([earlier]),
  });
  assert.equal(result.state, "pending");
});

test("candidates are trusted canonical heads, newest first, without the current head", () => {
  const outsider = comment(`Agent-Review: claude:b:reviewer\nReview-Head: ${"c".repeat(40)}\nReview-Verdict: PASS\n`, {
    association: "NONE",
  });
  const fenced = comment(`\`\`\`\nAgent-Review: claude:b:reviewer\nReview-Head: ${"d".repeat(40)}\nReview-Verdict: PASS\n\`\`\`\n`);
  const heads = carriedHeadCandidates(
    [review(earlier), outsider, fenced, qa(head), review("E".repeat(40)), qa(earlier)],
    head,
  );
  assert.deepEqual(heads, [earlier, "e".repeat(40)]);
});

test("candidates are capped", () => {
  const comments = Array.from({ length: 9 }, (_, i) => review(String(i).repeat(40)));
  assert.equal(carriedHeadCandidates(comments, head).length, MAX_CARRIED_HEADS);
});

test("only merge commits on the first-parent path allow a carry", () => {
  const merge = (sha) => ({ sha, parents: [{}, {}] });
  const plain = (sha) => ({ sha, parents: [{}] });
  assert.equal(onlyBaseMerges([merge(head), merge("c".repeat(40)), plain(earlier)], earlier), true);
  assert.equal(onlyBaseMerges([merge(head), plain("c".repeat(40)), plain(earlier)], earlier), false);
  assert.equal(onlyBaseMerges([plain(head), plain(earlier)], earlier), false);
  assert.equal(onlyBaseMerges([merge(head), merge("c".repeat(40))], earlier), false);
  assert.equal(onlyBaseMerges([plain(earlier)], earlier), false);
  const long = Array.from({ length: MAX_MERGE_STEPS + 1 }, (_, i) => merge(String(i % 10).repeat(40)));
  assert.equal(onlyBaseMerges([...long, plain(earlier)], earlier), false);
  assert.equal(onlyBaseMerges(undefined, earlier), false);
});

test("the PR diff must be identical file by file", () => {
  const current = { files: [file("a.mjs"), file("b.md")] };
  assert.equal(sameChange(current, { files: [file("b.md"), file("a.mjs")] }), true);
  assert.equal(sameChange(current, { files: [file("a.mjs"), file("b.md", "@@ -1 +1 @@\n-a\n+c")] }), false);
  assert.equal(sameChange(current, { files: [file("a.mjs")] }), false);
  assert.equal(sameChange({ files: [] }, { files: [] }), false);
  const big = { files: Array.from({ length: 300 }, (_, i) => file(`f${i}`)) };
  assert.equal(sameChange(big, big), false);
});

test("a file without a patch compares by blob SHA", () => {
  const binary = (sha) => ({ filename: "x.png", status: "modified", sha });
  assert.equal(sameChange({ files: [binary("1".repeat(40))] }, { files: [binary("1".repeat(40))] }), true);
  assert.equal(sameChange({ files: [binary("1".repeat(40))] }, { files: [binary("2".repeat(40))] }), false);
});

test("evaluatePullRequest passes carried heads to the gate", () => {
  const pr = { body: body(), head: { sha: head }, changed_files: 1, auto_merge: null };
  const files = [{ filename: "apps/web/a.ts", status: "modified" }];
  const comments = [review(earlier)];
  const carried = evaluatePullRequest({ pr, files, comments, ownerLogin, carriedHeads: new Set([earlier]) });
  assert.equal(carried.result.state, "success");
  const strict = evaluatePullRequest({ pr, files, comments, ownerLogin });
  assert.equal(strict.result.state, "pending");
});
