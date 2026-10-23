// DAN-264: orch:overlap --plan advice. Pure logic; nothing is read from GitHub.
import assert from "node:assert/strict";
import test from "node:test";

import { overlapPairs } from "./orchestrator-core.mjs";
import { declaredDependencies, isTooling, laneOf, parseArgs, planParallel, renderPlan, taskOf } from "./plan-core.mjs";
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
    pr(3, "frontend", ["scripts/x.mjs", "e2e/a.spec.ts"]), pr(4, "backend", ["db/migrations/0102_b.sql"])];
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
    assignment(3, "frontend", { agent: "claude:s3:platforma" }), assignment(4, "frontend")]);
  const p = plan(prs, c);
  assert.deepEqual(verdicts(p), { 1: "ČEKA OVISNOST", 2: "ČEKA OVISNOST", 3: "ČEKA OVISNOST", 4: "PARALELNO" });
  assert.deepEqual(p.rows.map((r) => r.reasons), [["contract blockers: decision"], ["based on lane/1, not main"],
    ["declared dependency on #1"], []]);
  assert.deepEqual(declaredDependencies("STACKED ON #7, depends on #8", new Set([7, 8])), [7, 8]);
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
    "#2 PARALELNO (frontend, DAN-2, demo, DRAFT)",
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
