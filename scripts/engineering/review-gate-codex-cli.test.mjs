import test from "node:test";
import assert from "node:assert/strict";

import { evaluateGate } from "./review-gate-core.mjs";

// D-193 (#87 c.6543705860, plan #1010): a Codex review or QA run from the
// owner's Codex CLI counts as the Codex App, but only from the owner's account
// with the `Review-Channel: codex-cli` line outside a code block. Synthetic
// logins, slots and heads only.
const head = "c".repeat(40);
const old = "d".repeat(40);
const ownerLogin = "owner-fixture";
const CHANNEL = "Review-Channel: codex-cli\n";
let counter = 0;
const createdAt = () => new Date(1_700_000_000_000 + counter++ * 1000).toISOString();

const prBody = (risk = "critical", agent = "claude:a:platforma") => `Agent: ${agent}\nRisk: ${risk}\nTask: DAN-1\n`;
const owner = (body, app) => ({
  body,
  user: { login: ownerLogin },
  author_association: "OWNER",
  ...(app ? { performed_via_github_app: { slug: app } } : {}),
  created_at: createdAt(),
});
const review = ({ agent = "codex:cli:reviewer", verdict = "PASS", sha = head, channel = CHANNEL, app } = {}) =>
  owner(`Agent-Review: ${agent}\nReview-Head: ${sha}\nReview-Verdict: ${verdict}\n${channel}`, app);
const qa = ({ agent = "codex:cli2:qa", verdict = "PASS", sha = head, channel = CHANNEL, app } = {}) =>
  owner(`QA-Agent: ${agent}\nQA-Head: ${sha}\nQA-Verdict: ${verdict}\nQA-Scope: wrong actor\n${channel}`, app);
const claudeQa = (verdict = "PASS") => qa({ agent: "claude:qa1:qa", verdict, channel: "", app: "claude" });
const claudeReview = () => review({ agent: "claude:r1:reviewer", channel: "", app: "claude" });
const evaluate = (comments, extra = {}) => evaluateGate({ ownerLogin, headSha: head, body: prBody(), comments, ...extra });
const state = (comments, extra) => evaluate(comments, extra).state;

test("A1-A2: a Codex CLI review and a Claude QA pass a critical PR and the status names the channel first", () => {
  const result = evaluate([review(), claudeQa()]);
  assert.equal(result.state, "success");
  assert.match(result.description, /^Codex CLI review \(D-193, owner account\)\. /);
});

test("A3: a Claude review and a Codex CLI QA pass a critical PR", () => {
  assert.equal(state([claudeReview(), qa()]), "success");
});

test("A4: a Codex CLI review alone passes a standard PR", () => {
  assert.equal(state([review()], { body: prBody("standard") }), "success");
});

test("A5: a Codex CLI review and QA of distinct principals take the Codex pair path (known limit)", () => {
  const result = evaluate([review(), qa()]);
  assert.equal(result.state, "success");
  assert.match(result.description, /Independent Codex review and QA pair/);
});

test("A6: a Codex CLI verdict carries through a clean base merge like an App verdict", () => {
  const carried = { carriedHeads: new Set([old]) };
  assert.equal(state([review({ sha: old }), claudeQa()], carried), "success");
  assert.equal(state([review({ sha: old }), claudeQa()]), "pending");
});

test("R1-R2: the channel line counts only on the owner's own account", () => {
  for (const association of ["CONTRIBUTOR", "MEMBER", "COLLABORATOR"]) {
    const stranger = { ...review(), user: { login: "someone-else" }, author_association: association };
    assert.equal(state([stranger, claudeQa()]), "pending", association);
  }
  const otherLogin = { ...review(), user: { login: "not-the-owner" } };
  assert.equal(state([otherLogin, claudeQa()]), "pending");
});

test("R3: the channel line inside a code block does not count", () => {
  for (const fence of ["```", "~~~"]) {
    assert.equal(state([review({ channel: `${fence}\n${CHANNEL}${fence}\n` }), claudeQa()]), "pending", fence);
  }
});

test("R4: a misspelt or decorated channel line does not count", () => {
  for (const line of [
    "Review-Channel: codex",
    "Review-Channel: codex_cli",
    "Review-Channel: codexcli",
    "Review-Channel: codex-cli-x",
    "Review-Channel: codex cli",
    "Review-Channels: codex-cli",
    "> Review-Channel: codex-cli",
    "- Review-Channel: codex-cli",
  ]) {
    assert.equal(state([review({ channel: `${line}\n` }), claudeQa()]), "pending", line);
  }
});

