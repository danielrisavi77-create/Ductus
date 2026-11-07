import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import fc from "fast-check";

import { evaluatePullRequest, sameRepositoryHead } from "../engineering/review-gate-core.mjs";
import { ccrThreads, checkRollup, gateStatus, ghJson, ghList, prPaths, prView, readGate } from "./gh.mjs";
import { allLines, readinessOf } from "./merge-ready.mjs";
import { EXIT_CODES } from "./merge-ready-core.mjs";
import { allRequiredPass, summarizeThreads } from "./orchestrator-core.mjs";
import {
  AUTHORS, HEAD, NUMBER, OUTSIDE, R, READABLE_OUTSIDE, REPO, rawPull, routesFor, runTool, SCENARIOS,
} from "./origin-cases.mjs";
import { requiredStatusChecks } from "./preflight-core.mjs";
import { readyChecks } from "./pr-ready.mjs";

// F-010 in the orchestrator tools (DAN-574 PR B1, plan #1671): pr-ready (T1),
// merge-ready <n> (T2) and merge-ready --all (T3) judge only a head in this
// repository, by the gate's own predicate over the same REST object (I3). The
// S outcomes were recorded on main d54b88b9 (origin-snapshot.json, I2).
const snapshot = JSON.parse(readFileSync(new URL("./origin-snapshot.json", import.meta.url), "utf8"));
const lines = (s) => s.split(/\r?\n/).filter(Boolean);
const rec = (r) => ({ exit: r.code, lines: lines(r.stdout), stderr: lines(r.stderr) });
const PASSING_T2 = new Set(["READY", "WAITS_OWNER", "WAITING"]);
const RANK = { READY: 3, WAITS_OWNER: 2, WAITING: 1, BLOCKED: 0, UNREAD: 0 };
const stateOf = (r) => /^MERGE-READY (\w+):/.exec(r.lines.at(-1) ?? "")?.[1] ?? null;
const rowStates = (r) => Object.fromEntries(r.lines.filter((l) => l.startsWith("#")).map((l) => {
  const [n, state] = l.split(" ");
  return [Number(n.slice(1)), state];
}));

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

const single = (cls, sc, over = {}) => routesFor({ pulls: [{ n: NUMBER, raw: rawPull(cls, { ...sc.pull, ...over }) }], scenario: sc });
const t1 = async (routes) => rec(await runTool("pr-ready.mjs", [String(NUMBER)], routes));
const t2 = async (routes) => rec(await runTool("merge-ready.mjs", [String(NUMBER)], routes));
const t3 = async (routes) => rec(await runTool("merge-ready.mjs", ["--all"], routes));

// ---------------------------------------------------------------------------
// In-process mirror of the two CLIs over the same routes, for the properties
// (500+ runs each would take minutes as processes). It calls the same exported
// reads and the same pure evaluators in the CLIs' order; the tests below prove
// it prints what the real CLIs print, on every S and O class and scenario.
function failed(text) {
  const e = new Error(text);
  e.stderr = text;
  return e;
}
function fakeExec(routes) {
  const calls = new Map();
  return async (cmd, args) => {
    const path = args[1] === "graphql" ? "graphql" : args[1];
    const list = routes[path];
    if (cmd !== "gh" || !Array.isArray(list) || list.length === 0) throw failed(`fake gh: unexpected path ${path}`);
    const i = calls.get(path) ?? 0;
    calls.set(path, i + 1);
    const a = list[Math.min(i, list.length - 1)];
    if (a && typeof a === "object" && "$error" in a) throw failed(String(a.$error));
    return JSON.stringify(a);
  };
}
const io = (routes) => {
  const exec = fakeExec(routes);
  const json = (args) => ghJson(args, exec);
  const list = (path, _exec, opts) => ghList(path, exec, opts);
  const repo = async () => {
    const r = await json(["api", "repos/{owner}/{repo}"]);
    return { owner: r.owner.login, repo: r.name };
  };
  return { json, list, repo };
};
const why = (e) => String(e?.stderr || e?.message || e).trim().split("\n")[0];
const tryRead = async (fn) => {
  try {
    return await fn();
  } catch (e) {
    return { error: why(e) };
  }
};
const quiet = async (fn) => {
  try {
    return await fn();
  } catch {
    return null;
  }
};

