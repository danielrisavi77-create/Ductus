// Fill the ZADATAK template (docs/SESSIONS.md §3) for one PLAN-DEMO task. Read-only: prints the
// brief, writes nothing, starts no session. Exit 0 = brief printed, 1 = refused (problems on
// stderr), 2 = usage or read error.
// Usage: node brief.mjs <P-1|B-8|F-4|K-2> --task DAN-<n> [--done B-1,#240] [--risk standard|critical]
//   [--plan <issue URL>] [--visual <text|n/a reason>] [--izvan <text>] [--checks <text>] [--slot <s>]
//   [--orchestrator <name>] [--mape <folders>] [--plan-file <path>] [--sessions-file <path>]
import { readFile } from "node:fs/promises";

import { buildBrief, parseCli, parseList, parseOwnership, parsePlanTasks } from "./brief-core.mjs";

const VALUED = ["--task", "--done", "--risk", "--plan", "--visual", "--izvan", "--checks", "--slot", "--orchestrator", "--mape", "--plan-file", "--sessions-file"];

try {
  const { id, opts } = parseCli(process.argv.slice(2), VALUED);
  if (!id) throw new Error("usage: orch:brief <task id> --task DAN-<n> [options]");
  const tasks = parsePlanTasks(await readFile(opts["plan-file"] ?? "docs/PLAN-DEMO.md", "utf8"));
  const ownership = parseOwnership(await readFile(opts["sessions-file"] ?? "docs/SESSIONS.md", "utf8"));
  const { text, problems } = buildBrief({ tasks, ownership, id, opts: { ...opts, done: parseList(opts.done) } });
  if (!text) {
    for (const p of problems) console.error(`REFUSED: ${p}`);
    process.exit(1);
  }
  console.log(text);
  console.error("Advice only: the orchestrator reads the brief, adds what the generator cannot know, and logs the exact text on #87.");
} catch (e) {
  console.error(`brief failed: ${e.message}`);
  process.exit(2);
}
