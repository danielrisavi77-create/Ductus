import test from "node:test";
import assert from "node:assert/strict";

import { evaluateGate, field } from "./review-gate-core.mjs";

const head = "a".repeat(40);
const author = "claude:a:backend";

const prBody = (risk = "standard") =>
  `Agent: ${author}\nRisk: ${risk}\nTask: B-1\n`;

const review = (agent = "codex:b:reviewer", sha = head) => ({
  body: `Agent-Review: ${agent}\nReview-Head: ${sha}\nReview-Verdict: PASS\n`,
});

const qa = (agent = "claude:c:qa", sha = head) => ({
  body: `QA-Agent: ${agent}\nQA-Head: ${sha}\nQA-Verdict: PASS\nQA-Scope: offline + wrong actor\n`,
});

test("field reads exact metadata lines", () => {
  assert.equal(field("Risk: critical\nTask: B-8", "Risk"), "critical");
  assert.equal(field("Risky: low", "Risk"), null);
});

test("missing metadata fails closed", () => {
  assert.equal(
    evaluateGate({ body: "Risk: low", headSha: head }).state,
    "failure",
  );
});

test("missing task fails closed", () => {
  assert.equal(
    evaluateGate({ body: `Agent: ${author}\nRisk: standard\n`, headSha: head }).state,
    "failure",
  );
});

test("unknown agent role fails closed", () => {
  assert.equal(
    evaluateGate({
      body: "Agent: claude:a:whatever\nRisk: low\nTask: X-1\n",
      headSha: head,
    }).state,
    "failure",
  );
});

test("standard waits for review", () => {
  assert.equal(
    evaluateGate({ body: prBody(), headSha: head }).state,
    "pending",
  );
});

test("author cannot review own PR", () => {
  const result = evaluateGate({
    body: prBody(),
    headSha: head,
    comments: [review("claude:a:backend")],
  });
  assert.equal(result.state, "pending");
});

test("review is bound to the current head", () => {
  const result = evaluateGate({
    body: prBody(),
    headSha: head,
    comments: [review("codex:b:reviewer", "b".repeat(40))],
  });
  assert.equal(result.state, "pending");
});

test("standard passes with independent review", () => {
  const result = evaluateGate({
    body: prBody(),
    headSha: head,
    comments: [review()],
  });
  assert.equal(result.state, "success");
});

test("critical also requires independent QA", () => {
  const waiting = evaluateGate({
    body: prBody("critical"),
    headSha: head,
    comments: [review()],
  });
  assert.equal(waiting.state, "pending");

  const passing = evaluateGate({
    body: prBody("critical"),
    headSha: head,
    comments: [review(), qa()],
  });
  assert.equal(passing.state, "success");
});

test("QA cannot be the reviewer", () => {
  const reviewer = "codex:b:reviewer";
  const result = evaluateGate({
    body: prBody("critical"),
    headSha: head,
    comments: [
      review(reviewer),
      {
        body: `QA-Agent: ${reviewer}\nQA-Head: ${head}\nQA-Verdict: PASS\nQA-Scope: test\n`,
      },
    ],
  });
  assert.equal(result.state, "pending");
});

test("owner override must target the current head and include a reason", () => {
  const result = evaluateGate({
    body: prBody("critical"),
    headSha: head,
    comments: [{
      body: `Owner-Override: PASS\nOverride-Head: ${head}\nOverride-Reason: local reviewer unavailable\n`,
    }],
  });
  assert.equal(result.state, "success");
});
