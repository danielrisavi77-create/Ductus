// P1-1: preflight before review or QA. Pure core only; gh is never called.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { CONTRACT_LINES, CRITICAL_CONTRACT_LINES, contractText, evaluatePreflight, preflightExitCode, preflightPass, requiredStatusChecks } from "./preflight-core.mjs";
import { evaluateChecks, evaluateReady } from "./orchestrator-core.mjs";

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
  "- **Mjesta:** x",
  "- **Stvarni pozivatelj:** `scripts/orchestrator/preflight.mjs`",
  "- **Poznate granice:** ne čita review ni QA",
  "- **Što bi ovaj PR moglo oboriti na QA-i?:** oblik opisa koji parser ne prepoznaje",
].join("\n");
const ok = (name, appId = null) => ({ name, appId, status: "COMPLETED", conclusion: "SUCCESS", completedAt: "2026-10-12T10:00:00Z" });
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

test("critical PRs require all five §14 contract fields; other risks keep the general contract", () => {
  for (const label of CRITICAL_CONTRACT_LINES) {
    const line = `- **${label}:** x`;
    const missing = BODY.replace(`${line}\n`, "");
    const empty = BODY.replace(line, `- **${label}:**`);
    const placeholder = BODY.replace(line, `- **${label}:** <TBD>`);
    for (const body of [missing, empty, placeholder]) {
      assert.ok(fails(evaluatePreflight(input({ pr: { body } }))).includes(`critical-contract:${label}`), `${label} must be filled`);
    }
  }
  const nonCritical = BODY.replace("Risk: critical", "Risk: standard").replace("- **Invarijanta:** x\n", "").replace("- **Mjesta:** x\n", "");
  assert.deepEqual(fails(evaluatePreflight(input({ pr: { body: nonCritical } }))), []);
});

