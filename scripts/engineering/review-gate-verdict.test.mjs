// Gate verdict handling: a current negative verdict is bound to trusted data
// (the comment's App, association and head), never to what the PR body says.
// All identities are invented.
import test from "node:test";
import assert from "node:assert/strict";

import fc from "fast-check";

import { evaluateGate, field } from "./review-gate-core.mjs";

const head = "a".repeat(40);
const olderHead = "b".repeat(40);
const ownerLogin = "owner-x";

const APPS = { claude: "claude", chatgpt: "chatgpt-codex-connector", codex: "chatgpt-codex-connector", grok: "grok-by-xai" };

const prBody = (agent = "claude:w1:backend", risk = "low", task = "T-1") =>
  `Agent: ${agent}\nRisk: ${risk}\nTask: ${task}\n`;

let counter = 0;
const comment = (body, { login = ownerLogin, association = "OWNER", appSlug = null, type } = {}) => ({
  body,
  user: type ? { login, type } : { login },
  author_association: association,
  performed_via_github_app: appSlug ? { slug: appSlug } : null,
  created_at: new Date(1_750_000_000_000 + counter++ * 1000).toISOString(),
});

const appFor = (agent) => APPS[agent.split(":")[0].toLowerCase()];

const review = (agent, verdict, { sha = head, ...meta } = {}) =>
  comment(
    `Agent-Review: ${agent}:reviewer\nReview-Head: ${sha}\nReview-Verdict: ${verdict}\n`,
    { appSlug: appFor(agent), ...meta },
  );

const qa = (agent, verdict, { sha = head, fallback, ...meta } = {}) =>
  comment(
    `QA-Agent: ${agent}:qa\nQA-Head: ${sha}\nQA-Verdict: ${verdict}\nQA-Scope: negative paths\n` +
      (fallback ? `Provider-Fallback: ${fallback} — quota exhausted\n` : ""),
    { appSlug: appFor(agent), ...meta },
  );

const quotaNotice = () =>
  comment("You have reached your Codex usage limits for code reviews.", {
    login: "chatgpt-codex-connector[bot]",
    type: "Bot",
    association: "NONE",
    appSlug: "chatgpt-codex-connector",
  });

const gate = (body, comments) => evaluateGate({ body, headSha: head, ownerLogin, comments });

const holds = (body, comments, label) => {
  const result = gate(body, comments);
  assert.notEqual(result.state, "success", label ?? body);
  return result;
};

// ... (remaining tests unchanged except the own-principal one below)

test("PASS from the declared author's own principal still does not count for critical", () => {
  const ownReview = gate(prBody("claude:w1:backend", "critical"), [review("claude:w1", "PASS")]);
  assert.equal(ownReview.state, "pending");
  assert.match(ownReview.description, /Waiting for independently authenticated review/);

  const ownQa = gate(prBody("grok:q1:backend", "critical"), [
    review("chatgpt:r2", "PASS"),
    qa("grok:q1", "PASS"),
  ]);
  assert.equal(ownQa.state, "pending");
  assert.match(ownQa.description, /waiting for separately authenticated QA PASS/);
});

test("low and standard succeed without any review", () => {
  assert.equal(gate(prBody("claude:w1:backend", "low"), []).state, "success");
  assert.equal(gate(prBody("claude:w1:backend", "standard"), []).state, "success");
});
