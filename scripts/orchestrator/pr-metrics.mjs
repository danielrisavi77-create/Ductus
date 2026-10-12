// DAN-130 PR B: lead time, verdict counts and demo tasks of merged PRs.
// Read-only. Usage: node pr-metrics.mjs --since YYYY-MM-DD [--json]
import { readFile } from "node:fs/promises";

import { mergedPrs, prComments } from "./gh.mjs";
import { demoTaskIds, mapLimit, parseMetricsArgs, prMetrics, renderMetrics, summarize } from "./metrics-core.mjs";

try {
  const { since, json } = parseMetricsArgs(process.argv.slice(2));
  const demoIds = demoTaskIds(await readFile(new URL("../../docs/PLAN-DEMO.md", import.meta.url), "utf8"));
  const prs = await mergedPrs(since);
  const rows = await mapLimit(prs, 5, async (pr) => prMetrics(pr, await prComments(pr.number), demoIds));
  const summary = summarize(rows);
  if (json) console.log(JSON.stringify({ since, summary, rows }, null, 2));
  else console.log(renderMetrics(rows, summary, since).join("\n"));
} catch (e) {
  console.error(`pr-metrics failed: ${e.message}`);
  process.exit(2);
}
