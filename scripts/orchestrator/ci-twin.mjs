// DAN-267: CI Digital Twin phase A. Reads recent successful CI runs and prints p50/p95 per job.
// Read-only. Usage: node ci-twin.mjs --since YYYY-MM-DD [--limit N] [--json]
import { ghJson, ghList } from "./gh.mjs";
import { mapLimit } from "./metrics-core.mjs";
import { isOwnRun, parseTwinArgs, renderTwin, runShape, summarizeRuns } from "./ci-twin-core.mjs";

try {
  const { since, json, limit } = parseTwinArgs(process.argv.slice(2));
  const runs = [];
  for (let page = 1; runs.length < limit; page += 1) {
    // per_page tops out at 100 (GitHub), so a larger --limit needs further pages.
    const body = await ghJson([
      "api",
      `repos/{owner}/{repo}/actions/workflows/ci.yml/runs?status=success&event=pull_request&created=>=${since}&per_page=100&page=${page}`,
    ]);
    // F-122: runs from forks are left out; they use the fork's workflow and its job names.
    runs.push(...body.workflow_runs.filter(isOwnRun));
    if (body.workflow_runs.length < 100) break;
  }
  runs.length = Math.min(runs.length, limit);
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
