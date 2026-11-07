// F-015 (review of #1657): the orchestrator tools show and count a verdict the
// way the gate counts it. Each input class runs through both the gate
// (`evaluateGate`) and the tools (`latestVerdict`, `rounds`). Synthetic logins,
// slots and heads only.
import assert from "node:assert/strict";
import test from "node:test";

import fc from "fast-check";

import { evaluateGate, headNegatives, headVerdicts, lastBaseChange, sinceBaseChange } from "../engineering/review-gate-core.mjs";
import { rounds } from "./metrics-core.mjs";
import { latestVerdict, verdictInputs } from "./orchestrator-core.mjs";

const head = "c".repeat(40);
const old = "d".repeat(40);
const ownerLogin = "owner-fixture";
const AUTHOR = "claude:a:platforma";
let counter = 0;
const createdAt = () => new Date(1_700_000_000_000 + counter++ * 1000).toISOString();

const prBody = (risk) => `Agent: ${AUTHOR}\nRisk: ${risk}\nTask: DAN-1\n`;
const owner = (body, { app, edited = false, association = "OWNER", login = ownerLogin } = {}) => {
  const created = createdAt();
  return {
    body,
    user: { login, type: "User" },
    author_association: association,
    ...(app ? { performed_via_github_app: { slug: app } } : {}),
    created_at: created,
    ...(edited ? { updated_at: new Date(Date.parse(created) + 60_000).toISOString() } : {}),
  };
};
const review = ({ agent = "claude:r1:reviewer", verdict = "PASS", sha = head, extra = "", app = "claude", ...over } = {}) =>
  owner(`Agent-Review: ${agent}\nReview-Head: ${sha}\nReview-Verdict: ${verdict}\n${extra}`, { app, ...over });
const qa = ({ agent = "claude:q1:qa", verdict = "PASS", sha = head, scope = true, extra = "", app = "claude", ...over } = {}) =>
  owner(`QA-Agent: ${agent}\nQA-Head: ${sha}\nQA-Verdict: ${verdict}\n${scope ? "QA-Scope: synthetic\n" : ""}${extra}`, { app, ...over });
const CLI = "Review-Channel: codex-cli\n";

const gate = (comments, risk) => evaluateGate({ ownerLogin, headSha: head, body: prBody(risk), comments }).state;
const tool = (comments, kind) => latestVerdict(comments, kind, head, { authorAgent: AUTHOR });
// Only a verdict on the current head can pass the gate; a stale one is shown
// as stale (class 16), not as a current verdict.
const shown = (comments, kind) => {
  const v = tool(comments, kind);
  return v?.current ? v.verdict : null;
};
const counted = (comments, kind) => {
  const r = rounds(comments, kind, { authorAgent: AUTHOR });
  return { total: r.total, pass: r.pass };
};

// Review classes on a standard PR: the gate passes exactly when the tools show
// a PASS on this head.
const reviewClasses = [
  ["1 App PASS", [review()], "PASS", true],
  ["2 owner CLI PASS", [review({ agent: "codex:cli:reviewer", app: null, extra: CLI })], "PASS", true],
  ["3 PASS without an App", [review({ app: null })], null, false],
  ["4 App of another runtime", [review({ app: "chatgpt-codex-connector" })], null, false],
  ["5 edited PASS", [review({ edited: true })], "EDITED", false],
  ["6 edited FAIL", [review({ verdict: "FAIL", edited: true })], "FAIL", false],
  ["9 wrong role", [review({ agent: "claude:r1:qa" })], null, false],
  ["10 FAIL then PASS of one principal (F-023)", [review({ verdict: "FAIL" }), review()], "FAIL", false],
  ["11a markdown negative", [review({ verdict: "**FAIL**" })], "FAIL", false],
  ["11b BLOK", [review({ verdict: "BLOK" }), review({ agent: "claude:r2:reviewer" })], "BLOCK", false],
  ["12a negative on a short head", [review({ verdict: "FAIL", sha: head.slice(0, 7) }), review({ agent: "claude:r2:reviewer" })], "FAIL", false],
  ["12b negative without a head", [review({ verdict: "FAIL", sha: "" }), review({ agent: "claude:r2:reviewer" })], "FAIL", false],
  ["13 author's principal PASS", [review({ agent: "claude:a:reviewer" })], null, false],
  ["14a bot author", [{ ...review(), user: { login: "helper[bot]", type: "Bot" } }], null, false],
  ["14b unlisted author", [review({ association: "COLLABORATOR", login: "helper" })], null, false],
  ["15 two principals, FAIL and PASS", [review({ agent: "claude:r2:reviewer", verdict: "FAIL" }), review()], "FAIL", false],
  ["17 two CLI channels", [review({ agent: "codex:cli:reviewer", app: null, extra: `${CLI}Review-Channel: grok-cli\n` })], null, false],
];

