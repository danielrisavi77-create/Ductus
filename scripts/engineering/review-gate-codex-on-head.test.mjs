import assert from "node:assert/strict";
import { test } from "node:test";

import { codexOnHead } from "./review-gate-core.mjs";

// codexOnHead is the gate's own "Codex on this head" rule (D-138/D-139), exported so the
// orchestrator's merge-ready report reads it the same way; the gate calls it too.
const head = "a".repeat(40);
const other = "b".repeat(40);
const CODEX_BOT = { login: "chatgpt-codex-connector[bot]", type: "Bot" };
const state = (code = {}, security = {}) =>
  JSON.stringify({
    code_review: { commit_sha: head, has_any_findings: true, has_unresolved_findings: false, status: "completed", ...code },
    security_review: { commit_sha: null, has_unresolved_findings: null, ...security },
  });
const summary = (json = state(), { user = CODEX_BOT, slug = "chatgpt-codex-connector" } = {}) => ({
  body: `<!-- codex-pull-request-review-summary -->\n<!-- codex-review-state:v1 ${json} -->\n\n## Codex Review Summary\n`,
  user,
  performed_via_github_app: { slug },
});
const review = (sha = head, s = "COMMENTED", user = CODEX_BOT) => ({ user, commit_id: sha, state: s });
const on = (comments = [], prReviews = []) => codexOnHead({ comments, prReviews, headSha: head });

test("a Codex PR review of this head counts, of another head or by another account does not", () => {
  assert.equal(on([], [review()]), true);
  assert.equal(on([], [review(head, "APPROVED")]), true);
  assert.equal(on([], [review(other)]), false);
  assert.equal(on([], [review(head, "COMMENTED", { login: "someone", type: "User" })]), false);
  assert.equal(on([], [review(head, "DISMISSED")]), false);
});

test("the edited-in-place summary counts only clean, completed, on this head and from the Codex App", () => {
  assert.equal(on([summary()]), true);
  assert.equal(on([summary(state({ has_unresolved_findings: true }))]), false);
  assert.equal(on([summary(state({ status: "in_progress" }))]), false);
  assert.equal(on([summary(state({ commit_sha: other }))]), false);
  assert.equal(on([summary(state({}, { has_unresolved_findings: true }))]), false);
  assert.equal(on([summary(state(), { slug: "claude" })]), false);
  assert.equal(on([summary(state(), { user: { login: "danielrisavi77-create", type: "User" } })]), false);
  assert.equal(on([summary("{not json")]), false);
  assert.equal(on([]), false);
});