/** pr-ready.mjs main() over routes, in process (no retry waits, no mergeable re-read wait). */
async function mirrorT1(routes, n = NUMBER) {
  const { json, list, repo } = io(routes);
  try {
    const pr = await prView(n, { json, waitMs: 0 });
    if (pr.state !== "OPEN") return { exit: 2, lines: [], stderr: [`PR #${n} is ${pr.state}`] };
    const files = await quiet(() => prPaths(n, list));
    const rollup = await checkRollup(pr.headRefOid, { list });
    const id = await repo();
    const compare = await quiet(() => json(["api", `repos/${id.owner}/${id.repo}/compare/${pr.headRefOid}...main`]));
    const threadNodes = await quiet(() => ccrThreads(n, { json, list }));
    const gate = await readGate(pr.headRefOid, { read: (sha) => gateStatus(sha, list) });
    const checks = readyChecks({ pr, id, gate, rollup, files, compare, threadNodes });
    const ok = allRequiredPass(checks);
    return {
      exit: ok ? 0 : 1,
      lines: [`PR #${n} head ${String(pr.headRefOid).slice(0, 8)}`, ...checks.map((c) => `${c.level.padEnd(4)} ${c.text}`), ok ? "READY: all required checks pass" : "NOT READY"],
      stderr: [],
    };
  } catch (e) {
    return { exit: 2, lines: [], stderr: [`pr-ready failed: ${e.message}`] };
  }
}

async function mirrorReads(routes) {
  const { json, list, repo } = io(routes);
  const id = await tryRead(repo);
  const main = id.error ? { error: "x" } : await tryRead(() => json(["api", `repos/${id.owner}/${id.repo}/branches/main`]));
  const required = main.error ? null : requiredStatusChecks(main?.protection?.required_status_checks);
  const repository = id.error ? null : `${id.owner}/${id.repo}`;
  const readiness = async (n) => {
    const raw = await json(["api", `repos/{owner}/{repo}/pulls/${n}`]);
    const head = raw?.head?.sha;
    const statuses = await tryRead(() => list(`repos/{owner}/{repo}/commits/${head}/statuses?per_page=100`));
    const threads = await tryRead(async () => summarizeThreads(await ccrThreads(n, { json, list })));
    const rollup = await tryRead(() => checkRollup(head, { list }));
    return readinessOf({ raw, statuses, rollup, threads, required, repository });
  };
  return { list, readiness };
}

/** merge-ready.mjs <n> over routes, in process. */
async function mirrorT2(routes, n = NUMBER) {
  const { readiness } = await mirrorReads(routes);
  const { pr, result } = await readiness(n);
  return {
    exit: EXIT_CODES[result.state],
    lines: [`PR #${n} head ${String(pr.headRefOid).slice(0, 8)}`, ...result.checks.map((c) => `${c.level.padEnd(6)} ${c.text}`), `MERGE-READY ${result.state}: ${result.reason}`],
    stderr: [],
  };
}

/** merge-ready.mjs --all over routes, in process (readOpenPrs without retries). */
async function mirrorT3(routes) {
  const { list, readiness } = await mirrorReads(routes);
  const numbers = (await list("repos/{owner}/{repo}/pulls?state=open&per_page=100")).map((p) => p.number).sort((a, b) => a - b);
  const items = [];
  for (const number of numbers) {
    try {
      items.push({ number, value: await readiness(number) });
    } catch (e) {
      items.push({ number, error: why(e) });
    }
  }
  const out = allLines(items);
  return { exit: out.unread ? 2 : 0, lines: out.lines.flatMap(lines), stderr: [] };
}

const allPulls = (classes, sc) => classes.map((cls, i) => ({ n: NUMBER + i, raw: rawPull(cls, { ...sc.pull, number: NUMBER + i }) }));

