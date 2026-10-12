// P1-1: preflight before review or QA. Pure core only; gh is never called.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { CONTRACT_LINES, contractText, evaluatePreflight, preflightPass } from "./preflight-core.mjs";

const HEAD = "a".repeat(40);
const MAIN = "b".repeat(40);
const BODY = [
  "## Engineering metadata",
  "",
  "Agent: claude:cloudW:platforma",
  "Risk: critical",
  "Task: #249 P1-1",
  "",
  "## Ugovor (§14)",
  "",
  "- **Invarijanta:** x",
  "- **Stvarni pozivatelj:** `scripts/orchestrator/preflight.mjs`",
  "- **Poznate granice:** ne čita review ni QA",
  "- **Što bi ovaj PR moglo oboriti na QA-i?:** oblik opisa koji parser ne prepoznaje",
].join("\n");
const ok = (name) => ({ name, status: "COMPLETED", conclusion: "SUCCESS", completedAt: "2026-10-12T10:00:00Z" });
const REQUIRED = ["Lint, typecheck, test and build", "Local stack (compose.yaml)", "Security scanners", "Dependency review"];
const ROLLUP = REQUIRED.map(ok);
const PR = { state: "OPEN", isDraft: false, baseRefName: "main", headRefOid: HEAD, body: BODY };
const input = (over = {}) => ({
  mainSha: MAIN,
  compare: { status: "ahead", behind_by: 0 },
  rollup: ROLLUP,
  required: [...REQUIRED, "Engineering review gate"],
  ...over,
  pr: { ...PR, ...over.pr },
});
const fails = (checks) => checks.filter((c) => c.level === "FAIL").map((c) => c.id);

test("a ready PR passes every check, and only then", () => {
  const checks = evaluatePreflight(input());
  assert.deepEqual(fails(checks), []);
  assert.ok(preflightPass(checks));
  assert.ok(checks.every((c) => c.level === "PASS"));
  assert.equal(preflightPass([]), false);
});

test("each condition from ORKESTRATOR.md fails on its own", () => {
  assert.deepEqual(fails(evaluatePreflight(input({ pr: { isDraft: true } }))), ["draft"]);
  assert.deepEqual(fails(evaluatePreflight(input({ pr: { state: "CLOSED" } }))), ["open"]);
  assert.deepEqual(fails(evaluatePreflight(input({ pr: { baseRefName: "dev" } }))), ["base"]);
  assert.deepEqual(fails(evaluatePreflight(input({ compare: { status: "diverged", behind_by: 3 } }))), ["main"]);
  const red = [...ROLLUP.slice(1), { ...ROLLUP[0], conclusion: "FAILURE" }];
  assert.deepEqual(fails(evaluatePreflight(input({ rollup: red }))), ["ci"]);
  const pending = [...ROLLUP.slice(1), { name: ROLLUP[0].name, status: "IN_PROGRESS", conclusion: "" }];
  assert.deepEqual(fails(evaluatePreflight(input({ rollup: pending }))), ["ci"]);
});

test("an unread input is a FAIL, never a pass", () => {
  assert.deepEqual(fails(evaluatePreflight(input({ compare: null }))), ["main"]);
  assert.deepEqual(fails(evaluatePreflight(input({ compare: {} }))), ["main"]);
  assert.deepEqual(fails(evaluatePreflight(input({ mainSha: null }))), ["main"]);
  assert.deepEqual(fails(evaluatePreflight(input({ rollup: null }))), ["ci"]);
  assert.deepEqual(fails(evaluatePreflight(input({ rollup: [] }))), ["ci"]);
});

test("the gate status is not CI: a pending review gate does not block preflight", () => {
  const gate = { context: "Engineering review gate", state: "PENDING", startedAt: "2026-10-12T10:00:00Z" };
  assert.deepEqual(fails(evaluatePreflight(input({ rollup: [...ROLLUP, gate] }))), []);
});

test("--head: a moved head fails, the planned head passes", () => {
  assert.deepEqual(fails(evaluatePreflight(input({ expectHead: HEAD }))), []);
  assert.deepEqual(fails(evaluatePreflight(input({ expectHead: HEAD.toUpperCase() }))), []);
  assert.deepEqual(fails(evaluatePreflight(input({ expectHead: "c".repeat(40) }))), ["head"]);
});

test("each mandatory description line fails when missing, empty or a placeholder", () => {
  const without = (re) => BODY.split("\n").filter((l) => !re.test(l)).join("\n");
  assert.deepEqual(fails(evaluatePreflight(input({ pr: { body: without(/^Task:/) } }))), ["task"]);
  assert.deepEqual(fails(evaluatePreflight(input({ pr: { body: BODY.replace("Task: #249 P1-1", "Task: <ID ili kratki identifikator>") } }))), ["task"]);
  assert.deepEqual(fails(evaluatePreflight(input({ pr: { body: BODY.replace("Task: #249 P1-1", "Task:") } }))), ["task"]);
  assert.deepEqual(fails(evaluatePreflight(input({ pr: { body: without(/Stvarni pozivatelj/) } }))), ["contract:Stvarni pozivatelj"]);
  assert.deepEqual(fails(evaluatePreflight(input({ pr: { body: without(/Poznate granice/) } }))), ["contract:Poznate granice"]);
  assert.deepEqual(fails(evaluatePreflight(input({ pr: { body: without(/oboriti/) } }))), ["contract:Što bi ovaj PR moglo oboriti na QA-i?"]);
  const empty = BODY.replace("ne čita review ni QA", "");
  assert.equal(contractText(empty, "Poznate granice"), "");
  assert.deepEqual(fails(evaluatePreflight(input({ pr: { body: empty } }))), ["contract:Poznate granice"]);
  assert.deepEqual(fails(evaluatePreflight(input({ pr: { body: null } }))), ["task", ...CONTRACT_LINES.map((l) => `contract:${l}`)]);
});

