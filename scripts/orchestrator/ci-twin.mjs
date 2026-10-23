// DAN-267: CI Digital Twin phase A. Reads recent successful CI runs and prints p50/p95 per job.
// Read-only. Usage: node ci-twin.mjs --since YYYY-MM-DD [--limit N] [--json]
import { ghJson, ghList } from "./gh.mjs";
import { mapLimit } from "./metrics-core.mjs";
import { parseTwinArgs, renderTwin, runShape, summarizeRuns } from "./ci-twin-core.mjs";

try {
  const { since, json, limit } = parseTwinArgs(process.argv.slice(2));
  const runs = (await ghJson([
    "api",
    `repos/{owner}/{repo}/actions/workflows/ci.yml/runs?status=success&event=pull_request&created=>=${since}&per_page=${limit}`,
  ])).workflow_runs.slice(0, limit);
  const shapes = (
    await mapLimit(runs, 5, async (run) =>
      runShape(run, await ghList(`repos/{owner}/{repo}/actions/runs/${run.id}/jobs?per_page=100&filter=latest`, undefined, { key: "jobs" })))
  ).filter(Boolean);
  const summary = summarizeRuns(shapes);
  if (json) console.log(JSON.stringify({ since, summary, shapes }, null, 2));
  else console.log(renderTwin(summary, since).join("\n"));
} catch (e) {
  console.error(`ci-twin failed: ${e.message}`);
  process.exit(2);
}