// ---------------------------------------------------------------------------
// I2: every S class in every scenario prints what main d54b88b9 printed.
test("I2: T1, T2 and T3 give the recorded main outcomes for every S class and scenario", async () => {
  const jobs = [];
  for (const [name, sc] of Object.entries(SCENARIOS)) {
    for (const cls of Object.keys(AUTHORS)) {
      const routes = single(cls, sc);
      jobs.push(async () => [`t1 ${cls}/${name}`, await t1(routes), snapshot.t1[`${cls}/${name}`]]);
      jobs.push(async () => [`t2 ${cls}/${name}`, await t2(routes), snapshot.t2[`${cls}/${name}`]]);
    }
    const pulls = Object.keys(AUTHORS).map((cls, i) => ({ n: NUMBER + i, raw: rawPull(cls, { ...sc.pull, number: NUMBER + i }) }));
    jobs.push(async () => [`t3 ${name}`, await t3(routesFor({ pulls, scenario: sc })), snapshot.t3[name]]);
  }
  for (const [label, got, want] of await pool(jobs)) assert.deepEqual(got, want, label);
});

test("the in-process mirror prints the recorded main outcomes for every S class and scenario", async () => {
  for (const [name, sc] of Object.entries(SCENARIOS)) {
    for (const cls of Object.keys(AUTHORS)) {
      assert.deepEqual(await mirrorT1(single(cls, sc)), snapshot.t1[`${cls}/${name}`], `t1 ${cls}/${name}`);
      assert.deepEqual(await mirrorT2(single(cls, sc)), snapshot.t2[`${cls}/${name}`], `t2 ${cls}/${name}`);
    }
    const pulls = Object.keys(AUTHORS).map((cls, i) => ({ n: NUMBER + i, raw: rawPull(cls, { ...sc.pull, number: NUMBER + i }) }));
    assert.deepEqual(await mirrorT3(routesFor({ pulls, scenario: sc })), snapshot.t3[name], `t3 ${name}`);
  }
});

// ---------------------------------------------------------------------------
// Every O class in every scenario, through the real CLIs (I1, I4).
test("T1 and T2: no O class passes in any scenario; readable outside names are strictly BLOCKED", async () => {
  const jobs = [];
  for (const [name, sc] of Object.entries(SCENARIOS)) {
    for (const cls of Object.keys(OUTSIDE)) {
      const routes = single(cls, sc);
      jobs.push(async () => ({ cls, name, routes, r1: await t1(routes), r2: await t2(routes) }));
    }
  }
  for (const { cls, name, routes, r1, r2 } of await pool(jobs)) {
    const label = `${cls}/${name}`;
    // pr-ready: never READY; a FAIL row or (statuses unreadable) the error exit.
    assert.notEqual(r1.exit, 0, `t1 ${label}`);
    assert.ok(!r1.lines.includes("READY: all required checks pass"), `t1 ${label}`);
    if (r1.exit === 1) assert.ok(r1.lines.some((l) => /^FAIL external PR, owner must adopt: .*\(F-010\)$/.test(l)), `t1 ${label}: ${r1.lines}`);
    // merge-ready: BLOCKED for a readable outside name, else BLOCKED or UNREAD, before any status is read.
    const state = stateOf(r2);
    assert.ok(!PASSING_T2.has(state), `t2 ${label}: ${state}`);
    if (READABLE_OUTSIDE.has(cls)) {
      assert.equal(state, "BLOCKED", `t2 ${label}`);
      assert.equal(r2.exit, 1, `t2 ${label}`);
    } else {
      assert.ok(state === "BLOCKED" || state === "UNREAD", `t2 ${label}: ${state}`);
      assert.equal(r2.exit, EXIT_CODES[state], `t2 ${label}`);
    }
    assert.equal(r2.lines.length, 3, `t2 ${label}: only the origin row, ${r2.lines}`);
    assert.match(r2.lines[1], /\(F-010\)$/, `t2 ${label}`);
    // The in-process mirror agrees with the CLIs on every O class too.
    assert.deepEqual(await mirrorT1(routes), r1, `mirror t1 ${label}`);
    assert.deepEqual(await mirrorT2(routes), r2, `mirror t2 ${label}`);
  }
});

