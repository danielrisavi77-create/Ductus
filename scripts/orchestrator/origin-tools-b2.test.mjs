import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import fc from "fast-check";

import { evaluatePullRequest, sameRepositoryHead } from "../engineering/review-gate-core.mjs";
import { checkRollup, mainPathsSince, openPrsWithPaths, prPaths, prView } from "./gh.mjs";
import { overlapPairs, renderOverlap } from "./orchestrator-core.mjs";
import {
  AUTHORS, contractFor, HEAD, io, NUMBER, OUTSIDE, PLAN_SCENARIOS, planPulls, PREFLIGHT_SCENARIOS, R,
  READABLE_OUTSIDE, REPO, rawPull, routesFor, runTool,
} from "./origin-cases.mjs";
import { planParallel, renderPlan, VERDICTS } from "./plan-core.mjs";
import { evaluatePreflight, INFORMATIONAL_READS, preflightExitCode, requiredStatusChecks } from "./preflight-core.mjs";

// F-010 in the orchestrator tools (DAN-574 PR B2, plan #1671): preflight (T4) and
// pr-overlap --plan (T5) judge only a head in this repository, by the gate's own
// predicate over the same REST object the head SHA came from (I3). The S outcomes
// were recorded on main 58d5e338 before the guard (origin-snapshot.json t4/t5, I2).
const snapshot = JSON.parse(readFileSync(new URL("./origin-snapshot.json", import.meta.url), "utf8"));
const split = (s) => s.split(/\r?\n/).filter(Boolean);
const rec = (r) => ({ exit: r.code, lines: split(r.stdout), stderr: split(r.stderr) });
const S = Object.keys(AUTHORS);
const ORIGIN_ROW = /^FAIL head origin: .*\(F-010\)/;
const NOT_PRINTED = "FAIL head origin: head is not proven to be in this repository (F-010); names not printed";

/** Runs tasks (functions returning promises) at most `width` at a time, results in order. */
async function pool(tasks, width = 8) {
  const out = new Array(tasks.length);
  let next = 0;
  await Promise.all(Array.from({ length: width }, async () => {
    while (next < tasks.length) {
      const i = next++;
      out[i] = await tasks[i]();
    }
  }));
  return out;
}

// ---------------------------------------------------------------------------
// In-process mirrors of the two CLIs over the same routes, for the properties.
// They call the same exported reads and pure evaluators in the CLIs' order; the
// tests below prove they print what the real CLIs print on every S and O class.
/** preflight.mjs <NUMBER> [args] over routes, in process (no mergeable re-read wait). */
async function mirrorT4(routes, args = []) {
  const { exec, json, list, repo } = io(routes);
  const hi = args.indexOf("--head");
  const expectHead = hi === -1 ? null : args[hi + 1];
  const readErrors = [];
  const attempt = async (name, fn) => {
    try {
      return await fn();
    } catch {
      readErrors.push(name);
      return null;
    }
  };
  try {
    const pr = await prView(NUMBER, { json, waitMs: 0 });
    const { owner, repo: name } = await repo();
    const main = await attempt("main branch", () => json(["api", `repos/${owner}/${name}/branches/main`]));
    const mainSha = main?.commit?.sha ?? null;
    const required = requiredStatusChecks(main?.protection?.required_status_checks);
    const compare = mainSha && pr.headRefOid
      ? await attempt("main comparison", () => json(["api", `repos/${owner}/${name}/compare/${mainSha}...${pr.headRefOid}`]))
      : null;
    const behind = Number.isInteger(compare?.behind_by) && compare.behind_by > 0;
    const prFiles = behind ? await attempt("PR file list", () => prPaths(NUMBER, list)) : null;
    const mainPaths = behind ? await attempt("main file list", () => mainPathsSince(pr.headRefOid, mainSha, exec)) : null;
    const rollup = pr.headRefOid ? await attempt("head checks", () => checkRollup(pr.headRefOid, { list })) : null;
    const checks = evaluatePreflight({ pr, mainSha, compare, rollup, required, expectHead, mainPaths, prPaths: prFiles, repository: `${owner}/${name}` });
    const lines = [`PR #${NUMBER} head ${String(pr.headRefOid ?? "?").slice(0, 8)} main ${String(mainSha ?? "?").slice(0, 8)}`];
    for (const c of checks) lines.push(`${c.level.padEnd(4)} ${c.text}`);
    const stderr = [];
    const blocking = readErrors.filter((n) => !INFORMATIONAL_READS.has(n));
    const detail = readErrors.filter((n) => INFORMATIONAL_READS.has(n));
    if (blocking.length) stderr.push(`PREFLIGHT READ ERROR: retry GitHub reads (${blocking.join(", ")})`);
    if (detail.length) stderr.push(`preflight note: not read, informational only (${detail.join(", ")})`);
    const exit = preflightExitCode(checks, readErrors);
    lines.push(exit === 0 ? "PREFLIGHT PASS: review or QA may start" : "PREFLIGHT FAIL: do not start review or QA");
    return { exit, lines, stderr };
  } catch (e) {
    return { exit: 2, lines: [], stderr: [`preflight failed: ${e.message}`] };
  }
}

