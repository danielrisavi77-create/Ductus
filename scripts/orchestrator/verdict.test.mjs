import assert from "node:assert/strict";
import { test } from "node:test";

import { evaluateGate } from "../engineering/review-gate-core.mjs";
import {
  FOOTER, checkReport, composeVerdict, headProblem, parseVerdictArgs, verifyComposed,
} from "./verdict-core.mjs";

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
    [...base, "--model"],
    [...base, "--report", "--model"],
    [...base, "--post"],
    [...base, "--force"],
  ];
  for (const args of bad) assert.ok(parseVerdictArgs(args).error, args.join(" "));
});

test("checkReport enforces the totals line and refuses PASS with blocking findings", () => {
  const r = { role: "reviewer", verdict: "PASS" };
  assert.equal(checkReport("", r), null);
  assert.equal(checkReport("x\nBez nalaza.", r), null);
  assert.equal(checkReport("[MANJE] a.mjs:1\nUkupno: 0 kritično, 0 važno, 2 manje.", r), null);
  assert.match(checkReport("[VAŽNO] a.mjs:1\nUkupno: 0 kritično, 1 važno, 0 manje.", r), /PASS with open/);
  assert.equal(checkReport("Ukupno: 1 kritično, 0 važno, 0 manje.", { role: "reviewer", verdict: "FAIL" }), null);
  assert.match(checkReport("nalazi bez zbroja", r), /must end with/);
  assert.match(checkReport("Bez nalaza.\nReview-Verdict: FAIL", r), /metadata/);
  assert.match(checkReport("Owner-Override: PASS", { role: "qa", verdict: "PASS" }), /metadata/);
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
  const fail = composeVerdict({ ...opts, verdict: "FAIL", report: "Ukupno: 1 kritično, 0 važno, 0 manje." });
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
