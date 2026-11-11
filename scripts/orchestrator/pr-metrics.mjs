// DAN-130 PR B: lead time, verdict counts and demo tasks of merged PRs.
// Read-only. Usage: node pr-metrics.mjs --since YYYY-MM-DD [--json]
// DAN-695: also compares the model a PASS on the merged head declares
// (Review-Model, QA-Model) with the table in docs/ORKESTRATOR.md §7, over the
// PR's changed files. A report, not a gate: a file list that cannot be read
// counts as empty, and the check then expects Opus (rule of doubt).
import "./help.mjs";
import { readFile } from "node:fs/promises";

import { mergedPrs, prComments, prPaths } from "./gh.mjs";
import { demoTaskIds, mapLimit, parseMetricsArgs, prMetrics, renderMetrics, summarize } from "./metrics-core.mjs";

try {
  const { since, json } = parseMetricsArgs(process.argv.slice(2));
  const demoIds = demoTaskIds(await readFile(new URL("../../docs/PLAN-DEMO.md", import.meta.url), "utf8"));
  const prs = await mergedPrs(since);
  const rows = await mapLimit(prs, 5, async (pr) => {
    const [comments, paths] = await Promise.all([prComments(pr.number), prPaths(pr.number).catch(() => [])]);
    return prMetrics(pr, comments, demoIds, paths);
  });
  const summary = summarize(rows);
  if (json) console.log(JSON.stringify({ since, summary, rows }, null, 2));
  else console.log(renderMetrics(rows, summary, since).join("\n"));
} catch (e) {
  console.error(`pr-metrics failed: ${e.message}`);
  process.exit(2);
}