/** pr-overlap.mjs --plan [--contract file] over routes, in process. */
async function mirrorT5(routes, contract) {
  const { list, repo } = io(routes);
  try {
    const prs = await openPrsWithPaths({ list, paths: (n) => prPaths(n, list) });
    const pairs = overlapPairs(prs);
    const repository = await repo().then(({ owner, repo: name }) => `${owner}/${name}`, () => null);
    const plan = planParallel({ prs, pairs, contract: contract ? JSON.parse(JSON.stringify(contract)) : null, independent: [], repository });
    const lines = [...renderOverlap(prs, pairs), "", ...renderPlan(plan)].flatMap(split);
    return { exit: prs.some((p) => !p.paths) ? 1 : 0, lines, stderr: [] };
  } catch (e) {
    return { exit: 2, lines: [], stderr: [`pr-overlap failed: ${e.message}`] };
  }
}

const t4 = async (routes, args = []) => rec(await runTool("preflight.mjs", [String(NUMBER), ...args], routes));
const t5 = async (routes, contract) => rec(await runTool("pr-overlap.mjs", ["--plan"], routes, { contract }));
const single = (cls, sc, over = {}, repo = R.R1) => routesFor({ pulls: [{ n: NUMBER, raw: rawPull(cls, { ...sc.pull, ...over }) }], scenario: sc, repo });
const planCase = (cls, sc, repo = R.R1) => {
  const pulls = planPulls(cls, sc);
  const contract = sc.contract === false ? undefined : contractFor(pulls.map((p) => p.n));
  return { pulls, contract, routes: routesFor({ pulls, scenario: sc, repo }) };
};

/** T5 output -> {rows: {"#n": {verdict, reasons}}, gate: in-gate count, warning}. */
function planOf(r) {
  const rows = {};
  let last = null;
  let gate = null;
  for (const l of r.lines) {
    const row = /^#(\S+) (NEPROVJERENO|PREKLAPANJE|ČEKA OVISNOST|PARALELNO) \(/.exec(l);
    if (row) rows[row[1]] = last = { verdict: row[2], reasons: [] };
    else if (l.startsWith("  ") && last) last.reasons.push(l.trim());
    else last = null;
    const g = /Gate: (\d+)\/\d+\./.exec(l);
    if (g) gate = Number(g[1]);
  }
  return { rows, gate, warning: r.lines.some((l) => l.startsWith("WARNING:")) };
}
const outOfDraft = (sc) => sc.others.filter(([, draft]) => !draft).length;

