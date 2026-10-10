// DAN-130 PR B: invented fixtures only; gh is never called.
import assert from "node:assert/strict";
import test from "node:test";

import {
  demoTaskIds, demoTaskOf, parseMetricsArgs, percentile, prMetrics, renderMetrics, summarize,
} from "./metrics-core.mjs";

const SHA = (c) => c.repeat(40);
const body = (risk, task) => `Agent: claude:a:x\nRisk: ${risk}\nTask: ${task}\n`;
const review = (head, verdict, at) => ({
  author_association: "OWNER",
  user: { login: "u" },
  created_at: at,
  body: `Agent-Review: claude:reviewX\nReview-Head: ${head}\nReview-Verdict: ${verdict}\n`,
});
const qa = (head, verdict, at) => ({
  author_association: "OWNER",
  user: { login: "u" },
  created_at: at,
  body: `QA-Agent: claude:qaX\nQA-Head: ${head}\nQA-Verdict: ${verdict}\n`,
});
const plan = "| ID | Zadatak |\n| --- | --- |\n| B-7 | model |\n| P-6 | rječnik |\n| D-3 | proba |\nB-99 nije redak\n";

test("percentile uses nearest rank and tolerates empty input", () => {
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([5], 90), 5);
  assert.equal(percentile([4, 1, 3, 2], 50), 2);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90), 9);
});

test("demo task ids come from table rows only; the Task value is matched against them", () => {
  const ids = demoTaskIds(plan);
  assert.deepEqual([...ids].sort(), ["B-7", "D-3", "P-6"]);
  assert.equal(demoTaskOf("B-7 1/2", ids), "B-7");
  assert.equal(demoTaskOf("DAN-110", ids), null);
  assert.equal(demoTaskOf("B-99", ids), null);
  assert.equal(demoTaskOf(undefined, ids), null);
});

test("prMetrics counts verdicts, QA rounds and distinct heads, ignoring untrusted comments", () => {
  const ids = demoTaskIds(plan);
  const comments = [
    review(SHA("a"), "PASS", "2026-10-01T10:00:00Z"),
    qa(SHA("a"), "FAIL", "2026-10-01T11:00:00Z"),
    qa(SHA("b"), "PASS", "2026-10-02T11:00:00Z"),
    { ...qa(SHA("c"), "FAIL", "2026-10-02T12:00:00Z"), author_association: "NONE" },
  ];
  const m = prMetrics(
    { number: 7, createdAt: "2026-10-01T00:00:00Z", mergedAt: "2026-10-02T12:00:00Z", headRefOid: SHA("b"), body: body("critical", "B-7") },
    comments,
    ids,
  );
  assert.deepEqual(m, {
    number: 7, risk: "critical", task: "B-7", demoTask: "B-7", leadHours: 36,
    reviewPass: 1, reviewFail: 0, qaPass: 1, qaFail: 1, qaRounds: 2, heads: 2,
  });
});

test("a PR without verdicts or a parsable date still yields a row", () => {
  const m = prMetrics({ number: 1, createdAt: "bad", mergedAt: "x", headRefOid: SHA("d"), body: "" }, [], new Set());
  assert.equal(m.leadHours, null);
  assert.equal(m.risk, null);
  assert.equal(m.heads, 1);
  assert.equal(m.qaRounds, 0);
});

test("summary: critical median/p90, QA rounds per PR, distinct demo tasks", () => {
  const row = (number, risk, leadHours, qaRounds, demoTask) => ({ number, risk, leadHours, qaRounds, demoTask });
  const rows = [
    row(1, "critical", 10, 1, "B-7"),
    row(2, "critical", 30, 3, "B-7"),
    row(3, "critical", 20, 2, "P-6"),
    row(4, "standard", 2, 0, null),
  ];
  const s = summarize(rows);
  assert.equal(s.merged, 4);
  assert.deepEqual(s.critical, { prs: 3, leadMedianH: 20, leadP90H: 30, qaRoundsPerPr: 2, qaRoundsMax: 3 });
  assert.equal(s.all.leadMedianH, 10);
  assert.deepEqual(s.demoTasksMerged, ["B-7", "P-6"]);
  const empty = summarize([]);
  assert.equal(empty.critical.leadMedianH, null);
  assert.equal(empty.critical.qaRoundsPerPr, null);
  assert.ok(renderMetrics([], empty, "2026-10-01").join("\n").includes("demo tasks merged: 0"));
});

test("args: --since is required and strict", () => {
  assert.deepEqual(parseMetricsArgs(["--since", "2026-10-01", "--json"]), { since: "2026-10-01", json: true });
  assert.throws(() => parseMetricsArgs([]), /usage/);
  assert.throws(() => parseMetricsArgs(["--since"]), /usage/);
  assert.throws(() => parseMetricsArgs(["--since", "yesterday"]), /usage/);
  assert.throws(() => parseMetricsArgs(["--since", "2026-13-45"]), /usage/);
});
