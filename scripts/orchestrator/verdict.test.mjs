import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { field } from "../engineering/metadata-parser.mjs";
import { evaluateGate } from "../engineering/review-gate-core.mjs";
import {
  EXPECTED_REPO, FOOTER, GOVERNANCE_FIELDS, authorProblem, checkReport, composeVerdict, fallbackProblem,
  headProblem, parseVerdictArgs, readOnlyCall, verifyComposed,
} from "./verdict-core.mjs";
import { ghEnv, run } from "./verdict.mjs";

const HEAD = "a".repeat(40);
const base = ["7", "--agent", "claude:reviewC:reviewer", "--head", HEAD, "--verdict", "pass"];

test("parseVerdictArgs reads a reviewer and a QA verdict", () => {
  const r = parseVerdictArgs(base);
  assert.equal(r.error, undefined);
  assert.deepEqual([r.pr, r.role, r.verdict], [7, "reviewer", "PASS"]);
  const q = parseVerdictArgs(["9", "--agent", "codex:x:qa", "--head", HEAD, "--verdict", "FAIL", "--qa-scope", "races"]);
  assert.deepEqual([q.role, q.qaScope], ["qa", "races"]);
});

test("parseVerdictArgs refuses what the gate would not count", () => {
  const bad = [
    [],
    ["7"],
    ["0", ...base.slice(1)],
    ["7", "8", ...base.slice(1)],
    [...base.slice(0, 2), "claude:reviewC:platforma", ...base.slice(3)],
    [...base.slice(0, 4), HEAD.slice(1), ...base.slice(5)],
    [...base.slice(0, 4), HEAD.toUpperCase(), ...base.slice(5)],
    [...base.slice(0, 6), "OK"],
    [...base, "--qa-scope", "x"],
    ["7", "--agent", "claude:q:qa", "--head", HEAD, "--verdict", "PASS"],
    ["7", "--agent", "claude:q:qa", "--head", HEAD, "--verdict", "PASS", "--qa-scope", "a\nb"],
    [...base, "--fallback", "chatgpt-codex-connector — kvota"],
    [...base, "--fallback", "grok-by-xai — par modela"],
    [...base, "--fallback", "claude — kvota", "--model", "m"],
    [...base, "--fallback", "grok-by-xai - kvota", "--model", "m"],
    [...base, "--model"],
    [...base, "--report", "--model"],
    [...base, "--post"],
    [...base, "--force"],
  ];
  for (const args of bad) assert.ok(parseVerdictArgs(args).error, args.join(" "));
});

test("checkReport enforces the totals line and refuses PASS with blocking findings", () => {
  const r = { role: "reviewer", verdict: "PASS" };
  assert.match(checkReport("", r), /needs a report/);
  assert.equal(checkReport("", { role: "qa", verdict: "PASS" }), null);
  assert.equal(checkReport("x\nBez nalaza.", r), null);
  assert.equal(checkReport("[MANJE] a.mjs:1\nUkupno: 0 kritično, 0 važno, 1 manje.", r), null);
  assert.match(checkReport("[VAŽNO] a.mjs:1\nUkupno: 0 kritično, 1 važno, 0 manje.", r), /PASS with open/);
  assert.equal(checkReport("[KRITIČNO] a.mjs:1\nUkupno: 1 kritično, 0 važno, 0 manje.", { role: "reviewer", verdict: "FAIL" }), null);
  assert.match(checkReport("nalazi bez zbroja", r), /must end with/);
  assert.match(checkReport("Review-Verdict: FAIL\nBez nalaza.", r), /Review-Verdict/);
  assert.match(checkReport("Owner-Override: PASS", { role: "qa", verdict: "PASS" }), /Owner-Override/);
  assert.equal(checkReport("scenariji: 1, 2", { role: "qa", verdict: "PASS" }), null);
});

