import test from "node:test";
import assert from "node:assert/strict";

import { evaluateGate, field } from "./review-gate-core.mjs";

const head = "a".repeat(40);
const author = "claude:a:backend";
const ownerLogin = "danielrisavi77-create";

const prBody = (risk = "standard", agent = author) =>
  `Agent: ${agent}\nRisk: ${risk}\nTask: B-1\n`;

let counter = 0;
const entry = (body, {
  login = ownerLogin,
  association = "OWNER",
  createdAt,
} = {}) => ({
  body,
  user: { login },
  author_association: association,
  created_at: createdAt ?? new Date(1_700_000_000_000 + counter++ * 1000).toISOString(),
});

const review = ({
  agent = "codex:b:reviewer",
  sha = head,
  verdict = "PASS",
  ...meta
} = {}) =>
  entry(
    `Agent-Review: ${agent}\nReview-Head: ${sha}\nReview-Verdict: ${verdict}\n`,
    meta,
  );

const qa = ({
  agent = "claude:c:qa",
  sha = head,
  verdict = "PASS",
  scope = "offline + wrong actor",
  ...meta
} = {}) =>
  entry(
    `QA-Agent: ${agent}\nQA-Head: ${sha}\nQA-Verdict: ${verdict}\nQA-Scope: ${scope}\n`,
    meta,
  );

const evaluate = (input) =>
  evaluateGate({ ownerLogin, comments: [], ...input });

test("field reads metadata outside code fences only", () => {
  assert.equal(field("Risk: critical\nTask: B-8", "Risk"), "critical");
  assert.equal(field("Risky: low", "Risk"), null);
  assert.equal(
    field("```\nRisk: low\n```\nRisk: critical", "Risk"),
    "critical",
  );
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
    body: prBody("standard", "chatgpt:a:platforma"),
    headSha: head,
    comments: [review()],
  });
  assert.equal(result.state, "success");
});

test("standard waits for review", () => {
  assert.equal(evaluate({ body: prBody(), headSha: head }).state, "pending");
});

test("same runtime and slot cannot review own PR under another role", () => {
  const result = evaluate({
    body: prBody(),
    headSha: head,
    comments: [review({ agent: "claude:a:reviewer" })],
  });
  assert.equal(result.state, "pending");
});

test("review is bound to the current head", () => {
  const result = evaluate({
    body: prBody(),
    headSha: head,
    comments: [review({ sha: "b".repeat(40) })],
  });
  assert.equal(result.state, "pending");
});

test("untrusted outsider cannot spoof a review PASS", () => {
  const result = evaluate({
    body: prBody(),
    headSha: head,
    comments: [review({ login: "outsider", association: "NONE" })],
  });
  assert.equal(result.state, "pending");
});

test("trusted collaborator review can satisfy the gate", () => {
  const result = evaluate({
    body: prBody(),
    headSha: head,
    comments: [review({ login: "trusted-reviewer", association: "COLLABORATOR" })],
  });
  assert.equal(result.state, "success");
});

test("review example inside a code fence does not satisfy the gate", () => {
  const body =
    "Use this when done:\n```\n" +
    `Agent-Review: codex:b:reviewer\nReview-Head: ${head}\nReview-Verdict: PASS\n` +
    "```";
  const result = evaluate({
    body: prBody(),
    headSha: head,
    comments: [entry(body)],
  });
  assert.equal(result.state, "pending");
});

test("review block must start the comment", () => {
  const result = evaluate({
    body: prBody(),
    headSha: head,
    comments: [entry(
      `Review complete.\nAgent-Review: codex:b:reviewer\nReview-Head: ${head}\nReview-Verdict: PASS\n`,
    )],
  });
  assert.equal(result.state, "pending");
});

test("latest verdict from one reviewer replaces its earlier PASS", () => {
  const result = evaluate({
    body: prBody(),
    headSha: head,
    comments: [
      review({ verdict: "PASS" }),
      review({ verdict: "FAIL" }),
    ],
  });
  assert.equal(result.state, "pending");
});

test("later PASS can resolve an earlier FAIL from the same reviewer", () => {
  const result = evaluate({
    body: prBody(),
    headSha: head,
    comments: [
      review({ verdict: "FAIL" }),
      review({ verdict: "PASS" }),
    ],
  });
  assert.equal(result.state, "success");
});

test("any current independent reviewer BLOCK holds the gate", () => {
  const result = evaluate({
    body: prBody(),
    headSha: head,
    comments: [
      review({ agent: "codex:b:reviewer", verdict: "PASS" }),
      review({ agent: "chatgpt:c:reviewer", verdict: "BLOCK" }),
    ],
  });
  assert.equal(result.state, "pending");
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

test("same runtime and slot cannot be both reviewer and QA", () => {
  const result = evaluate({
    body: prBody("critical"),
    headSha: head,
    comments: [
      review({ agent: "codex:b:reviewer" }),
      qa({ agent: "codex:b:qa" }),
    ],
  });
  assert.equal(result.state, "pending");
});

test("author principal cannot provide QA under another role", () => {
  const result = evaluate({
    body: prBody("critical"),
    headSha: head,
    comments: [
      review(),
      qa({ agent: "claude:a:qa" }),
    ],
  });
  assert.equal(result.state, "pending");
});

test("latest QA FAIL revokes an earlier QA PASS", () => {
  const result = evaluate({
    body: prBody("critical"),
    headSha: head,
    comments: [
      review(),
      qa({ verdict: "PASS" }),
      qa({ verdict: "FAIL" }),
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
      qa({ login: "outsider", association: "NONE" }),
    ],
  });
  assert.equal(result.state, "pending");
});

test("owner override must be canonical, current-head and reasoned", () => {
  const valid = evaluate({
    body: prBody("critical"),
    headSha: head,
    comments: [entry(
      `Owner-Override: PASS\nOverride-Head: ${head}\nOverride-Reason: emergency governance decision\n`,
    )],
  });
  assert.equal(valid.state, "success");

  const prefixed = evaluate({
    body: prBody("critical"),
    headSha: head,
    comments: [entry(
      `Example only:\nOwner-Override: PASS\nOverride-Head: ${head}\nOverride-Reason: bypass\n`,
    )],
  });
  assert.equal(prefixed.state, "pending");
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
