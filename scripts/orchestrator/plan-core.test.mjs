// DAN-264: orch:overlap --plan advice. Pure logic; nothing is read from GitHub.
import assert from "node:assert/strict";
import test from "node:test";

import { prPaths } from "./gh.mjs";
import { overlapPairs } from "./orchestrator-core.mjs";
import { DEMO_FIRST_UNTIL, declaredDependencies, isTooling, laneOf, parseArgs, planParallel, renderPlan, taskOf, writerOf } from "./plan-core.mjs";
import { contractState } from "./work-guard-core.mjs";

const NOW = Date.parse("2026-10-23T22:00:00Z");
const SHA = "a".repeat(40);
const body = (role, task, extra = "") => `Agent: codex:s${task}:${role}\nRisk: critical\nTask: DAN-${task}\n${extra}`;
const pr = (number, role, paths, over = {}) => ({
  number, isDraft: false, baseRefName: "main", body: body(role, number), paths, ...over,
});
const assignment = (n, role, over = {}) => ({
  task: `DAN-${n}`, agent: `codex:s${n}:${role}`, branch: `lane/${n}`, baseSha: SHA, paths: ["src/"],
  pr: n, failures: [], regressions: 0, blockers: [], ...over,
});
const contract = (assignments, over = {}) => ({
  schema: 1, repository: "danielrisavi77-create/Ductus",
  issuedAt: "2026-10-23T21:55:00Z", expiresAt: "2026-10-23T22:05:00Z", assignments, ...over,
});
const plan = (prs, c, independent) => planParallel({ prs, pairs: overlapPairs(prs), contract: c, now: NOW, independent });
const verdicts = (p) => Object.fromEntries(p.rows.map((r) => [r.number, r.verdict]));

test("three writers on separate files with active assignments run in parallel", () => {
  const prs = [pr(598, "backend", ["db/tests/a.sql", "src/server/evidence/x.ts"]),
    pr(600, "platforma", [".github/workflows/ci.yml"]), pr(610, "frontend", ["src/components/editor/a.tsx"])];
  const c = contract([assignment(598, "backend"), assignment(600, "platforma"), assignment(610, "frontend")]);
  // without the orchestrator's check the backend x frontend pair stays unproven
  assert.deepEqual(verdicts(plan(prs, c)), { 598: "NEPROVJERENO", 600: "PARALELNO", 610: "NEPROVJERENO" });
  const p = plan(prs, c, [[610, 598]]);
  assert.deepEqual(verdicts(p), { 598: "PARALELNO", 600: "PARALELNO", 610: "PARALELNO" });
  assert.equal(p.contract, "VALID");
  assert.deepEqual(p.rows.map((r) => r.kind), ["demo", "tooling", "demo"]);
});

test("missing, invalid, stale or unreadable contract never gives PARALELNO", () => {
  const prs = [pr(1, "backend", ["src/server/a.ts"])];
  const good = contract([assignment(1, "backend")]);
  for (const [c, state] of [[null, "MISSING"], [{}, "INVALID_CONTRACT"],
    [{ ...good, repository: "other/repo" }, "INVALID_CONTRACT"],
    [{ ...good, expiresAt: "2026-10-23T21:59:00Z" }, "STALE_CONTRACT"],
    [{ ...good, issuedAt: "2026-10-23T22:01:00Z" }, "STALE_CONTRACT"],
    [{ ...good, assignments: [{ ...assignment(1, "backend"), agent: "nobody" }] }, "INVALID_CONTRACT"]]) {
    const p = plan(prs, c);
    assert.equal(p.contract, state);
    assert.equal(p.rows[0].verdict, "NEPROVJERENO", state);
  }
  assert.equal(contractState(good, Number.NaN), "STALE_CONTRACT");
});

