import test from "node:test";
import assert from "node:assert/strict";

import { evaluateGate, prNumberFromEvent } from "./review-gate-core.mjs";

// #128: quota evidence holds only while the exhausted App shows nothing else.
// A. A later comment of the same App that is not a quota message proves it
//    works again, so the earlier evidence no longer counts.
// B. The message counts only as the opening of the App's comment; the phrase
//    quoted inside a review, a code block or a reply is no evidence.
const head = "a".repeat(40);
const ownerLogin = "danielrisavi77-create";
const BASE = 1_800_000_000_000;
const MIN = 60 * 1000;
const iso = (ms) => new Date(BASE + ms).toISOString();
const QUOTA = "You have reached your Codex usage limits for code reviews. Ask an admin to raise the limit.";

const codex = (body, ms, extra = {}) => ({
  body,
  user: { login: "chatgpt-codex-connector[bot]", type: "Bot" },
  author_association: "NONE",
  performed_via_github_app: { slug: "chatgpt-codex-connector" },
  created_at: iso(ms),
  ...extra,
});
const byOwner = (body, ms, slug = "claude") => ({
  body,
  user: { login: ownerLogin },
  author_association: "OWNER",
  performed_via_github_app: { slug },
  created_at: iso(ms),
});
const review = (ms) => byOwner(`Agent-Review: claude:b:reviewer\nReview-Head: ${head}\nReview-Verdict: PASS\n`, ms);
const fallbackQa = (ms) =>
  byOwner(
    `QA-Agent: claude:c:qa\nQA-Head: ${head}\nQA-Verdict: PASS\nQA-Scope: offline + wrong actor\nProvider-Fallback: chatgpt-codex-connector\n`,
    ms,
  );
const evaluate = (comments) =>
  evaluateGate({ body: "Agent: chatgpt:a:backend\nRisk: critical\nTask: B-1\n", headSha: head, ownerLogin, comments });

test("control: a quota message alone still allows the fallback", () => {
  assert.equal(evaluate([codex(QUOTA, 0), review(10 * MIN), fallbackQa(20 * MIN)]).state, "success");
});

test("control: a later quota message of the same App keeps the evidence (#128)", () => {
  assert.equal(evaluate([codex(QUOTA, 0), codex(QUOTA, 5 * MIN), review(10 * MIN), fallbackQa(20 * MIN)]).state, "success");
});

test("A: a later ordinary comment of the exhausted App voids the evidence (#128)", () => {
  // Shape of PR #97: quota message, then a real Codex review summary.
  const summary = codex("### Codex Review Summary\n\nDidn't find any major issues.", 5 * MIN);
  assert.equal(evaluate([codex(QUOTA, 0), summary, review(10 * MIN), fallbackQa(20 * MIN)]).state, "pending");
});

test("A: an ordinary comment the App posts after the QA also voids it (#128)", () => {
  const summary = codex("Codex Review: Didn't find any major issues.", 30 * MIN);
  assert.equal(evaluate([codex(QUOTA, 0), review(10 * MIN), fallbackQa(20 * MIN), summary]).state, "pending");
});

test("A: an ordinary comment of the App before the quota message does not void it (#128)", () => {
  const earlier = codex("Codex Review: Didn't find any major issues.", -60 * MIN);
  assert.equal(evaluate([earlier, codex(QUOTA, 0), review(10 * MIN), fallbackQa(20 * MIN)]).state, "success");
});

test("A: an old quota message edited into an ordinary comment is no evidence (#128)", () => {
  const edited = codex("Codex Review: Didn't find any major issues.", 0, { updated_at: iso(5 * MIN) });
  assert.equal(evaluate([edited, review(10 * MIN), fallbackQa(20 * MIN)]).state, "pending");
});

test("B: the phrase anywhere but at the opening of the comment is no evidence (#128)", () => {
  for (const body of [
    "```\nYou have reached your Codex usage limits\n```",
    "Codex Review: Didn't find any major issues. The gate matches `reached your Codex usage limits`.",
    "> You have reached your Codex usage limits\n\nAs requested, the sentence above.",
    "Sure: You have reached your Codex usage limits",
  ]) {
    assert.equal(evaluate([codex(body, 0), review(10 * MIN), fallbackQa(20 * MIN)]).state, "pending", body);
  }
});

test("B: leading whitespace before the message is still the opening (#128)", () => {
  assert.equal(evaluate([codex(`\n  ${QUOTA}`, 0), review(10 * MIN), fallbackQa(20 * MIN)]).state, "success");
});