test("contract lines are found in the forms PR descriptions use", () => {
  assert.equal(contractText("Stvarni pozivatelj: a.mjs", "Stvarni pozivatelj"), "a.mjs");
  assert.equal(contractText("1. **Stvarni pozivatelj:** a.mjs", "Stvarni pozivatelj"), "a.mjs");
  assert.equal(contractText("- **Što bi ovaj PR moglo oboriti na QA-i?** ništa", "Što bi ovaj PR moglo oboriti na QA-i?"), null);
  assert.equal(contractText("- Što bi ovaj PR moglo oboriti na QA-i: x", "Što bi ovaj PR moglo oboriti na QA-i?"), "x");
  assert.equal(contractText("## Poznate granice\n\nne čita QA\n\n## Dokaz", "Poznate granice"), "ne čita QA");
  assert.equal(contractText("**Poznate granice:**\n- jedna\n- druga\n\nnešto", "Poznate granice"), "jedna druga");
  // a label alone, followed by the next field, is still empty
  assert.equal(contractText("- **Poznate granice:**\n- **Invarijanta:** x", "Poznate granice"), "");
  assert.equal(contractText("## Poznate granice\n## Dokaz\nx", "Poznate granice"), "");
  // a longer word that only starts with the label is not the label
  assert.equal(contractText("Stvarni pozivatelji: a", "Stvarni pozivatelj"), null);
});

test("code fences and HTML comments never satisfy a line", () => {
  const fenced = "```\nStvarni pozivatelj: a.mjs\n```";
  assert.equal(contractText(fenced, "Stvarni pozivatelj"), null);
  assert.equal(contractText("<!-- Stvarni pozivatelj: a.mjs -->", "Stvarni pozivatelj"), null);
  assert.equal(contractText("<!--\nPoznate granice: x\n-->", "Poznate granice"), null);
});

test("the PR template alone does not pass preflight", () => {
  const template = readFileSync(new URL("../../.github/pull_request_template.md", import.meta.url), "utf8");
  const checks = evaluatePreflight(input({ pr: { body: template } }));
  assert.deepEqual(fails(checks), ["task", ...CONTRACT_LINES.map((l) => `contract:${l}`)]);
});

test("CI green means every required check of main, not whatever checks the head has", () => {
  const notCi = [ok("Engineering gate evaluator"), ok("GitGuardian Security Checks")];
  const checks = evaluatePreflight(input({ rollup: notCi }));
  assert.deepEqual(fails(checks), ["ci"]);
  const ci = checks.find((c) => c.id === "ci").text;
  for (const name of REQUIRED) assert.ok(ci.includes(name), name);
  assert.deepEqual(fails(evaluatePreflight(input({ rollup: [...ROLLUP.slice(1), ...notCi] }))), ["ci"]);
});

test("unread required checks are a FAIL; only the review gate may be missing", () => {
  assert.deepEqual(fails(evaluatePreflight(input({ required: null }))), ["ci"]);
  assert.deepEqual(fails(evaluatePreflight(input({ required: [] }))), ["ci"]);
  assert.deepEqual(fails(evaluatePreflight(input({ required: ["Engineering review gate"] }))), ["ci"]);
  assert.deepEqual(fails(evaluatePreflight(input({ required: REQUIRED }))), []);
});

test("description and check-name text is never echoed unfiltered", () => {
  const evil = "\u001b]8;;http://x\u0007click\u001b]8;;\u0007";
  const long = "x".repeat(81);
  for (const bad of [evil, long, "a\nFAIL fake"]) {
    const body = BODY.replace("Task: #249 P1-1", `Task: ${bad}`);
    const red = [...ROLLUP.slice(1), { ...ROLLUP[0], conclusion: bad }, { ...ok(bad), conclusion: "FAILURE" }];
    const checks = evaluatePreflight(input({ pr: { body }, rollup: red, required: [...REQUIRED, bad] }));
    for (const c of checks) assert.ok(!c.text.includes(bad), `${c.id}: ${c.text}`);
    assert.ok(checks.some((c) => c.text.includes("<not printed>")));
    assert.ok(checks.find((c) => c.id === "task").text.includes("filled"));
  }
  const odd = evaluatePreflight(input({ pr: { state: evil, baseRefName: long } }));
  for (const c of odd) assert.ok(!c.text.includes(evil) && !c.text.includes(long), c.text);
});
