// orch:sync, pure core only; git and gh are never called.
import assert from "node:assert/strict";
import test from "node:test";

import { GATE_CONTEXT } from "./orchestrator-core.mjs";
import { ciWait, DEFAULT_WAIT_MIN, headDrift, mergeCheck, parseSyncArgs, syncPlan } from "./sync-core.mjs";

const HEAD = "a".repeat(40);
const PR = { state: "OPEN", baseRefName: "main", headRefName: "claude/x", headRefOid: HEAD, sameRepository: true };
const LOCAL = { branch: "claude/x", head: HEAD, dirty: false, behind: 3 };
const plan = (pr = {}, local = {}) => syncPlan({ pr: { ...PR, ...pr }, local: { ...LOCAL, ...local } });
const run = (name, conclusion, status = "COMPLETED") => ({ name, status, conclusion, completedAt: "2026-11-01T10:00:00Z" });

test("parseSyncArgs accepts a PR number and an optional wait", () => {
  assert.deepEqual(parseSyncArgs(["12"]), { n: 12, waitMin: DEFAULT_WAIT_MIN });
  assert.deepEqual(parseSyncArgs(["12", "--wait-min", "0"]), { n: 12, waitMin: 0 });
  assert.deepEqual(parseSyncArgs(["--wait-min", "5", "12"]), { n: 12, waitMin: 5 });
});

test("parseSyncArgs rejects anything else", () => {
  for (const args of [[], ["x"], ["0"], ["1.5"], ["1", "2"], ["1", "--wait-min"], ["1", "--wait-min", "-1"], ["1", "--force"]]) {
    assert.equal(parseSyncArgs(args), null, args.join(" "));
  }
});

test("syncPlan merges only a lagging branch that matches the PR head", () => {
  assert.equal(plan().action, "merge");
  assert.equal(plan({}, { behind: 0 }).action, "skip");
});

test("syncPlan stops before touching anything when the checkout is not the PR head", () => {
  const stops = [
    plan({ state: "MERGED" }), plan({ baseRefName: "release" }), plan({ sameRepository: false }),
    plan({}, { branch: null }), plan({}, { branch: "main" }), plan({}, { dirty: true }),
    plan({}, { head: "b".repeat(40) }), plan({}, { behind: null }), plan({}, { behind: Number.NaN }),
  ];
  for (const p of stops) {
    assert.equal(p.action, "stop");
    assert.ok(p.reason);
  }
});

test("ciWait waits for an empty, unreadable or running roll-up", () => {
  assert.equal(ciWait([], ["Lint"]).state, "waiting");
  assert.equal(ciWait(null, null).state, "waiting");
  const w = ciWait([run("Lint", "SUCCESS"), run("E2E", "", "IN_PROGRESS")], ["Lint", "E2E"]);
  assert.equal(w.state, "waiting");
  assert.deepEqual(w.running, ["E2E"]);
  for (const status of ["WAITING", "REQUESTED", "QUEUED"]) {
    assert.equal(ciWait([run("Lint", "SUCCESS"), run("Deploy", status, status)], ["Lint"]).state, "waiting", status);
  }
});

test("ciWait waits for a required check that has not reported yet", () => {
  const w = ciWait([{ ...run("Lint", "SUCCESS"), appId: 1 }], [{ context: "Lint", appId: 1 }, "E2E"]);
  assert.equal(w.state, "waiting");
  assert.deepEqual(w.missing, ["E2E"]);
});

test("ciWait does not take a same-named check of another App for an App-bound required check", () => {
  const required = [{ context: "Lint", appId: 1 }];
  const other = ciWait([{ ...run("Lint", "SUCCESS"), appId: 2 }], required);
  assert.equal(other.state, "waiting");
  assert.deepEqual(other.missing, ["Lint app 1"]);
  assert.equal(ciWait([{ context: "Lint", state: "SUCCESS" }], required).state, "waiting");
  assert.equal(ciWait([{ ...run("Lint", "SUCCESS"), appId: 1 }], required).state, "settled");
});