test("R5: the channel line without a canonical block is no verdict", () => {
  assert.equal(state([owner(`Looks fine.\n${CHANNEL}`), claudeQa()]), "pending");
});

test("R6: the channel does not lend the Codex App to another runtime", () => {
  for (const agent of ["claude:cli:reviewer", "grok:cli:reviewer"]) {
    assert.equal(state([review({ agent }), qa({ agent: "codex:cli2:qa", channel: "", app: "chatgpt-codex-connector" })]), "pending", agent);
  }
});

test("R7: a comment naming both CLI channels counts as neither", () => {
  const both = review({ channel: `${CHANNEL}Review-Channel: grok-cli\n` });
  assert.equal(state([both, claudeQa()]), "pending");
  const grokBoth = review({ agent: "grok:cli:reviewer", channel: `Review-Channel: grok-cli\n${CHANNEL}` });
  assert.equal(state([grokBoth, claudeQa()]), "pending");
});

test("R8: a real App on the comment wins over the channel line", () => {
  const viaClaude = review({ agent: "codex:cli:reviewer", app: "claude" });
  assert.equal(state([viaClaude, claudeQa()]), "pending");
});

test("R9-R10: on a critical PR the same principal cannot give both review and QA", () => {
  assert.equal(state([review(), qa({ agent: "codex:cli:qa" })]), "pending");
  assert.equal(state([review({ agent: "chatgpt:cli:reviewer" }), qa({ agent: "codex:CLI:qa" })]), "pending");
  const appQa = qa({ agent: "codex:cli:qa", channel: "", app: "chatgpt-codex-connector" });
  assert.equal(state([review(), appQa]), "pending");
});

test("R11: the author's own principal never reviews through the channel", () => {
  const body = prBody("standard", "codex:cli:platforma");
  assert.equal(state([review()], { body }), "pending");
  assert.equal(state([review({ agent: "chatgpt:CLI:reviewer" })], { body }), "pending");
});

test("R12: a Codex CLI verdict on an old head does not count", () => {
  assert.equal(state([review({ sha: old }), claudeQa()]), "pending");
});

test("R13: a Codex CLI FAIL or BLOCK holds the gate", () => {
  for (const verdict of ["FAIL", "BLOCK"]) {
    assert.notEqual(state([review({ verdict }), claudeReview(), claudeQa()]), "success", `review ${verdict}`);
    assert.notEqual(state([review(), claudeQa(), qa({ verdict })]), "success", `qa ${verdict}`);
    assert.notEqual(state([review(), review({ verdict }), claudeQa()]), "success", `later ${verdict}`);
  }
});

test("R14: an Owner-Override with the channel line stays an override and names no CLI", () => {
  const override = owner(`Owner-Override: PASS\nOverride-Head: ${head}\nOverride-Reason: test\n${CHANNEL}`);
  const result = evaluate([override]);
  assert.equal(result.state, "success");
  assert.doesNotMatch(result.description, /CLI/);
});

test("R15: a Codex CLI comment is no Codex App proof for the D-139 second session", () => {
  const secondSession = qa({
    agent: "claude:qa2:qa",
    app: "claude",
    channel: `Provider-Fallback: claude-second-session — Codex review na headu ${head}\n`,
  });
  const comments = [claudeReview(), review({ agent: "codex:cli3:reviewer" }), secondSession];
  assert.equal(state(comments), "pending");
  // Control: the same comments pass once the Codex App itself reviewed the head.
  const appReview = { user: { login: "chatgpt-codex-connector[bot]", type: "Bot" }, state: "COMMENTED", commit_id: head };
  assert.equal(state(comments, { prReviews: [appReview], reviewComments: [] }), "success");
});

test("R16: both channels used name both notes, Grok first", () => {
  const grok = review({ agent: "grok:cli:reviewer", channel: "Review-Channel: grok-cli\n" });
  const result = evaluate([grok, review(), claudeQa()]);
  assert.equal(result.state, "success");
  assert.match(result.description, /^Grok CLI review \(D-162, owner account\)\. Codex CLI review \(D-193, owner account\)\. /);
});
