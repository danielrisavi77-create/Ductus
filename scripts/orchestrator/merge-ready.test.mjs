import assert from "node:assert/strict";
import { test } from "node:test";

import { evaluateGate } from "../engineering/review-gate-core.mjs";
import { EXIT_CODES, evaluateMergeReady, pickStatus, STATES } from "./merge-ready-core.mjs";

const HEAD = "23db58e9709afc5fcb3c77194aacd52def04b9ce";
const pr = (over = {}) => ({ number: 1041, state: "OPEN", isDraft: false, headRefOid: HEAD, baseRefName: "main", mergeable: "MERGEABLE", ...over });
// The required contexts of main's branch protection as GitHub returns them (1. 11. 2026.).
const ACTIONS = 15368;
const REQUIRED_NAMES = ["Lint, typecheck, test and build", "Local stack (compose.yaml)", "Security scanners", "Dependency review"];
const REQUIRED = [...REQUIRED_NAMES, "Engineering review gate"].map((context) => ({ context, appId: ACTIONS }));
const run = (name, conclusion = "SUCCESS", appId = ACTIONS, i = name) => ({ workflowName: String(i), name, appId, status: "COMPLETED", conclusion, startedAt: "2026-11-01T10:00:00Z" });
const green = REQUIRED_NAMES.map((name) => run(name));
// The fixed descriptions of review-gate-core (evaluateMergeAuthorization) and a carried gate pass.
const GATE_CARRIED = { state: "success", description: "Review PASS and QA PASS (carried from 61f205dd, D-101)." };
const NEEDS_OWNER = { state: "pending", description: "Needs the owner's merge command for this head (D-97 or critical)." };
const OWNER_OK = { state: "success", description: "Owner merge command names this head." };
const ready = (over = {}) => ({ pr: pr(), mergeState: "CLEAN", gate: GATE_CARRIED, authorization: OWNER_OK, rollup: green, required: REQUIRED, threads: { count: 0, authors: [] }, codex: true, ...over });
const level = (r, id) => r.checks.find((c) => c.id === id)?.level;

test("a carried gate pass (D-101) with no QA verdict on the head is ready: the gate decides, not a recount", () => {
  const r = evaluateMergeReady(ready({ codex: false, critical: true }));
  assert.equal(r.state, STATES.READY, r.reason);
  assert.match(r.checks.find((c) => c.id === "gate").text, /carried/);
  assert.equal(level(r, "codex"), "INFO", "Codex is shown, never counted against the gate");
});

test("#1041: gate passed by carry, one unresolved thread, GitHub BLOCKED -> BLOCKED with the thread as reason", () => {
  const r = evaluateMergeReady(ready({ authorization: NEEDS_OWNER, mergeState: "BLOCKED", threads: { count: 1, authors: ["chatgpt-codex-connector"] } }));
  assert.equal(r.state, STATES.BLOCKED);
  assert.match(r.reason, /1 unresolved review thread/);
  assert.match(r.checks.find((c) => c.id === "merge-state").text, /because of: authorization, threads/);
});

test("everything passes but the owner's command: WAITS_OWNER, naming the PR", () => {
  const r = evaluateMergeReady(ready({ authorization: NEEDS_OWNER, mergeState: "BLOCKED" }));
  assert.equal(r.state, STATES.WAITS_OWNER);
  assert.match(r.reason, /Spoji 1041/);
});

test("GitHub BLOCKED with nothing visible to explain it is BLOCKED, never READY", () => {
  const r = evaluateMergeReady(ready({ mergeState: "BLOCKED" }));
  assert.equal(r.state, STATES.BLOCKED);
  assert.match(r.reason, /no status, check or thread read here explains it \(required: Lint, typecheck, test and build, Local stack \(compose\.yaml\), Security scanners, Dependency review, Engineering review gate\)/);
});

