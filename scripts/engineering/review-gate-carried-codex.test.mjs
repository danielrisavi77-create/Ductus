import test from "node:test";
import assert from "node:assert/strict";

import { carriedHeadCandidates, evaluateGate, sameChange } from "./review-gate-core.mjs";

// D-101 extended to the D-139 path (owner, #87 issuecomment-6292451022): the
// Codex review and the Provider-Fallback head on an earlier head count for the
// current head when the runner confirmed that head as carried. Codex threads
// stay judged live; every other D-139 element stays required.
const head = "a".repeat(40);
const old = "b".repeat(40);
const older = "c".repeat(40);
const ownerLogin = "danielrisavi77-create";
const BASE = 1_800_000_000_000;
const MIN = 60 * 1000;
const iso = (ms) => new Date(BASE + ms).toISOString();
const CODEX_BOT = { login: "chatgpt-codex-connector[bot]", type: "Bot" };

const byOwner = (body, ms) => ({
  body,
  user: { login: ownerLogin },
  author_association: "OWNER",
  performed_via_github_app: { slug: "claude" },
  created_at: iso(ms),
});
const line = (sha) => `Provider-Fallback: claude-second-session — Codex review na headu ${sha}`;
const review = (sha, slot = "b") =>
  byOwner(`Agent-Review: claude:${slot}:reviewer\nReview-Head: ${sha}\nReview-Verdict: PASS\n`, 10 * MIN);
const qa = ({ sha = old, declared = sha, slot = "c", verdict = "PASS" } = {}) =>
  byOwner(
    `QA-Agent: claude:${slot}:qa\nQA-Head: ${sha}\nQA-Verdict: ${verdict}\nQA-Scope: x\n${declared ? `${line(declared)}\n` : ""}`,
    20 * MIN,
  );
const codexReview = (commit) => ({ user: CODEX_BOT, state: "COMMENTED", commit_id: commit, submitted_at: iso(5 * MIN) });
const summary = (sha, extra = {}) => ({
  id: 1,
  body: `<!-- codex-pull-request-review-summary -->\n<!-- codex-review-state:v1 ${JSON.stringify({
    code_review: { commit_sha: sha, has_any_findings: false, has_unresolved_findings: false, status: "completed", ...extra },
    security_review: { commit_sha: null, has_any_findings: null, has_unresolved_findings: null, status: null },
  })} -->\n`,
  user: CODEX_BOT,
  performed_via_github_app: { slug: "chatgpt-codex-connector" },
  created_at: iso(5 * MIN),
  updated_at: iso(6 * MIN),
});
const thread = (id) => ({ id, user: CODEX_BOT, in_reply_to_id: null });
const reply = (id, to) => ({ id, user: { login: ownerLogin, type: "User" }, author_association: "OWNER", in_reply_to_id: to });

const AUTHOR = "Agent: claude:a:platforma\nRisk: critical\nTask: B-1\n";
const evaluate = ({
  comments = [review(old), qa()],
  prReviews = [codexReview(old)],
  reviewComments = [],
  carried = [old],
} = {}) =>
  evaluateGate({
    body: AUTHOR,
    headSha: head,
    ownerLogin,
    comments,
    prReviews,
    reviewComments,
    carriedHeads: new Set(carried),
  });

test("QA, review, declaration and Codex review all on a carried head pass", () => {
  const result = evaluate();
  assert.equal(result.state, "success");
  assert.match(result.description, /second Claude session/);
  assert.match(result.description, /Carried from bbbbbbb/);
});

test("a clean Codex summary on the carried head counts as well", () => {
  assert.equal(evaluate({ prReviews: [], comments: [review(old), qa(), summary(old)] }).state, "success");
});

test("a current-head QA may declare a carried Codex head", () => {
  const comments = [review(head), qa({ sha: head, declared: old })];
  assert.equal(evaluate({ comments }).state, "success");
});

test("a head the runner did not confirm as carried carries nothing", () => {
  assert.equal(evaluate({ carried: [] }).state, "pending");
  assert.equal(evaluate({ carried: [older] }).state, "pending");
});