// ---------------------------------------------------------------------------
// I2: every S class in every scenario prints what main 58d5e338 printed.
test("I2: T4 and T5 give the recorded main outcomes for every S class and scenario", async () => {
  const jobs = [];
  for (const [name, sc] of Object.entries(PREFLIGHT_SCENARIOS)) {
    for (const cls of S) jobs.push(async () => [`t4 ${cls}/${name}`, await t4(single(cls, sc), sc.args), snapshot.t4[`${cls}/${name}`]]);
  }
  for (const [name, sc] of Object.entries(PLAN_SCENARIOS)) {
    for (const cls of S) {
      jobs.push(async () => {
        const { routes, contract } = planCase(cls, sc);
        return [`t5 ${cls}/${name}`, await t5(routes, contract), snapshot.t5[`${cls}/${name}`]];
      });
    }
  }
  for (const [label, got, want] of await pool(jobs)) assert.deepEqual(got, want, label);
});

test("the in-process mirrors print the recorded main outcomes for every S class and scenario", async () => {
  for (const [name, sc] of Object.entries(PREFLIGHT_SCENARIOS)) {
    for (const cls of S) assert.deepEqual(await mirrorT4(single(cls, sc), sc.args), snapshot.t4[`${cls}/${name}`], `t4 ${cls}/${name}`);
  }
  for (const [name, sc] of Object.entries(PLAN_SCENARIOS)) {
    for (const cls of S) {
      const { routes, contract } = planCase(cls, sc);
      assert.deepEqual(await mirrorT5(routes, contract), snapshot.t5[`${cls}/${name}`], `t5 ${cls}/${name}`);
    }
  }
});

// ---------------------------------------------------------------------------
// Every O class (O1-O13, O6 included) in every scenario, through the real CLIs (I1).
test("T4: every O class in every scenario has the origin FAIL row and never exits 0", async () => {
  const jobs = [];
  for (const [name, sc] of Object.entries(PREFLIGHT_SCENARIOS)) {
    for (const cls of Object.keys(OUTSIDE)) {
      const routes = single(cls, sc);
      jobs.push(async () => ({ cls, name, sc, routes, r: await t4(routes, sc.args) }));
    }
  }
  for (const { cls, name, sc, routes, r } of await pool(jobs)) {
    const label = `${cls}/${name}`;
    assert.notEqual(r.exit, 0, label);
    assert.equal(r.lines.at(-1), "PREFLIGHT FAIL: do not start review or QA", label);
    assert.ok(r.lines.some((l) => ORIGIN_ROW.test(l)), `${label}: ${r.lines}`);
    // O9t/O9l: a blank-padded name would print as the base name itself, so it is not printed.
    if (cls === "O9t" || cls === "O9l") assert.ok(r.lines.includes(NOT_PRINTED), `${label}: ${r.lines}`);
    else if (READABLE_OUTSIDE.has(cls)) assert.ok(r.lines.some((l) => /^FAIL head origin: (head \S+ is outside base|base \S+ is not this repository)/.test(l)), `${label}: ${r.lines}`);
    // A read error keeps exit 2 (as for S); otherwise the origin FAIL is exit 1.
    if (snapshot.t4[`S1/${name}`].exit !== 2) assert.equal(r.exit, 1, label);
    assert.deepEqual(await mirrorT4(routes, sc.args), r, `mirror ${label}`);
  }
});

test("T5: an O subject is never PARALELNO, names its origin and takes no gate slot, in every scenario", async () => {
  const jobs = [];
  for (const [name, sc] of Object.entries(PLAN_SCENARIOS)) {
    for (const cls of Object.keys(OUTSIDE)) {
      const c = planCase(cls, sc);
      jobs.push(async () => ({ cls, name, sc, c, r: await t5(c.routes, c.contract) }));
    }
  }
  for (const { cls, name, sc, c, r } of await pool(jobs)) {
    const label = `${cls}/${name}`;
    const { rows, gate } = planOf(r);
    // O6: the list object itself is null, so the row has no number.
    const subject = rows[cls === "O6" ? "undefined" : String(NUMBER)];
    assert.ok(subject, `${label}: ${r.lines}`);
    assert.equal(subject.verdict, "NEPROVJERENO", label);
    assert.ok(subject.reasons.some((x) => /^head origin: .*\(F-010\)$/.test(x)), `${label}: ${subject.reasons}`);
    assert.equal(gate, outOfDraft(sc), `${label}: gate count holds only the companions`);
    assert.deepEqual(await mirrorT5(c.routes, c.contract), r, `mirror ${label}`);
  }
});

