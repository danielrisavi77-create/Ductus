// DAN-130 PR B: invented fixtures only; gh is never called.
import assert from "node:assert/strict";
import test from "node:test";

import {
  demoTaskIds, demoTasksOf, mapLimit, median, parseMetricsArgs, percentile, prMetrics, renderMetrics, summarize,
} from "./metrics-core.mjs";

const SHA = (c) => c.repeat(40);
const body = (risk, task) => `Agent: claude:a:x\nRisk: ${risk}\nTask: ${task}\n`;
const review = (head, verdict, at, agent = "claude:reviewX") => ({
  author_association: "OWNER",
  user: { login: "u" },
  created_at: at,
  body: `Agent-Review: ${agent}\nReview-Head: ${head}\nReview-Verdict: ${verdict}\n`,
});
const qa = (head, verdict, at, agent = "claude:qaX") => ({
  author_association: "OWNER",
  user: { login: "u" },
  created_at: at,
  body: `QA-Agent: ${agent}\nQA-Head: ${head}\nQA-Verdict: ${verdict}\n`,
});
const plan = "| ID | Zadatak |\n| --- | --- |\n| B-5 | uloge |\n| B-7 | model |\n| B-8 | evidencija |\n| P-6 | rječnik |\n| D-3 | proba |\nB-99 nije redak\n";
const merged = (over = {}) => ({
  number: 7, createdAt: "2026-10-01T00:00:00Z", mergedAt: "2026-10-02T12:00:00Z", headRefOid: SHA("b"),
  title: "feat: x", body: body("critical", "DAN-1"), ...over,
});

test("percentile is nearest rank; median is a true median", () => {
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([5], 90), 5);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90), 9);
  assert.equal(median([]), null);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([7]), 7);
});

test("demo task ids come from table rows only", () => {
  assert.deepEqual([...demoTaskIds(plan)].sort(), ["B-5", "B-7", "B-8", "D-3", "P-6"]);
});

test("plan ids are found in Task or title, with letter suffix, not in Linear ids", () => {
  const ids = demoTaskIds(plan);
  assert.deepEqual(demoTasksOf(["DAN-33", "feat: model (B-7, 1/2)"], ids), ["B-7"]);
  assert.deepEqual(demoTasksOf(["B-5a", "feat: x"], ids), ["B-5"]);
  assert.deepEqual(demoTasksOf(["B-8b", undefined], ids), ["B-8"]);
  assert.deepEqual(demoTasksOf(["DAN-5", "feat: forbidden terms check in CI (P-6)"], ids), ["P-6"]);
  assert.deepEqual(demoTasksOf(["B-7 1/2", "B-7 2/2 and P-6"], ids), ["B-7", "P-6"]);
  assert.deepEqual(demoTasksOf(["DAN-110", "fix: retry"], ids), []);
  assert.deepEqual(demoTasksOf(["B-99", "B-99a"], ids), []);
  assert.deepEqual(demoTasksOf([], ids), []);
});

test("prMetrics: a round is one distinct head per kind; gate rules decide its outcome", () => {
  const comments = [
    review(SHA("a"), "PASS", "2026-10-01T10:00:00Z"),
    qa(SHA("a"), "PASS", "2026-10-01T11:00:00Z"),
    qa(SHA("a"), "PASS", "2026-10-01T11:30:00Z"), // repeat on the same head
    qa(SHA("a"), "FAIL", "2026-10-01T11:40:00Z", "claude:qaY"), // other identity, same head: FAIL wins
    qa(SHA("b"), "PASS", "2026-10-02T11:00:00Z"),
    qa(SHA("b"), "PASS", "2026-10-02T11:10:00Z", "claude:qaY"), // two identities passing the same head
    { ...qa(SHA("c"), "FAIL", "2026-10-02T12:00:00Z"), author_association: "NONE" },
  ];
  const m = prMetrics(merged({ title: "feat: model (B-7)" }), comments, demoTaskIds(plan));
  assert.deepEqual(m, {
    number: 7, risk: "critical", task: "DAN-1", demoTasks: ["B-7"], leadHours: 36,
    reviewPass: 1, reviewFail: 0, qaPass: 1, qaFail: 1, qaRounds: 2, heads: 2,
  });
});