for (const [name, comments, verdict, passes] of reviewClasses) {
  test(`F-015 review class ${name}: tools show what the gate counts`, () => {
    assert.equal(shown(comments, "review"), verdict);
    assert.equal(gate(comments, "standard") === "success", passes);
    assert.equal(shown(comments, "review") === "PASS", passes);
  });
}

// QA classes on a critical PR with a counted review of another principal.
const base = [review({ agent: "codex:cr:reviewer", app: null, extra: CLI })];
const qaClasses = [
  ["7 QA PASS without QA-Scope", [qa({ scope: false })], null, false],
  ["8 QA PASS with QA-Scope", [qa()], "PASS", true],
  ["9 wrong role", [qa({ agent: "claude:q1:reviewer" })], null, false],
  ["10 FAIL then PASS of one principal (F-023)", [qa({ verdict: "FAIL" }), qa()], "FAIL", false],
  ["5 edited QA PASS", [qa({ edited: true })], "EDITED", false],
];

for (const [name, extra, verdict, passes] of qaClasses) {
  test(`F-015 QA class ${name}: tools show what the gate counts`, () => {
    const comments = [...base, ...extra];
    assert.equal(shown(comments, "review"), "PASS");
    assert.equal(shown(comments, "qa"), verdict);
    assert.equal(gate(comments, "critical") === "success", passes);
  });
}

test("F-015 class 16: a PASS only on another head is stale and passes nothing", () => {
  const comments = [review({ sha: old })];
  assert.deepEqual(tool(comments, "review"), { verdict: "PASS", head: old, agent: "claude:r1:reviewer", current: false });
  assert.equal(gate(comments, "standard"), "pending");
});

test("F-015: rounds count a PASS only where the gate counts it", () => {
  for (const comments of [[review({ edited: true })], [qa({ scope: false })], [review({ agent: "claude:r1:qa" })], [review({ verdict: "FAIL" }), review()]]) {
    for (const kind of ["review", "qa"]) assert.equal(counted(comments, kind).pass, 0, `${kind} ${comments[0].body}`);
  }
  assert.deepEqual(counted([review()], "review"), { total: 1, pass: 1 });
  assert.deepEqual(counted([qa()], "qa"), { total: 1, pass: 1 });
  assert.deepEqual(counted([review({ verdict: "FAIL" }), review()], "review"), { total: 1, pass: 0 });
  assert.deepEqual(counted([review({ agent: "claude:a:reviewer" })], "review"), { total: 0, pass: 0 });
});

test("F-015: headVerdicts and headNegatives read nothing without a full head", () => {
  assert.deepEqual(headVerdicts([review()], "review", "abc"), []);
  assert.deepEqual(headNegatives([review({ verdict: "FAIL" })], "review", undefined), []);
  assert.deepEqual(headVerdicts([review()], "other", head), []);
});

