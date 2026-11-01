// Which PLAN-DEMO task could be assigned next. Read-only and offline: it reads docs/PLAN-DEMO.md
// only, because the repo holds no machine-readable "done" state (Linear does). The orchestrator
// passes what it knows. Advice only; it assigns and starts nothing.
// Usage: node next.mjs --done B-1,B-2,#240 [--active B-8,F-4] [--json] [--plan-file <path>]
import { readFile } from "node:fs/promises";

import { parseCli, parseList, parsePlanTasks, pickNext, renderNext } from "./brief-core.mjs";

try {
  const { opts, json } = parseCli(process.argv.slice(2), ["--done", "--active", "--plan-file"], ["--json"]);
  if (opts.done === undefined) throw new Error("--done is required (pass '' ... or a list): the repo cannot know what is merged");
  const tasks = parsePlanTasks(await readFile(opts["plan-file"] ?? "docs/PLAN-DEMO.md", "utf8"));
  const res = pickNext({ tasks, done: parseList(opts.done), active: parseList(opts.active) });
  if (json) console.log(JSON.stringify(res, null, 2));
  else for (const line of renderNext(res)) console.log(line);
} catch (e) {
  console.error(`next failed: ${e.message}`);
  process.exit(2);
}