// ---------------------------------------------------------------------------
// Negative tests of plan §4 (N4, N11, N12) and the unread repository.
test("R4: repoId fails: T4 exits 2 before any check, T5 judges every head NEPROVJERENO", async () => {
  const r4 = await t4(single("S1", PREFLIGHT_SCENARIOS.ready, {}, R.R4));
  assert.equal(r4.exit, 2);
  assert.deepEqual(r4.lines, []);
  assert.match(r4.stderr.join("\n"), /^preflight failed: HTTP 404/);
  const c = planCase("S1", PLAN_SCENARIOS.withDraft, R.R4);
  const r5 = await t5(c.routes, c.contract);
  const { rows, gate } = planOf(r5);
  for (const row of Object.values(rows)) {
    assert.equal(row.verdict, "NEPROVJERENO");
    assert.ok(row.reasons.includes("head origin: this repository could not be read (F-010)"), `${row.reasons}`);
  }
  assert.equal(gate, 0);
});

test("N4: head and base full_name both empty (O13): T4 FAIL as unread names, T5 NEPROVJERENO", async () => {
  const r = await t4(single("O13", PREFLIGHT_SCENARIOS.ready));
  assert.equal(r.exit, 1);
  assert.ok(r.lines.includes("FAIL head origin: head or base repository could not be read (head unknown, base unknown) (F-010)"), `${r.lines}`);
  const c = planCase("O13", PLAN_SCENARIOS.single);
  const { rows } = planOf(await t5(c.routes, c.contract));
  assert.equal(rows[NUMBER].verdict, "NEPROVJERENO");
});

test("N11: O1 with --head equal to its head: the head check passes and origin still fails", async () => {
  const r = await t4(single("O1", PREFLIGHT_SCENARIOS.expectHead), ["--head", HEAD]);
  assert.equal(r.exit, 1);
  assert.ok(r.lines.includes("FAIL head origin: head outsider/repo1-fork is outside base owner1/repo1 (F-010)"), `${r.lines}`);
  assert.ok(!r.lines.some((l) => /the head moved/.test(l)), `${r.lines}`);
});

test("N12: an O subject frees its slot for a draft companion; an S subject does not", async () => {
  const tight = PLAN_SCENARIOS.slotsTight;
  const o = planCase("O1", tight);
  const withO = planOf(await t5(o.routes, o.contract));
  assert.equal(withO.rows[NUMBER + 3].verdict, "PARALELNO");
  assert.equal(withO.gate, 2);
  const withS = planOf({ lines: snapshot.t5["S1/slotsTight"].lines });
  assert.equal(withS.rows[NUMBER + 3].verdict, "ČEKA OVISNOST");
  assert.ok(withS.rows[NUMBER + 3].reasons.some((x) => /gate full/.test(x)));
  // Over capacity only counts heads in this repository.
  const over = planCase("O1", PLAN_SCENARIOS.overCapacity);
  const r = planOf(await t5(over.routes, over.contract));
  assert.equal(r.warning, false);
  assert.equal(r.gate, 3);
  for (const i of [1, 2, 3]) assert.equal(r.rows[NUMBER + i].verdict, "PARALELNO", `#${NUMBER + i}`);
  assert.ok(!r.rows[NUMBER].reasons.some((x) => /over capacity/.test(x)));
  assert.ok(planOf({ lines: snapshot.t5["S1/overCapacity"].lines }).warning);
});

test("an outside name with characters outside the allow-list is not printed by T4", async () => {
  const routes = single("S1", PREFLIGHT_SCENARIOS.ready, { head: { sha: HEAD, ref: "feature/x", repo: { full_name: "evil\u001b[2J/x" } } });
  const r = await t4(routes);
  assert.equal(r.exit, 1);
  assert.ok(r.lines.includes(NOT_PRINTED), `${r.lines}`);
  assert.ok(!r.lines.join("\n").includes("\u001b"));
});