// C (owner decision, #128 issuecomment-6123209198): the fallback needs valid
// quota evidence for any one other registered App, not for every other App.
// Grok has no registered quota message, yet Grok review + Grok QA may pass on
// Codex evidence alone.
test("C: Grok review and Grok QA pass on Codex quota evidence alone (#128)", () => {
  const grokReview = byOwner(`Agent-Review: grok:b:reviewer\nReview-Head: ${head}\nReview-Verdict: PASS\n`, 10 * MIN, "grok-by-xai");
  const grokQa = byOwner(
    `QA-Agent: grok:c:qa\nQA-Head: ${head}\nQA-Verdict: PASS\nQA-Scope: offline + wrong actor\nProvider-Fallback: chatgpt-codex-connector\n`,
    20 * MIN,
    "grok-by-xai",
  );
  assert.equal(evaluate([codex(QUOTA, 0), grokReview, grokQa]).state, "success");
  assert.equal(evaluate([grokReview, grokQa]).state, "pending");
});

// Real shape of PR #97 (review FAIL on this PR, 12 Oct 2026): Codex keeps one
// "Codex Review Summary" comment and edits it in place, and posts the review
// itself as a PR review, which the issue comments list never shows.
const evaluateWithReviews = (comments, reviews) =>
  evaluateGate({ body: "Agent: chatgpt:a:backend\nRisk: critical\nTask: B-1\n", headSha: head, ownerLogin, comments, prReviews: reviews });
const codexReview = (ms, user = { login: "chatgpt-codex-connector[bot]", type: "Bot" }) => ({
  user,
  state: "COMMENTED",
  body: "Codex Review",
  submitted_at: iso(ms),
});

test("A: a summary created before the quota message and edited after it voids the evidence (#128)", () => {
  const summary = codex("### Codex Review Summary\n\nCompleted.", -10 * MIN, { updated_at: iso(5 * MIN) });
  assert.equal(evaluate([summary, codex(QUOTA, 0), review(10 * MIN), fallbackQa(20 * MIN)]).state, "pending");
});

test("control: a summary edited before the quota message keeps the evidence (#128)", () => {
  const summary = codex("### Codex Review Summary\n\nCompleted.", -10 * MIN, { updated_at: iso(-5 * MIN) });
  assert.equal(evaluate([summary, codex(QUOTA, 0), review(10 * MIN), fallbackQa(20 * MIN)]).state, "success");
});

test("A: a PR review of the exhausted App after the quota message voids the evidence (#128)", () => {
  const comments = [codex(QUOTA, 0), review(10 * MIN), fallbackQa(20 * MIN)];
  assert.equal(evaluateWithReviews(comments, [codexReview(5 * MIN)]).state, "pending");
  assert.equal(evaluateWithReviews(comments, [codexReview(30 * MIN)]).state, "pending");
});

test("control: an earlier PR review of the App, or one by another account, keeps the evidence (#128)", () => {
  const comments = [codex(QUOTA, 0), review(10 * MIN), fallbackQa(20 * MIN)];
  assert.equal(evaluateWithReviews(comments, [codexReview(-5 * MIN)]).state, "success");
  assert.equal(evaluateWithReviews(comments, [codexReview(5 * MIN, { login: "chatgpt-codex-connector[bot]", type: "User" })]).state, "success");
  assert.equal(evaluateWithReviews(comments, [codexReview(5 * MIN, { login: ownerLogin, type: "User" })]).state, "success");
});

test("A: a PR review of the App with an unreadable time voids the evidence, failing closed (#128)", () => {
  const comments = [codex(QUOTA, 0), review(10 * MIN), fallbackQa(20 * MIN)];
  assert.equal(evaluateWithReviews(comments, [{ ...codexReview(0), submitted_at: null }]).state, "pending");
});

test("the runner finds the PR of a relayed review, and nothing else (#128)", () => {
  assert.equal(prNumberFromEvent({ pull_request: { number: 7 } }), 7);
  assert.equal(prNumberFromEvent({ issue: { number: 8, pull_request: {} } }), 8);
  assert.equal(prNumberFromEvent({ issue: { number: 9 } }), null);
  assert.equal(prNumberFromEvent({ workflow_run: { pull_requests: [{ number: 295 }] } }), 295);
  // A fork head lists no PR, and more than one PR is ambiguous: evaluate nothing.
  assert.equal(prNumberFromEvent({ workflow_run: { pull_requests: [] } }), null);
  assert.equal(prNumberFromEvent({ workflow_run: { pull_requests: [{ number: 1 }, { number: 2 }] } }), null);
  assert.equal(prNumberFromEvent({ workflow_run: { pull_requests: [{ number: "3" }] } }), null);
});
