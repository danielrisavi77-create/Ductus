// DAN-274: PR and issue templates open with three plain-language lines for people; the machine
// metadata moves below them, into <details>. The parsers are not changed, so this table pins that
// every input class they see still reads the same way (ENGINEERING_SYSTEM §6).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { canonicalBlock, field, metadataLines } from "./metadata-parser.mjs";
import { evaluateMetadata } from "./pr-metadata-core.mjs";
import { CONTRACT_LINES, CRITICAL_CONTRACT_LINES, contractText } from "../orchestrator/preflight-core.mjs";
import { OPEN_LABELS } from "../orchestrator/evidence-core.mjs";
import { checkReport, composeVerdict, verifyComposed } from "../orchestrator/verdict-core.mjs";

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");
const PR_TEMPLATE = ".github/pull_request_template.md";
const ISSUE_TEMPLATES = [
  ".github/ISSUE_TEMPLATE/agent-task.md",
  ".github/ISSUE_TEMPLATE/bug-hunter.md",
  ".github/ISSUE_TEMPLATE/product-improvement.md",
];
const HUMAN = ["Što", "Zašto", "Rizik i provjera"];
const SHA = "a".repeat(40);
const GOVERNANCE_LINE = /^(agent|risk|task|agent-review|review-[a-z-]+|qa-[a-z-]+|owner-[a-z-]+|override-[a-z-]+|command-[a-z-]+|provider-[a-z-]+)\s*:/i;