// Property: on any mix of review comments the tools never read laxer than the
// gate. A canonical negative the gate does not count (for example without an
// App or in the wrong role) is still shown, so the tools may read stricter;
// without such a negative they read exactly as the gate.
const commentArb = (kind) =>
  fc.record({
    agent: fc.constantFrom(
      ...(kind === "review"
        ? ["claude:r1:reviewer", "claude:R1:reviewer", "claude:r2:reviewer", "codex:c1:reviewer", "grok:g1:reviewer", "claude:a:reviewer", "claude:r1:qa", "x"]
        : ["claude:q1:qa", "claude:q2:qa", "codex:c2:qa", "claude:a:qa", "claude:q1:reviewer"]),
    ),
    verdict: fc.constantFrom("PASS", "pass", "FAIL", "BLOCK", "**FAIL**", "BLOK", "ok"),
    sha: fc.constantFrom(head, head.toUpperCase(), old, head.slice(0, 7), "", "zz"),
    app: fc.constantFrom("claude", "chatgpt-codex-connector", undefined),
    extra: fc.constantFrom("", CLI, "Review-Channel: grok-cli\n", `${CLI}Review-Channel: grok-cli\n`),
    edited: fc.boolean(),
    scope: fc.boolean(),
    association: fc.constantFrom("OWNER", "OWNER", "NONE", "COLLABORATOR"),
  }).map((r) => (kind === "review" ? review(r) : qa(r)));

const uncountedNegative = (comments, kind) =>
  headNegatives(comments, kind, head).length > 0
  && !headVerdicts(comments, kind, head, { authorAgent: AUTHOR }).some((v) => v.verdict === "FAIL" || v.verdict === "BLOCK");

test("F-015 property: a standard PR passes the gate when and only when the tools show a review PASS", () => {
  fc.assert(
    fc.property(fc.array(commentArb("review"), { maxLength: 5 }), (comments) => {
      const passes = gate(comments, "standard") === "success";
      const pass = shown(comments, "review") === "PASS";
      const why = JSON.stringify(comments.map((c) => c.body));
      if (pass) assert.ok(passes, why);
      if (!uncountedNegative(comments, "review")) assert.equal(pass, passes, why);
    }),
    { numRuns: 400 },
  );
});

test("F-015: a negative the gate does not count is still shown, stricter than the gate", () => {
  const comments = [review(), review({ agent: "claude:r1:qa", verdict: "FAIL" })];
  assert.equal(gate(comments, "standard"), "success");
  assert.equal(shown(comments, "review"), "FAIL");
});

test("F-015 property: on a critical PR the tools never show QA laxer than the gate", () => {
  fc.assert(
    fc.property(fc.array(commentArb("qa"), { maxLength: 5 }), (extra) => {
      const comments = [...base, ...extra];
      const qaShown = shown(comments, "qa");
      const passes = gate(comments, "critical") === "success";
      // F-015 (cxcr1657, finding 2): no tolerance; the tools share the gate's
      // critical QA paths, so a shown QA PASS always passes the gate.
      if (qaShown === "PASS") assert.ok(passes, JSON.stringify(comments.map((c) => c.body)));
      if (passes && !uncountedNegative(comments, "qa")) assert.equal(qaShown, "PASS");
    }),
    { numRuns: 400 },
  );
});