test("the Codex review must be on the declared head, not on another earlier one", () => {
  assert.equal(evaluate({ prReviews: [codexReview(older)], carried: [old, older] }).state, "pending");
  assert.equal(evaluate({ comments: [review(old), qa({ declared: older })], carried: [old, older] }).state, "pending");
});

test("a carried declaration still needs Codex proof on that head", () => {
  assert.equal(evaluate({ prReviews: [] }).state, "pending");
  assert.equal(evaluate({ prReviews: [], comments: [review(old), qa(), summary(old, { has_any_findings: true })] }).state, "pending");
});

test("Codex threads are still judged live on a carried head", () => {
  assert.equal(evaluate({ reviewComments: [thread(1)] }).state, "pending");
  assert.equal(evaluate({ reviewComments: [thread(1), reply(2, 1)] }).state, "success");
});

test("a QA FAIL or BLOCK on a carried head still blocks", () => {
  for (const verdict of ["FAIL", "BLOCK"]) {
    const comments = [review(old), qa(), qa({ slot: "d", verdict })];
    assert.equal(evaluate({ comments }).state, "pending", verdict);
  }
});

test("the QA slot rules still apply to a carried QA", () => {
  for (const slot of ["a", "b"]) assert.equal(evaluate({ comments: [review(old), qa({ slot })] }).state, "pending", slot);
});

test("a declaration with a short or wrongly worded head carries nothing", () => {
  const comments = [review(old), qa({ declared: old.slice(0, 7) })];
  assert.equal(evaluate({ comments }).state, "pending");
});

test("the declaration head becomes a carry candidate, bounded by the same walk", () => {
  const plain = (sha) => ({ sha, parents: [{ sha: "0".repeat(40) }] });
  const merge = (sha) => ({ sha, parents: [{ sha: "1".repeat(40) }, { sha: "2".repeat(40) }], mergesBase: true });
  const path = [merge(head), merge(older), plain(old)];
  // QA on an earlier head that declares another earlier head: both are candidates
  const comments = [qa({ sha: older, declared: old })];
  const { heads } = carriedHeadCandidates(comments, head, path);
  assert.deepEqual([...heads].sort(), [old, older].sort());
  // a declared head off the first-parent walk is dropped
  assert.deepEqual(carriedHeadCandidates([qa({ sha: older, declared: "d".repeat(40) })], head, path).heads, [older]);
});

// D-157: moved line numbers are not a change; a real change is.
const diff = (patch, name = "a.ts") => ({ files: [{ filename: name, status: "modified", patch }] });
const body = "@@ -451,14 +451,14 @@ export const hr = {\n ctx1\n-old\n+new\n ctx2";
const shifted = "@@ -457,14 +457,14 @@ export const other = {\n ctx1\n-old\n+new\n ctx2";

test("a hunk shifted by the base branch is the same change", () => {
  assert.equal(sameChange(diff(body), diff(shifted)), true);
  assert.equal(sameChange(diff("@@ -1 +1 @@\n-a\n+b"), diff("@@ -9 +9 @@\n-a\n+b")), true);
});

test("a changed context line, added or removed line is not the same change", () => {
  assert.equal(sameChange(diff(body), diff(shifted.replace("ctx2", "ctxX"))), false);
  assert.equal(sameChange(diff(body), diff(shifted.replace("+new", "+newer"))), false);
  assert.equal(sameChange(diff(body), diff(shifted.replace("-old", "-older"))), false);
  assert.equal(sameChange(diff(body), diff(shifted.replace("\n-old", ""))), false);
});

test("a changed line count or hunk count is not the same change", () => {
  assert.equal(sameChange(diff(body), diff(shifted.replace("+457,14", "+457,15"))), false);
  assert.equal(sameChange(diff(body), diff(shifted.replace("-457,14", "-457,13"))), false);
  assert.equal(sameChange(diff(body), diff(`${shifted}\n@@ -600,1 +600,1 @@\n-x\n+y`)), false);
});

test("a content line that looks like a header is still compared", () => {
  assert.equal(sameChange(diff("@@ -1 +1 @@\n-a\n+@@ -5 +5 @@"), diff("@@ -2 +2 @@\n-a\n+@@ -6 +6 @@")), false);
});