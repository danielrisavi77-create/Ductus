import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import fc from "fast-check";

import { evaluatePullRequest, sameRepositoryHead } from "../engineering/review-gate-core.mjs";
import { toPr } from "./gh.mjs";
import { headOrigin, overrideOutput } from "./orchestrator-core.mjs";
import {
  AUTHORS, baseArb, gateOutside, HEAD, headArb, io, NUMBER, OUTSIDE, OVERRIDE_REASON, OVERRIDE_SCENARIOS, OWNER,
  PASS_COMMENTS, R, rawPull, repoArb, repositoryOf, routesFor, runTool, segment,
} from "./origin-cases.mjs";

// F-010 in the orchestrator tools (DAN-574 PR B3, plan #1671): orch:override (T6)
// prints a block only for a head the gate's predicate places in this repository,
// over the same REST object the head SHA comes from (I3), and the display tools
// (N10: pr-status, evidence) mark an outside head and never show its PASS. The S
// outcomes were recorded on main ccabd332 before the guard (origin-snapshot.json t6/n10, I2).
const snapshot = JSON.parse(readFileSync(new URL("./origin-snapshot.json", import.meta.url), "utf8"));
const split = (s) => s.split(/\r?\n/).filter(Boolean);
const rec = (r) => ({ exit: r.code, lines: split(r.stdout), stderr: split(r.stderr) });
const S = Object.keys(AUTHORS);
const O = Object.keys(OUTSIDE);
const ORIGIN_ERR = new RegExp(`^#${NUMBER}: head origin: .*\\(F-010\\)`);

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

const t6 = async (routes) => rec(await runTool("override-block.mjs", [String(NUMBER), "--reason", OVERRIDE_REASON], routes));
const single = (cls, sc = {}, { repo = R.R1, ...entry } = {}) => routesFor({ pulls: [{ n: NUMBER, raw: rawPull(cls, sc.pull), ...entry }], scenario: sc, repo });

/**
 * override-block.mjs <NUMBER> --reason over routes, in process: the same read, the
 * same repoId and the same pure functions as the CLI. The tests below prove it
 * prints what the real CLI prints on every S and O class.
 */
async function mirrorT6(routes) {
  const { json, repo } = io(routes);
  const repository = await repo().then(({ owner, repo: name }) => `${owner}/${name}`, () => null);
  try {
    const pr = await json(["api", `repos/{owner}/{repo}/pulls/${NUMBER}`]);
    const { stdout, stderr } = overrideOutput(NUMBER, pr, OVERRIDE_REASON, headOrigin(toPr(pr), repository));
    return { exit: 0, lines: split(stdout), stderr: split(stderr) };
  } catch (e) {
    return { exit: 1, lines: [], stderr: [`#${NUMBER}: ${e.message}`] };
  }
}

/** The gate on `raw` with the owner's override comment `block` (what T6 would print for S1). */
const gateWithOverride = (raw, block) => evaluatePullRequest({
  pr: { ...raw, changed_files: 1 }, files: [{ filename: "src/domain/example.ts", status: "modified" }], ownerLogin: OWNER,
  comments: [{ body: block, user: { login: OWNER }, author_association: "OWNER", performed_via_github_app: null, created_at: "2026-11-01T12:00:00Z" }],
}).result;

// ---------------------------------------------------------------------------
// I2: every S class prints what main ccabd332 printed.
test("I2: T6 and the N10 display tools give the recorded main outcomes for every S class", async () => {
  const jobs = [];
  for (const [name, sc] of Object.entries(OVERRIDE_SCENARIOS)) {
    for (const cls of S) jobs.push(async () => [`t6 ${cls}/${name}`, await t6(single(cls, sc)), snapshot.t6[`${cls}/${name}`]]);
  }
  for (const cls of S) {
    const routes = single(cls, {}, { comments: PASS_COMMENTS });
    jobs.push(async () => [`n10 ${cls}/pr-status`, rec(await runTool("pr-status.mjs", [], routes)), snapshot.n10[`${cls}/pr-status`]]);
    jobs.push(async () => [`n10 ${cls}/pr-status-json`, rec(await runTool("pr-status.mjs", ["--json"], routes)), snapshot.n10[`${cls}/pr-status-json`]]);
    jobs.push(async () => [`n10 ${cls}/evidence`, rec(await runTool("evidence.mjs", ["--pr", String(NUMBER)], routes)), snapshot.n10[`${cls}/evidence`]]);
  }
  for (const [label, got, want] of await pool(jobs)) assert.deepEqual(got, want, label);
});

test("the in-process T6 mirror prints the recorded main outcomes for every S class", async () => {
  for (const [name, sc] of Object.entries(OVERRIDE_SCENARIOS)) {
    for (const cls of S) assert.deepEqual(await mirrorT6(single(cls, sc)), snapshot.t6[`${cls}/${name}`], `t6 ${cls}/${name}`);
  }
});

