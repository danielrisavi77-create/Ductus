import test from "node:test";
import assert from "node:assert/strict";

import { evaluateGate, field } from "./review-gate-core.mjs";

const head = "a".repeat(40);
const author = "claude:a:backend";
const ownerLogin = "danielrisavi77-create";

const prBody = (risk = "standard") =>
  `Agent: ${author}\nRisk: ${risk}\nTask: B-1\n`;

const entry = (body, {
  login = ownerLogin,
  association = "OWNER",
} = {}) => ({
  body,
  user: { login },
  author_association: association,
});

const review = (agent = "codex:b:reviewer", sha = head, meta = {}) =>
  entry(
    `Agent-Review: ${agent}\nReview-Head: ${sha}\nReview-Verdict: PASS\n`,
    meta,
  );

const qa = (agent = "claude:c:qa", sha = head, meta = {}) =>
  entry(
    `QA-Agent: ${agent}\nQA-Head: ${sha}\nQA-Verdict: PASS\nQA-Scope: offline + wrong actor\n`,
    meta,
  );

const evaluate = (input) =>
  evaluateGate({ ownerLogin, comments: [], reviews: [], ...input });

test("field reads exact metadata lines", () => {
  assert.equal(field("Risk: critical\nTask: B-8", "Risk"), "critical");
  assert.equal(field("Risky: low", "Risk"), null);
});

test("missing metadata fails closed", () => {
  assert.equal(evaluate({ body: "Risk: low", headSha: head }).state, "failure");
});

test("missing task fails closed", () => {
  assert.equal(
    evaluate({ body: `Agent: ${author}\nRisk: standard\n`, headSha: head }).state,
    "failure",
  );
});

test("missing owner identity fails closed", () => {
  assert.equal(
    evaluateGate({ body: prBody(), headSha: head }).state,
    "failure",
  );
});

test("unknown agent role fails closed", () => {
  assert.equal(
    evaluate({
      body: "Agent: claude:a:whatever\nRisk: low\nTask: X-1\n",
      headSha: head,
    }).state,
    "failure",
  );
});

test("ChatGPT is a valid runtime identity", () => {
  const result = evaluate({
    body: "Agent: chatgpt:a:orchestrator\nRisk: low\nTask: SYS-1\n",
    headSha: head,
    comments: [review()],
  });
  assert.equal(result.state, "success");
});

test("standard waits for review", () => {
  assert.equal(evaluate({ body: prBody(), headSha: head }).state, "pending");
});

test("author cannot review own PR", () => {
  const result = evaluate({
    body: prBody(),
    headSha: head,
    comments: [review("claude:a:backend")],
  });
  assert.equal(result.state, "pending");
});

test("review is bound to the current head", () => {
  const result = evaluate({
    body: prBody(),
    headSha: head,
    comments: [review("codex:b:reviewer", "b".repeat(40))],
  });
  assert.equal(result.state, "pending");
});

test("untrusted outsider cannot spoof a review PASS", () => {
  const result = evaluate({
    body: prBody(),
    headSha: head,
    comments: [review("codex:b:reviewer", head, {
      login: "outsider",
      association: "NONE",
    })],
  });
  assert.equal(result.state, "pending");
});

test("trusted collaborator review can satisfy the gate", () => {
  const result = evaluate({
    body: prBody(),
    headSha: head,
    comments: [review("codex:b:reviewer", head, {
      login: "trusted-reviewer",
      association: "COLLABORATOR",
    })],
  });
  assert.equal(result.state, "success");
});

test("standard passes with independent owner-posted review", () => {
  const result = evaluate({
    body: prBody(),
    headSha: head,
    comments: [review()],
  });
  assert.equal(result.state, "success");
});

test("critical also requires independent QA", () => {
  const waiting = evaluate({
    body: prBody("critical"),
    headSha: head,
    comments: [review()],
  });
  assert.equal(waiting.state, "pending");

  const passing = evaluate({
    body: prBody("critical"),
    headSha: head,
    comments: [review(), qa()],
  });
  assert.equal(passing.state, "success");
});

test("QA cannot be the reviewer", () => {
  const reviewer = "codex:b:reviewer";
  const result = evaluate({
    body: prBody("critical"),
    headSha: head,
    comments: [
      review(reviewer),
      entry(
        `QA-Agent: ${reviewer}\nQA-Head: ${head}\nQA-Verdict: PASS\nQA-Scope: test\n`,
      ),
    ],
  });
  assert.equal(result.state, "pending");
});

test("outsider cannot spoof critical QA", () => {
  const result = evaluate({
    body: prBody("critical"),
    headSha: head,
    comments: [
      review(),
      qa("claude:c:qa", head, { login: "outsider", association: "NONE" }),
    ],
  });
  assert.equal(result.state, "pending");
});

test("owner override must target the current head and include a reason", () => {
  const result = evaluate({
    body: prBody("critical"),
    headSha: head,
    comments: [entry(
      `Owner-Override: PASS\nOverride-Head: ${head}\nOverride-Reason: local reviewer unavailable\n`,
    )],
  });
  assert.equal(result.state, "success");
});

test("collaborator cannot spoof owner override", () => {
  const result = evaluate({
    body: prBody("critical"),
    headSha: head,
    comments: [entry(
      `Owner-Override: PASS\nOverride-Head: ${head}\nOverride-Reason: bypass\n`,
      { login: "trusted-reviewer", association: "COLLABORATOR" },
    )],
  });
  assert.equal(result.state, "pending");
});