const withoutFrontmatter = (text) => text.replace(/^---\n[\s\S]*?\n---\n/, "");
const contentLines = (text) => withoutFrontmatter(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const htmlComments = (text) => [...text.matchAll(/<!--([\s\S]*?)-->/g)].map((m) => m[1]);

/** The template with every `<placeholder>` filled, as an author would submit it. */
function filledPr() {
  return read(PR_TEMPLATE)
    .replace("<claude|codex|chatgpt>:<slot>:<role>", "claude:wcit:platforma")
    .replace("<low|standard|critical>", "critical")
    .replace("<ID ili kratki identifikator>", "DAN-274")
    .replace(/: <[^>\n]+>/g, ": izmišljen popunjen tekst");
}

// Class 1 and 7: every template opens with the three human lines, in order, right after frontmatter.
for (const rel of [PR_TEMPLATE, ...ISSUE_TEMPLATES]) {
  test(`${rel} opens with the three lines for people`, () => {
    const first = contentLines(read(rel)).slice(0, 3);
    assert.deepEqual(first.map((l) => l.match(/^\*\*([^*]+):\*\*/)?.[1] ?? l), HUMAN);
  });

  test(`${rel}: the human placeholders carry no decision label, slot or SHA`, () => {
    for (const line of contentLines(read(rel)).slice(0, 3)) {
      assert.doesNotMatch(line, /\bD-\d+|\b[0-9a-f]{7,40}\b|claude:|codex:|chatgpt:/, line);
    }
  });

  // Class 5: field() does not skip HTML comments, so a comment line must never look like metadata.
  test(`${rel}: no HTML comment line reads as a governance field`, () => {
    for (const body of htmlComments(read(rel))) {
      for (const line of body.split(/\r?\n/)) assert.doesNotMatch(line.trim(), GOVERNANCE_LINE, line);
    }
  });
}

test("the PR template keeps the machine part inside one <details> below the human lines", () => {
  const lines = contentLines(read(PR_TEMPLATE));
  const open = lines.indexOf("<details>");
  assert.ok(open >= 3, "details opens after the three human lines");
  assert.equal(lines[open + 1], "<summary>Detalji za agente</summary>");
  assert.equal(lines.at(-1), "</details>");
  for (const name of ["Agent", "Risk", "Task"]) {
    assert.ok(lines.findIndex((l) => l.startsWith(`${name}:`)) > open, `${name}: is inside details`);
  }
});

// contractText() reads the next paragraph for an empty label, and `</details>` is a paragraph, so a
// gated line left empty just before it would read as filled. The template keeps gated lines away.
test("no preflight-gated line sits right before </details>", () => {
  const lines = contentLines(read(PR_TEMPLATE));
  const last = lines.at(-2);
  for (const label of [...CRITICAL_CONTRACT_LINES, ...CONTRACT_LINES]) assert.ok(!last.startsWith(label), last);
});

// Class 1: the raw template still parses to its placeholders and fills nothing (see preflight.test).
test("raw PR template: field() finds the placeholders, the contract stays unfilled", () => {
  const t = read(PR_TEMPLATE);
  assert.equal(field(t, "Agent"), "<claude|codex|chatgpt>:<slot>:<role>");
  assert.equal(field(t, "Risk"), "<low|standard|critical>");
  assert.equal(field(t, "Task"), "<ID ili kratki identifikator>");
  assert.equal(evaluateMetadata({ body: t, files: [] }).ok, false);
  for (const label of [...CRITICAL_CONTRACT_LINES, ...CONTRACT_LINES]) assert.match(contractText(t, label) ?? "", /^<.*>$/, label);
});

// Class 2 and 3: a filled template, metadata inside <details>, reads as before.
test("filled PR template: metadata, contract and open lines are read inside <details>", () => {
  const body = filledPr();
  const result = evaluateMetadata({ body, files: [PR_TEMPLATE, "docs/ENGINEERING_SYSTEM.md"] });
  assert.equal(result.ok, true, result.message);
  assert.deepEqual([result.agent, result.risk, result.task], ["claude:wcit:platforma", "critical", "DAN-274"]);
  for (const label of [...CRITICAL_CONTRACT_LINES, ...CONTRACT_LINES]) assert.equal(contractText(body, label), "izmišljen popunjen tekst", label);
  for (const label of OPEN_LABELS.filter((l) => l !== "Neizvedeno")) assert.equal(contractText(body, label), "ništa", label);
});

// Class 4: the human lines neither shadow nor satisfy a machine line.
const SHADOW = [
  { name: "Rizik i provjera does not shadow Risk", body: "**Rizik i provjera:** nizak\n\nRisk: critical", check: (b) => field(b, "Risk") === "critical" },
  { name: "Rizik i provjera is not a Risk value", body: "**Rizik i provjera:** Risk: low", check: (b) => field(b, "Risk") === null },
  { name: "Što does not satisfy the QA contract line", body: "**Što:** Što bi ovaj PR moglo oboriti na QA-i?: ništa", check: (b) => contractText(b, CONTRACT_LINES[2]) === null },
  { name: "Što does not satisfy the QA line from an empty human line", body: "**Što:**\n\nnešto", check: (b) => contractText(b, CONTRACT_LINES[2]) === null },
  { name: "Zašto is not Task", body: "**Zašto:** Task: DAN-1", check: (b) => field(b, "Task") === null },
  { name: "metadata inside details is read", body: "**Što:** x\n\n<details>\n<summary>Detalji za agente</summary>\n\nTask: DAN-274\n</details>", check: (b) => field(b, "Task") === "DAN-274" },
  { name: "metadata in a fence inside details is not read", body: "<details>\n\n```\nTask: DAN-1\n```\n</details>", check: (b) => field(b, "Task") === null },
];
for (const c of SHADOW) test(`human lines: ${c.name}`, () => assert.ok(c.check(c.body)));

// Class 6: a verdict opens with its machine block, then one sentence for people, then the findings.
const VERDICTS = [
  { role: "reviewer", agent: "claude:r1:reviewer", verdict: "PASS", report: "Predlošci su čitljivi, a strojni redci se čitaju kao prije.\n\nBez nalaza." },
  { role: "reviewer", agent: "claude:r1:reviewer", verdict: "FAIL", report: "Promjena skriva grešku u čitanju rizika.\n\n[VAŽNO] a.mjs:1\nDohvatljivo kroz: nije pokazano\n\nUkupno: 0 kritično, 1 važno, 0 manje." },
  { role: "qa", agent: "claude:q1:qa", verdict: "PASS", qaScope: "predlošci", report: "Napad na predloške nije uspio.\n\nBez nalaza." },
];
for (const v of VERDICTS) {
  test(`verdict ${v.role} ${v.verdict}: a human sentence after the machine block keeps the gate shape`, () => {
    assert.equal(checkReport(v.report, { role: v.role, verdict: v.verdict }), null);
    const body = composeVerdict({ ...v, head: SHA });
    assert.equal(verifyComposed(body, { ...v, head: SHA }), null);
    assert.equal(metadataLines(body).find(Boolean), v.role === "qa" ? `QA-Agent: ${v.agent}` : `Agent-Review: ${v.agent}`);
  });
}

test("verdict: the human sentence above the machine block breaks the canonical shape", () => {
  const body = composeVerdict({ ...VERDICTS[0], head: SHA });
  assert.equal(canonicalBlock(`Kratko za ljude.\n\n${body}`, "Agent-Review"), false);
  assert.match(verifyComposed(`Kratko za ljude.\n\n${body}`, { ...VERDICTS[0], head: SHA }), /first line/);
});

test("verdict: a human sentence shaped like a field is refused", () => {
  assert.match(checkReport("Review-Sazetak: čitljivo.\n\nBez nalaza.", { role: "reviewer", verdict: "PASS" }), /governance/);
});
