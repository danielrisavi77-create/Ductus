import assert from "node:assert/strict";
import test from "node:test";

import { canonicalVerdicts } from "./health-core.mjs";
import { latestVerdict, parseVerdicts, REPO_OWNER } from "./orchestrator-core.mjs";
import { EXPECTED_REPO } from "./verdict-core.mjs";

// Review finding 1 on #1013: the orchestrator scripts read a verdict's App as
// the gate does, so an owner CLI comment with `Review-Channel` (D-162, D-193)
// counts as that App, and nothing else does. Synthetic heads and slots.
const H = "e".repeat(40);
const owner = (body, over = {}) => ({
  body,
  user: { login: REPO_OWNER, type: "User" },
  author_association: "OWNER",
  created_at: "2026-10-31T10:00:00Z",
  ...over,
});
const review = (agent, channel, over) =>
  owner(`Agent-Review: ${agent}\nReview-Head: ${H}\nReview-Verdict: PASS\n${channel}`, over);
const CODEX = "Review-Channel: codex-cli\n";
const GROK = "Review-Channel: grok-cli\n";

test("the owner is the repository owner the verdict tool checks", () => {
  assert.equal(REPO_OWNER, EXPECTED_REPO.split("/")[0]);
});

test("health: an owner CLI comment counts as the channel's App", () => {
  const codex = canonicalVerdicts([review("codex:cli:reviewer", CODEX)]);
  assert.deepEqual(codex.map((v) => [v.kind, v.principal, v.key]), [
    ["review", "openai:cli", "review|chatgpt-codex-connector|openai:cli"],
  ]);
  const grok = canonicalVerdicts([review("grok:cli:reviewer", GROK)]);
  assert.deepEqual(grok.map((v) => v.key), ["review|grok-by-xai|grok:cli"]);
});

test("health: the channel is refused as the gate refuses it", () => {
  for (const [name, comment] of [
    ["no channel", review("codex:cli:reviewer", "")],
    ["fenced", review("codex:cli:reviewer", `\`\`\`\n${CODEX}\`\`\`\n`)],
    ["misspelt", review("codex:cli:reviewer", "Review-Channel: codex\n")],
    ["both channels", review("codex:cli:reviewer", CODEX + GROK)],
    ["wrong runtime", review("claude:cli:reviewer", CODEX)],
    ["other login", review("codex:cli:reviewer", CODEX, { user: { login: "not-the-owner", type: "User" } })],
    ["not owner", review("codex:cli:reviewer", CODEX, { author_association: "CONTRIBUTOR" })],
  ]) {
    assert.deepEqual(canonicalVerdicts([comment]), [], name);
  }
});

test("health: a real App on the comment still wins over the line", () => {
  const viaClaude = review("claude:r:reviewer", CODEX, { performed_via_github_app: { slug: "claude" } });
  assert.deepEqual(canonicalVerdicts([viaClaude]).map((v) => v.key), ["review|claude|claude:r"]);
});

test("orchestrator: the App of a CLI verdict is the gate's App", () => {
  assert.deepEqual(parseVerdicts([review("codex:cli:reviewer", CODEX)], "review").map((v) => v.appSlug), [
    "chatgpt-codex-connector",
  ]);
  assert.deepEqual(parseVerdicts([review("grok:cli:reviewer", GROK)], "review").map((v) => v.appSlug), ["grok-by-xai"]);
  assert.deepEqual(parseVerdicts([review("codex:cli:reviewer", CODEX + GROK)], "review").map((v) => v.appSlug), [null]);
});

test("orchestrator: a CLI FAIL and an App PASS of the same principal are one identity, as in the gate", () => {
  const app = review("codex:cli:reviewer", "", { performed_via_github_app: { slug: "chatgpt-codex-connector" } });
  const cliFail = owner(`Agent-Review: codex:cli:reviewer\nReview-Head: ${H}\nReview-Verdict: FAIL\n${CODEX}`, {
    created_at: "2026-10-31T11:00:00Z",
  });
  assert.equal(latestVerdict([app, cliFail], "review", H).verdict, "FAIL");
  assert.equal(latestVerdict([cliFail, { ...app, created_at: "2026-10-31T12:00:00Z" }], "review", H).verdict, "PASS");
});