test("each condition from ORKESTRATOR.md fails on its own", () => {
  assert.deepEqual(fails(evaluatePreflight(input({ pr: { isDraft: true } }))), ["draft"]);
  assert.deepEqual(fails(evaluatePreflight(input({ pr: { state: "CLOSED" } }))), ["open"]);
  assert.deepEqual(fails(evaluatePreflight(input({ pr: { baseRefName: "dev" } }))), ["base"]);
  assert.deepEqual(fails(evaluatePreflight(input({ compare: { status: "diverged", behind_by: 3 } }))), ["main"]);
  const red = [...ROLLUP.slice(1), { ...ROLLUP[0], conclusion: "FAILURE" }];
  assert.deepEqual(fails(evaluatePreflight(input({ rollup: red }))), ["ci"]);
  const cancelled = [...ROLLUP.slice(1), { ...ROLLUP[0], conclusion: "CANCELLED" }];
  assert.deepEqual(fails(evaluatePreflight(input({ rollup: cancelled }))), ["ci"]);
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

const MERGE_AUTH = "Merge authorization";
const authorization = (state) => ({ context: MERGE_AUTH, state, startedAt: "2026-10-22T10:00:00Z" });
const reviewEntry = (over = {}) => input({
  required: [...REQUIRED, "Engineering review gate", MERGE_AUTH],
  rollup: [...ROLLUP, { context: "Engineering review gate", state: "PENDING" }, authorization("PENDING")],
  ...over,
});

test("D-161: Merge authorization waits for the owner by design and never counts as CI", () => {
  for (const state of ["PENDING", "FAILURE", "ERROR", "SUCCESS"]) {
    assert.deepEqual(fails(evaluatePreflight(reviewEntry({ rollup: [...ROLLUP, authorization(state)] }))), [], state);
  }
  // Positive control: the same exemption does not cover any other context.
  for (const context of ["Merge Authorization", "Merge authorization extra", "Other authorization"]) {
    const rollup = [...ROLLUP, authorization("PENDING"), { context, state: "FAILURE" }];
    assert.deepEqual(fails(evaluatePreflight(reviewEntry({ rollup }))), ["ci"], context);
  }
  // It is not a stand-in for CI: missing or red real checks still fail, and an unread rollup fails.
  for (const name of REQUIRED) {
    const others = ROLLUP.filter((c) => c.name !== name);
    assert.deepEqual(fails(evaluatePreflight(reviewEntry({ rollup: [...others, authorization("PENDING")] }))), ["ci"], name);
    assert.deepEqual(fails(evaluatePreflight(reviewEntry({ rollup: [...others, { ...ok(name), conclusion: "FAILURE" }, authorization("PENDING")] }))), ["ci"], name);
  }
  assert.deepEqual(fails(evaluatePreflight(reviewEntry({ rollup: null }))), ["ci"]);
  // Merge readiness stays strict: the shared check still reports it.
  assert.deepEqual(evaluateChecks(reviewEntry().rollup).bad, [{ name: MERGE_AUTH, state: "PENDING" }]);
  assert.equal(preflightExitCode(evaluatePreflight(reviewEntry()), ["head checks"]), 2);
});

test("D-161 (b): a running check does not fail preflight; a failed one does", () => {
  const name = REQUIRED[0];
  const others = ROLLUP.slice(1);
  const running = [
    { name, status: "IN_PROGRESS", conclusion: "" },
    { name, status: "QUEUED", conclusion: "" },
    { name, status: "COMPLETED", conclusion: "PENDING" },
    { context: name, state: "PENDING" },
  ];
  for (const check of running) {
    const checks = evaluatePreflight(input({ rollup: [...others, check] }));
    assert.deepEqual(fails(checks), [], JSON.stringify(check));
    assert.match(checks.find((c) => c.id === "ci").text, /still running/);
  }
  for (const conclusion of ["FAILURE", "CANCELLED", "ERROR", "UNKNOWN", "TIMED_OUT"]) {
    assert.deepEqual(fails(evaluatePreflight(input({ rollup: [...others, { ...ok(name), conclusion }] }))), ["ci"], conclusion);
  }
  // A running check next to a failed one still fails, and a check never reported still fails.
  const red = { ...ok(REQUIRED[1]), conclusion: "FAILURE" };
  assert.deepEqual(fails(evaluatePreflight(input({ rollup: [...ROLLUP.slice(2), { name, status: "IN_PROGRESS" }, red] }))), ["ci"]);
  assert.deepEqual(fails(evaluatePreflight(input({ rollup: others }))), ["ci"]);
});

test("D-161 (b): a failed and a running entry of one check with equal times fail in either order", () => {
  const name = REQUIRED[0];
  const others = ROLLUP.slice(1);
  const failed = { name, status: "COMPLETED", conclusion: "FAILURE", startedAt: "2026-10-24T10:00:00Z" };
  const running = { name, status: "IN_PROGRESS", conclusion: "", startedAt: "2026-10-24T10:00:00Z" };
  for (const pair of [[failed, running], [running, failed]]) {
    assert.deepEqual(fails(evaluatePreflight(input({ rollup: [...others, ...pair] }))), ["ci"]);
  }
  // Positive control: the running entry alone, and a strictly newer rerun, still pass.
  assert.deepEqual(fails(evaluatePreflight(input({ rollup: [...others, running] }))), []);
  assert.deepEqual(fails(evaluatePreflight(input({ rollup: [...others, failed, { ...running, startedAt: "2026-10-24T11:00:00Z" }] }))), []);
});

test("review entry keeps metadata, head, base and main guards", () => {
  for (const [over, id] of [
    [{ pr: { body: BODY.replace("Task: #249 P1-1", "Task:") } }, "task"],
    [{ pr: { baseRefName: "dev" } }, "base"],
    [{ pr: { isDraft: true } }, "draft"],
    [{ expectHead: "c".repeat(40) }, "head"],
    [{ mainSha: null }, "main"],
    [{ compare: null }, "main"],
    [{ compare: { status: "diverged", behind_by: 1 } }, "main"],
  ]) assert.ok(fails(evaluatePreflight(reviewEntry(over))).includes(id), id);
  for (const label of [...CONTRACT_LINES, ...CRITICAL_CONTRACT_LINES]) {
    const body = BODY.split("\n").filter((line) => !line.includes(`**${label}:`)).join("\n");
    assert.ok(!preflightPass(evaluatePreflight(reviewEntry({ pr: { body } }))), label);
  }
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
  assert.equal(contractText("- **Stvarni pozivatelj:**\n> **Poznate granice:** x", "Stvarni pozivatelj"), "");
  assert.equal(contractText("## Poznate granice\n## Dokaz\nx", "Poznate granice"), "");
  // a longer word that only starts with the label is not the label
  assert.equal(contractText("Stvarni pozivatelji: a", "Stvarni pozivatelj"), null);
});

test("code fences and HTML comments never satisfy a line", () => {
  const fenced = "```\nStvarni pozivatelj: a.mjs\n```";
  assert.equal(contractText(fenced, "Stvarni pozivatelj"), null);
  assert.equal(contractText("- **Stvarni pozivatelj:**\n\n```\nlažni.mjs\n```", "Stvarni pozivatelj"), "");
  assert.equal(contractText(["> - **Stvarni pozivatelj:**", ">", "> ```md", "> lažni.mjs", "> ```"].join("\n"), "Stvarni pozivatelj"), "");
  assert.equal(contractText(["> ```md", "> **Stvarni pozivatelj:** lažni.mjs", "> ```"].join("\n"), "Stvarni pozivatelj"), null);
  assert.equal(contractText(["> ```md", "Stvarni pozivatelj: valid.mjs"].join("\n"), "Stvarni pozivatelj"), "valid.mjs");
  assert.equal(contractText(["- ```md", "  Stvarni pozivatelj: lažni.mjs", "  ```"].join("\n"), "Stvarni pozivatelj"), null);
  assert.equal(contractText(["-\t```md", "\tStvarni pozivatelj: lažni.mjs", "\t```"].join("\n"), "Stvarni pozivatelj"), null);
  assert.equal(contractText(["- parent", "  - ```md", "    Stvarni pozivatelj: lažni.mjs", "    ```"].join("\n"), "Stvarni pozivatelj"), null);
  assert.equal(contractText(["- > ```md", "  > **Stvarni pozivatelj:** lažni.mjs", "  > ```"].join("\n"), "Stvarni pozivatelj"), null);
  const continuationFence = ["- item", "  ```md", "  example"];
  assert.equal(contractText([...continuationFence, "Stvarni pozivatelj: valid.mjs"].join("\n"), "Stvarni pozivatelj"), "valid.mjs");
  assert.equal(contractText([...continuationFence, "```", "Stvarni pozivatelj: lažni.mjs"].join("\n"), "Stvarni pozivatelj"), null);
  const quotedContinuationFence = ["> - item", ">   ```md", ">   example"];
  assert.equal(contractText([...quotedContinuationFence, "> **Stvarni pozivatelj:** valid.mjs"].join("\n"), "Stvarni pozivatelj"), "valid.mjs");
  assert.equal(contractText([...quotedContinuationFence, "> ```", "> **Stvarni pozivatelj:** lažni.mjs", "> ```"].join("\n"), "Stvarni pozivatelj"), null);
  const lazyContinuationFence = ["- item", "lazy continuation", "  ```md", "  example"];
  assert.equal(contractText([...lazyContinuationFence, "Stvarni pozivatelj: valid.mjs"].join("\n"), "Stvarni pozivatelj"), "valid.mjs");
  assert.equal(contractText([...lazyContinuationFence, "```", "Stvarni pozivatelj: lažni.mjs"].join("\n"), "Stvarni pozivatelj"), null);
  assert.equal(contractText([...lazyContinuationFence, "  ```", "Stvarni pozivatelj: valid.mjs"].join("\n"), "Stvarni pozivatelj"), "valid.mjs");
  assert.equal(contractText(["- **Stvarni pozivatelj:**", "", "- ```md", "  lažni.mjs", "  ```"].join("\n"), "Stvarni pozivatelj"), "");
  assert.equal(contractText([">     Stvarni pozivatelj: uvučeni-kod.mjs"].join("\n"), "Stvarni pozivatelj"), null);
  assert.equal(contractText("<!-- Stvarni pozivatelj: a.mjs -->", "Stvarni pozivatelj"), null);
  assert.equal(contractText("<!--\nPoznate granice: x\n-->", "Poznate granice"), null);
  assert.equal(contractText("<!--\nPoznate granice: hidden\n-->\nPoznate granice: visible", "Poznate granice"), "visible");
  assert.equal(contractText("<!--\nPoznate granice: hidden", "Poznate granice"), null);
  assert.equal(contractText(["````markdown", "```", "Stvarni pozivatelj: lažni.mjs", "```", "````"].join("\n"), "Stvarni pozivatelj"), null);
  assert.equal(contractText(["~~~md", "```", "Poznate granice: lažno", "~~~", "~~~"].join("\n"), "Poznate granice"), null);
  assert.equal(contractText(["    Stvarni pozivatelj: uvučeni-kod.mjs"].join("\n"), "Stvarni pozivatelj"), null);
  for (const label of CRITICAL_CONTRACT_LINES) {
    const original = `- **${label}:** x`;
    const spoofed = BODY.replace(original, [`- **${label}:**`, "", "> ```", "> lažni-sadržaj", "> ```"].join("\n"));
    assert.ok(fails(evaluatePreflight(input({ pr: { body: spoofed } }))).includes(`critical-contract:${label}`), `${label} must not be satisfied by a quoted fence`);
    const listSpoofed = BODY.replace(original, [`- **${label}:**`, "", "- ```md", "  lažni-sadržaj", "  ```"].join("\n"));
    assert.ok(fails(evaluatePreflight(input({ pr: { body: listSpoofed } }))).includes(`critical-contract:${label}`), `${label} must not be satisfied by a list fence`);
    const nestedSpoofed = BODY.replace(original, [`- **${label}:**`, "", "- > ```md", "  > lažni-sadržaj", "  > ```"].join("\n"));
    assert.ok(fails(evaluatePreflight(input({ pr: { body: nestedSpoofed } }))).includes(`critical-contract:${label}`), `${label} must not be satisfied by a list quote fence`);
  }
});

test("the PR template alone does not pass preflight", () => {
  const template = readFileSync(new URL("../../.github/pull_request_template.md", import.meta.url), "utf8");
  const checks = evaluatePreflight(input({ pr: { body: template } }));
  assert.deepEqual(fails(checks), ["task", ...CONTRACT_LINES.map((l) => `contract:${l}`)]);
});

test("the orchestrator's canonical session-launch instructions invoke the preflight on the pinned head", () => {
  const docs = readFileSync(new URL("../../docs/ORKESTRATOR.md", import.meta.url), "utf8");
  const system = readFileSync(new URL("../../docs/ENGINEERING_SYSTEM.md", import.meta.url), "utf8");
  const skills = [
    readFileSync(new URL("../../.agents/skills/ductus-orchestrator/SKILL.md", import.meta.url), "utf8"),
    readFileSync(new URL("../../.claude/skills/ductus-orchestrator/SKILL.md", import.meta.url), "utf8"),
  ];
  for (const instruction of [docs, system, ...skills]) {
    assert.match(instruction, /orch:preflight <(?:pr|PR)> --head <(?:puni-sha|full-SHA)>/);
    assert.match(instruction, /ne pokreće sesij|never starts a session/i);
  }
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

test("an App-bound required check cannot be satisfied by another App or a legacy status", () => {
  const required = [{ context: REQUIRED[0], appId: 15368 }];
  const wrongApp = [{ ...ok(REQUIRED[0], 42) }];
  const legacy = [{ context: REQUIRED[0], state: "SUCCESS" }];
  assert.deepEqual(fails(evaluatePreflight(input({ required, rollup: wrongApp }))), ["ci"]);
  assert.deepEqual(fails(evaluatePreflight(input({ required, rollup: legacy }))), ["ci"]);
  assert.deepEqual(fails(evaluatePreflight(input({ required, rollup: [ok(REQUIRED[0], 15368)] }))), []);
});

test("required check app identities override the legacy contexts projection", () => {
  assert.deepEqual(requiredStatusChecks({
    contexts: ["bound", "legacy"],
    checks: [{ context: "bound", app_id: 15368 }, { context: "app-unknown", app_id: null }],
  }), [
    { context: "bound", appId: 15368 },
    { context: "app-unknown", appId: null },
    { context: "legacy", appId: null },
  ]);
  assert.equal(requiredStatusChecks(null), null);
});

test("preflight returns exit 2 for a read error, distinct from a failed check", () => {
  const failed = evaluatePreflight(input({ pr: { isDraft: true } }));
  assert.equal(preflightExitCode(failed), 1);
  assert.equal(preflightExitCode(failed, ["main branch"]), 2);
  assert.equal(preflightExitCode(evaluatePreflight(input())), 0);
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

const BEHIND = { status: "diverged", behind_by: 3 };
const riskBody = (risk) => BODY.replace("Risk: critical", risk === null ? "Reviewer: none" : `Risk: ${risk}`);
const lag = (over = {}) => input({ compare: BEHIND, prPaths: ["scripts/a.mjs", "docs/x.md"], mainPaths: ["src/b.ts"], ...over, pr: { body: riskBody("standard"), ...over.pr } });

test("a head behind main passes when no missing main commit touches a file of the PR (#87 6265641655)", () => {
  assert.deepEqual(fails(evaluatePreflight(lag())), []);
  assert.deepEqual(fails(evaluatePreflight(lag({ mainPaths: [] }))), []);
});

test("a head behind main fails when main changed at least one file of the PR", () => {
  const checks = evaluatePreflight(lag({ mainPaths: ["src/b.ts", "docs/x.md"] }));
  assert.deepEqual(fails(checks), ["main"]);
  assert.match(checks.find((c) => c.id === "main").text, /merge main first/);
});

test("a head behind main fails closed when a file list cannot be read", () => {
  assert.deepEqual(fails(evaluatePreflight(lag({ mainPaths: null }))), ["main"]);
  assert.deepEqual(fails(evaluatePreflight(lag({ prPaths: null }))), ["main"]);
  assert.deepEqual(fails(evaluatePreflight(lag({ prPaths: [] }))), ["main"]);
  assert.deepEqual(fails(evaluatePreflight(lag({ mainPaths: undefined, prPaths: undefined }))), ["main"]);
});

test("a head that contains main passes as before, whatever the file lists say", () => {
  assert.deepEqual(fails(evaluatePreflight(input({ mainPaths: ["docs/x.md"], prPaths: ["docs/x.md"] }))), []);
});

test("D-101: every risk, critical and D-97 included, may enter review behind main when main touched none of its files", () => {
  for (const risk of ["critical", "CRITICAL", "high", "low", "standard", null]) {
    assert.deepEqual(fails(evaluatePreflight(lag({ pr: { body: riskBody(risk) }, mainPaths: ["src/b.ts"] }))), [], String(risk));
  }
  for (const path of ["scripts/orchestrator/x.mjs", ".github/workflows/ci.yml", "docs/DECISIONS.md", "SCRIPTS/Hooks/a.mjs", "lefthook.yml"]) {
    for (const risk of ["critical", "standard"]) {
      assert.deepEqual(fails(evaluatePreflight(lag({ pr: { body: riskBody(risk) }, prPaths: ["docs/x.md", path] }))), [], `${risk} ${path}`);
    }
  }
});

test("D-101: the same critical or D-97 PR still fails when main changed one of its files or a list is unread", () => {
  for (const risk of ["critical", "standard"]) {
    const pr = { body: riskBody(risk) };
    const hit = evaluatePreflight(lag({ pr, prPaths: ["docs/DECISIONS.md", "docs/x.md"], mainPaths: ["docs/DECISIONS.md"] }));
    assert.deepEqual(fails(hit), ["main"], risk);
    assert.match(hit.find((c) => c.id === "main").text, /merge main first/);
    assert.deepEqual(fails(evaluatePreflight(lag({ pr, mainPaths: null }))), ["main"], risk);
    assert.deepEqual(fails(evaluatePreflight(lag({ pr, prPaths: null }))), ["main"], risk);
    assert.deepEqual(fails(evaluatePreflight(lag({ pr, prPaths: [] }))), ["main"], risk);
  }
});