// ---------------------------------------------------------------------------
// T6 over every O class (O1-O13, O6 included) in every scenario, through the real CLI (I1).
test("T6: every O class in every scenario prints nothing on stdout, the origin on stderr, and exits 1", async () => {
  const block = snapshot.t6["S1/open"].lines.map((l) => `${l}\n`).join("");
  const jobs = [];
  for (const [name, sc] of Object.entries(OVERRIDE_SCENARIOS)) {
    for (const cls of O) {
      const routes = single(cls, sc);
      jobs.push(async () => ({ cls, name, sc, routes, r: await t6(routes) }));
    }
  }
  for (const { cls, name, sc, routes, r } of await pool(jobs)) {
    const label = `${cls}/${name}`;
    assert.equal(r.exit, 1, label);
    assert.deepEqual(r.lines, [], label);
    assert.equal(r.stderr.length, 1, `${label}: ${r.stderr}`);
    assert.match(r.stderr[0], ORIGIN_ERR, label);
    assert.ok(!r.stderr.join("\n").includes("Override-Head"), label);
    assert.deepEqual(await mirrorT6(routes), r, `mirror ${label}`);
    // The gate does not accept the override for this head either (line 126 of the plan), except
    // O8r: head and base agree, and the gate never reads repoId, so only T6 sees base != owner1/repo1.
    const raw = rawPull(cls, sc.pull);
    if (raw) assert.equal(gateWithOverride(raw, block).state === "success", cls === "O8r", label);
  }
});

test("N9: O1 and O3 with a valid reason and an open PR get no block; S1 still gets it", async () => {
  for (const cls of ["O1", "O3"]) {
    const r = await t6(single(cls, OVERRIDE_SCENARIOS.open));
    assert.notEqual(r.exit, 0, cls);
    assert.deepEqual(r.lines, [], cls);
  }
  assert.ok((await t6(single("O1"))).stderr[0].includes("head outsider/repo1-fork is outside base owner1/repo1 (F-010)"));
  const s1 = await t6(single("S1", OVERRIDE_SCENARIOS.open));
  assert.equal(s1.exit, 0);
  assert.deepEqual(s1.lines, ["Owner-Override: PASS", `Override-Head: ${HEAD}`, `Override-Reason: ${OVERRIDE_REASON}`]);
  // The block it prints is the one the gate accepts for S1 (the S1 control of the gate test above).
  assert.equal(gateWithOverride(rawPull("S1"), s1.lines.map((l) => `${l}\n`).join("")).state, "success");
});

test("R2-R4: S1 under a repoId with another case, a renamed repository or a failed read gets no block", async () => {
  const want = {
    R2: "base owner1/repo1 is not this repository Owner1/Repo1 (F-010)",
    R3: "base owner1/repo1 is not this repository owner1/renamed1 (F-010)",
    R4: "this repository could not be read (F-010)",
  };
  for (const [k, text] of Object.entries(want)) {
    const r = await t6(single("S1", OVERRIDE_SCENARIOS.open, { repo: R[k] }));
    assert.equal(r.exit, 1, k);
    assert.deepEqual(r.lines, [], k);
    assert.ok(r.stderr[0].includes(text), `${k}: ${r.stderr}`);
  }
});

test("an outside name with characters outside the allow-list is not printed by T6", async () => {
  for (const cls of ["O9t", "O9l"]) {
    const r = await t6(single(cls));
    assert.match(r.stderr[0], /names not printed/, cls);
  }
  const r = await t6(single("S1", {}, { raw: rawPull("S1", { head: { sha: HEAD, ref: "x", repo: { full_name: "evil\u001b[2J/x" } } }) }));
  assert.equal(r.exit, 1);
  assert.match(r.stderr[0], /names not printed/);
  assert.ok(!r.stderr.join("\n").includes("\u001b"));
});

// C1: T6 reads the PR once; the head it prints and the origin it judges are that one object.
test("C1: the fork goes away between reads (O1 then O3, or O1 then S1): T6 prints no block", async () => {
  for (const second of ["O3", "S1"]) {
    const routes = single("O1", OVERRIDE_SCENARIOS.open, { answers: [rawPull("O1"), rawPull(second)] });
    const r = await t6(routes);
    assert.equal(r.exit, 1, second);
    assert.deepEqual(r.lines, [], second);
    assert.match(r.stderr[0], ORIGIN_ERR, second);
  }
});

