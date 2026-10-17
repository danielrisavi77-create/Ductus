import test from "node:test";
import assert from "node:assert/strict";

import { carriedByCompare, carriedHeadCandidates, evaluateGate } from "./review-gate-core.mjs";

// Owner decision (#87, issuecomment-6242103643): an Owner-Override carries over
// a clean merge of the base branch exactly like a review or QA verdict (D-101):
// only merges of the base, and only while the PR's own diff is unchanged.
const head = "a".repeat(40);
const earlier = "b".repeat(40);
const ownerLogin = "danielrisavi77-create";
const BODY = "Agent: claude:a:platforma\nRisk: critical\nTask: B-1\n";

let counter = 0;
const comment = (text, { login = ownerLogin, association = "OWNER", appSlug = null, type = "User" } = {}) => ({
  body: text,
  user: { login, type },
  author_association: association,
  performed_via_github_app: appSlug ? { slug: appSlug } : null,
  created_at: new Date(1_700_000_000_000 + counter++ * 1000).toISOString(),
});
const override = (sha, opts, reason = "demo") =>
  comment(`Owner-Override: PASS\nOverride-Head: ${sha}\nOverride-Reason: ${reason}\n`, opts);
const evaluate = (comments, carriedHeads = new Set()) =>
  evaluateGate({ body: BODY, headSha: head, ownerLogin, comments, carriedHeads });

const merge = (sha) => ({ sha, parents: [{}, {}], mergesBase: true });
const plain = (sha) => ({ sha, parents: [{}] });
const file = (patch) => ({ filename: "a.mjs", status: "modified", patch });

test("an override on an earlier head counts once that head is carried", () => {
  assert.equal(evaluate([override(earlier)], new Set([earlier])).state, "success");
});

test("without a carry the override on an earlier head does not count", () => {
  assert.equal(evaluate([override(earlier)]).state, "pending");
  assert.equal(evaluate([override(earlier)], new Set(["c".repeat(40)])).state, "pending");
});

test("a clean base merge names the override head as a carry candidate", () => {
  const path = [merge(head), plain(earlier)];
  assert.deepEqual(carriedHeadCandidates([override(earlier)], head, path), { heads: [earlier], reason: null });
});

test("a commit that is not a base merge stops the carry", () => {
  assert.deepEqual(carriedHeadCandidates([override(earlier)], head, [plain(head), plain(earlier)]).heads, []);
  const notBase = { sha: head, parents: [{}, {}], mergesBase: false };
  assert.deepEqual(carriedHeadCandidates([override(earlier)], head, [notBase, plain(earlier)]).heads, []);
});

test("a changed PR diff does not carry the override", async () => {
  const current = { files: [file("@@ -1 +1 @@\n-a\n+b")] };
  const changed = { files: [file("@@ -1 +1 @@\n-a\n+c")] };
  const carried = await carriedByCompare([earlier], current, async () => changed);
  assert.equal(carried.size, 0);
  assert.equal(evaluate([override(earlier)], carried).state, "pending");
  const same = await carriedByCompare([earlier], current, async () => current);
  assert.equal(evaluate([override(earlier)], same).state, "success");
});

test("an override from the wrong author does not carry", () => {
  const set = new Set([earlier]);
  const outsider = override(earlier, { login: "random-outsider", association: "NONE" });
  const bot = override(earlier, { login: "ductus-botovi[bot]", association: "NONE", type: "Bot" });
  const viaApp = override(earlier, { appSlug: "claude" });
  const collaborator = override(earlier, { login: "someone", association: "COLLABORATOR" });
  for (const item of [outsider, bot, viaApp, collaborator]) {
    assert.equal(evaluate([item], set).state, "pending", item.user.login);
    // Naming a head is harmless; the override check itself is what refuses (viaApp).
    if (item !== viaApp) assert.deepEqual(carriedHeadCandidates([item], head, [merge(head), plain(earlier)]).heads, []);
  }
});

test("an override without a reason does not carry", () => {
  assert.equal(evaluate([override(earlier, undefined, "")], new Set([earlier])).state, "pending");
});

test("a current-head override still works without any carry", () => {
  assert.equal(evaluate([override(head)]).state, "success");
});

// Owner decision on #413 (MANJE 3): a later FAIL or BLOCK on the current head
// voids a carried override; an override given on the current head still wins.
const verdictQa = (sha, verdict) =>
  comment(`QA-Agent: claude:c:qa
QA-Head: ${sha}
QA-Verdict: ${verdict}
QA-Scope: x
`, { appSlug: "claude" });
const verdictReview = (sha, verdict) =>
  comment(`Agent-Review: claude:b:reviewer
Review-Head: ${sha}
Review-Verdict: ${verdict}
`, { appSlug: "claude" });

test("a QA FAIL or BLOCK on the current head voids a carried override", () => {
  for (const verdict of ["FAIL", "BLOCK"]) {
    const result = evaluate([override(earlier), verdictQa(head, verdict)], new Set([earlier]));
    assert.equal(result.state, "pending", verdict);
  }
});

test("a review FAIL or BLOCK on the current head voids a carried override", () => {
  for (const verdict of ["FAIL", "BLOCK"]) {
    assert.equal(evaluate([override(earlier), verdictReview(head, verdict)], new Set([earlier])).state, "pending", verdict);
  }
});

test("an override given on the current head after a FAIL still passes", () => {
  assert.equal(evaluate([verdictQa(head, "FAIL"), override(head)], new Set([earlier])).state, "success");
});

test("a negative verdict on the earlier override head does not void its carried override", () => {
  const comments = [verdictQa(earlier, "FAIL"), override(earlier)];
  assert.equal(evaluate(comments, new Set([earlier])).state, "success");
});

test("a PASS on the current head does not disturb a carried override", () => {
  assert.equal(evaluate([override(earlier), verdictQa(head, "PASS")], new Set([earlier])).state, "success");
});