// F-015 (review cxcr1657, finding 1): the tools read verdicts after the last
// base change, as the gate runner does (review-gate.mjs), and an unread or
// unreadable event list shows no verdict at all, never a current PASS.
const at = (ms) => new Date(1_800_000_000_000 + ms).toISOString();
const stamped = (comment, ms) => ({ ...comment, created_at: at(ms) });
const baseChange = (ms, event = "base_ref_changed") => ({ event, created_at: typeof ms === "number" ? at(ms) : ms });
// The runner: an unreadable cutoff fails the run (pending), otherwise only
// comments after the cutoff count.
const gateAfterEvents = (comments, events, risk = "standard") => {
  const cutoff = lastBaseChange(events);
  if (cutoff === Infinity) return "pending";
  return evaluateGate({ ownerLogin, headSha: head, body: prBody(risk), comments: sinceBaseChange(comments, cutoff, "created_at", { codexEdits: true }), historyComments: comments }).state;
};
const toolAfterEvents = (comments, events, kind = "review") => {
  const inputs = verdictInputs({ comments, events, reviews: [], reviewComments: [] });
  if (!inputs) return "unread";
  const v = latestVerdict(inputs.comments, kind, head, { authorAgent: AUTHOR, ...inputs });
  return v?.current ? v.verdict : null;
};
const passAt = stamped(review(), 10_000);
const eventClasses = [
  ["E1 events unread", [passAt], undefined, "unread", false],
  ["E2 no events", [passAt], [], "PASS", true],
  ["E3 events without a base change", [passAt], [{ event: "labeled", created_at: at(20_000) }], "PASS", true],
  ["E4 base change after the PASS", [passAt], [baseChange(20_000)], null, false],
  ["E5 base change before the PASS", [passAt], [baseChange(5_000)], "PASS", true],
  ["E6 automatic base change after the PASS", [passAt], [baseChange(20_000, "automatic_base_change_succeeded")], null, false],
  ["E7 base change without a readable time", [passAt], [baseChange("soon")], "unread", false],
  ["E8 PASS in the same instant as the base change", [passAt], [baseChange(10_000)], null, false],
  ["E9 FAIL before the base change, PASS after", [stamped(review({ verdict: "FAIL" }), 1_000), passAt], [baseChange(5_000)], "PASS", true],
];

for (const [name, comments, events, verdict, passes] of eventClasses) {
  test(`F-015 event class ${name}: the tools read after the base change as the gate does`, () => {
    assert.equal(toolAfterEvents(comments, events), verdict);
    assert.equal(gateAfterEvents(comments, events) === "success", passes);
  });
}

test("F-015: verdictInputs gives nothing without readable comments or events", () => {
  assert.equal(verdictInputs({ comments: undefined, events: [] }), null);
  assert.equal(verdictInputs({ comments: [], events: null }), null);
  assert.equal(verdictInputs({ comments: [], events: [baseChange("soon")] }), null);
  const read = verdictInputs({ comments: [passAt], events: [baseChange(20_000)], reviews: [{ submitted_at: at(30_000) }, { submitted_at: at(1_000) }] });
  assert.deepEqual(read.comments, []);
  assert.deepEqual(read.historyComments, [passAt]);
  assert.equal(read.prReviews.length, 1);
  assert.equal(read.quotaReviews.length, 2);
  assert.equal(read.reviewComments, undefined);
});

// F-015 (review cxcr1657, finding 2): on a critical PR the tools count a QA
// PASS only on a path the gate accepts (criticalQaPath, shared with the gate):
// another App than every passing review, or the quota fallback, the D-139
// second session or the Codex pair, each from a principal that gave no review
// PASS. Inputs the tools could not read close the paths that need them.
const QUOTA = "You have reached your Codex usage limits for code reviews.";
const codexBot = { login: "chatgpt-codex-connector[bot]", type: "Bot" };
const quotaMessage = (ms) => ({ body: QUOTA, user: codexBot, author_association: "NONE", performed_via_github_app: { slug: "chatgpt-codex-connector" }, created_at: at(ms) });
const codexPrReview = (sha = head) => ({ user: codexBot, state: "COMMENTED", commit_id: sha, submitted_at: at(1_000) });
const D139 = `Provider-Fallback: claude-second-session — Codex review na headu ${head}\n`;
const claudeReview = (slot = "r") => stamped(review({ agent: `claude:${slot}:reviewer` }), 10_000);
const cliReview = (slot = "cr") => stamped(review({ agent: `codex:${slot}:reviewer`, app: null, extra: CLI }), 10_000);
const claudeQa = (slot, extra = "") => stamped(qa({ agent: `claude:${slot}:qa`, extra }), 20_000);
const full = { prReviews: [], quotaReviews: [], reviewComments: [], historyComments: undefined };
const criticalGate = (comments, opts = {}) =>
  evaluateGate({ ownerLogin, headSha: head, body: prBody("critical"), comments, prReviews: [], reviewComments: [], ...opts }).state;
