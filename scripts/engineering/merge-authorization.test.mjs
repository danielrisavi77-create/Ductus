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

// D-196: the owner's command is kept for D-97 paths and for a critical PR whose
// gate passed without QA; a critical PR with QA and no D-97 path needs none.
const D97 = ["scripts/engineering/x.mjs"];
// Only tests, so QA-exempt; its risk floor is below critical, so the parsed
// risk decides the result.
const QA_EXEMPT = ["e2e/a.spec.ts"];

test("Risk critical with QA required and no D-97 path is authorized without a command (D-196)", () => {
  const out = authorize({ body: bodyWith("critical"), filenames: ["src/a.ts", "db/migrations/1.sql"] });
  assert.equal(out.state, "success");
  assert.match(out.description, /D-196/);
});

test("Risk critical on a D-97 path still needs the owner's command (D-196)", () => {
  for (const filenames of [D97, ["src/a.ts", ...D97], ["src/a.ts", "docs/DECISIONS.md"], ["src/a.ts", ".github/workflows/ci.yml"]]) {
    assert.equal(authorize({ body: bodyWith("critical"), filenames }).state, "pending", filenames.join(","));
    assert.equal(authorize({ body: bodyWith("critical"), filenames, comments: [command(head)] }).state, "success");
  }
});

test("a QA-exempt critical PR (only tests or only documents) still needs the owner's command (D-196)", () => {
  for (const filenames of [QA_EXEMPT, ["tests/unit/a.test.ts"], ["db/tests/a.sql"], ["docs/x.md"]]) {
    assert.equal(authorize({ body: bodyWith("critical"), filenames }).state, "pending", filenames.join(","));
    assert.equal(authorize({ body: bodyWith("critical"), filenames, comments: [command(head)] }).state, "success");
  }
});

test("an undeclared or failing metadata never authorizes a critical PR without a command", () => {
  assert.equal(authorize({ body: "Agent: claude:a:platforma\nTask: B-1\n" }).state, "pending");
});

test("a description that fools a regex does not fool the parser (review of #565, finding 1)", () => {
  const body = "Agent: claude:a:platforma\nrisk: critical\nTask: B-1\n\n```\nRisk: standard\n```\n";
  // A QA-exempt path keeps the command for critical but not for standard, so the
  // result shows which risk the parser read.
  assert.equal(authorize({ body, filenames: QA_EXEMPT }).state, "pending");
  assert.equal(authorize({ body: `${bodyWith("critical")}\nRisk: standard\n`, filenames: QA_EXEMPT }).state, "pending");
  assert.equal(authorize({ body: bodyWith("standard"), filenames: QA_EXEMPT }).state, "success");
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
  assert.equal(authorize({ body, filenames: D97 }).state, "pending");
  assert.equal(authorize({ body, filenames: QA_EXEMPT }).state, "pending");
});

test("the command binds to the head: another head, another login, an App or a bot do not count", () => {
  const critical = bodyWith("critical");
  const filenames = D97;
  assert.equal(authorize({ body: critical, filenames, comments: [command(earlier)] }).state, "pending");
  assert.equal(authorize({ body: critical, filenames, comments: [command(head, { login: "someone", association: "MEMBER" })] }).state, "pending");
  assert.equal(authorize({ body: critical, filenames, comments: [command(head, { appSlug: "some-app" })] }).state, "pending");
  assert.equal(authorize({ body: critical, filenames, comments: [command(head, { type: "Bot" })] }).state, "pending");
  assert.equal(authorize({ body: critical, filenames, comments: [comment(`Owner-Command: reject\nCommand-Head: ${head}\n`)] }).state, "pending");
});

test("the command on an earlier head counts only once that head is carried through a clean base merge (D-101)", () => {
  const critical = bodyWith("critical");
  const comments = [command(earlier)];
  assert.equal(authorize({ body: critical, filenames: D97, comments }).state, "pending");
  assert.equal(authorize({ body: critical, filenames: D97, comments, carriedHeads: new Set([earlier]) }).state, "success");
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
  const pr = { body: bodyWith("standard"), head: { sha: head }, changed_files: 1, user: { login: "x" } };
  const out = evaluatePullRequest({
    pr,
    files: [{ filename: "src/a.ts" }],
    comments: [],
    prReviews: [],
    reviewComments: [],
    ownerLogin,
    carriedHeads: new Set(),
  });
  assert.notEqual(out.result.state, "success");
  assert.equal(out.mergeAuthorization.state, "pending");
});