// ---------------------------------------------------------------------------
// C2: the head SHA and the origin come from the same REST object, also across the
// mergeable re-read of prView. T5 judges the list object it takes the head from.
const shaOf = (c) => c.repeat(40);
test("C2: first read O1 at OLD (mergeable null), re-read S1 at NEW: judged on NEW, old green checks never pass", async () => {
  const OLD = shaOf("a");
  const NEW = shaOf("b");
  const first = rawPull("O1", { body: PREFLIGHT_SCENARIOS.ready.pull.body, mergeable: null, mergeable_state: "unknown", head: { sha: OLD, ref: "x", repo: { full_name: "outsider/repo1-fork" } } });
  const second = rawPull("S1", { body: PREFLIGHT_SCENARIOS.ready.pull.body, head: { sha: NEW, ref: "x", repo: { full_name: REPO } } });
  const oldGreen = routesFor({ pulls: [{ n: NUMBER, raw: first }], scenario: PREFLIGHT_SCENARIOS.ready });
  const newRed = routesFor({ pulls: [{ n: NUMBER, raw: second, answers: [first, second] }], scenario: { ...PREFLIGHT_SCENARIOS.ready, ci: "failure" } });
  const r = await t4({ ...oldGreen, ...newRed });
  assert.equal(r.exit, 1);
  assert.equal(r.lines[0], `PR #${NUMBER} head ${NEW.slice(0, 8)} main ${shaOf("d").slice(0, 8)}`);
  assert.ok(!r.lines.some((l) => ORIGIN_ROW.test(l)), `${r.lines}`);
  assert.ok(r.lines.some((l) => /^FAIL .*failure/i.test(l)), `${r.lines}`);
  // The reverse: S1 at OLD first, O1 at NEW on the re-read: the origin FAIL of NEW.
  const firstS = { ...second, head: { ...second.head, sha: OLD }, mergeable: null, mergeable_state: "unknown" };
  const secondO = { ...first, head: { ...first.head, sha: NEW }, mergeable: true, mergeable_state: "clean" };
  const rev = { ...routesFor({ pulls: [{ n: NUMBER, raw: firstS }], scenario: PREFLIGHT_SCENARIOS.ready }), ...routesFor({ pulls: [{ n: NUMBER, raw: secondO, answers: [firstS, secondO] }], scenario: PREFLIGHT_SCENARIOS.ready }) };
  const r2 = await t4(rev);
  assert.equal(r2.exit, 1);
  assert.ok(r2.lines.includes("FAIL head origin: head outsider/repo1-fork is outside base owner1/repo1 (F-010)"), `${r2.lines}`);
  // --head OLD, the re-read moved to NEW: the head check fails as well.
  const r3 = await t4({ ...oldGreen, ...newRed }, ["--head", OLD]);
  assert.equal(r3.exit, 1);
  assert.ok(r3.lines.some((l) => /^FAIL head is bbbbbbbb, expected aaaaaaaa: the head moved$/.test(l)), `${r3.lines}`);
});

test("C2 for T5: the list object decides, the single PR read is not used", async () => {
  const sc = PLAN_SCENARIOS.single;
  const contract = contractFor([NUMBER]);
  const body = { body: `Agent: claude:w${NUMBER}:platforma\nRisk: standard\nTask: DAN-${NUMBER}\n` };
  const listO = routesFor({ pulls: [{ n: NUMBER, raw: rawPull("S1", body), listed: rawPull("O1", body) }], scenario: sc });
  assert.equal(planOf(await t5(listO, contract)).rows[NUMBER].verdict, "NEPROVJERENO");
  const listS = routesFor({ pulls: [{ n: NUMBER, raw: rawPull("O1", body), listed: rawPull("S1", body) }], scenario: sc });
  assert.equal(planOf(await t5(listS, contract)).rows[NUMBER].verdict, "PARALELNO");
});