test("two verdicts on the same head are one round", () => {
  const comments = [qa(SHA("a"), "PASS", "2026-10-01T11:00:00Z"), qa(SHA("a"), "PASS", "2026-10-01T12:00:00Z")];
  const m = prMetrics(merged({ headRefOid: SHA("a") }), comments, new Set());
  assert.equal(m.qaRounds, 1);
  assert.equal(m.qaPass, 1);
  assert.equal(m.heads, 1);
});

test("a short head is not counted as a head or a round", () => {
  const comments = [qa("aaaaaaa", "PASS", "2026-10-01T11:00:00Z"), qa(SHA("a"), "PASS", "2026-10-01T12:00:00Z")];
  const m = prMetrics(merged({ headRefOid: SHA("a") }), comments, new Set());
  assert.equal(m.heads, 1);
  assert.equal(m.qaRounds, 1);
  assert.equal(prMetrics(merged({ headRefOid: "abc123" }), [], new Set()).heads, 0);
});

test("a PR without verdicts or a parsable date still yields a row", () => {
  const m = prMetrics({ number: 1, createdAt: "bad", mergedAt: "x", headRefOid: SHA("d"), body: "" }, [], new Set());
  assert.equal(m.leadHours, null);
  assert.equal(m.risk, null);
  assert.deepEqual(m.demoTasks, []);
  assert.equal(m.heads, 1);
  assert.equal(m.qaRounds, 0);
});

test("summary: critical median/p90, QA rounds, demo tasks and PRs without a plan id", () => {
  const row = (number, risk, leadHours, qaRounds, demoTasks) => ({ number, risk, leadHours, qaRounds, demoTasks });
  const rows = [
    row(1, "critical", 10, 1, ["B-7"]),
    row(2, "critical", 30, 3, ["B-7"]),
    row(3, "critical", 20, 2, ["P-6"]),
    row(4, "critical", 40, 2, []),
    row(5, "standard", 2, 0, []),
  ];
  const s = summarize(rows);
  assert.equal(s.merged, 5);
  assert.deepEqual(s.critical, { prs: 4, leadMedianH: 25, leadP90H: 40, qaRoundsPerPr: 2, qaRoundsMax: 3 });
  assert.equal(s.all.leadMedianH, 20);
  assert.deepEqual(s.demoTasksMerged, ["B-7", "P-6"]);
  assert.equal(s.prsWithoutDemoId, 2);
  const empty = summarize([]);
  assert.equal(empty.critical.leadMedianH, null);
  assert.equal(empty.critical.qaRoundsPerPr, null);
});

test("render puts the two T2 metrics first", () => {
  const rows = [{ number: 1, risk: "critical", task: "B-7", leadHours: 4, qaRounds: 2, demoTasks: ["B-7"], reviewPass: 1, reviewFail: 0, qaPass: 1, qaFail: 1, heads: 2 }];
  const lines = renderMetrics(rows, summarize(rows), "2026-10-01");
  assert.match(lines[1], /^1\. time from open to merge: median 4 h, p90 4 h/);
  assert.match(lines[2], /^2\. QA rounds per PR .*mean 2, max 2/);
  assert.match(lines.at(-1), /PRs without a recognised plan id: 0/);
  assert.ok(renderMetrics([], summarize([]), "2026-10-01").join("\n").includes("median ? h"));
});

test("mapLimit bounds concurrency and keeps input order", async () => {
  let inFlight = 0;
  let peak = 0;
  const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    return n * 2;
  });
  assert.deepEqual(out, [2, 4, 6, 8, 10, 12, 14]);
  assert.equal(peak, 3);
  assert.deepEqual(await mapLimit([], 5, async (n) => n), []);
});

test("args: --since is required and strict", () => {
  assert.deepEqual(parseMetricsArgs(["--since", "2026-10-01", "--json"]), { since: "2026-10-01", json: true });
  assert.throws(() => parseMetricsArgs([]), /usage/);
  assert.throws(() => parseMetricsArgs(["--since"]), /usage/);
  assert.throws(() => parseMetricsArgs(["--since", "yesterday"]), /usage/);
  assert.throws(() => parseMetricsArgs(["--since", "2026-13-45"]), /usage/);
});