test("T3: every O class row is BLOCKED (readable) or UNREAD, S1 keeps its row, exit 2 on any UNREAD", async () => {
  const classes = ["S1", ...Object.keys(OUTSIDE)];
  const jobs = Object.entries(SCENARIOS).map(([name, sc]) => async () => {
    const routes = routesFor({ pulls: allPulls(classes, sc), scenario: sc });
    return { name, routes, r: await t3(routes) };
  });
  for (const { name, routes, r } of await pool(jobs)) {
    const rows = rowStates(r);
    classes.forEach((cls, i) => {
      const state = rows[NUMBER + i];
      if (cls === "S1") return;
      if (READABLE_OUTSIDE.has(cls)) assert.equal(state, "BLOCKED", `${cls}/${name}`);
      else assert.ok(state === "BLOCKED" || state === "UNREAD", `${cls}/${name}: ${state}`);
    });
    const s1 = stateOf(snapshot.t2[`S1/${name}`]);
    assert.equal(rows[NUMBER], s1, `S1/${name}`);
    assert.equal(r.exit, Object.values(rows).includes("UNREAD") ? 2 : 0, name);
    assert.ok(Object.values(rows).includes("UNREAD"), `${name}: O3 and the like are UNREAD`);
    assert.deepEqual(await mirrorT3(routes), r, `mirror t3 ${name}`);
  }
});

// ---------------------------------------------------------------------------
// Negative tests of plan §4.
test("N1: O1 and O2 with stale success statuses on their head: T1 NOT READY, T2 BLOCKED", async () => {
  for (const cls of ["O1", "O2"]) {
    const routes = single(cls, SCENARIOS.ready);
    const r1 = await t1(routes);
    const r2 = await t2(routes);
    assert.equal(r1.exit, 1, cls);
    assert.equal(r1.lines.at(-1), "NOT READY", cls);
    assert.equal(stateOf(r2), "BLOCKED", cls);
    assert.equal(r2.exit, 1, cls);
    assert.ok(!r2.lines.some((l) => /Merge authorization success|gate success/.test(l)), `${cls}: stale statuses are not read`);
  }
});

test("N2: letter case differs, both ways: BLOCKED", async () => {
  const ways = [
    { head: { sha: HEAD, ref: "feature/x", repo: { full_name: "Owner1/Repo1" } } },
    { base: { ref: "main", repo: { full_name: "Owner1/Repo1" } } },
  ];
  for (const over of ways) {
    const routes = single("S1", SCENARIOS.ready, over);
    assert.equal((await t1(routes)).exit, 1, JSON.stringify(over));
    const r2 = await t2(routes);
    assert.equal(stateOf(r2), "BLOCKED", JSON.stringify(over));
    assert.match(r2.lines[1], /outside base|is not this repository/);
  }
});

test("N3: head.repo and base.repo are empty objects (O12): never a pass", async () => {
  const routes = single("O12", SCENARIOS.ready);
  assert.equal((await t1(routes)).exit, 1);
  assert.equal(stateOf(await t2(routes)), "UNREAD");
});

test("N5: no base or base.repo null/missing: T1 NOT READY, T2 UNREAD", async () => {
  for (const cls of ["O11m", "O11n", "O11b"]) {
    const routes = single(cls, SCENARIOS.ready);
    assert.equal((await t1(routes)).exit, 1, cls);
    const r2 = await t2(routes);
    assert.equal(stateOf(r2), "UNREAD", cls);
    assert.match(r2.lines[1], /base unknown/, cls);
  }
});

test("N6: R2 or R3, head and base both differ from repoId or only head equals it: outside", async () => {
  const cases = [
    { repo: R.R2, over: {} },
    { repo: R.R3, over: {} },
    { repo: R.R3, over: { head: { sha: HEAD, ref: "feature/x", repo: { full_name: "owner1/renamed1" } } } },
    { repo: R.R2, over: { head: { sha: HEAD, ref: "feature/x", repo: { full_name: "Owner1/Repo1" } } } },
  ];
  for (const { repo, over } of cases) {
    const routes = routesFor({ pulls: [{ n: NUMBER, raw: rawPull("S1", over) }], repo });
    const label = `${repo.owner.login}/${repo.name} ${JSON.stringify(over)}`;
    const r1 = await t1(routes);
    assert.equal(r1.exit, 1, label);
    assert.ok(r1.lines.some((l) => /^FAIL external PR, owner must adopt: .*\(F-010\)$/.test(l)), label);
    assert.equal(stateOf(await t2(routes)), "BLOCKED", label);
  }
});