test("unread files, no writer role, no DAN task, no or wrong assignment are NEPROVJERENO", () => {
  const prs = [pr(1, "backend", null), pr(2, "backend", ["a.ts"], { body: "Agent: codex:x:reviewer\nTask: DAN-2" }),
    pr(3, "frontend", ["b.ts"], { body: "Agent: codex:s3:frontend\nTask: #87" }), pr(4, "frontend", ["c.ts"]),
    pr(5, "frontend", ["d.ts"]), pr(6, "frontend", ["e.ts"])];
  const c = contract([assignment(1, "backend"), assignment(2, "backend"), assignment(3, "frontend"),
    assignment(5, "backend"), assignment(6, "frontend", { task: "DAN-60" })]);
  const p = plan(prs, c);
  assert.deepEqual(verdicts(p), { 1: "NEPROVJERENO", 2: "NEPROVJERENO", 3: "NEPROVJERENO",
    4: "NEPROVJERENO", 5: "NEPROVJERENO", 6: "NEPROVJERENO" });
  const why = Object.fromEntries(p.rows.map((r) => [r.number, r.reasons.join("; ")]));
  assert.match(why[1], /files could not be read/);
  assert.match(why[2], /no writer/);
  assert.match(why[3], /no DAN task/);
  assert.match(why[4], /no active assignment/);
  assert.match(why[5], /contract assigns codex:s5:backend/);
  assert.match(why[6], /contract task DAN-60 differs/);
});

test("shared files and migration order are PREKLAPANJE, named on both sides", () => {
  const prs = [pr(1, "backend", ["db/migrations/0101_a.sql"]), pr(2, "platforma", ["scripts/x.mjs"]),
    pr(3, "frontend", ["scripts/x.mjs", "e2e/a.spec.ts"]), pr(4, "backend", ["db/migrations/0102_b.sql"], { isDraft: true })];
  const c = contract([assignment(1, "backend"), assignment(2, "platforma"), assignment(3, "frontend")]);
  const p = plan(prs, c);
  assert.equal(p.rows[1].verdict, "PREKLAPANJE");
  assert.deepEqual(p.rows[1].reasons, ["#3: 1 shared file"]);
  assert.deepEqual(p.rows[2].reasons, ["#2: 1 shared file"]);
  // #4 has no assignment, so it stays NEPROVJERENO, and #1 still sees the migration order
  assert.equal(p.rows[0].verdict, "PREKLAPANJE");
  assert.deepEqual(p.rows[0].reasons, ["#4: order of db/migrations"]);
  assert.equal(p.rows[3].verdict, "NEPROVJERENO");
});

