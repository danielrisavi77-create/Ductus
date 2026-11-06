import assert from "node:assert/strict";
import test from "node:test";

import { displayAgentRisk, latestVerdict } from "./orchestrator-core.mjs";

// F-015: the status tools show a PASS only when the gate could count it, and
// print the body's Agent and Risk only in the shape the gate accepts.
const H = "d".repeat(40);
const owner = { login: "owner1", type: "User" };
const verdict = (agent, word, over = {}) => ({
  body: `Agent-Review: ${agent}\nReview-Head: ${H}\nReview-Verdict: ${word}\n${over.extra ?? ""}`,
  author_association: "OWNER",
  user: owner,
  created_at: "2026-11-06T10:00:00Z",
  performed_via_github_app: null,
  ...over,
});
const app = (slug) => ({ performed_via_github_app: { slug } });
const withoutAppField = (comment) => {
  const copy = { ...comment };
  delete copy.performed_via_github_app;
  return copy;
};

const identityClasses = [
  ["owner through the App of the runtime", verdict("claude:r1:reviewer", "PASS", app("claude")), "PASS"],
  ["codex runtime through the Codex App", verdict("codex:r1:reviewer", "PASS", app("chatgpt-codex-connector")), "PASS"],
  ["owner without an App", verdict("claude:r1:reviewer", "PASS"), null],
  ["performed_via_github_app missing", withoutAppField(verdict("claude:r1:reviewer", "PASS")), null],
  ["App of another runtime", verdict("claude:r1:reviewer", "PASS", app("grok-by-xai")), null],
  ["unregistered App", verdict("claude:r1:reviewer", "PASS", app("someapp")), null],
  ["App slug null", verdict("claude:r1:reviewer", "PASS", { performed_via_github_app: { slug: null } }), null],
  ["Agent outside the gate pattern", verdict("claude r1 reviewer", "PASS", app("claude")), null],
  ["owner CLI channel of the runtime", verdict("codex:r1:reviewer", "PASS", { extra: "Review-Channel: codex-cli\n" }), "PASS"],
  ["owner CLI channel of another runtime", verdict("claude:r1:reviewer", "PASS", { extra: "Review-Channel: codex-cli\n" }), null],
  ["two CLI channel lines", verdict("codex:r1:reviewer", "PASS", { extra: "Review-Channel: codex-cli\nReview-Channel: grok-cli\n" }), null],
  ["CLI channel from a collaborator", verdict("codex:r1:reviewer", "PASS", { extra: "Review-Channel: codex-cli\n", author_association: "COLLABORATOR", user: { login: "helper1", type: "User" } }), null],
  ["bot account", verdict("claude:r1:reviewer", "PASS", { ...app("claude"), user: { login: "x[bot]", type: "Bot" } }), null],
  ["FAIL without an App stays negative", verdict("claude:r1:reviewer", "FAIL"), "FAIL"],
  ["BLOCK through another App stays negative", verdict("claude:r1:reviewer", "BLOCK", app("grok-by-xai")), "BLOCK"],
];

for (const [name, comment, expected] of identityClasses) {
  test(`F-015 verdict class "${name}"`, () => {
    const v = latestVerdict([comment], "review", H);
    assert.equal(v?.verdict ?? null, expected);
  });
}

test("F-015: an unverified PASS never hides a verified negative or shows beside it as PASS", () => {
  const fail = verdict("claude:r2:reviewer", "FAIL", { ...app("claude"), created_at: "2026-11-06T09:00:00Z" });
  const plain = verdict("claude:r3:reviewer", "PASS", { created_at: "2026-11-06T11:00:00Z" });
  assert.equal(latestVerdict([fail, plain], "review", H).verdict, "FAIL");
  assert.equal(latestVerdict([plain], "review", H), null);
});

const body = (agent, risk) => `${agent === undefined ? "" : `Agent: ${agent}\n`}${risk === undefined ? "" : `Risk: ${risk}\n`}Task: DAN-1\n`;
const metadataClasses = [
  ["valid", body("claude:w1:platforma", "critical"), { agent: "claude:w1:platforma", risk: "critical" }],
  ["risk in upper case", body("claude:w1:platforma", "Standard"), { agent: "claude:w1:platforma", risk: "standard" }],
  ["missing both", body(undefined, undefined), { agent: null, risk: null }],
  ["agent with spaces", body("claude:w1:platforma extra words", "low"), { agent: "invalid", risk: "low" }],
  ["agent with unknown role", body("claude:w1:admin", "low"), { agent: "invalid", risk: "low" }],
  ["agent with escape character", body("claude:w1:platforma\u001b[2J", "low"), { agent: "invalid", risk: "low" }],
  ["risk outside the set", body("claude:w1:platforma", "medium"), { agent: "claude:w1:platforma", risk: "invalid" }],
  ["risk with escape character", body("claude:w1:platforma", "low\u0007"), { agent: "claude:w1:platforma", risk: "invalid" }],
];

for (const [name, text, expected] of metadataClasses) {
  test(`F-015 metadata class "${name}"`, () => {
    assert.deepEqual(displayAgentRisk(text), expected);
  });
}

test("F-015: a body that is not a string prints nothing", () => {
  assert.deepEqual(displayAgentRisk(null), { agent: null, risk: null });
  assert.deepEqual(displayAgentRisk(undefined), { agent: null, risk: null });
});