test("N7: repoId fails (R4) for S1: T1 exits 2, T2 and T3 are UNREAD", async () => {
  const routes = routesFor({ pulls: [{ n: NUMBER, raw: rawPull("S1") }], repo: R.R4 });
  const r1 = await t1(routes);
  assert.equal(r1.exit, 2);
  assert.match(r1.stderr.join("\n"), /^pr-ready failed: HTTP 404/);
  const r2 = await t2(routes);
  assert.equal(stateOf(r2), "UNREAD");
  assert.equal(r2.exit, 2);
  const r3 = await t3(routes);
  assert.deepEqual(rowStates(r3), { [NUMBER]: "UNREAD" });
  assert.equal(r3.exit, 2);
});

test("N8: --all with S1, O1 and O3: READY, BLOCKED, UNREAD and exit 2", async () => {
  const r = await t3(routesFor({ pulls: allPulls(["S1", "O1", "O3"], SCENARIOS.ready), scenario: SCENARIOS.ready }));
  assert.deepEqual(rowStates(r), { [NUMBER]: "READY", [NUMBER + 1]: "BLOCKED", [NUMBER + 2]: "UNREAD" });
  assert.equal(r.exit, 2);
});

test("N13: an Owner-Command for an O1 head is neither READY nor WAITS_OWNER, in the gate and in T2", async () => {
  const raw = rawPull("O1", { changed_files: 1 });
  const command = {
    body: `Owner-Command: merge\nCommand-Head: ${HEAD}\nDatum: 2026-11-07\n`,
    user: { login: "owner1", type: "User" }, author_association: "OWNER", performed_via_github_app: null,
    created_at: "2026-11-01T11:00:00Z",
  };
  const gate = evaluatePullRequest({ pr: raw, files: [{ filename: "src/domain/example.ts", status: "modified" }], comments: [command], ownerLogin: "owner1" });
  assert.equal(gate.result.state, "failure");
  assert.equal(gate.mergeAuthorization.state, "pending");
  // Statuses as a stale success would leave them: T2 still BLOCKED, not WAITS_OWNER.
  for (const sc of [SCENARIOS.ready, SCENARIOS.needsOwner]) {
    const r2 = await t2(single("O1", sc));
    assert.equal(stateOf(r2), "BLOCKED");
  }
});

test("N14: an app author with type Bot passes T1; an app login with type User fails as on main", async () => {
  assert.equal((await t1(single("S3", SCENARIOS.ready))).exit, 0);
  const r = await t1(single("S3u", SCENARIOS.ready));
  assert.equal(r.exit, 1);
  assert.ok(r.lines.includes("FAIL external PR, owner must adopt: author mergify[bot] is not the owner"));
  assert.deepEqual(r, snapshot.t1["S3u/ready"]);
});

test("N15: .git suffix and leading space on the head name: BLOCKED", async () => {
  for (const cls of ["O9g", "O9l", "O9t", "O9f"]) {
    const routes = single(cls, SCENARIOS.ready);
    assert.equal((await t1(routes)).exit, 1, cls);
    assert.equal(stateOf(await t2(routes)), "BLOCKED", cls);
  }
});

