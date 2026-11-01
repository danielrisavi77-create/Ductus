// Task brief generator and next-task advice. Pure logic over the real PLAN-DEMO and SESSIONS
// files, plus a synthetic table for the edge cases. Nothing is read from GitHub or Linear.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  PLAN_ISSUE_RE, TASK_ID_RE, TEMP_DECISION_URL, buildBrief, dependents, parseCli, parseList, parseOwnership, parsePlanTasks,
  pickNext, renderNext, riskFloor,
} from "./brief-core.mjs";

const read = (p) => readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), "utf8");
const plan = read("docs/PLAN-DEMO.md");
const sessions = read("docs/SESSIONS.md");
const tasks = parsePlanTasks(plan);
const ownership = parseOwnership(sessions);
const PLAN_URL = "https://github.com/danielrisavi77-create/Ductus/issues/153";
const brief = (id, opts) => buildBrief({ tasks, ownership, id, opts });
const get = (id) => tasks.find((t) => t.id === id);

const SYNTH = `## 4. Zadaci
### Platforma
| ID | Zadatak | Ovisi o | Gotovo kad | T |
| --- | --- | --- | --- | --- |
| P-1 | Kostur | | testovi zeleni | T1 |
| P-2 | CI | P-1 | CI zelen | T1 |
### Backend
| ID | Zadatak | Ovisi o | Gotovo kad | T |
| --- | --- | --- | --- | --- |
| B-1 | Plan | | plan poslan | T1 |
| B-2 | Domena (D-98) | P-1, B-1 (B-3 nakon demoa; D-98 dopuna), #240 | isti testovi | T2 |
| B-3 | Idući | B-2 | testovi | T3 |
### Frontend
| ID | Zadatak | Ovisi o | Gotovo kad | T |
| --- | --- | --- | --- | --- |
| F-1 | Ekran | P-1 | snimka odgovara | T2 |
### Kratkotrajne sesije i Daniel
| ID | Zadatak | Ovisi o | Gotovo kad | T |
| --- | --- | --- | --- | --- |
| D-1 | Dizajn | | odobreno | T1 |
## 5. Rezovi
| B-9 | ne ulazi | | | |
`;

test("real PLAN-DEMO: every row parses, ids are unique, dependencies point at real rows", () => {
  assert.ok(tasks.length >= 30);
  for (const t of tasks) {
    assert.match(t.id, TASK_ID_RE);
    assert.ok(t.doneWhen.length > 0, `${t.id} has no 'Gotovo kad'`);
    for (const d of t.deps) assert.ok(get(d), `${t.id} depends on unknown ${d}`);
  }
  assert.equal(get("B-8").role, "backend");
  assert.deepEqual(get("B-8").deps, ["B-3", "B-7"]);
  assert.deepEqual(get("B-8").external, ["#240"]);
  assert.equal(get("D-2").role, "daniel");
});

