import test from "node:test";
import assert from "node:assert/strict";

import { evaluateGate, evaluatePullRequest } from "./review-gate-core.mjs";

// D-139 (issue #87, comment 6241681114): a critical QA PASS may come from a
// second Claude session when the reviewer is Claude too, but only with a
// Codex review on the current head, every Codex thread answered, and the
// declaration line naming that head.
const head = "a".repeat(40);
const other = "b".repeat(40);
const ownerLogin = "danielrisavi77-create";
const BASE = 1_800_000_000_000;
const MIN = 60 * 1000;
const iso = (ms) => new Date(BASE + ms).toISOString();
const CODEX_BOT = { login: "chatgpt-codex-connector[bot]", type: "Bot" };

const byOwner = (body, ms, slug = "claude") => ({
  body,
  user: { login: ownerLogin },
  author_association: "OWNER",
  performed_via_github_app: { slug },
  created_at: iso(ms),
});
const reviewPass = (ms = 10 * MIN) =>
  byOwner(`Agent-Review: claude:b:reviewer\nReview-Head: ${head}\nReview-Verdict: PASS\n`, ms);
const line = (sha = head) => `Provider-Fallback: claude-second-session — Codex review na headu ${sha}`;
const qa = ({ slot = "c", sha = head, fallback = line(head), verdict = "PASS" } = {}) =>
  byOwner(
    `QA-Agent: claude:${slot}:qa\nQA-Head: ${sha}\nQA-Verdict: ${verdict}\nQA-Scope: offline + wrong actor\n${fallback ? `${fallback}\n` : ""}`,
    20 * MIN,
  );
const codexReview = (commit = head, extra = {}) => ({
  user: CODEX_BOT,
  state: "COMMENTED",
  commit_id: commit,
  submitted_at: iso(5 * MIN),
  ...extra,
});
const thread = (id) => ({ id, user: CODEX_BOT, in_reply_to_id: null, created_at: iso(6 * MIN) });
const reply = (id, to, user = { login: ownerLogin, type: "User" }, association = "OWNER") => ({
  id,
  user,
  author_association: association,
  in_reply_to_id: to,
  created_at: iso(7 * MIN),
});

const AUTHOR = "Agent: claude:a:platforma\nRisk: critical\nTask: B-1\n";
const evaluate = ({ comments, prReviews = [codexReview()], reviewComments = [], body = AUTHOR } = {}) =>
  evaluateGate({ body, headSha: head, ownerLogin, comments, prReviews, reviewComments });
const ok = [reviewPass(), qa()];

test("control: Claude review and Claude QA without the D-139 evidence stay pending", () => {
  assert.equal(evaluate({ comments: [reviewPass(), qa({ fallback: "" })] }).state, "pending");
});

test("passes with distinct slots, Codex review on head, all Codex threads answered", () => {
  const result = evaluate({ comments: ok, reviewComments: [thread(1), reply(2, 1)] });
  assert.equal(result.state, "success");
  assert.match(result.description, /second Claude session/);
});

test("passes when Codex left no thread at all", () => {
  assert.equal(evaluate({ comments: ok }).state, "success");
});

test("every Codex thread needs its own answer", () => {
  assert.equal(evaluate({ comments: ok, reviewComments: [thread(1), reply(2, 1), thread(3)] }).state, "pending");
});

test("an unanswered Codex thread blocks", () => {
  assert.equal(evaluate({ comments: ok, reviewComments: [thread(1)] }).state, "pending");
});

test("a reply by Codex itself does not answer its thread", () => {
  assert.equal(evaluate({ comments: ok, reviewComments: [thread(1), reply(2, 1, CODEX_BOT)] }).state, "pending");
});

test("a reply to a different thread does not answer", () => {
  assert.equal(evaluate({ comments: ok, reviewComments: [thread(1), reply(3, 2)] }).state, "pending");
});

test("no Codex review, or one on another head, blocks", () => {
  assert.equal(evaluate({ comments: ok, prReviews: [] }).state, "pending");
  assert.equal(evaluate({ comments: ok, prReviews: [codexReview(other)] }).state, "pending");
});

test("a Codex-looking review from a non-bot or another bot is no evidence", () => {
  const forged = codexReview(head, { user: { login: "chatgpt-codex-connector[bot]", type: "User" } });
  assert.equal(evaluate({ comments: ok, prReviews: [forged] }).state, "pending");
  const lookalike = codexReview(head, { user: { login: "other[bot]", type: "Bot" } });
  assert.equal(evaluate({ comments: ok, prReviews: [lookalike] }).state, "pending");
});

test("a dismissed or pending Codex review is no evidence", () => {
  for (const state of ["DISMISSED", "PENDING"]) {
    assert.equal(evaluate({ comments: ok, prReviews: [codexReview(head, { state })] }).state, "pending", state);
  }
});

