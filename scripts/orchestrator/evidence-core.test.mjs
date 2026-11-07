// DAN-274: invented fixtures only; gh is never called.
import assert from "node:assert/strict";
import test from "node:test";

import { buildEvidence, parseEvidenceArgs, renderEvidence } from "./evidence-core.mjs";

const H1 = "a".repeat(40);
const H2 = "b".repeat(40);
const BODY = [
  "## Engineering metadata",
  "",
  "Agent: claude:x:platforma",
  "Risk: critical",
  "Task: DAN-1",
  "",
  "Invarijanta: samo čita.",
  "Mjesta: scripts/orchestrator/x.mjs.",
  "Stvarni pozivatelj: ručno pokretanje.",
  "Poznate granice: nema.",
  "Što bi ovaj PR moglo oboriti na QA-i?: posebni znakovi.",
  "",
  "- Neizvedeno: Node 24 lokalno.",
].join("\n");
const pr = (over = {}) => ({ number: 5, state: "OPEN", isDraft: false, headRefOid: H1, body: BODY, ...over });
const verdict = (kind, head, v, text = "") => ({
  user: { login: "owner", type: "User" },
  author_association: "OWNER",
  performed_via_github_app: { slug: "claude" },
  created_at: "2026-10-24T10:00:00Z",
  body: kind === "review"
    ? `Agent-Review: claude:r:reviewer\nReview-Head: ${head}\nReview-Verdict: ${v}\n\n${text}`
    : `QA-Agent: claude:q:qa\nQA-Head: ${head}\nQA-Verdict: ${v}\nQA-Scope: synthetic\n\n${text}`,
});
const ROLLUP = [{ name: "Lint", status: "COMPLETED", conclusion: "SUCCESS", workflowName: "1" }];

test("arguments are strict", () => {
  assert.deepEqual(parseEvidenceArgs(["--pr", "12", "--json"]), { pr: 12, json: true });
  assert.throws(() => parseEvidenceArgs([]), /usage/);
  assert.throws(() => parseEvidenceArgs(["--pr", "0"]), /invalid/);
  assert.throws(() => parseEvidenceArgs(["--pr", "1x"]), /invalid/);
  assert.throws(() => parseEvidenceArgs(["--pr", "1", "--force"]), /invalid/);
});

test("a head that is not a SHA is refused", () => {
  assert.throws(() => buildEvidence({ pr: pr({ headRefOid: "main" }) }), /SHA/);
});

// F-015: a critical QA PASS counts only on a gate path, so the review here comes
// from the owner's Codex CLI and the QA from the Claude App.
const cliReview = (head, v) => {
  const rest = verdict("review", head, v);
  delete rest.performed_via_github_app;
  return { ...rest, body: rest.body.replace("claude:r:reviewer", "codex:r:reviewer").replace("\n\n", "\nReview-Channel: codex-cli\n\n") };
};

test("facts of a PR with a current review and QA", () => {
  const e = buildEvidence({
    pr: pr(),
    events: [], comments: [cliReview(H1, "PASS"), verdict("qa", H1, "PASS")],
    rollup: ROLLUP,
    gate: { state: "success", description: "Carried from 630f1db" },
  });
  assert.equal(e.risk, "critical");
  assert.equal(e.task, "DAN-1");
  assert.deepEqual(e.review, { verdict: "PASS", head: "aaaaaaaa", agent: "codex:r:reviewer", current: true });
  assert.equal(e.qa.verdict, "PASS");
  assert.deepEqual(e.checks, { total: 1, bad: [] });
  assert.equal(e.gate.description, "Carried from 630f1db");
  assert.equal(e.contract.find((c) => c.label === "Invarijanta").text, "samo čita.");
  assert.equal(e.open.find((c) => c.label === "Neizvedeno").text, "Node 24 lokalno.");
  assert.equal(e.open.find((c) => c.label === "Treba Daniel").text, null);
});

test("a verdict for an older head is marked as not this head", () => {
  const e = buildEvidence({ pr: pr({ headRefOid: H2 }), events: [], comments: [verdict("review", H1, "PASS")] });
  assert.equal(e.review.current, false);
  assert.match(renderEvidence(e).join("\n"), /PASS by claude:r:reviewer on aaaaaaaa \(not this head\)/);
});