test("every failed read is UNREAD, and UNREAD wins over everything else", () => {
  for (const key of ["gate", "authorization", "rollup", "threads"]) {
    for (const value of [{ error: "HTTP 502" }, undefined]) {
      const r = evaluateMergeReady(ready({ [key]: value, threads: key === "threads" ? value : { count: 3, authors: [] } }));
      assert.equal(r.state, STATES.UNREAD, `${key} ${JSON.stringify(value)}`);
    }
  }
  assert.equal(evaluateMergeReady(ready({ threads: { error: "x" }, gate: { state: "failure" } })).state, STATES.UNREAD);
});

test("gate states: missing and pending wait, failure and error block", () => {
  assert.equal(evaluateMergeReady(ready({ gate: null })).state, STATES.WAITING);
  assert.equal(evaluateMergeReady(ready({ gate: { state: "pending", description: "Waiting for QA." } })).state, STATES.WAITING);
  for (const state of ["failure", "error"]) assert.equal(evaluateMergeReady(ready({ gate: { state } })).state, STATES.BLOCKED, state);
  // The gate posts a FAIL or BLOCK verdict as pending (#1110): it needs a fix, so it blocks.
  for (const description of ["Independent review fail on current head.", "Independent QA block on current head.", "CLI note. Independent review block on current head."]) {
    const r = evaluateMergeReady(ready({ gate: { state: "pending", description } }));
    assert.equal(r.state, STATES.BLOCKED, description);
    assert.match(r.reason, /negative verdict/);
  }
  assert.equal(evaluateMergeReady(ready({ gate: { state: "pending", description: "Critical PR: waiting for separately authenticated QA PASS." } })).state, STATES.WAITING);
  // A pending authorization that waits for the gate is a wait, not the owner's turn.
  assert.equal(evaluateMergeReady(ready({ authorization: { state: "pending", description: "Waiting for the Engineering review gate." } })).state, STATES.WAITING);
  assert.equal(evaluateMergeReady(ready({ authorization: { state: "failure" } })).state, STATES.BLOCKED);
});

test("the gate's real text for a FAIL or BLOCK verdict is read as BLOCKED (bound to evaluateGate, not copied)", () => {
  const ownerLogin = "danielrisavi77-create";
  const verdict = (block, verdict, ms) => ({
    body: block === "review"
      ? `Agent-Review: claude:b:reviewer\nReview-Head: ${HEAD}\nReview-Verdict: ${verdict}\n`
      : `QA-Agent: claude:c:qa\nQA-Head: ${HEAD}\nQA-Verdict: ${verdict}\nQA-Scope: x\n`,
    user: { login: ownerLogin },
    author_association: "OWNER",
    performed_via_github_app: { slug: "claude" },
    created_at: new Date(1_800_000_000_000 + ms).toISOString(),
  });
  const body = "Agent: claude:a:platforma\nRisk: critical\nTask: B-1\n";
  for (const comments of [[verdict("review", "FAIL", 1)], [verdict("review", "BLOCK", 1)], [verdict("review", "PASS", 1), verdict("qa", "FAIL", 2)]]) {
    const gate = evaluateGate({ body, headSha: HEAD, ownerLogin, comments, prReviews: [], reviewComments: [] });
    assert.equal(gate.state, "pending", gate.description);
    const r = evaluateMergeReady(ready({ gate }));
    assert.equal(r.state, STATES.BLOCKED, gate.description);
  }
});

test("CI: failing blocks, running waits, none reported waits; the gate's own statuses are not CI", () => {
  const fail = [...green, { workflowName: "3", name: "Security scanners", conclusion: "FAILURE", startedAt: "2026-11-01T10:00:00Z" }];
  assert.equal(evaluateMergeReady(ready({ rollup: fail })).state, STATES.BLOCKED);
  const running = [...green, { workflowName: "3", name: "e2e", status: "IN_PROGRESS", conclusion: "", startedAt: "2026-11-01T10:00:00Z" }];
  assert.equal(evaluateMergeReady(ready({ rollup: running })).state, STATES.WAITING);
  assert.equal(evaluateMergeReady(ready({ rollup: [] })).state, STATES.WAITING);
  const gateOnly = [...green, { context: "Engineering review gate", state: "PENDING" }, { context: "Merge authorization", state: "PENDING" }, { context: "Auto-merge eligible", state: "PENDING" }];
  assert.equal(evaluateMergeReady(ready({ rollup: gateOnly })).state, STATES.READY);
});