// ---------------------------------------------------------------------------
// Properties P1-P4 for T4 and T5, 500 runs each; fast-check prints the seed on a failure.
const RUNS = { numRuns: 500 };
const segment = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,11}$/);
const name = fc.oneof(
  fc.constantFrom(REPO, "Owner1/Repo1", `${REPO} `, ` ${REPO}`, `${REPO}.git`, `${REPO}-fork`, "outsider/repo1", "owner1/renamed1", "", null, 42, {}),
  fc.tuple(segment, segment).map(([a, b]) => `${a}/${b}`),
  fc.string({ maxLength: 20 }),
);
const repoShape = fc.oneof(
  fc.constant("drop"), fc.constant(null), fc.constant({}),
  fc.record({ full_name: name, fork: fc.boolean() }, { requiredKeys: ["full_name"] }),
);
const withRepo = (part, repo) => (repo === "drop" ? part : { ...part, repo });
const headArb = fc.oneof(fc.constant(undefined), repoShape.map((repo) => withRepo({ sha: HEAD, ref: "feature/x" }, repo)));
const baseArb = fc.oneof(fc.constant(undefined), repoShape.map((repo) => withRepo({ ref: "main" }, repo)));
const repoArb = fc.oneof(
  fc.constantFrom(R.R1, R.R2, R.R3, R.R4),
  fc.tuple(segment, segment).map(([o, n]) => ({ owner: { login: o }, name: n })),
);
const anyInput = fc.record({
  cls: fc.constantFrom(...S), pre: fc.constantFrom(...Object.keys(PREFLIGHT_SCENARIOS)),
  plan: fc.constantFrom(...Object.keys(PLAN_SCENARIOS)), head: headArb, base: baseArb, repo: repoArb,
});
const RANK = Object.fromEntries(VERDICTS.map((v, i) => [v, i]));

/** One input -> the T4 and T5 outcomes for the subject PR. */
async function outcomes({ cls, pre, plan, head, base, repo }) {
  const psc = PREFLIGHT_SCENARIOS[pre];
  const raw4 = { ...rawPull(cls, psc.pull), head, base };
  const r4 = await mirrorT4(routesFor({ pulls: [{ n: NUMBER, raw: raw4 }], scenario: psc, repo }), psc.args);
  const sc = PLAN_SCENARIOS[plan];
  const pulls = planPulls(cls, sc);
  const raw5 = { ...pulls[0].raw, head, base };
  pulls[0] = { ...pulls[0], raw: raw5, listed: raw5 };
  const contract = sc.contract === false ? undefined : contractFor(pulls.map((p) => p.n));
  const r5 = await mirrorT5(routesFor({ pulls, scenario: sc, repo }), contract);
  const p5 = planOf(r5);
  return { raw4, raw5, r4, subject: p5.rows[NUMBER], gate: p5.gate, sc };
}
const gateOutside = (raw) => /head is not in this repository/i.test(
  evaluatePullRequest({ pr: { ...raw, changed_files: 1 }, files: [{ filename: "src/domain/example.ts", status: "modified" }], comments: [], ownerLogin: "owner1" }).result.description ?? "",
);
const repositoryOf = (repo) => (repo.$error ? null : `${repo.owner.login}/${repo.name}`);

test("P1: when the gate fails on origin, T4 does not pass and T5 neither advises nor counts the PR", async () => {
  await fc.assert(fc.asyncProperty(anyInput, async (input) => {
    const o = await outcomes(input);
    if (gateOutside(o.raw4)) {
      assert.notEqual(o.r4.exit, 0);
      if (!input.repo.$error) assert.ok(o.r4.lines.some((l) => ORIGIN_ROW.test(l)), `${o.r4.lines}`);
    }
    if (gateOutside(o.raw5)) {
      assert.equal(o.subject.verdict, "NEPROVJERENO");
      assert.ok(o.gate <= outOfDraft(o.sc));
    }
  }), RUNS);
});

