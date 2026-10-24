// DAN-130 PR B: lead time, verdict counts and demo tasks of merged PRs.
// Read-only. --since YYYY-MM-DD OR --playwright-report <results.json>, plus --json.
import { readFile } from "node:fs/promises";

import { mergedPrs, prComments } from "./gh.mjs";
import { demoTaskIds, mapLimit, parseMetricsArgs, prMetrics, renderMetrics, summarize } from "./metrics-core.mjs";
import { playwrightMetrics, renderPlaywrightMetrics } from "./playwright-metrics.mjs";

try {
  const { since, json, playwrightReport } = parseMetricsArgs(process.argv.slice(2));
  if (playwrightReport) {
    const metrics = playwrightMetrics(JSON.parse(await readFile(playwrightReport, "utf8")));
    console.log(json ? JSON.stringify(metrics, null, 2) : renderPlaywrightMetrics(metrics).join("\n"));
  } else {
    const demoIds = demoTaskIds(await readFile(new URL("../../docs/PLAN-DEMO.md", import.meta.url), "utf8"));
    const prs = await mergedPrs(since);
    const rows = await mapLimit(prs, 5, async (pr) => prMetrics(pr, await prComments(pr.number), demoIds));
    const summary = summarize(rows);
    if (json) console.log(JSON.stringify({ since, summary, rows }, null, 2));
    else console.log(renderMetrics(rows, summary, since).join("\n"));
  }
} catch (e) {
  console.error(`pr-metrics failed: ${e.message}`);
  process.exit(2);
}