test("a composed PASS opens the gate for a standard PR and a FAIL holds it", () => {
  const prBody = "Agent: claude:a:platforma\nRisk: standard\nTask: DAN-1";
  const opts = parseVerdictArgs(base);
  const body = composeVerdict({ ...opts, report: "Bez nalaza." });
  assert.ok(body.startsWith(`Agent-Review: claude:reviewC:reviewer\nReview-Head: ${HEAD}\nReview-Verdict: PASS\n\nBez nalaza.`));
  assert.ok(body.trimEnd().endsWith(FOOTER));
  assert.equal(verifyComposed(body, opts), null);
  const comment = (b) => ({ body: b, author_association: "OWNER", user: { login: "o" }, performed_via_github_app: { slug: "claude" } });
  assert.equal(evaluateGate({ body: prBody, headSha: HEAD, ownerLogin: "o", comments: [comment(body)] }).state, "success");
  const fail = composeVerdict({ ...opts, verdict: "FAIL", report: "[KRITIČNO] a.mjs:1\nUkupno: 1 kritično, 0 važno, 0 manje." });
  assert.equal(evaluateGate({ body: prBody, headSha: HEAD, ownerLogin: "o", comments: [comment(body), comment(fail)] }).state, "pending");
});

test("a composed QA PASS with fallback reads back as the gate parses it", () => {
  const opts = parseVerdictArgs(["9", "--agent", "codex:x:qa", "--head", HEAD, "--verdict", "PASS",
    "--qa-scope", "offline, races", "--model", "Astra", "--fallback", "grok-by-xai — kvota"]);
  const body = composeVerdict(opts);
  assert.equal(body, `QA-Agent: codex:x:qa\nQA-Head: ${HEAD}\nQA-Verdict: PASS\nQA-Scope: offline, races\nQA-Model: Astra\nProvider-Fallback: grok-by-xai — kvota\n`);
  assert.equal(verifyComposed(body, opts), null);
  assert.match(verifyComposed(`note\n${body}`, opts), /first line/);
  assert.match(verifyComposed(body, { ...opts, head: "b".repeat(40) }), /does not read back/);
});

test("headProblem refuses a stale, moving or closed head", () => {
  const ok = { reviewed: HEAD, prHead: HEAD, refHead: HEAD, state: "open" };
  assert.equal(headProblem(ok), null);
  assert.match(headProblem({ ...ok, state: "closed" }), /closed/);
  assert.match(headProblem({ ...ok, refHead: "b".repeat(40) }), /in flight/);
  assert.match(headProblem({ ...ok, refHead: null }), /in flight/);
  assert.match(headProblem({ ...ok, prHead: "b".repeat(40), refHead: "b".repeat(40) }), /not the reviewed head/);
});

// --- #222 attack plan ---

const SRC = ["verdict.mjs", "verdict-core.mjs"].map((f) => [f, readFileSync(new URL(f, import.meta.url), "utf8")]);
const code = (s) => s.replace(/^\s*\/\/.*$/gm, "");