// ---------------------------------------------------------------------------
// N10: an O PR with review and QA PASS on its head, through the real display tools.
const FOOTER = "Facts only: no PASS, no advice, no review text.";
const saysPass = (text) => /PASS|spreman/i.test(text);
test("N10: pr-status and evidence mark every O head VANJSKI and never show its PASS", async () => {
  const jobs = O.map((cls) => async () => {
    const raw = rawPull(cls);
    const routes = routesFor({ pulls: [{ n: NUMBER, raw, listed: raw, comments: PASS_COMMENTS }] });
    const [table, json, text, ejson] = await Promise.all([
      runTool("pr-status.mjs", [], routes), runTool("pr-status.mjs", ["--json"], routes),
      runTool("evidence.mjs", ["--pr", String(NUMBER)], routes), runTool("evidence.mjs", ["--pr", String(NUMBER), "--json"], routes),
    ]);
    return { cls, table, json, text, ejson };
  });
  for (const { cls, table, json, text, ejson } of await pool(jobs)) {
    // A PR without a readable head SHA (O5, O6) stops the tool: nothing is shown at all.
    assert.ok(!saysPass(table.stdout), `${cls} table: ${table.stdout}`);
    if (table.code === 0) assert.match(split(table.stdout)[0], new RegExp(`^#${NUMBER} \\w{8} ${cls === "O11b" ? "undefined" : "main"} VANJSKI \\(`), cls);
    assert.ok(!saysPass(json.stdout), `${cls} json: ${json.stdout}`);
    if (json.code === 0) {
      const [row] = JSON.parse(json.stdout);
      assert.equal(typeof row.external, "string", cls);
      assert.notEqual(row.external, "", cls);
    }
    const lines = split(text.stdout);
    assert.ok(!saysPass(lines.filter((l) => l !== FOOTER).join("\n")), `${cls} evidence: ${text.stdout}`);
    if (text.code === 0) assert.ok(lines.some((l) => /^Head origin: VANJSKI \(.*F-010.*\)$/.test(l)), `${cls}: ${lines}`);
    assert.ok(!saysPass(ejson.stdout), `${cls} evidence json: ${ejson.stdout}`);
    if (ejson.code === 0) assert.match(JSON.parse(ejson.stdout).external, /F-010/, cls);
  }
});

test("N10: under every R value an S1 PR is shown with PASS only when its head is in the repository read", async () => {
  for (const [k, repo] of Object.entries(R)) {
    const routes = single("S1", {}, { comments: PASS_COMMENTS, repo });
    const text = split((await runTool("evidence.mjs", ["--pr", String(NUMBER)], routes)).stdout).filter((l) => l !== FOOTER).join("\n");
    assert.equal(saysPass(text), k === "R1", `${k}: ${text}`);
    if (k !== "R1") assert.match(text, /^Head origin: VANJSKI \(/m, k);
  }
});

// ---------------------------------------------------------------------------
// Properties P1-P2 for T6, 500 runs each; fast-check prints the seed on a failure.
const RUNS = { numRuns: 500 };
const scArb = fc.constantFrom(...Object.keys(OVERRIDE_SCENARIOS));
// The second arm names head, base and repoId alike, so blocks are reached as well as refusals.
const anyInput = fc.oneof(
  fc.record({ cls: fc.constantFrom(...S), sc: scArb, head: headArb, base: baseArb, repo: repoArb }),
  fc.record({ cls: fc.constantFrom(...S), sc: scArb, owner: segment, name: segment }).map(({ cls, sc, owner, name }) => ({
    cls, sc, head: { sha: HEAD, ref: "feature/x", repo: { full_name: `${owner}/${name}` } },
    base: { ref: "main", repo: { full_name: `${owner}/${name}` } }, repo: { owner: { login: owner }, name },
  })),
);
const outcome = async ({ cls, sc, head, base, repo }) => {
  const s = OVERRIDE_SCENARIOS[sc];
  const raw = { ...rawPull(cls, s.pull), head, base };
  return { raw, r: await mirrorT6(routesFor({ pulls: [{ n: NUMBER, raw }], scenario: s, repo })) };
};

test("P1: when the gate fails on origin, T6 prints no block and exits 1", async () => {
  await fc.assert(fc.asyncProperty(anyInput, async (input) => {
    const { raw, r } = await outcome(input);
    if (gateOutside(raw)) {
      assert.equal(r.exit, 1);
      assert.deepEqual(r.lines, []);
    }
  }), RUNS);
});

test("P2: a printed block implies sameRepositoryHead(raw), a base equal to repoId and an open PR", async () => {
  await fc.assert(fc.asyncProperty(anyInput, async (input) => {
    const { raw, r } = await outcome(input);
    if (r.lines.length) {
      assert.equal(r.exit, 0);
      assert.ok(sameRepositoryHead(raw));
      assert.equal(raw.base.repo.full_name, repositoryOf(input.repo));
      assert.equal(raw.state, "open");
      assert.equal(raw.merged_at, null);
    }
  }), RUNS);
});

test("P1/P2 inputs: the generator reaches blocks and origin refusals both", async () => {
  // Guard against a vacuous property: a fixed sample of the arbitrary has both outcomes.
  const sample = fc.sample(anyInput, { numRuns: 300, seed: 1671 });
  const results = await Promise.all(sample.map(outcome));
  assert.ok(results.some(({ r }) => r.lines.length > 0), "some input prints a block");
  assert.ok(results.some(({ raw, r }) => gateOutside(raw) && r.exit === 1), "some input is refused on origin");
});