test("the declaration must name the current head in full", () => {
  for (const fallback of [line(other), line(head.slice(0, 7)), `${line(head)} extra`]) {
    assert.equal(evaluate({ comments: [reviewPass(), qa({ fallback })] }).state, "pending", fallback);
  }
});

test("the declaration wording is fixed", () => {
  for (const fallback of [
    `Provider-Fallback: claude-second-session — kvota ${head}`,
    `Provider-Fallback: claude — Codex review na headu ${head}`,
    `Provider-Fallback: claude-second-session Codex review na headu ${head}`,
  ]) {
    assert.equal(evaluate({ comments: [reviewPass(), qa({ fallback })] }).state, "pending", fallback);
  }
});

test("the QA slot must differ from author and reviewer, case-insensitively", () => {
  for (const slot of ["a", "A", "b", "B"]) {
    assert.equal(evaluate({ comments: [reviewPass(), qa({ slot })] }).state, "pending", slot);
  }
});

test("a carried declaration needs the Codex review on the declared head, not on the current one", () => {
  const result = evaluateGate({
    body: AUTHOR,
    headSha: head,
    ownerLogin,
    comments: [reviewPass(), qa({ sha: other, fallback: line(other) })],
    prReviews: [codexReview()],
    reviewComments: [],
    carriedHeads: new Set([other]),
  });
  assert.equal(result.state, "pending");
});

test("a QA FAIL from any valid session still blocks", () => {
  assert.equal(evaluate({ comments: [...ok, qa({ slot: "d", verdict: "FAIL" })] }).state, "pending");
});

test("missing review comment data fails closed", () => {
  const result = evaluateGate({ body: AUTHOR, headSha: head, ownerLogin, comments: ok, prReviews: [codexReview()] });
  assert.equal(result.state, "pending");
});

test("non-critical risk is unaffected by the declaration", () => {
  const body = "Agent: claude:a:backend\nRisk: standard\nTask: B-1\n";
  assert.equal(evaluate({ comments: [reviewPass()], body }).state, "success");
});

test("evaluatePullRequest passes the review comments through to the gate", () => {
  const pr = { body: AUTHOR, head: { sha: head }, changed_files: 1 };
  const files = [{ filename: "scripts/engineering/review-gate-core.mjs", status: "modified", patch: "x" }];
  const run = (reviewComments) =>
    evaluatePullRequest({ pr, files, comments: ok, prReviews: [codexReview()], reviewComments, ownerLogin }).result;
  assert.equal(run([thread(1)]).state, "pending");
  assert.equal(run([thread(1), reply(2, 1)]).state, "success");
});

test("only the PR author answers a Codex thread: bots and outsiders do not", () => {
  const bot = { login: "ductus-botovi[bot]", type: "Bot" };
  const outsider = { login: "random-outsider", type: "User" };
  assert.equal(evaluate({ comments: ok, reviewComments: [thread(1), reply(2, 1, bot, "NONE")] }).state, "pending");
  assert.equal(evaluate({ comments: ok, reviewComments: [thread(1), reply(2, 1, outsider, "NONE")] }).state, "pending");
  // a bot posing with an owner association is still a bot
  assert.equal(evaluate({ comments: ok, reviewComments: [thread(1), reply(2, 1, bot, "OWNER")] }).state, "pending");
});

test("the author login also answers when its association is not OWNER", () => {
  const author = { login: "pr-author", type: "User" };
  const result = evaluateGate({
    body: AUTHOR, headSha: head, ownerLogin, comments: ok, prReviews: [codexReview()],
    reviewComments: [thread(1), reply(2, 1, author, "COLLABORATOR")], authorLogin: "pr-author",
  });
  assert.equal(result.state, "success");
});

test("the declaration wording is case-exact apart from the SHA", () => {
  for (const fallback of [
    `Provider-Fallback: CLAUDE-SECOND-SESSION — CODEX REVIEW NA HEADU ${head}`,
    `Provider-Fallback: claude-second-session — codex review na headu ${head}`,
  ]) {
    assert.equal(evaluate({ comments: [reviewPass(), qa({ fallback })] }).state, "pending", fallback);
  }
  assert.equal(evaluate({ comments: [reviewPass(), qa({ fallback: line(head.toUpperCase()) })] }).state, "success");
});

test("the QA session must not have reviewed this PR on any head with any verdict", () => {
  const oldFail = byOwner(`Agent-Review: claude:c:reviewer
Review-Head: ${other}
Review-Verdict: FAIL
`, 1 * MIN);
  assert.equal(evaluate({ comments: [oldFail, ...ok] }).state, "pending");
  const oldPass = byOwner(`Agent-Review: claude:C:reviewer
Review-Head: ${other}
Review-Verdict: PASS
`, 1 * MIN);
  assert.equal(evaluate({ comments: [oldPass, ...ok] }).state, "pending");
});