const criticalTool = (comments, opts = {}) => {
  const v = latestVerdict(comments, "qa", head, { authorAgent: AUTHOR, ...full, ...opts });
  return v?.current ? v.verdict : null;
};
const qaPathClasses = [
  ["Q1 review and QA of one principal on the Claude App (finding)", [claudeReview("r"), claudeQa("r")], {}, null, false],
  ["Q2 QA on another App than the review", [cliReview(), claudeQa("q")], {}, "PASS", true],
  ["Q3 same App, other principal, no path", [claudeReview("r"), claudeQa("q")], {}, null, false],
  ["Q4 Codex pair of two principals", [cliReview("cr"), stamped(qa({ agent: "codex:cq:qa", app: null, extra: CLI }), 20_000)], {}, "PASS", true],
  ["Q5 Codex pair of one principal", [cliReview("cr"), stamped(qa({ agent: "codex:cr:qa", app: null, extra: CLI }), 20_000)], {}, null, false],
  ["Q6 quota fallback with evidence", [quotaMessage(1_000), claudeReview("r"), claudeQa("q", "Provider-Fallback: chatgpt-codex-connector\n")], {}, "PASS", true],
  ["Q7 quota fallback with the PR reviews unread", [quotaMessage(1_000), claudeReview("r"), claudeQa("q", "Provider-Fallback: chatgpt-codex-connector\n")], { prReviews: undefined, quotaReviews: undefined }, null, true],
  ["Q8 D-139 second session", [claudeReview("r"), claudeQa("q", D139)], { prReviews: [codexPrReview()] }, "PASS", true],
  ["Q9 D-139 with the Codex threads unread", [claudeReview("r"), claudeQa("q", D139)], { prReviews: [codexPrReview()], reviewComments: undefined }, null, true],
  ["Q10 D-139 from a principal that once reviewed", [stamped(review({ agent: "claude:q:reviewer", verdict: "FAIL", sha: old }), 5_000), claudeReview("r"), claudeQa("q", D139)], { prReviews: [codexPrReview()] }, null, false],
  ["Q11 QA without any review PASS", [claudeQa("q")], {}, "PASS", false],
  ["Q12 QA FAIL of the reviewer's principal is still shown", [claudeReview("r"), stamped(qa({ agent: "claude:r:qa", verdict: "FAIL" }), 20_000)], {}, "FAIL", false],
  ["Q13 same-App review PASS on another head (stricter than the gate)", [stamped(review({ agent: "claude:r:reviewer", sha: old }), 5_000), cliReview(), claudeQa("q")], {}, null, true],
];

for (const [name, comments, opts, verdict, passes] of qaPathClasses) {
  test(`F-015 critical QA class ${name}: the tools count QA on the gate's paths`, () => {
    assert.equal(criticalTool(comments, opts), verdict);
    const gateOpts = Object.fromEntries(Object.entries(opts).filter(([, value]) => value !== undefined));
    assert.equal(criticalGate(comments, gateOpts) === "success", passes);
    if (verdict === "PASS" && comments.some((c) => c.body.includes("Agent-Review"))) assert.ok(passes, "tool PASS without gate success");
  });
}

test("F-015: the gate keeps its descriptions on each critical QA path", () => {
  const gateResult = (comments, opts = {}) =>
    evaluateGate({ ownerLogin, headSha: head, body: prBody("critical"), comments, prReviews: [], reviewComments: [], ...opts }).description;
  assert.match(gateResult([cliReview(), claudeQa("q")]), /Independently authenticated review and QA are valid for current head\./);
  assert.match(gateResult([quotaMessage(1_000), claudeReview("r"), claudeQa("q", "Provider-Fallback: chatgpt-codex-connector\n")]), /quota fallback: chatgpt-codex-connector/);
  assert.match(gateResult([claudeReview("r"), claudeQa("q", D139)], { prReviews: [codexPrReview()] }), /second Claude session/);
  assert.match(gateResult([cliReview("cr"), stamped(qa({ agent: "codex:cq:qa", app: null, extra: CLI }), 20_000)]), /Codex review and QA pair/);
  assert.match(gateResult([claudeReview("r"), claudeQa("r")]), /waiting for separately authenticated QA PASS/);
});
