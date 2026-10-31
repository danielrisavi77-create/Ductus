// F-027: a negative verdict the parser cannot read exactly still blocks; a
// malformed PASS still counts for nothing. All identities are invented.
import test from "node:test";
import assert from "node:assert/strict";

import { evaluateGate } from "./review-gate-core.mjs";

const head = "a".repeat(40);
const other = "b".repeat(40);
const ownerLogin = "owner-x";

let counter = 0;
const comment = (body, appSlug = "claude") => ({
  body,
  user: { login: ownerLogin },
  author_association: "OWNER",
  performed_via_github_app: { slug: appSlug },
  created_at: new Date(1_760_000_000_000 + counter++ * 1000).toISOString(),
});
const review = (slot, verdict, sha = head) =>
  comment(`Agent-Review: claude:${slot}:reviewer\nReview-Head: ${sha}\nReview-Verdict: ${verdict}\n`);
const qa = (slot, verdict, { sha = head, scope = "QA-Scope: negative paths\n" } = {}) =>
  comment(`QA-Agent: chatgpt:${slot}:qa\nQA-Head: ${sha}\nQA-Verdict: ${verdict}\n${scope}`, "chatgpt-codex-connector");

const gate = (comments, risk = "standard") =>
  evaluateGate({ body: `Agent: claude:w1:backend\nRisk: ${risk}\nTask: T-1\n`, headSha: head, ownerLogin, comments });

test("control: one valid review PASS on the head passes a standard PR", () => {
  assert.equal(gate([review("r1", "PASS")]).state, "success");
});

test("a negative verdict in other words blocks beside a valid PASS from another slot", () => {
  for (const verdict of ["BLOCK - see below", "**BLOCK**", "fail (two findings)", "FAIL."]) {
    const result = gate([review("r1", "PASS"), review("r2", verdict)]);
    assert.notEqual(result.state, "success", verdict);
  }
});

test("a negative verdict with a short, missing or unreadable head blocks the current head", () => {
  for (const sha of [head.slice(0, 7), "", "see the summary above"]) {
    const result = gate([review("r1", "PASS"), review("r2", "BLOCK", sha)]);
    assert.notEqual(result.state, "success", JSON.stringify(sha));
  }
});

test("a negative verdict on another head, full or short, does not block the current head", () => {
  for (const sha of [other, other.slice(0, 7)]) {
    assert.equal(gate([review("r1", "PASS"), review("r2", "BLOCK", sha)]).state, "success", sha);
  }
});

test("a QA FAIL without its scope line still blocks a critical PR", () => {
  const comments = [review("r1", "PASS"), qa("q1", "PASS"), qa("q2", "FAIL", { scope: "" })];
  assert.notEqual(gate(comments, "critical").state, "success");
  assert.equal(gate([review("r1", "PASS"), qa("q1", "PASS")], "critical").state, "success");
});

test("a malformed PASS still counts for nothing", () => {
  for (const [verdict, sha] of [["PASS - with notes", head], ["PASS", head.slice(0, 7)], ["**PASS**", head]]) {
    assert.notEqual(gate([review("r1", verdict, sha)]).state, "success", `${verdict} ${sha}`);
  }
});

test("a PASS line that names FAIL or BLOCK counts as negative (fails closed)", () => {
  assert.notEqual(gate([review("r1", "PASS"), review("r2", "PASS, no BLOCK left")]).state, "success");
});

test("a later valid PASS from the same slot replaces its own malformed BLOCK, as for any verdict", () => {
  assert.equal(gate([review("r1", "BLOCK - see below"), review("r1", "PASS")]).state, "success");
});