test("Codex #1197: a required check that was never reported is not green, so the PR is not READY", () => {
  // The finding's scenario: BEHIND, gate and authorization success, only Security scanners reported.
  const r = evaluateMergeReady(ready({ mergeState: "BEHIND", rollup: [run("Security scanners")] }));
  assert.equal(r.state, STATES.WAITING);
  assert.match(r.reason, /required check\(s\) not reported on the head yet: Lint, typecheck, test and build, Local stack \(compose\.yaml\), Dependency review$/);
  // The same name from another App does not stand in for the required one.
  const otherApp = evaluateMergeReady(ready({ rollup: [...green.slice(1), run(REQUIRED_NAMES[0], "SUCCESS", 999)] }));
  assert.equal(otherApp.state, STATES.WAITING);
  // A required list given as plain strings matches by name only; the gate's own context is never asked of CI.
  assert.equal(evaluateMergeReady(ready({ required: [...REQUIRED_NAMES, "Engineering review gate", "Merge authorization"] })).state, STATES.READY);
  // An unread or empty required list is UNREAD, never "nothing required".
  for (const required of [null, undefined, []]) assert.equal(evaluateMergeReady(ready({ required })).state, STATES.UNREAD, JSON.stringify(required));
  // A required check that failed still blocks, also when another is missing.
  assert.equal(evaluateMergeReady(ready({ rollup: [run("Security scanners", "FAILURE")] })).state, STATES.BLOCKED);
});

test("conflict, draft, closed, other base and an uncomputed merge state", () => {
  assert.equal(evaluateMergeReady(ready({ mergeState: "DIRTY" })).state, STATES.BLOCKED);
  assert.equal(evaluateMergeReady(ready({ pr: pr({ mergeable: "CONFLICTING" }) })).state, STATES.BLOCKED);
  assert.equal(evaluateMergeReady(ready({ pr: pr({ isDraft: true }) })).state, STATES.BLOCKED);
  assert.equal(evaluateMergeReady(ready({ pr: pr({ state: "CLOSED" }) })).state, STATES.BLOCKED);
  assert.equal(evaluateMergeReady(ready({ pr: pr({ baseRefName: "dev" }) })).state, STATES.BLOCKED);
  assert.equal(evaluateMergeReady(ready({ mergeState: "UNKNOWN" })).state, STATES.WAITING);
  for (const ms of ["BEHIND", "UNSTABLE", "HAS_HOOKS", "clean"]) assert.equal(evaluateMergeReady(ready({ mergeState: ms })).state, STATES.READY, ms);
});

test("pickStatus takes the newest status of one context, ties by id", () => {
  const list = [
    { context: "Merge authorization", state: "pending", created_at: "2026-11-01T10:00:00Z", id: 1 },
    { context: "Merge authorization", state: "success", created_at: "2026-11-01T11:00:00Z", id: 2 },
    { context: "Engineering review gate", state: "failure", created_at: "2026-11-01T12:00:00Z", id: 3 },
    { context: "Merge authorization", state: "failure", created_at: "2026-11-01T11:00:00Z", id: 1 },
  ];
  assert.equal(pickStatus(list, "Merge authorization").state, "success");
  assert.equal(pickStatus(list, "Auto-merge eligible"), null);
  assert.equal(pickStatus(undefined, "x"), null);
});

test("exit codes are distinct per state", () => {
  assert.deepEqual(Object.keys(EXIT_CODES).sort(), Object.values(STATES).sort());
  assert.equal(new Set(Object.values(EXIT_CODES)).size, Object.keys(EXIT_CODES).length);
});