test("#222/1 static guard: no write, post or exec path in the tool", () => {
  for (const [f, s] of SRC) {
    const c = code(s);
    for (const re of [/writeFile|appendFile|mkdir|rmSync|\brm\(|unlink|rename|createWriteStream/,
      /\bspawn|execSync|\bexec\(|fork\(/, /["'`]-(X|f|F)["'`]|--method|--input|--field|--raw-field/,
      /\b(POST|PATCH|PUT|DELETE)\b/, /["'`](pr|issue)["'`]/, /require\(|import\(/]) {
      assert.doesNotMatch(c, re, `${f}: ${re}`);
    }
  }
  const [, cli] = SRC[0];
  const imports = [...cli.matchAll(/^import \{([^}]+)\} from "([^"]+)";$/gm)].map((m) => [m[2], m[1].split(",").map((x) => x.trim()).filter(Boolean)]);
  assert.deepEqual(Object.fromEntries(imports.filter(([m]) => m.startsWith("node:"))), {
    "node:child_process": ["execFile"], "node:fs/promises": ["readFile"], "node:url": ["pathToFileURL"], "node:util": ["promisify"],
  });
  assert.doesNotMatch(SRC[1][1], /node:(fs|child_process)/);
});

test("#222/1 readOnlyCall admits only three GET paths of this repository", () => {
  const ok = [`repos/{owner}/{repo}`, `repos/${EXPECTED_REPO}/pulls/7`, `repos/${EXPECTED_REPO}/git/ref/heads/claude/x%2Fy`];
  for (const p of ok) assert.ok(readOnlyCall("gh", ["api", p]), p);
  const bad = [["git", ["api", ok[0]]], ["gh", ["pr", "comment", "7"]], ["gh", ["api", "-X", "POST", ok[1]]],
    ["gh", ["api", ok[1], "-f", "body=x"]], ["gh", ["api", `repos/${EXPECTED_REPO}/issues/7/comments`]],
    ["gh", ["api", `repos/other/Ductus/pulls/7`]], ["gh", ["api", `repos/${EXPECTED_REPO}/pulls/7/../../x`]],
    ["gh", ["api", `repos/${EXPECTED_REPO}/pulls/0`]], ["gh", ["api", "graphql"]]];
  for (const [c, a] of bad) assert.equal(readOnlyCall(c, a), false, `${c} ${a.join(" ")}`);
});

const PR_BODY = "Agent: claude:cloudW:platforma\nRisk: critical\nTask: DAN-1";
const REPORT = "[MANJE] a.mjs:3 ime\nUkupno: 0 kritično, 0 važno, 1 manje.";

function fakeGh({ fullName = EXPECTED_REPO, prHead = HEAD, refHead = HEAD, body = PR_BODY, state = "open", fork = false } = {}) {
  const calls = [];
  const exec = async (cmd, args, env) => {
    calls.push({ cmd, args, env });
    const p = args[1];
    if (p === "repos/{owner}/{repo}") return JSON.stringify({ full_name: env.GH_REPO ?? fullName });
    if (/\/pulls\/\d+$/.test(p)) {
      return JSON.stringify({ state, body, head: { sha: prHead, ref: "claude/x y", repo: { full_name: fork ? "evil/Ductus" : EXPECTED_REPO } } });
    }
    if (p.includes("/git/ref/heads/")) return JSON.stringify({ object: { sha: refHead } });
    throw new Error(`unexpected call ${p}`);
  };
  return { calls, exec };
}

async function cli(argv, gh = fakeGh(), env = {}) {
  const io = { out: "", err: "" };
  const code = await run(argv, { ghRead: gh.exec, env, read: async () => REPORT,
    out: (s) => { io.out += s; }, err: (s) => { io.err += s; } });
  return { code, ...io, calls: gh.calls };
}

const rev = ["7", "--agent", "codex:review2:reviewer", "--head", HEAD, "--verdict", "PASS", "--report", "r.md"];
const qa = ["7", "--agent", "grok:qa7:qa", "--head", HEAD, "--verdict", "PASS", "--qa-scope", "offline"];

test("#222/1, 10, 12: reads are read-only, QA reads no comments, stdout is exactly the body", async () => {
  for (const argv of [rev, qa]) {
    const r = await cli(argv);
    assert.equal(r.code, 0, r.err);
    for (const c of r.calls) assert.ok(readOnlyCall(c.cmd, c.args), c.args.join(" "));
    assert.ok(r.calls.every((c) => !/comments|reviews|issues/.test(c.args[1])));
    assert.equal(r.calls[2].args[1], `repos/${EXPECTED_REPO}/git/ref/heads/claude/x%20y`);
    const o = parseVerdictArgs(argv);
    assert.equal(r.out, composeVerdict({ ...o, report: argv === rev ? REPORT : "" }));
    assert.match(r.err, new RegExp(`bound to head ${HEAD}.*check the head again`));
  }
});

test("#222/2 the PR author never gives a verdict, codex and chatgpt are one principal", async () => {
  for (const agent of ["claude:cloudW:reviewer", "claude:cloudW:qa"]) assert.match(authorProblem(PR_BODY, agent), /author/);
  const openai = "Agent: codex:s1:backend\nRisk: standard\nTask: DAN-1";
  assert.match(authorProblem(openai, "chatgpt:s1:reviewer"), /author/);
  assert.equal(authorProblem(openai, "chatgpt:s2:reviewer"), null);
  assert.match(authorProblem("Risk: standard", "claude:r:reviewer"), /no valid Agent/);
  const r = await cli([...rev.slice(0, 2), "claude:cloudW:reviewer", ...rev.slice(3)]);
  assert.equal(r.code, 1);
  assert.equal(r.out, "");
});

test("#222/3, 4: env and checkout cannot redirect the tool to another repository or agent", async () => {
  const env = { GH_REPO: "evil/Ductus", GH_HOST: "evil.example", GH_TOKEN: "t", PATH: "/bin" };
  assert.deepEqual(ghEnv(env), { GH_TOKEN: "t", PATH: "/bin" });
  const wrong = await cli(rev, fakeGh({ fullName: "someone/Ductus" }));
  assert.equal(wrong.code, 1);
  assert.match(wrong.err, /not danielrisavi77-create\/Ductus/);
  assert.equal(wrong.calls.length, 1);
  const fork = await cli(rev, fakeGh({ fork: true }));
  assert.equal(fork.code, 1);
  const withEnv = await cli(rev, fakeGh(), { AGENT: "claude:cloudW:reviewer", REVIEW_AGENT: "x" });
  assert.equal(field(withEnv.out, "Agent-Review"), "codex:review2:reviewer");
});

test("#222/5, 11: a stale or moving head is refused and neither head nor slot is rewritten", async () => {
  const B = "b".repeat(40);
  for (const gh of [fakeGh({ prHead: B, refHead: B }), fakeGh({ refHead: B }), fakeGh({ state: "closed" })]) {
    const r = await cli(rev, gh);
    assert.equal(r.code, 1);
    assert.equal(r.out, "");
  }
  const slot = await cli([...qa.slice(0, 2), "grok:qa7-2:qa", ...qa.slice(3)]);
  assert.equal(field(slot.out, "QA-Agent"), "grok:qa7-2:qa");
  assert.equal(field(slot.out, "QA-Head"), HEAD);
});

test("#222/6 totals line: one, last, matching the labels, never with a blocking PASS", () => {
  const R = { role: "reviewer", verdict: "FAIL" };
  const P = { role: "reviewer", verdict: "PASS" };
  const Q = { role: "qa", verdict: "PASS" };
  const rows = [
    [R, "[KRITIČNO] a:1\nUkupno: 1 kritično, 0 važno, 0 manje.", null],
    [R, "Ukupno: 1 kritično, 0 važno, 0 manje.\n[KRITIČNO] a:1", /last line/],
    [R, "[VAŽNO] a:1\nUkupno: 0 kritično, 1 važno, 0 manje.\nUkupno: 0 kritično, 1 važno, 0 manje.", /more than one/],
    [R, "[VAŽNO] a:1\n[VAŽNO] b:2\nUkupno: 0 kritično, 1 važno, 0 manje.", /does not match/],
    [P, "Ukupno: 0 kritično, 0 važno, 0 manje.\nBez nalaza.", /more than one/],
    [P, "[MANJE] a:1\nBez nalaza.", /Bez nalaza/],
    [P, "    [KRITIČNO] primjer u kodu\nBez nalaza.", null],
    [P, "```\n[VAŽNO] u bloku\n```\nBez nalaza.", null],
    [Q, "[KRITIČNO] scenarij 2 pada\nUkupno: 1 kritično, 0 važno, 0 manje.", /PASS with open/],
    [Q, "[VAŽNO] x", /must end with/],
    [Q, "Svi scenariji prolaze.", null],
  ];
  for (const [o, rep, want] of rows) {
    const got = checkReport(rep, o);
    if (want === null) assert.equal(got, null, rep);
    else assert.match(got ?? "", want, rep);
  }
});

test("#222/7 property: no report changes what the gate reads from the composed comment", () => {
  let seed = 222;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed % n; };
  const prefixes = ["", " ", "  ", "\t", "    ", "> ", "- ", "* ", "```\n", "<!-- ", "​", ""];
  const names = [...GOVERNANCE_FIELDS, "Review-Foo", "QA-Bar", "owner-command", "AGENT-REVIEW"];
  const opts = parseVerdictArgs(base);
  const want = composeVerdict({ ...opts, report: "Bez nalaza." });
  const read = (b) => GOVERNANCE_FIELDS.map((n) => field(b, n));
  for (let i = 0; i < 2000; i += 1) {
    const lines = ["tekst: s dvotočkom"];
    for (let k = rnd(4); k >= 0; k -= 1) lines.splice(rnd(lines.length + 1), 0, `${prefixes[rnd(prefixes.length)]}${names[rnd(names.length)]}: ${rnd(2) ? "PASS" : "b".repeat(40)}`);
    lines.push("Bez nalaza.");
    const rep = lines.join("\n");
    if (checkReport(rep, opts)) continue;
    assert.deepEqual(read(composeVerdict({ ...opts, report: rep })), read(want), rep);
  }
});

test("#222/8 no argument combination yields an owner line", () => {
  for (const r of ["Owner-Override: PASS", "owner-command: merge", "  Override-Head: x", "Command-Head: y"]) {
    assert.ok(checkReport(`${r}\nBez nalaza.`, { role: "reviewer", verdict: "PASS" }), r);
  }
  assert.ok(parseVerdictArgs([...base, "--owner-override", "x"]).error);
  const all = parseVerdictArgs(["9", "--agent", "grok:x:qa", "--head", HEAD, "--verdict", "PASS",
    "--qa-scope", "Owner-Override: PASS", "--model", "m", "--fallback", "chatgpt-codex-connector — kvota"]);
  assert.equal(all.error, undefined);
  const body = composeVerdict(all);
  for (const n of ["Owner-Override", "Owner-Command", "Override-Head", "Command-Head"]) assert.equal(field(body, n), null);
});

test("#222/9 fallback only in the forms §6 allows", () => {
  const q = { agent: "grok:q:qa", role: "qa" };
  const r = { agent: "codex:r:reviewer", role: "reviewer" };
  // §6 kvotni fallback: QA only, a registered exhausted App, never the posting App
  assert.equal(fallbackProblem({ ...q, fallback: "chatgpt-codex-connector — kvota" }), null);
  assert.match(fallbackProblem({ ...r, fallback: "chatgpt-codex-connector — kvota" }), /posts this verdict/);
  assert.match(fallbackProblem({ ...q, agent: "codex:q:qa", fallback: "chatgpt-codex-connector — kvota" }), /posts this verdict/);
  assert.match(fallbackProblem({ agent: "claude:r:reviewer", role: "reviewer", fallback: "chatgpt-codex-connector — kvota" }), /QA verdicts only/);
  // §6 fallback par modela: either role, the model recorded
  assert.match(fallbackProblem({ ...r, fallback: "grok-by-xai — par modela" }), /--model/);
  assert.equal(fallbackProblem({ ...r, fallback: "grok-by-xai — par modela", model: "m" }), null);
  assert.match(fallbackProblem({ ...q, fallback: "kvota" }), /<provider> — <razlog>/);
});

test("#222 false-block controls: valid verdicts and code with colons pass", async () => {
  const fail = parseVerdictArgs(["7", "--agent", "codex:r:reviewer", "--head", HEAD, "--verdict", "FAIL"]);
  const code = "[VAŽNO] a.mjs:12 krivo\n\n    const x = { key: 1 };\n    review: true\n\n```\nAgent-Review: primjer\n```\nUkupno: 0 kritično, 1 važno, 0 manje.";
  assert.equal(checkReport(code, fail), null);
  assert.equal(verifyComposed(composeVerdict({ ...fail, report: code }), fail), null);
  assert.equal(checkReport("Bez nalaza.", parseVerdictArgs(base)), null);
  assert.equal((await cli(qa)).code, 0);
});