test("real SESSIONS: ownership cells exist for the three standing writers", () => {
  for (const r of ["backend", "frontend", "platforma"]) assert.match(ownership[r], /`/, `${r} ownership missing`);
  assert.match(ownership.backend, /src\/domain\//);
  assert.match(ownership.frontend, /e2e\//);
});

test("real SESSIONS still publishes the decision URL the brief cites", () => {
  assert.ok(sessions.includes(TEMP_DECISION_URL));
});

test("synthetic table: commentary in brackets is not a dependency, section 5 rows are ignored", () => {
  const t = parsePlanTasks(SYNTH);
  assert.deepEqual(t.map((x) => x.id), ["P-1", "P-2", "B-1", "B-2", "B-3", "F-1", "D-1"]);
  const b2 = t.find((x) => x.id === "B-2");
  assert.deepEqual(b2.deps, ["P-1", "B-1"]);
  assert.deepEqual(b2.external, ["#240"]);
  assert.deepEqual(dependents(t, "P-1"), ["B-2", "B-3", "F-1", "P-2"]);
  assert.throws(() => parsePlanTasks("# nothing"), /not found/);
  assert.throws(() => parsePlanTasks(SYNTH.replace("| P-2 | CI |", "| P-1 | CI |")), /duplicate/);
});

test("brief: refuses without a Linear task, with unmet dependencies, and for owner tasks", () => {
  const r = brief("B-8", { done: [] });
  assert.equal(r.text, null);
  assert.ok(r.problems.some((p) => /--task/.test(p)));
  assert.ok(r.problems.some((p) => /unmet dependencies: B-3, B-7, #240/.test(p)));
  assert.match(brief("D-2", { task: "DAN-1" }).problems[0], /owner task/);
  assert.match(brief("Z-9", { task: "DAN-1" }).problems[0], /not in PLAN/);
  assert.ok(brief("P-1", { task: "DAN-1x" }).problems.some((p) => /--task/.test(p)));
});

test("brief: critical needs a plan-of-attack issue, and risk can only go up", () => {
  const base = { task: "DAN-900", done: ["B-3", "B-7", "#240"] };
  assert.equal(riskFloor(get("B-8")), "critical");
  assert.equal(riskFloor(get("K-1")), "standard", "'sesija Arhitektura' is a Claude session, not a login session");
  assert.ok(brief("B-8", base).problems.some((p) => /--plan/.test(p)));
  assert.ok(brief("B-8", { ...base, plan: "https://example.com/issues/1" }).problems.some((p) => /--plan/.test(p)));
  assert.ok(brief("B-8", { ...base, plan: PLAN_URL, risk: "standard" }).problems.some((p) => /below the floor/.test(p)));
  assert.ok(brief("B-8", { ...base, plan: PLAN_URL, risk: "urgent" }).problems.some((p) => /--risk must be/.test(p)));
  assert.match(PLAN_URL, PLAN_ISSUE_RE);
});

test("brief: a complete backend brief has every template line and the real ownership", () => {
  const r = brief("B-8", { task: "DAN-900", done: ["B-3", "B-7", "#240"], plan: PLAN_URL, slot: "claude:a" });
  assert.deepEqual(r.problems, []);
  const keys = r.text.split("\n").map((l) => l.split(":")[0].split(" · ")[0]);
  assert.deepEqual(keys, [
    "ZADATAK DAN-900 (B-8)", "Orkestrator", "Runtime slot", "Cilj", "Ulaz", "Opseg", "Mape", "Gotovo kad", "Vizualni ugovor",
    "Lokalne provjere prije pusha", "Plan napada", "Privremene datoteke", "Ovisi o",
  ]);
  assert.ok(r.text.includes(ownership.backend));
  assert.ok(r.text.split("\n").includes(`Plan napada: ${PLAN_URL}`));
  assert.ok(r.text.includes(TEMP_DECISION_URL));
  assert.match(r.text, /pisac-backend\.md/);
  assert.match(r.text, /docs\/BACKEND\.md §6/);
  assert.match(r.text, /docs\/DECISIONS\.md \([^)]*D-103/);
  assert.match(r.text, /Izvan opsega: sve izvan retka B-8, uključujući /);
  assert.match(r.text, /Runtime slot: claude:a/);
  assert.doesNotMatch(r.text, /—|–/, "no long dashes in generated text");
});

test("brief: the text carries no verdict, review or assessment language (neutrality, ORKESTRATOR §8)", () => {
  const r = brief("P-2", { task: "DAN-901", done: ["P-1"] });
  assert.deepEqual(r.problems, []);
  assert.doesNotMatch(r.text, /Agent-Review|QA-Agent|PASS|FAIL|BLOCK/);
  assert.match(r.text, /Plan napada: n\/a/);
  assert.match(r.text, /Vizualni ugovor: n\/a/);
});

test("brief: a Frontend task needs a visual contract or an explicit n/a with a reason", () => {
  const base = { task: "DAN-902", done: ["P-1", "D-2"] };
  assert.ok(brief("F-4", base).problems.some((p) => /--visual/.test(p)));
  assert.ok(brief("F-4", { ...base, visual: "n/a" }).problems.some((p) => /--visual/.test(p)));
  assert.deepEqual(brief("F-4", { ...base, visual: "n/a zadatak je port bez promjene prikaza" }).problems, []);
  const ok = brief("F-4", { ...base, visual: "Odobrena slika: docs/design/ductura/ljuska.png; ruta /; stanja: prazno, puno" });
  assert.deepEqual(ok.problems, []);
  assert.match(ok.text, /docs\/design\/DESIGN-SYSTEM\.md/);
});

test("brief: a short-lived task has no owner row, so folders must be given", () => {
  assert.ok(brief("K-2", { task: "DAN-903", done: ["P-1"] }).problems.some((p) => /--mape/.test(p)));
  assert.deepEqual(brief("K-2", { task: "DAN-903", done: ["P-1"], mape: "src/lib/citations/" }).problems, []);
});

test("next: ready by dependencies, one pick per lane, most unlocking first", () => {
  const t = parsePlanTasks(SYNTH);
  const res = pickNext({ tasks: t, done: [], now: Date.parse("2026-11-10T00:00:00Z") });
  assert.deepEqual(res.picks.map((p) => p.id), ["P-1", "B-1"]);
  assert.deepEqual(res.backlog, []);
  assert.ok(res.blocked.some((b) => b.id === "B-2" && b.missing.join() === "P-1,B-1,#240"));
  const after = pickNext({ tasks: t, done: ["P-1", "B-1", "#240"], active: ["P-2"], now: 0 });
  assert.deepEqual(after.picks.map((p) => p.id), ["B-2", "F-1"]);
  assert.deepEqual(after.backlog, []);
  assert.deepEqual(after.busy, ["platforma"]);
  assert.ok(!after.picks.some((p) => p.role === "daniel"));
});

test("next: a busy lane is skipped and an active or done task is never offered again", () => {
  const t = parsePlanTasks(SYNTH);
  const res = pickNext({ tasks: t, done: ["P-1"], active: ["B-1"] });
  assert.ok(!res.picks.some((p) => p.id === "B-1" || p.id === "P-1"));
  assert.ok(!res.picks.some((p) => p.role === "backend"));
  assert.ok(res.picks.some((p) => p.id === "F-1"));
  assert.ok(res.backlog.includes("P-2") || res.picks.some((p) => p.id === "P-2"));
});

test("next: D-107 marks a tooling pick before 3 November 2026 and not after", () => {
  const t = parsePlanTasks(SYNTH);
  const before = pickNext({ tasks: t, done: [], now: Date.parse("2026-11-01T00:00:00Z") });
  assert.ok(before.picks.find((p) => p.id === "P-1").notes.some((n) => /D-107/.test(n)));
  const after = pickNext({ tasks: t, done: [], now: Date.parse("2026-11-04T00:00:00Z") });
  assert.deepEqual(after.picks.find((p) => p.id === "P-1").notes, []);
});

test("next: the real plan with nothing done starts at the roots of the critical chain", () => {
  const res = pickNext({ tasks, done: [], now: Date.parse("2026-11-10T00:00:00Z") });
  const ids = res.picks.map((p) => p.id);
  assert.ok(ids.includes("P-1") && ids.includes("B-1") && ids.includes("F-1"));
  assert.equal(res.picks.length, new Set(res.picks.map((p) => p.role)).size, "one pick per lane");
  assert.ok(renderNext(res).at(-1).startsWith("Savjet, ne odluka"));
});

test("cli parsing: lists reject typos instead of skipping them, unknown flags fail", () => {
  assert.deepEqual(parseList("B-1, B-2,#240"), ["B-1", "B-2", "#240"]);
  assert.deepEqual(parseList(""), []);
  assert.throws(() => parseList("B-1,bogus"), /bogus/);
  assert.throws(() => parseList("DAN-12"), /DAN-12/);
  assert.throws(() => parseCli(["B-1", "--nope", "x"], ["--task"]), /unknown/);
  assert.throws(() => parseCli(["--task"], ["--task"]), /incomplete/);
  assert.deepEqual(parseCli(["B-8", "--task", "DAN-1", "--json"], ["--task"], ["--json"]), { id: "B-8", opts: { task: "DAN-1" }, json: true });
});

test("cli: orch:brief and orch:next run against the real files and keep exit codes", () => {
  const run = (script, args) => spawnSync("node", [fileURLToPath(new URL(script, import.meta.url)), ...args], {
    encoding: "utf8", cwd: fileURLToPath(new URL("../..", import.meta.url)),
  });
  const ok = run("./brief.mjs", ["P-2", "--task", "DAN-950", "--done", "P-1"]);
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /^ZADATAK DAN-950 \(P-2\)/);
  const refused = run("./brief.mjs", ["B-8", "--task", "DAN-950"]);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /REFUSED/);
  assert.equal(run("./brief.mjs", []).status, 2);
  const next = run("./next.mjs", ["--done", ""]);
  assert.equal(next.status, 0);
  assert.match(next.stdout, /Savjet, ne odluka/);
  assert.equal(run("./next.mjs", []).status, 2);
  assert.equal(run("./next.mjs", ["--done", "bogus"]).status, 2);
});
