// DAN-130 PR B: pure logic for `pnpm orch:metrics`. No gh/git calls here.
import { field } from "../engineering/metadata-parser.mjs";
import { parseAgentRisk, parseVerdicts } from "./orchestrator-core.mjs";

const HOUR = 3_600_000;
const COUNTED = new Set(["PASS", "FAIL", "BLOCK"]);

/** Nearest-rank percentile (p in 0..100) of numbers; null for an empty list. */
export function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

/** Demo task ids ("B-7", "P-6", "D-3") from the table rows of docs/PLAN-DEMO.md. */
export function demoTaskIds(planText) {
  return new Set([...String(planText ?? "").matchAll(/^\|\s*([A-Z]-\d+)\s*\|/gm)].map((m) => m[1]));
}

/** First demo task id in a PR `Task:` value ("B-7 1/2" -> "B-7"); null when none is in the plan. */
export function demoTaskOf(taskValue, demoIds) {
  const m = /\b([A-Z]-\d+)\b/.exec(taskValue ?? "");
  return m && demoIds.has(m[1]) ? m[1] : null;
}

/**
 * Metrics of one merged PR. `heads` is a lower bound: the distinct heads that
 * received a canonical verdict plus the merged head (GitHub keeps no list of
 * earlier heads for non-forced pushes).
 */
export function prMetrics(pr, comments, demoIds) {
  const created = Date.parse(pr.createdAt);
  const merged = Date.parse(pr.mergedAt);
  const reviews = parseVerdicts(comments, "review").filter((e) => COUNTED.has(e.verdict));
  const qas = parseVerdicts(comments, "qa").filter((e) => COUNTED.has(e.verdict));
  const pass = (list) => list.filter((e) => e.verdict === "PASS").length;
  const heads = new Set([...reviews, ...qas].map((e) => e.head?.toLowerCase()).filter(Boolean));
  if (pr.headRefOid) heads.add(pr.headRefOid.toLowerCase());
  const task = field(pr.body, "Task") ?? null;
  return {
    number: pr.number,
    risk: parseAgentRisk(pr.body).risk?.toLowerCase() ?? null,
    task,
    demoTask: demoTaskOf(task, demoIds),
    leadHours: Number.isFinite(created) && Number.isFinite(merged) ? (merged - created) / HOUR : null,
    reviewPass: pass(reviews),
    reviewFail: reviews.length - pass(reviews),
    qaPass: pass(qas),
    qaFail: qas.length - pass(qas),
    qaRounds: qas.length,
    heads: heads.size,
  };
}

const round = (n) => (n === null ? null : Math.round(n * 10) / 10);

export function summarize(rows) {
  const lead = (rs) => rs.map((r) => r.leadHours).filter((h) => h !== null);
  const critical = rows.filter((r) => r.risk === "critical");
  const stats = (rs) => ({
    prs: rs.length,
    leadMedianH: round(percentile(lead(rs), 50)),
    leadP90H: round(percentile(lead(rs), 90)),
  });
  return {
    merged: rows.length,
    all: stats(rows),
    critical: {
      ...stats(critical),
      qaRoundsPerPr: critical.length ? round(critical.reduce((s, r) => s + r.qaRounds, 0) / critical.length) : null,
      qaRoundsMax: critical.length ? Math.max(...critical.map((r) => r.qaRounds)) : null,
    },
    demoTasksMerged: [...new Set(rows.map((r) => r.demoTask).filter(Boolean))].sort(),
  };
}

export function renderMetrics(rows, summary, since) {
  const f = (v) => (v === null ? "?" : String(v));
  const lines = [`merged PRs since ${since}: ${summary.merged}`];
  for (const r of rows) {
    lines.push(
      `#${r.number} ${r.risk ?? "-"} | ${r.task ?? "-"} | lead ${f(round(r.leadHours))} h | review ${r.reviewPass} PASS ${r.reviewFail} FAIL | qa ${r.qaPass} PASS ${r.qaFail} FAIL | heads >= ${r.heads}`,
    );
  }
  const c = summary.critical;
  lines.push(
    `all: n=${summary.all.prs} lead median ${f(summary.all.leadMedianH)} h, p90 ${f(summary.all.leadP90H)} h`,
    `critical: n=${c.prs} lead median ${f(c.leadMedianH)} h, p90 ${f(c.leadP90H)} h; QA rounds per PR ${f(c.qaRoundsPerPr)} (max ${f(c.qaRoundsMax)})`,
    `demo tasks merged: ${summary.demoTasksMerged.length} (${summary.demoTasksMerged.join(", ") || "-"})`,
  );
  return lines;
}

/** `--since YYYY-MM-DD` (required, strict) and `--json`. */
export function parseMetricsArgs(args) {
  const i = args.indexOf("--since");
  const since = i >= 0 ? args[i + 1] : undefined;
  if (!since || !/^\d{4}-\d{2}-\d{2}$/.test(since) || Number.isNaN(Date.parse(since))) {
    throw new Error("usage: orch:metrics --since YYYY-MM-DD [--json]");
  }
  return { since, json: args.includes("--json") };
}
