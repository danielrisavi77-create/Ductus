import test from "node:test";
import assert from "node:assert/strict";

import { evaluateGate } from "./review-gate-core.mjs";

// D-162: a Grok review run from the owner's CLI counts as the Grok provider,
// but only with the owner's `Review-Channel: grok-cli` line.
const head = "b".repeat(40);
const ownerLogin = "danielrisavi77-create";
let counter = 0;
const createdAt = () => new Date(1_700_000_000_000 + counter++ * 1000).toISOString();

const prBody = (risk, agent) => `Agent: ${agent}\nRisk: ${risk}\nTask: DAN-244\n`;
const owner = (body, app) => ({
  body,
  user: { login: ownerLogin },
  author_association: "OWNER",
  ...(app ? { performed_via_github_app: { slug: app } } : {}),
  created_at: createdAt(),
});
const cliReview = (verdict = "PASS", channel = "Review-Channel: grok-cli\n") =>
  owner(`Agent-Review: grok:cli:reviewer\nReview-Head: ${head}\nReview-Verdict: ${verdict}\n${channel}`);
const claudeQa = () =>
  owner(`QA-Agent: claude:qa1:qa\nQA-Head: ${head}\nQA-Verdict: PASS\nQA-Scope: wrong actor\n`, "claude");
const evaluate = (input) => evaluateGate({ ownerLogin, comments: [], headSha: head, ...input });

test("a CLI review with the channel line and a Claude QA pass a critical PR", () => {
  const result = evaluate({ body: prBody("critical", "claude:a:platforma"), comments: [cliReview(), claudeQa()] });
  assert.equal(result.state, "success");
});

test("without the channel line an owner comment without an App is not a verdict", () => {
  const result = evaluate({
    body: prBody("critical", "claude:a:platforma"),
    comments: [cliReview("PASS", ""), claudeQa()],
  });
  assert.equal(result.state, "pending");
});

test("a CLI review and a Grok QA do not satisfy the two-Apps rule together", () => {
  const grokQa = owner(
    `QA-Agent: grok:cli2:qa\nQA-Head: ${head}\nQA-Verdict: PASS\nQA-Scope: x\nReview-Channel: grok-cli\n`,
  );
  const result = evaluate({ body: prBody("critical", "claude:a:platforma"), comments: [cliReview(), grokQa] });
  assert.equal(result.state, "pending");
});

test("a CLI FAIL holds the gate blocked", () => {
  const result = evaluate({
    body: prBody("critical", "claude:a:platforma"),
    comments: [cliReview("FAIL"), claudeQa()],
  });
  assert.notEqual(result.state, "success");
});

test("the channel line is ignored on a comment of a non-owner", () => {
  const stranger = {
    ...cliReview(),
    user: { login: "someone" },
    author_association: "CONTRIBUTOR",
  };
  const result = evaluate({ body: prBody("critical", "claude:a:platforma"), comments: [stranger, claudeQa()] });
  assert.equal(result.state, "pending");
});
