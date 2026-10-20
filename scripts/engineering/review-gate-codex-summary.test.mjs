import test from "node:test";
import assert from "node:assert/strict";

import { evaluateGate } from "./review-gate-core.mjs";

// D-139 with a clean Codex review: Codex leaves no pull request review, only
// its summary comment with a machine state naming the full reviewed commit
// (owner option A, 20 Oct 2026). Everything else of D-139 stays required.
const head = "a".repeat(40);
const other = "b".repeat(40);
const ownerLogin = "danielrisavi77-create";
const BASE = 1_800_000_000_000;
const MIN = 60 * 1000;
const iso = (ms) => new Date(BASE + ms).toISOString();
const CODEX_BOT = { login: "chatgpt-codex-connector[bot]", type: "Bot" };

const byOwner = (body, ms) => ({
  body,
  user: { login: ownerLogin },
  author_association: "OWNER",
  performed_via_github_app: { slug: "claude" },
  created_at: iso(ms),
});
const reviewPass = byOwner(`Agent-Review: claude:b:reviewer\nReview-Head: ${head}\nReview-Verdict: PASS\n`, 10 * MIN);
const qaPass = byOwner(
  `QA-Agent: claude:c:qa\nQA-Head: ${head}\nQA-Verdict: PASS\nQA-Scope: offline + wrong actor\nProvider-Fallback: claude-second-session — Codex review na headu ${head}\n`,
  20 * MIN,
);
const state = (code = {}) =>
  JSON.stringify({
    code_review: {
      commit_sha: head,
      has_any_findings: false,
      has_unresolved_findings: false,
      status: "completed",
      ...code,
    },
    security_review: { commit_sha: null, has_any_findings: null, has_unresolved_findings: null, status: null },
  });
const summaryBody = (json = state()) =>
  `<!-- codex-pull-request-review-summary -->\n<!-- codex-review-state:v1 ${json} -->\n\n## Codex Review Summary\n`;
const summary = ({ code, body, user = CODEX_BOT, slug = "chatgpt-codex-connector" } = {}) => ({
  id: 1,
  body: body ?? summaryBody(state(code)),
  user,
  performed_via_github_app: { slug },
  created_at: iso(5 * MIN),
  updated_at: iso(6 * MIN),
});
const receipt = (sha = head.slice(0, 10)) => ({
  body: `<!-- codex-review-receipt:v1 -->\n\nCodex Review: Didn't find any major issues.\n\n**Reviewed commit:** \`${sha}\`\n`,
  user: CODEX_BOT,
  performed_via_github_app: { slug: "chatgpt-codex-connector" },
  created_at: iso(5 * MIN),
});

const AUTHOR = "Agent: claude:a:platforma\nRisk: critical\nTask: B-1\n";
const evaluate = (extra, { prReviews = [], reviewComments = [] } = {}) =>
  evaluateGate({
    body: AUTHOR,
    headSha: head,
    ownerLogin,
    comments: [reviewPass, qaPass, ...extra],
    prReviews,
    reviewComments,
  });
const pending = (extra, rest) => assert.equal(evaluate(extra, rest).state, "pending");

test("a clean completed Codex summary on the full head satisfies the Codex review condition", () => {
  const result = evaluate([summary(), receipt()]);
  assert.equal(result.state, "success");
  assert.match(result.description, /second Claude session/);
});

test("control: without any Codex evidence the gate stays pending", () => pending([]));

test("the receipt comment alone is no evidence", () => pending([receipt()]));

test("an unanswered Codex thread still blocks a clean summary", () => {
  pending([summary()], { reviewComments: [{ id: 1, user: CODEX_BOT, in_reply_to_id: null }] });
});

test("a summary not written by the Codex Bot account is no evidence", () => {
  for (const user of [
    { login: ownerLogin, type: "User" },
    { login: "chatgpt-codex-connector[bot]", type: "User" },
    { login: "other-app[bot]", type: "Bot" },
    { login: "chatgpt-codex-connector", type: "Bot" },
  ]) {
    pending([summary({ user })]);
  }
});

test("the right bot account without the Codex App slug is no evidence", () => {
  pending([summary({ slug: "other-app" })]);
  pending([{ ...summary(), performed_via_github_app: null }]);
});

test("a body that merely contains the marker is no evidence", () => {
  pending([summary({ body: `quote:\n${summaryBody()}` })]);
});

