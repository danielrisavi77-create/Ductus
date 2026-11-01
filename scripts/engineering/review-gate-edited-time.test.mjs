import test from "node:test";
import assert from "node:assert/strict";

import { evaluateGate } from "./review-gate-core.mjs";

// #129: a comment's time is the time of its last edit. An edit does not move
// `created_at`, so a comment created inside the quota window and rewritten
// into a PASS long after would otherwise never leave the window, and an old
// verdict rewritten later would not count as the newest one of its principal.
const head = "a".repeat(40);
const ownerLogin = "danielrisavi77-create";
const BASE = 1_800_000_000_000;
const iso = (ms) => new Date(BASE + ms).toISOString();
const HOUR = 3600 * 1000;

const prBody = (risk) => `Agent: chatgpt:a:backend\nRisk: ${risk}\nTask: B-1\n`;
const byOwner = (body, createdMs, updatedMs) => ({
  body,
  user: { login: ownerLogin },
  author_association: "OWNER",
  performed_via_github_app: { slug: "claude" },
  created_at: iso(createdMs),
  ...(updatedMs === undefined ? {} : { updated_at: iso(updatedMs) }),
});
const review = (agent, verdict, createdMs, updatedMs) =>
  byOwner(`Agent-Review: ${agent}\nReview-Head: ${head}\nReview-Verdict: ${verdict}\n`, createdMs, updatedMs);
const fallbackQa = (createdMs, updatedMs) =>
  byOwner(
    `QA-Agent: claude:c:qa\nQA-Head: ${head}\nQA-Verdict: PASS\nQA-Scope: offline + wrong actor\nProvider-Fallback: chatgpt-codex-connector\n`,
    createdMs,
    updatedMs,
  );
const codexQuota = (createdMs) => ({
  body: "You have reached your Codex usage limits for code reviews.",
  user: { login: "chatgpt-codex-connector[bot]", type: "Bot" },
  author_association: "NONE",
  performed_via_github_app: { slug: "chatgpt-codex-connector" },
  created_at: iso(createdMs),
  updated_at: iso(createdMs),
});
const evaluate = (comments, risk = "critical") =>
  evaluateGate({ body: prBody(risk), headSha: head, ownerLogin, comments });

test("control: a fallback QA within the window, never edited, passes", () => {
  const result = evaluate([codexQuota(0), review("claude:b:reviewer", "PASS", HOUR), fallbackQa(60_000, 60_000)]);
  assert.equal(result.state, "success");
});

test("a fallback QA created inside the window and edited outside it does not pass (#129)", () => {
  const result = evaluate([
    codexQuota(0),
    review("claude:b:reviewer", "PASS", 240 * HOUR),
    fallbackQa(60_000, 240 * HOUR),
  ]);
  assert.equal(result.state, "pending");
});

// F-012 (owner decision 1. 11. 2026.) replaces the #129 case "an edit inside
// the window keeps the fallback valid": an edited PASS never counts, inside the
// window or not. The unedited control above still passes.
test("an edited fallback QA PASS does not pass, even inside the window (F-012)", () => {
  const result = evaluate([codexQuota(0), review("claude:b:reviewer", "PASS", HOUR), fallbackQa(60_000, 2 * HOUR)]);
  assert.equal(result.state, "pending");
});

test("the newest verdict of a principal is the one edited last (#129)", () => {
  // PASS written at 2 h; an older comment of the same principal rewritten to
  // FAIL at 3 h is the principal's latest word.
  const result = evaluate(
    [review("claude:b:reviewer", "FAIL", HOUR, 3 * HOUR), review("claude:b:reviewer", "PASS", 2 * HOUR)],
    "standard",
  );
  assert.equal(result.state, "pending");
});

test("a comment without updated_at keeps its created_at (#129)", () => {
  const result = evaluate([review("claude:b:reviewer", "PASS", HOUR)], "standard");
  assert.equal(result.state, "success");
});

// F-012: the App is fixed when a comment is created, its text is not. An edited
// comment never gives a PASS; an edited FAIL or BLOCK still holds.
test("an edited review PASS does not count; the same comment unedited does (F-012)", () => {
  assert.equal(evaluate([review("claude:b:reviewer", "PASS", HOUR)], "standard").state, "success");
  assert.equal(evaluate([review("claude:b:reviewer", "PASS", HOUR, HOUR)], "standard").state, "success");
  assert.equal(evaluate([review("claude:b:reviewer", "PASS", HOUR, HOUR + 1)], "standard").state, "pending");
  assert.equal(evaluate([review("claude:b:reviewer", "PASS", HOUR, 5 * HOUR)], "standard").state, "pending");
});

test("an edited PASS does not lift an earlier FAIL of the same principal (F-012)", () => {
  const result = evaluate(
    [review("claude:b:reviewer", "FAIL", HOUR), review("claude:b:reviewer", "PASS", 2 * HOUR, 3 * HOUR)],
    "standard",
  );
  assert.equal(result.state, "pending");
});

test("an edited FAIL or BLOCK still blocks (F-012)", () => {
  for (const verdict of ["FAIL", "BLOCK"]) {
    const result = evaluate(
      [review("claude:b:reviewer", "PASS", HOUR), review("claude:c:reviewer", verdict, 2 * HOUR, 3 * HOUR)],
      "standard",
    );
    assert.notEqual(result.state, "success", verdict);
  }
});

test("an edited QA PASS on a critical PR leaves the gate pending (F-012)", () => {
  const qa = (updatedMs) =>
    byOwner(`QA-Agent: codex:q:qa\nQA-Head: ${head}\nQA-Verdict: PASS\nQA-Scope: synthetic\n`, 2 * HOUR, updatedMs);
  const codexApp = (c) => ({ ...c, performed_via_github_app: { slug: "chatgpt-codex-connector" } });
  assert.equal(evaluate([review("claude:b:reviewer", "PASS", HOUR), codexApp(qa(2 * HOUR))]).state, "success");
  assert.equal(evaluate([review("claude:b:reviewer", "PASS", HOUR), codexApp(qa(4 * HOUR))]).state, "pending");
});

test("an edit time without a readable creation time counts as an edit (F-012)", () => {
  const noCreated = { ...review("claude:b:reviewer", "PASS", HOUR), created_at: "garbage", updated_at: iso(5 * HOUR) };
  assert.equal(evaluate([noCreated], "standard").state, "pending");
  // No edit time at all keeps the creation time (#129) and counts.
  assert.equal(evaluate([review("claude:b:reviewer", "PASS", HOUR)], "standard").state, "success");
});