test("unread data is shown as unread, never as fine", () => {
  const text = renderEvidence(buildEvidence({ pr: pr(), gate: { error: "boom" } })).join("\n");
  assert.match(text, /CI checks: unread/);
  assert.match(text, /Gate status: unread/);
  assert.match(text, /Review verdict on this head: unread/);
  assert.match(text, /QA verdict on this head: unread/);
});

test("failing checks are named", () => {
  const rollup = [{ name: "E2E", status: "COMPLETED", conclusion: "FAILURE", workflowName: "1" }, ...ROLLUP];
  const text = renderEvidence(buildEvidence({ pr: pr(), rollup })).join("\n");
  assert.match(text, /1\/2 not green: E2E=/);
});

test("output carries no review text and no control characters", () => {
  const secret = "ZZFINDING-text-of-the-review";
  const body = `${BODY}\nPoznate granice: dobro\u001b[31m\u202e skriveno\n`;
  const e = buildEvidence({
    pr: pr({ body }),
    events: [], comments: [verdict("review", H1, "FAIL", secret), verdict("qa", H1, "PASS", secret)],
    rollup: ROLLUP,
    gate: { state: "failure", description: `Needs\nreview${"x".repeat(500)}` },
  });
  for (const out of [JSON.stringify(e), renderEvidence(e).join("\n")]) {
    assert.ok(!out.includes(secret));
    assert.ok(!/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e]/.test(out));
  }
  assert.ok(e.gate.description.length <= 300);
});

test("names outside the allowed shape are not printed", () => {
  const e = buildEvidence({ pr: pr({ body: BODY.replace("claude:x:platforma", "evil$(id)") }) });
  assert.equal(e.agent, "<not printed>");
});

test("a job named __proto__ is kept", () => {
  const rollup = [{ name: "__proto__", status: "COMPLETED", conclusion: "FAILURE", workflowName: "1" }];
  assert.equal(buildEvidence({ pr: pr(), rollup }).checks.bad[0].name, "__proto__");
});

// F-015: a head that is not a SHA is read as the gate reads it. A PASS on it is
// no verdict; a FAIL on it holds this head. The head text is never printed.
test("a verdict head that is not a SHA is not printed", () => {
  const evil = `${String.fromCharCode(27)}[2J${String.fromCharCode(0x202e)}evil`;
  const on = (v) => ({ ...verdict("qa", H1, v), body: `QA-Agent: claude:q:qa\nQA-Head: ${evil}\nQA-Verdict: ${v}\nQA-Scope: synthetic\n` });
  const pass = buildEvidence({ pr: pr(), events: [], comments: [on("PASS")] });
  assert.deepEqual(pass.qa, { verdict: "none" });
  const fail = buildEvidence({ pr: pr(), events: [], comments: [on("FAIL")] });
  assert.deepEqual(fail.qa, { verdict: "FAIL", head: "aaaaaaaa", agent: "claude:q:qa", current: true });
  for (const e of [pass, fail]) {
    for (const out of [JSON.stringify(e), renderEvidence(e).join("\n")]) {
      assert.ok(!out.includes("evil"));
      assert.ok(!/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e]/.test(out));
    }
  }
});

// F-015 (cxcr1657): the pack shows what the gate counts.
test("a QA PASS of the reviewer's principal on the same App is not shown as PASS", () => {
  const same = { ...verdict("qa", H1, "PASS"), body: verdict("qa", H1, "PASS").body.replace("claude:q:qa", "claude:r:qa") };
  const e = buildEvidence({ pr: pr(), events: [], comments: [verdict("review", H1, "PASS"), same] });
  assert.equal(e.review.verdict, "PASS");
  assert.deepEqual(e.qa, { verdict: "none" });
});

test("verdicts before the last base change are not shown; unread events are unread", () => {
  const events = [{ event: "base_ref_changed", created_at: "2026-10-24T11:00:00Z" }];
  const comments = [cliReview(H1, "PASS"), verdict("qa", H1, "PASS")];
  const after = buildEvidence({ pr: pr(), events, comments });
  assert.deepEqual([after.review, after.qa], [{ verdict: "none" }, { verdict: "none" }]);
  const unread = buildEvidence({ pr: pr(), comments });
  assert.deepEqual([unread.review, unread.qa], [null, null]);
});