// ---------------------------------------------------------------------------
// Races of plan §4.
test("C1: first read O1 (mergeable null), the re-read O3: T1 FAIL on the re-read, T2 BLOCKED or UNREAD", async () => {
  const first = rawPull("O1", { mergeable: null, mergeable_state: "unknown" });
  const second = rawPull("O3");
  const routes = routesFor({ pulls: [{ n: NUMBER, raw: second, answers: [first, second] }] });
  const r1 = await t1(routes);
  assert.equal(r1.exit, 1);
  assert.ok(r1.lines.some((l) => /^FAIL external PR, owner must adopt: head or base repository could not be read \(head unknown/.test(l)), `${r1.lines}`);
  const state = stateOf(await t2(routes));
  assert.ok(state === "BLOCKED" || state === "UNREAD", state);
});

test("C3: --all, the list shows S1 and the PR read answers O1: the row follows the PR read (BLOCKED)", async () => {
  const routes = routesFor({ pulls: [{ n: NUMBER, raw: rawPull("O1"), listed: rawPull("S1") }] });
  const r = await t3(routes);
  assert.deepEqual(rowStates(r), { [NUMBER]: "BLOCKED" });
  assert.equal(r.exit, 0);
});

test("C4: a 502 repeated by withRetry, then a shape without head.repo: UNREAD", async () => {
  const routes = routesFor({ pulls: [{ n: NUMBER, raw: rawPull("O4"), answers: [{ $error: "HTTP 502: Bad Gateway" }, rawPull("O4")] }] });
  const r2 = await t2(routes);
  assert.equal(stateOf(r2), "UNREAD");
  assert.equal(r2.exit, 2);
  const r3 = await t3(routes);
  assert.deepEqual(rowStates(r3), { [NUMBER]: "UNREAD" });
  assert.equal(r3.exit, 2);
});

test("O6: the REST pull object is null: T1 stops at the state, T2 and T3 UNREAD on origin, T3 keeps the number", async () => {
  const jobs = Object.entries(SCENARIOS).map(([name, sc]) => async () => {
    const routes = single("O6", sc);
    const all = routesFor({ pulls: allPulls(["O6"], sc), scenario: sc });
    return { name, routes, all, r1: await t1(routes), r2: await t2(routes), r3: await t3(all) };
  });
  for (const { name, routes, all, r1, r2, r3 } of await pool(jobs)) {
    // pr-ready reads the PR as not open and stops there; it neither passes nor crashes.
    assert.equal(r1.exit, 2, `t1 ${name}`);
    assert.deepEqual(r1.lines, [], `t1 ${name}`);
    assert.deepEqual(r1.stderr, [`PR #${NUMBER} is `], `t1 ${name}`);
    // merge-ready <n>: UNREAD on the origin row, never READY, WAITS_OWNER or WAITING.
    assert.equal(stateOf(r2), "UNREAD", `t2 ${name}: ${r2.lines} ${r2.stderr}`);
    assert.equal(r2.exit, EXIT_CODES.UNREAD, `t2 ${name}`);
    assert.equal(r2.lines.length, 3, `t2 ${name}: ${r2.lines}`);
    assert.match(r2.lines[1], /^UNREAD .*\(F-010\)$/, `t2 ${name}`);
    // merge-ready --all: the row keeps the listed number and is UNREAD for origin, not a crash text.
    assert.deepEqual(rowStates(r3), { [NUMBER]: "UNREAD" }, `t3 ${name}: ${r3.lines}`);
    assert.ok(r3.lines.some((l) => /\(F-010\)/.test(l)), `t3 ${name}: ${r3.lines}`);
    assert.equal(r3.exit, 2, `t3 ${name}`);
    assert.deepEqual(await mirrorT1(routes), r1, `mirror t1 ${name}`);
    assert.deepEqual(await mirrorT2(routes), r2, `mirror t2 ${name}`);
    assert.deepEqual(await mirrorT3(all), r3, `mirror t3 ${name}`);
  }
});

// ---------------------------------------------------------------------------
// Properties P1-P4, 500 runs each; fast-check prints the seed and path on a failure.
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
const clsArb = fc.constantFrom(...Object.keys(AUTHORS));
const scArb = fc.constantFrom(...Object.keys(SCENARIOS));
const anyInput = fc.record({ cls: clsArb, sc: scArb, head: headArb, base: baseArb, repo: repoArb });

const build = ({ cls, sc, head, base, repo }) => {
  const scenario = SCENARIOS[sc];
  const raw = { ...rawPull(cls, scenario.pull), head, base };
  return { raw, scenario, routes: routesFor({ pulls: [{ n: NUMBER, raw }], scenario, repo }) };
};
const outcomes = async (routes) => {
  const r1 = await mirrorT1(routes);
  const r2 = await mirrorT2(routes);
  const r3 = await mirrorT3(routes);
  return { r1, s2: stateOf(r2), s3: rowStates(r3)[NUMBER] };
};
const gateOutside = (raw) => /head is not in this repository/i.test(
  evaluatePullRequest({ pr: { ...raw, changed_files: 1 }, files: [{ filename: "src/domain/example.ts", status: "modified" }], comments: [], ownerLogin: "owner1" }).result.description ?? "",
);

test("P1: when the gate fails on origin, no tool gives a passing outcome", async () => {
  await fc.assert(fc.asyncProperty(anyInput, async (input) => {
    const { raw, routes } = build(input);
    if (!gateOutside(raw)) return;
    const { r1, s2, s3 } = await outcomes(routes);
    assert.notEqual(r1.exit, 0);
    assert.ok(!PASSING_T2.has(s2), s2);
    assert.ok(!PASSING_T2.has(s3), s3);
    // I4: both names readable and different is always BLOCKED, never UNREAD.
    const h = raw.head?.repo?.full_name;
    const b = raw.base?.repo?.full_name;
    if (typeof h === "string" && h && typeof b === "string" && b && h !== b) assert.equal(s2, "BLOCKED");
  }), RUNS);
});

test("P2: a passing outcome implies sameRepositoryHead(raw) and a base equal to repoId", async () => {
  await fc.assert(fc.asyncProperty(anyInput, async (input) => {
    const { raw, routes } = build(input);
    const { r1, s2, s3 } = await outcomes(routes);
    const repository = input.repo.$error ? null : `${input.repo.owner.login}/${input.repo.name}`;
    if (r1.exit === 0 || PASSING_T2.has(s2) || PASSING_T2.has(s3)) {
      assert.ok(sameRepositoryHead(raw));
      assert.equal(raw.base.repo.full_name, repository);
    }
  }), RUNS);
});

test("P3: S inputs with any valid repository name under its own repoId equal the main outcomes", async () => {
  const arb = fc.record({ cls: clsArb, sc: scArb, owner: segment, repo: segment });
  await fc.assert(fc.asyncProperty(arb, async ({ cls, sc, owner, repo }) => {
    const full = `${owner}/${repo}`;
    const scenario = SCENARIOS[sc];
    const user = cls === "S1" ? { login: owner, type: "User" } : AUTHORS[cls];
    const raw = rawPull(cls, {
      ...scenario.pull, user,
      head: { sha: HEAD, ref: "feature/x", repo: { full_name: full } },
      base: { ref: "main", repo: { full_name: full } },
    });
    const routes = routesFor({ pulls: [{ n: NUMBER, raw }], scenario, repo: { owner: { login: owner }, name: repo } });
    assert.deepEqual(await mirrorT1(routes), snapshot.t1[`${cls}/${sc}`]);
    assert.deepEqual(await mirrorT2(routes), snapshot.t2[`${cls}/${sc}`]);
  }), RUNS);
});

test("P4: changing only head.repo of an S input never raises any tool's outcome", async () => {
  // O6 replaces the whole REST object, not head.repo; the O6 test above covers it.
  const heads = Object.keys(OUTSIDE).filter((k) => OUTSIDE[k] !== null);
  const arb = fc.record({ cls: clsArb, sc: scArb, repo: repoShape, o: fc.constantFrom(...heads), useO: fc.boolean() });
  await fc.assert(fc.asyncProperty(arb, async ({ cls, sc, repo, o, useO }) => {
    const scenario = SCENARIOS[sc];
    const before = rawPull(cls, scenario.pull);
    const changed = useO ? OUTSIDE[o].head : withRepo({ sha: HEAD, ref: "feature/x" }, repo);
    const after = { ...before, head: changed ?? { sha: HEAD, ref: "feature/x" } };
    const a = await outcomes(routesFor({ pulls: [{ n: NUMBER, raw: before }], scenario }));
    const b = await outcomes(routesFor({ pulls: [{ n: NUMBER, raw: after }], scenario }));
    assert.ok((b.r1.exit === 0 ? 1 : 0) <= (a.r1.exit === 0 ? 1 : 0));
    assert.ok(RANK[b.s2] <= RANK[a.s2], `${a.s2} -> ${b.s2}`);
    assert.ok(RANK[b.s3] <= RANK[a.s3], `${a.s3} -> ${b.s3}`);
    if (!sameRepositoryHead(after)) assert.ok(b.s2 === "BLOCKED" || b.s2 === "UNREAD", b.s2);
  }), RUNS);
});