test("another head, a short prefix, an uppercase-padded or missing sha is no evidence", () => {
  for (const commit_sha of [other, head.slice(0, 7), head.slice(0, 10), `${head}0`, ` ${head}`, "", null, 7]) {
    pending([summary({ code: { commit_sha } })]);
  }
});

test("a summary later edited for another commit no longer proves this head", () => {
  pending([summary({ code: { commit_sha: other } }), receipt()]);
});

test("findings, unresolved findings, or unknown values are no evidence", () => {
  for (const code of [
    { has_any_findings: true },
    { has_unresolved_findings: true },
    { has_any_findings: null },
    { has_unresolved_findings: "false" },
    { has_any_findings: undefined },
  ]) {
    pending([summary({ code })]);
  }
});

test("a status other than completed is no evidence", () => {
  for (const status of ["in_progress", "failed", "queued", "Completed", null, undefined]) {
    pending([summary({ code: { status } })]);
  }
});

test("malformed or missing state fails closed", () => {
  for (const body of [
    summaryBody("{not json"),
    summaryBody("null"),
    summaryBody("[]"),
    summaryBody('{"code_review":null}'),
    summaryBody('{"code_review":"completed"}'),
    "<!-- codex-pull-request-review-summary -->\nno state here",
    "<!-- codex-pull-request-review-summary -->\n<!-- codex-review-state:v1 -->",
  ]) {
    pending([summary({ body })]);
  }
  pending([{ ...summary(), body: undefined }]);
});

test("a quota message is no evidence", () => {
  const quota = {
    body: "You have reached your Codex usage limits for code reviews.",
    user: CODEX_BOT,
    performed_via_github_app: { slug: "chatgpt-codex-connector" },
    created_at: iso(5 * MIN),
  };
  pending([quota]);
});

test("a second summary for the same head with findings blocks", () => {
  pending([summary(), summary({ code: { has_unresolved_findings: true } })]);
});

test("a forged summary does not rescue a missing D-139 element", () => {
  const noDeclaration = byOwner(`QA-Agent: claude:c:qa\nQA-Head: ${head}\nQA-Verdict: PASS\nQA-Scope: offline + wrong actor\n`, 20 * MIN);
  const run = (qa) =>
    evaluateGate({ body: AUTHOR, headSha: head, ownerLogin, comments: [reviewPass, qa, summary()], prReviews: [], reviewComments: [] });
  assert.equal(run(noDeclaration).state, "pending");
  const sameSlot = byOwner(
    `QA-Agent: claude:b:qa\nQA-Head: ${head}\nQA-Verdict: PASS\nQA-Scope: offline + wrong actor\nProvider-Fallback: claude-second-session — Codex review na headu ${head}\n`,
    20 * MIN,
  );
  assert.equal(run(sameSlot).state, "pending");
});

test("non-critical risk is unaffected", () => {
  const body = "Agent: claude:a:backend\nRisk: standard\nTask: B-1\n";
  assert.equal(evaluateGate({ body, headSha: head, ownerLogin, comments: [reviewPass], prReviews: [], reviewComments: [] }).state, "success");
});
test("a valid clean summary plus an unreadable Codex summary voids the proof (review finding)", () => {
  for (const body of [summaryBody("{not json"), summaryBody("null"), summaryBody('{"code_review":null}'), "<!-- codex-pull-request-review-summary -->\ntruncated"]) {
    pending([summary(), summary({ body })]);
    pending([summary({ body }), summary()]);
  }
});
test("a clean summary plus another Codex summary without a usable commit voids the proof", () => {
  for (const code of [{ commit_sha: null }, { commit_sha: undefined }, { commit_sha: "abc" }]) {
    pending([summary(), summary({ code })]);
  }
});

test("the state must directly follow the marker and an open security finding blocks", () => {
  pending([summary({ body: `<!-- codex-pull-request-review-summary -->\nPR text\n<!-- codex-review-state:v1 ${state()} -->` })]);
  const withSecurity = JSON.stringify({
    code_review: { commit_sha: head, has_any_findings: false, has_unresolved_findings: false, status: "completed" },
    security_review: { commit_sha: head, has_any_findings: true, has_unresolved_findings: true, status: "completed" },
  });
  pending([summary({ body: summaryBody(withSecurity) })]);
  pending([summary(), summary({ body: summaryBody(withSecurity) })]);
});