test("P2: a passing T4 or a PARALELNO T5 subject implies sameRepositoryHead(raw) and a base equal to repoId", async () => {
  await fc.assert(fc.asyncProperty(anyInput, async (input) => {
    const o = await outcomes(input);
    const repository = repositoryOf(input.repo);
    if (o.r4.exit === 0) {
      assert.ok(sameRepositoryHead(o.raw4));
      assert.equal(o.raw4.base.repo.full_name, repository);
    }
    if (o.subject.verdict === "PARALELNO") {
      assert.ok(sameRepositoryHead(o.raw5));
      assert.equal(o.raw5.base.repo.full_name, repository);
    }
  }), RUNS);
});

test("P3: S inputs with any valid repository name under its own repoId equal the main outcomes", async () => {
  const arb = fc.record({ cls: fc.constantFrom(...S), pre: fc.constantFrom(...Object.keys(PREFLIGHT_SCENARIOS)), plan: fc.constantFrom(...Object.keys(PLAN_SCENARIOS)), owner: segment, repo: segment });
  await fc.assert(fc.asyncProperty(arb, async ({ cls, pre, plan, owner, repo }) => {
    const full = `${owner}/${repo}`;
    const id = { owner: { login: owner }, name: repo };
    const rename = (raw) => (raw ? { ...raw, head: { ...raw.head, repo: { full_name: full } }, base: { ...raw.base, repo: { full_name: full } } } : raw);
    const psc = PREFLIGHT_SCENARIOS[pre];
    const raw = rename(rawPull(cls, psc.pull));
    assert.deepEqual(await mirrorT4(routesFor({ pulls: [{ n: NUMBER, raw }], scenario: psc, repo: id }), psc.args), snapshot.t4[`${cls}/${pre}`]);
    const sc = PLAN_SCENARIOS[plan];
    const pulls = planPulls(cls, sc).map((p) => ({ ...p, raw: rename(p.raw), listed: rename(p.listed) }));
    const contract = sc.contract === false ? undefined : contractFor(pulls.map((p) => p.n));
    assert.deepEqual(await mirrorT5(routesFor({ pulls, scenario: sc, repo: id }), contract), snapshot.t5[`${cls}/${plan}`]);
  }), RUNS);
});

test("P4: changing only head.repo of an S input never raises T4's or the T5 subject's outcome", async () => {
  const heads = Object.keys(OUTSIDE).filter((k) => OUTSIDE[k] !== null);
  const arb = fc.record({
    cls: fc.constantFrom(...S), pre: fc.constantFrom(...Object.keys(PREFLIGHT_SCENARIOS)), plan: fc.constantFrom(...Object.keys(PLAN_SCENARIOS)),
    repo: repoShape, o: fc.constantFrom(...heads), useO: fc.boolean(),
  });
  await fc.assert(fc.asyncProperty(arb, async ({ cls, pre, plan, repo, o, useO }) => {
    const changed = useO ? OUTSIDE[o].head : withRepo({ sha: HEAD, ref: "feature/x" }, repo);
    const head = changed ?? { sha: HEAD, ref: "feature/x" };
    const before = rawPull(cls);
    const a = await outcomes({ cls, pre, plan, head: before.head, base: before.base, repo: R.R1 });
    const b = await outcomes({ cls, pre, plan, head, base: before.base, repo: R.R1 });
    assert.ok((b.r4.exit === 0 ? 1 : 0) <= (a.r4.exit === 0 ? 1 : 0), `${a.r4.exit} -> ${b.r4.exit}`);
    assert.ok(RANK[b.subject.verdict] <= RANK[a.subject.verdict], `${a.subject.verdict} -> ${b.subject.verdict}`);
    if (!sameRepositoryHead({ ...before, head })) {
      assert.notEqual(b.r4.exit, 0);
      assert.equal(b.subject.verdict, "NEPROVJERENO");
    }
  }), RUNS);
});
