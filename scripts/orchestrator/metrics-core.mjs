// DAN-130 PR B: pure logic for `pnpm orch:metrics`. No gh/git calls here.
import { field } from "../engineering/metadata-parser.mjs";
import { latestVerdict, parseAgentRisk, parseVerdicts } from "./orchestrator-core.mjs";

const HOUR = 3_600_000;
const COUNTED = new Set(["PASS", "FAIL", "BLOCK"]);
const FULL_SHA = /^[0-9a-f]{40}$/i;

/** Nearest-rank percentile (p in 0..100) of numbers; null for an empty list. */
export function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

/** True median: mean of the two middle values for an even count; null when empty. */
export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Demo task ids ("B-7", "P-6", "D-3") from the table rows of docs/PLAN-DEMO.md. */
export function demoTaskIds(planText) {
  return new Set([...String(planText ?? "").matchAll(/^\|\s*([A-Z]-\d+)\s*\|/gm)].map((m) => m[1]));
}

/**
 * Plan ids named in the PR `Task:` value and title ("B-7, 1/2" -> B-7, "B-5a" ->
 * B-5). Merged PRs often carry a Linear id in Task and the plan id only in the title.
 */
export function demoTasksOf(texts, demoIds) {
  const found = new Set();
  for (const text of texts) {
    for (const m of String(text ?? "").matchAll(/\b([A-Z]-\d+)[a-z]?\b/g)) {
      if (demoIds.has(m[1])) found.add(m[1]);
    }
  }
  return [...found].sort();
}

/**
 * Rounds of one kind: one per distinct full-SHA head, outcome by gate rules
 * (any FAIL/BLOCK wins, else PASS) via latestVerdict. Other heads are ignored.
 */
export function rounds(comments, kind) {
  const heads = new Set(
    parseVerdicts(comments, kind)
      .filter((e) => COUNTED.has(e.verdict) && e.head && FULL_SHA.test(e.head))
      .map((e) => e.head.toLowerCase()),
  );
  const list = [...heads].map((head) => latestVerdict(comments, kind, head)?.verdict);
  return { heads, total: list.length, pass: list.filter((v) => v === "PASS").length };
}

/**
 * Metrics of one merged PR. `heads` is a lower bound: the distinct full-SHA
 * heads that received a verdict plus the merged head (GitHub keeps no list of
 * earlier heads for non-forced pushes).
 */
export function prMetrics(pr, comments, demoIds) {
  const created = Date.parse(pr.createdAt);
  const merged = Date.parse(pr.mergedAt);
  const rev = rounds(comments, "review");
  const qa = rounds(comments, "qa");
  const heads = new Set([...rev.heads, ...qa.heads]);
  if (pr.headRefOid && FULL_SHA.test(pr.headRefOid)) heads.add(pr.headRefOid.toLowerCase());
  const task = field(pr.body, "Task") ?? null;
  return {
    number: pr.number,
    risk: parseAgentRisk(pr.body).risk?.toLowerCase() ?? null,
    task,
    demoTasks: demoTasksOf([task, pr.title], demoIds),
    leadHours: Number.isFinite(created) && Number.isFinite(merged) ? (merged - created) / HOUR : null,
    reviewPass: rev.pass,
    reviewFail: rev.total - rev.pass,
    qaPass: qa.pass,
    qaFail: qa.total - qa.pass,
    qaRounds: qa.total,
    heads: heads.size,
  };
}

const round = (n) => (n === null ? null : Math.round(n * 10) / 10);

export function summarize(rows) {
  const lead = (rs) => rs.map((r) => r.leadHours).filter((h) => h !== null);
  const critical = rows.filter((r) => r.risk === "critical");
  const stats = (rs) => ({
    prs: rs.length,
    leadMedianH: round(median(lead(rs))),
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
    demoTasksMerged: [...new Set(rows.flatMap((r) => r.demoTasks))].sort(),
    prsWithoutDemoId: rows.filter((r) => !r.demoTasks.length).length,
  };
}

export function renderMetrics(rows, summary, since) {
  const f = (v) => (v === null ? "?" : String(v));
  const c = summary.critical;
  const lines = [
    `T2 metrics (critical PRs merged since ${since}, n=${c.prs})`,
    `1. time from open to merge: median ${f(c.leadMedianH)} h, p90 ${f(c.leadP90H)} h (p90 is nearest-rank)`,
    `2. QA rounds per PR (one per distinct head): mean ${f(c.qaRoundsPerPr)}, max ${f(c.qaRoundsMax)}`,
    "",
    `merged PRs since ${since}: ${summary.merged}`,
  ];
  for (const r of rows) {
    lines.push(
      `#${r.number} ${r.risk ?? "-"} | ${r.task ?? "-"} | lead ${f(round(r.leadHours))} h | review ${r.reviewPass} PASS ${r.reviewFail} FAIL | qa ${r.qaPass} PASS ${r.qaFail} FAIL | heads >= ${r.heads}`,
    );
  }
  lines.push(
    `all risks: n=${summary.all.prs} lead median ${f(summary.all.leadMedianH)} h, p90 ${f(summary.all.leadP90H)} h`,
    `demo tasks merged: ${summary.demoTasksMerged.length} (${summary.demoTasksMerged.join(", ") || "-"}); PRs without a recognised plan id: ${summary.prsWithoutDemoId}`,
  );
  return lines;
}

/** Runs `fn` over `items` with at most `limit` in flight; results keep input order. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
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
