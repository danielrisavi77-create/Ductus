import test from "node:test";
import assert from "node:assert/strict";

import { carriedHeadCandidates, evaluateMergeAuthorization, evaluatePullRequest } from "./review-gate-core.mjs";
import { evaluateMetadata } from "./pr-metadata-core.mjs";
import { changedPaths } from "./protected-paths.mjs";

// D-161 (h): the merge queue reads one status, "Merge authorization", computed
// by the gate with the same parser that checks the declared risk.
const head = "a".repeat(40);
const earlier = "b".repeat(40);
const ownerLogin = "danielrisavi77-create";
const GREEN = { state: "success", description: "ok" };

let counter = 0;
const comment = (text, { login = ownerLogin, association = "OWNER", appSlug = null, type = "User" } = {}) => ({
  body: text,
  user: { login, type },
  author_association: association,
  performed_via_github_app: appSlug ? { slug: appSlug } : null,
  created_at: new Date(1_700_000_000_000 + counter++ * 1000).toISOString(),
});
const command = (sha, opts) => comment(`Owner-Command: merge\nCommand-Head: ${sha}\nDatum: 2026-10-22\n`, opts);

function authorize({ body, filenames = ["src/a.ts"], comments = [], gate = GREEN, carriedHeads = new Set() }) {
  const paths = changedPaths(filenames.map((filename) => ({ filename })));
  return evaluateMergeAuthorization({
    gate,
    metadata: evaluateMetadata({ body, files: paths }),
    paths,
    comments,
    headSha: head,
    ownerLogin,
    carriedHeads,
  });
}
const bodyWith = (risk) => `Agent: claude:a:platforma\nRisk: ${risk}\nTask: B-1\n`;

test("Risk low or standard without a D-97 path is authorized without a command", () => {
  assert.equal(authorize({ body: bodyWith("low"), filenames: ["docs/a.md"] }).state, "success");
  assert.equal(authorize({ body: bodyWith("Standard") }).state, "success");
});

test("Risk critical needs the owner's command", () => {
  assert.equal(authorize({ body: bodyWith("critical") }).state, "pending");
  assert.equal(authorize({ body: bodyWith("critical"), comments: [command(head)] }).state, "success");
});

test("a description that fools a regex does not fool the parser (review of #565, finding 1)", () => {
  const body = "Agent: claude:a:platforma\nrisk: critical\nTask: B-1\n\n```\nRisk: standard\n```\n";
  assert.equal(authorize({ body }).state, "pending");
  assert.equal(authorize({ body: `${bodyWith("critical")}\nRisk: standard\n` }).state, "pending");
});

test("a critical-floor path declared as standard is not authorized (metadata fails)", () => {
  assert.equal(authorize({ body: bodyWith("standard"), filenames: ["db/migrations/1.sql"] }).state, "pending");
});

test("a D-97 path needs the command even when declared low, and a rename counts under both names", () => {
  assert.equal(authorize({ body: bodyWith("critical"), filenames: [".github/mergify.yml"] }).state, "pending");
  const paths = changedPaths([{ filename: "docs/x.md", previous_filename: "docs/DECISIONS.md" }]);
  const result = evaluateMergeAuthorization({
    gate: GREEN,
    metadata: { ok: true, risk: "low", minimumRisk: "low" },
    paths,
    comments: [],
    headSha: head,
    ownerLogin,
    carriedHeads: new Set(),
  });
  assert.equal(result.state, "pending");
});

test("a label or a body edit cannot authorize a critical PR; only the owner's command does (finding 2)", () => {
  const body = `${bodyWith("critical")}\nLabel: spoji-me\n`;
  assert.equal(authorize({ body }).state, "pending");
});

test("the command binds to the head: another head, another login, an App or a bot do not count", () => {
  const critical = bodyWith("critical");
  assert.equal(authorize({ body: critical, comments: [command(earlier)] }).state, "pending");
  assert.equal(authorize({ body: critical, comments: [command(head, { login: "someone", association: "MEMBER" })] }).state, "pending");
  assert.equal(authorize({ body: critical, comments: [command(head, { appSlug: "some-app" })] }).state, "pending");
  assert.equal(authorize({ body: critical, comments: [command(head, { type: "Bot" })] }).state, "pending");
  assert.equal(authorize({ body: critical, comments: [comment(`Owner-Command: reject\nCommand-Head: ${head}\n`)] }).state, "pending");
});

test("the command on an earlier head counts only once that head is carried through a clean base merge (D-101)", () => {
  const critical = bodyWith("critical");
  const comments = [command(earlier)];
  assert.equal(authorize({ body: critical, comments, carriedHeads: new Set([earlier]) }).state, "success");
  const merge = (sha) => ({ sha, parents: [{}, {}], mergesBase: true });
  assert.deepEqual(carriedHeadCandidates(comments, head, [merge(head), { sha: earlier, parents: [{}] }]).heads, [earlier]);
  const app = [command(earlier, { appSlug: "some-app" })];
  assert.deepEqual(carriedHeadCandidates(app, head, [merge(head), { sha: earlier, parents: [{}] }]).heads, []);
});

test("nothing is authorized while the gate is not green", () => {
  assert.equal(authorize({ body: bodyWith("low"), gate: { state: "pending", description: "x" } }).state, "pending");
  assert.equal(authorize({ body: bodyWith("critical"), comments: [command(head)], gate: { state: "failure", description: "x" } }).state, "pending");
});

test("evaluatePullRequest returns the authorization beside the gate result", () => {
  const pr = { body: bodyWith("low"), head: { sha: head }, changed_files: 1, user: { login: "x" } };
  const out = evaluatePullRequest({
    pr,
    files: [{ filename: "docs/a.md" }],
    comments: [],
    prReviews: [],
    reviewComments: [],
    ownerLogin,
    carriedHeads: new Set(),
  });
  assert.notEqual(out.result.state, "success");
  assert.equal(out.mergeAuthorization.state, "pending");
});
