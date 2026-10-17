import test from "node:test";
import assert from "node:assert/strict";

import { evaluateGate } from "./review-gate-core.mjs";

// #130: a slot names one principal whatever its letter case, so `claude:B` is
// `claude:b`. Each row would otherwise let the author or the passing reviewer
// stand in as an independent party.
const head = "a".repeat(40);
const ownerLogin = "danielrisavi77-create";
let counter = 0;
const createdAt = () => new Date(1_700_000_000_000 + counter++ * 1000).toISOString();

const prBody = (risk, agent) => `Agent: ${agent}\nRisk: ${risk}\nTask: B-1\n`;
const byOwner = (body) => ({
  body,
  user: { login: ownerLogin },
  author_association: "OWNER",
  performed_via_github_app: { slug: "claude" },
  created_at: createdAt(),
});
const review = (agent) => byOwner(`Agent-Review: ${agent}\nReview-Head: ${head}\nReview-Verdict: PASS\n`);
const fallbackQa = (agent) =>
  byOwner(
    `QA-Agent: ${agent}\nQA-Head: ${head}\nQA-Verdict: PASS\nQA-Scope: offline + wrong actor\nProvider-Fallback: chatgpt-codex-connector\n`,
  );
const codexQuota = () => ({
  body: "You have reached your Codex usage limits for code reviews.",
  user: { login: "chatgpt-codex-connector[bot]", type: "Bot" },
  author_association: "NONE",
  performed_via_github_app: { slug: "chatgpt-codex-connector" },
  created_at: createdAt(),
});
const evaluate = (input) => evaluateGate({ ownerLogin, comments: [], ...input });

test("control: distinct slots still pass the quota fallback", () => {
  const result = evaluate({
    body: prBody("critical", "claude:a:platforma"),
    headSha: head,
    comments: [codexQuota(), review("claude:b:reviewer"), fallbackQa("claude:c:qa")],
  });
  assert.equal(result.state, "success");
});

test("principal slots compare without letter case in the quota fallback (#130)", () => {
  for (const [reviewer, qaAgent] of [
    ["claude:b:reviewer", "claude:B:qa"],
    ["claude:b:reviewer", "claude:A:qa"],
    ["claude:A:reviewer", "claude:c:qa"],
  ]) {
    const result = evaluate({
      body: prBody("critical", "claude:a:platforma"),
      headSha: head,
      comments: [codexQuota(), review(reviewer), fallbackQa(qaAgent)],
    });
    assert.equal(result.state, "pending", `${reviewer} + ${qaAgent}`);
  }
});

test("a standard PR reviewed by the author under another letter case stays pending (#130)", () => {
  const result = evaluate({
    body: prBody("standard", "claude:a:backend"),
    headSha: head,
    comments: [review("claude:A:reviewer")],
  });
  assert.equal(result.state, "pending");
});