test("a backend contract and another writer's screens are unproven, not parallel (#575 x #608)", () => {
  const prs = [
    pr(575, "backend", ["app/api/institution/courses/[courseId]/enrollment-code/route.ts", "src/server/institution/enrollment-code-route.ts"]),
    pr(608, "frontend", ["app/upis/page.tsx", "src/components/shell/shell-role.ts"]),
    pr(600, "platforma", [".github/workflows/ci.yml"]),
  ];
  const c = contract([assignment(575, "backend"), assignment(608, "frontend"), assignment(600, "platforma")]);
  const p = plan(prs, c);
  assert.deepEqual(verdicts(p), { 575: "NEPROVJERENO", 600: "PARALELNO", 608: "NEPROVJERENO" });
  assert.match(p.rows[0].reasons[0], /possible shared contract with #608 \(frontend\)/);
  assert.match(p.rows[2].reasons[0], /possible shared contract with #575 \(backend\)/);
  // a confirmation of another pair clears nothing here
  assert.deepEqual(verdicts(plan(prs, c, [[575, 600]])), verdicts(p));
  // client code that calls the API and backend adapters count too
  const client = [pr(1, "backend", ["app/api/sync/route.ts"]), pr(2, "frontend", ["src/lib/sync/drainRunner.ts"]),
    pr(3, "backend", ["src/adapters/storage/s3.ts"]), pr(4, "frontend", ["app/rad/page.tsx"])];
  const cc = contract([assignment(1, "backend"), assignment(2, "frontend"), assignment(3, "backend", { agent: "claude:s3:backend" }), assignment(4, "frontend", { agent: "claude:s4:frontend" })]);
  const cp = plan(client, cc);
  assert.equal(cp.contract, "VALID");
  assert.deepEqual(verdicts(cp), { 1: "NEPROVJERENO", 2: "NEPROVJERENO", 3: "NEPROVJERENO", 4: "NEPROVJERENO" });
  assert.match(cp.rows[1].reasons.join("; "), /possible shared contract with #1 \(backend\)/);
  assert.match(cp.rows[3].reasons.join("; "), /possible shared contract with #3 \(backend\)/);
  // an API route alone is not a screen: two backend-contract PRs of different writers are not flagged
  const api = [pr(1, "backend", ["src/server/a.ts"]), pr(2, "platforma", ["app/api/health/route.ts"])];
  assert.deepEqual(verdicts(plan(api, contract([assignment(1, "backend"), assignment(2, "platforma")]))),
    { 1: "PARALELNO", 2: "PARALELNO" });
});

test("a stacked base, a declared dependency or a contract blocker is ČEKA OVISNOST", () => {
  const prs = [pr(1, "backend", ["src/server/a.ts"]), pr(2, "platforma", ["scripts/a.mjs"], { baseRefName: "lane/1" }),
    pr(3, "platforma", ["scripts/b.mjs"], { body: body("platforma", 3, "Ovisi o #1 i depends on #999, čeka #3") }),
    pr(4, "frontend", ["e2e/a.spec.ts"])];
  const c = contract([assignment(1, "backend", { blockers: ["decision"] }), assignment(2, "platforma"),
    assignment(3, "platforma"), assignment(4, "frontend")]);
  const p = planParallel({ prs, pairs: overlapPairs(prs), contract: c, now: NOW, slots: 4 });
  assert.deepEqual(verdicts(p), { 1: "ČEKA OVISNOST", 2: "ČEKA OVISNOST", 3: "ČEKA OVISNOST", 4: "PARALELNO" });
  assert.deepEqual(p.rows.map((r) => r.reasons), [["contract blockers: decision"], ["based on lane/1, not main"],
    ["declared dependency on #1"], []]);
  assert.deepEqual(declaredDependencies("STACKED ON #7, depends on #8", new Set([7, 8])), [7, 8]);
  for (const text of ["čeka #596", "PR čeka #596", "Task: Čeka #596", "(čeka #596)"]) {
    assert.deepEqual(declaredDependencies(text, new Set([596])), [596], text);
  }
  // a word that only ends in one of the phrases is not a declaration
  assert.deepEqual(declaredDependencies("isčeka #596, nedepends on #596", new Set([596])), []);
  const waits = [pr(596, "platforma", ["scripts/gate.mjs"]), pr(597, "frontend", ["e2e/b.spec.ts"], { body: body("frontend", 597, "PR čeka #596") })];
  assert.equal(plan(waits, contract([assignment(596, "platforma"), assignment(597, "frontend")])).rows[1].verdict, "ČEKA OVISNOST");
});

test("free gate slots go to demo drafts before tooling drafts; the rest wait", () => {
  const prs = [pr(10, "backend", ["src/server/a.ts"]), pr(11, "platforma", ["scripts/a.mjs"], { isDraft: true }),
    pr(12, "frontend", ["e2e/x.spec.ts"], { isDraft: true }), pr(13, "platforma", ["docs/A.md"], { isDraft: true })];
  const c = contract([assignment(10, "backend"), assignment(11, "platforma"), assignment(12, "frontend")]);
  const p = plan(prs, c);
  // #13 is not assigned (unproven), so 2 free slots go to demo #12, then tooling #11
  assert.deepEqual(verdicts(p), { 10: "PARALELNO", 11: "PARALELNO", 12: "PARALELNO", 13: "NEPROVJERENO" });
  const full = planParallel({ prs, pairs: overlapPairs(prs), contract: c, now: NOW, slots: 2 });
  assert.deepEqual(verdicts(full), { 10: "PARALELNO", 11: "ČEKA OVISNOST", 12: "PARALELNO", 13: "NEPROVJERENO" });
  assert.deepEqual(full.rows[1].reasons, ["gate full (2 slots)"]);
  const over = planParallel({ prs: prs.map((x) => ({ ...x, isDraft: false })), pairs: [], contract: c, now: NOW, slots: 2 });
  assert.equal(over.overfull, true);
  assert.match(renderPlan(over).join("\n"), /WARNING: 4 PRs out of draft, more than the 2 gate slots/);
});

test("rendered plan and helpers", () => {
  const prs = [pr(2, "frontend", ["e2e/a.spec.ts"], { isDraft: true }), pr(1, "platforma", null)];
  const lines = renderPlan(plan(prs, contract([assignment(2, "frontend")])));
  assert.deepEqual(lines, [
    "#1 NEPROVJERENO (platforma, DAN-1, ?, in gate)",
    "  files could not be read",
    "  no active assignment in the work contract",
    "#2 NEPROVJERENO (frontend, DAN-2, demo, DRAFT)",
    "  overlap unknown: files of #1 could not be read",
    "Contract: VALID. Gate: 1/3. Advice only: the orchestrator decides.",
  ]);
  assert.equal(laneOf("Agent: claude:a:Frontend"), "frontend");
  assert.equal(laneOf("Agent: claude:a:reviewer"), null);
  assert.equal(taskOf("Task: DAN-264"), "DAN-264");
  assert.equal(isTooling([]), false);
  assert.equal(isTooling(["scripts/a.mjs", "docs/B.md"]), true);
  assert.equal(isTooling(["scripts/a.mjs", "src/a.ts"]), false);
});

test("arguments: unknown ones fail, the contract defaults to the environment", () => {
  assert.deepEqual(parseArgs([]), { json: false, plan: false, contract: null, independent: [] });
  assert.deepEqual(parseArgs(["--", "--plan", "--json", "--independent", "598:608"], { DUCTUS_WORK_CONTRACT: "/tmp/c.json" }),
    { json: true, plan: true, contract: "/tmp/c.json", independent: [[598, 608]] });
  assert.equal(parseArgs(["--plan", "--contract", "x.json"]).contract, "x.json");
  for (const bad of [["--plan", "--contract"], ["--contract", "--json"], ["--yes"], ["12"],
    ["--independent"], ["--independent", "598"], ["--independent", "0:5"], ["--independent", "5:6:7"]]) {
    assert.throws(() => parseArgs(bad), /unknown or incomplete argument/);
  }
  assert.throws(() => parseArgs(["--independent", "5:5"]), /not a pair/);
});

test("a PR whose files could not be read makes every other PR's overlap unknown", () => {
  const prs = [pr(1, "backend", null), pr(2, "frontend", ["e2e/a.spec.ts"], { isDraft: true })];
  const p = plan(prs, contract([assignment(1, "backend"), assignment(2, "frontend")]));
  assert.deepEqual(verdicts(p), { 1: "NEPROVJERENO", 2: "NEPROVJERENO" });
  assert.deepEqual(p.rows[1].reasons, ["overlap unknown: files of #1 could not be read"]);
  assert.deepEqual(p.rows[0].reasons, ["files could not be read"]);
});

test("two writers in the same role are checked for a shared contract; one writer is not", () => {
  const prs = [pr(1, "frontend", ["src/domain/document/a.ts"]), pr(2, "frontend", ["src/editor/b.ts"])];
  const c = contract([assignment(1, "frontend"), assignment(2, "frontend")]);
  const p = plan(prs, c);
  assert.deepEqual(verdicts(p), { 1: "NEPROVJERENO", 2: "NEPROVJERENO" });
  assert.match(p.rows[1].reasons[0], /possible shared contract with #1 \(frontend\)/);
  const same = prs.map((x) => ({ ...x, body: "Agent: codex:one:frontend\nTask: DAN-" + x.number }));
  const one = contract([assignment(1, "frontend", { agent: "codex:one:frontend" }),
    assignment(2, "frontend", { agent: "claude:one:frontend" })]);
  // the contract wants different principals, so check the pair rule directly on the rows
  const rows = planParallel({ prs: same, pairs: [], contract: one, now: NOW }).rows;
  assert.ok(rows.every((r) => !r.reasons.some((x) => /shared contract/.test(x))));
  assert.equal(writerOf("Agent: Codex:Slot1:frontend"), "codex:slot1");
  assert.equal(writerOf("Agent: codex:slot1:reviewer"), null);
});

test("D-107: a tooling draft waits while any demo draft is left in the queue, until the demo", () => {
  const prs = [pr(1, "backend", ["src/server/a.ts"], { isDraft: true }), pr(2, "platforma", ["scripts/a.mjs"], { isDraft: true })];
  const c = contract([assignment(1, "backend", { blockers: ["decision"] }), assignment(2, "platforma")]);
  const p = plan(prs, c);
  assert.deepEqual(verdicts(p), { 1: "ČEKA OVISNOST", 2: "ČEKA OVISNOST" });
  assert.deepEqual(p.rows[1].reasons, ["D-107: demo PR #1 waits in the queue"]);
  // after the demo the rule no longer applies (contract dates moved with the clock)
  const later = DEMO_FIRST_UNTIL + 60_000;
  const c2 = { ...c, issuedAt: new Date(later - 60_000).toISOString(), expiresAt: new Date(later + 60_000).toISOString() };
  assert.equal(planParallel({ prs, pairs: [], contract: c2, now: later }).rows[1].verdict, "PARALELNO");
  // a demo draft that got a slot does not hold tooling back; a full gate then does
  const two = [pr(1, "backend", ["src/server/a.ts"], { isDraft: true }), pr(2, "platforma", ["scripts/a.mjs"], { isDraft: true })];
  const c3 = contract([assignment(1, "backend"), assignment(2, "platforma")]);
  assert.deepEqual(verdicts(plan(two, c3)), { 1: "PARALELNO", 2: "PARALELNO" });
  const full = planParallel({ prs: two, pairs: [], contract: c3, now: NOW, slots: 1 });
  assert.deepEqual(verdicts(full), { 1: "PARALELNO", 2: "ČEKA OVISNOST" });
  assert.deepEqual(full.rows[1].reasons, ["gate full (1 slots)"]);
});

test("rough inputs never give PARALELNO: other identity, empty or malformed files, unknown base, overfull gate", async () => {
  // the contract names another writer in the same role
  const one = [pr(1, "frontend", ["e2e/a.spec.ts"])];
  const other = plan(one, contract([assignment(1, "frontend", { agent: "claude:assigned:frontend" })]));
  assert.deepEqual(other.rows[0], { ...other.rows[0], verdict: "NEPROVJERENO", reasons: ["contract assigns claude:assigned:frontend"] });
  // a body that copies another PR's identity loses the same-writer exemption with its own assignment
  const spoof = [pr(1, "frontend", ["src/domain/a.ts"]), pr(2, "frontend", ["src/editor/a.ts"], { body: body("frontend", 1).replace("DAN-1", "DAN-2") })];
  const sp = plan(spoof, contract([assignment(1, "frontend"), assignment(2, "frontend")]));
  assert.equal(sp.rows[1].verdict, "NEPROVJERENO");
  assert.match(sp.rows[1].reasons.join("; "), /contract assigns codex:s2:frontend/);
  // an empty list and an unknown base
  const rough = [pr(1, "frontend", []), pr(2, "backend", ["src/server/a.ts"], { baseRefName: undefined })];
  const rp = plan(rough, contract([assignment(1, "frontend"), assignment(2, "backend")]));
  assert.deepEqual(rp.rows.map((r) => [r.verdict, r.reasons]), [
    ["NEPROVJERENO", ["no changed files listed"]], ["NEPROVJERENO", ["base branch unknown"]]]);
  // malformed file entries are a failed read
  for (const bad of [[{ status: "modified" }], [{ filename: 123, status: "modified" }], [{ filename: "", status: "added" }],
    [{ filename: "src/new.ts", status: "renamed" }]]) {
    await assert.rejects(prPaths(5, async () => bad), /malformed entry/);
  }
  assert.deepEqual(await prPaths(5, async () => [{ filename: "src/new.ts", previous_filename: "src/old.ts", status: "renamed" }]), ["src/new.ts", "src/old.ts"]);
  // four PRs out of draft for three slots: none is advice-ready
  const four = [1, 2, 3, 4].map((n) => pr(n, ["backend", "frontend", "platforma", "backend"][n - 1], [`e2e/${n}.spec.ts`]));
  const fc = contract([1, 2, 3].map((n) => assignment(n, ["backend", "frontend", "platforma"][n - 1])));
  const fp = plan(four, fc);
  assert.equal(fp.overfull, true);
  assert.ok(fp.rows.every((r) => r.verdict !== "PARALELNO"));
  assert.match(fp.rows[0].reasons.join("; "), /gate over capacity \(4 out of draft, 3 slots\)/);
});