test("ciWait is settled on finished checks, red or green, and ignores the statuses that wait for people", () => {
  const rollup = [run("Lint", "SUCCESS"), run("E2E", "FAILURE"),
    { context: GATE_CONTEXT, state: "PENDING" }, { context: "Merge authorization", state: "PENDING" },
    { context: "Auto-merge eligible", state: "PENDING" },
    { name: "Mergify Merge Queue", appSlug: "mergify", status: "IN_PROGRESS", conclusion: "" }];
  const w = ciWait(rollup, ["Lint", "E2E", GATE_CONTEXT, "Merge authorization", "Auto-merge eligible"]);
  assert.deepEqual(w, { state: "settled", running: [], missing: [] });
});

test("headDrift accepts only the exact branch and head that CI and preflight covered", () => {
  const expected = { branch: "claude/x", head: HEAD };
  const cases = [
    ["same branch and head", { branch: "claude/x", head: HEAD }, null],
    ["a new local commit", { branch: "claude/x", head: "b".repeat(40) }, /head moved to bbbbbbbb/],
    ["another branch on the same head", { branch: "other", head: HEAD }, /branch moved to other/],
    ["detached HEAD", { branch: null, head: HEAD }, /branch moved to \(detached\)/],
    ["unreadable head", { branch: "claude/x", head: null }, /head moved to \(unreadable\)/],
    ["abbreviated head", { branch: "claude/x", head: HEAD.slice(0, 12) }, /head moved/],
    ["branch and head both moved", { branch: "other", head: "c".repeat(40) }, /branch moved to other.*head moved to cccccccc/],
  ];
  for (const [name, now, want] of cases) {
    const got = headDrift(now, expected);
    if (want === null) assert.equal(got, null, name);
    else assert.match(String(got), want, name);
  }
});

// Every state the checkout can be in after the merge step; only (a) and (d) may be pushed.
test("mergeCheck lets only a concluded merge that contains main and the PR head through", () => {
  const OLD = "b".repeat(40);
  const NEW = "c".repeat(40);
  const MAIN = "d".repeat(40);
  const ok = { before: OLD, main: MAIN, containedBefore: false, head: NEW, mergeInProgress: false, mainInHead: true, beforeInHead: true };
  const cases = [
    ["(a) concluded merge", {}, null],
    ["(b) MERGE_HEAD present, HEAD unchanged", { head: OLD, mergeInProgress: true, mainInHead: false }, /MERGE_HEAD/],
    ["(b) MERGE_HEAD present, HEAD moved", { mergeInProgress: true }, /MERGE_HEAD/],
    ["(c) HEAD without main", { head: OLD, mainInHead: false }, /does not contain the fetched main d{8}/],
    ["(c) HEAD moved, still without main", { mainInHead: false }, /does not contain the fetched main/],
    ["(d) already up to date", { head: OLD, containedBefore: true }, null],
    ["(e) HEAD moved off the PR head", { beforeInHead: false }, /does not contain the PR head b{8}/],
    ["(f) HEAD did not move, main was not in it", { head: OLD }, /did not move/],
    ["(g) head unreadable", { head: null }, /HEAD could not be read/],
    ["(g) merge state unreadable", { mergeInProgress: null }, /MERGE_HEAD/],
    ["(g) main ancestry unreadable", { mainInHead: null }, /does not contain the fetched main/],
    ["(g) PR head ancestry unreadable", { beforeInHead: null }, /does not contain the PR head/],
    ["(g) earlier containment unreadable", { head: OLD, containedBefore: null }, /did not move/],
  ];
  for (const [name, change, want] of cases) {
    const got = mergeCheck({ ...ok, ...change });
    if (want === null) assert.equal(got, null, name);
    else assert.match(String(got), want, name);
  }
});
