// The Owner queue of STATE.md sorted by deadline: overdue, soon, later, no deadline.
// Read-only and offline: it never changes STATE.md and never calls GitHub or Linear.
// It only displays; STATE.md and Linear stay the source of status.
// Usage: node owner-queue.mjs [--today YYYY-MM-DD] [--html <path>] [--state <path>]
//   --html writes one self-contained page (for a phone) instead of printing text
//   exit 0 = printed or written, 2 = usage error, unreadable file or no open items found
import "./help.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { groupByDeadline, parseOwnerQueue, renderHtml, renderText } from "./owner-queue-core.mjs";

const opts = { today: new Date().toISOString().slice(0, 10), state: "STATE.md", html: null };
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) {
  const key = args[i].replace(/^--/, "");
  if (!args[i].startsWith("--") || !(key in opts) || args[i + 1] === undefined) {
    console.error("usage: orch:owner [--today YYYY-MM-DD] [--html <path>] [--state <path>]");
    process.exit(2);
  }
  opts[key] = args[i + 1];
}

try {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.today)) throw new Error(`bad date: ${opts.today}`);
  const items = parseOwnerQueue(readFileSync(opts.state, "utf8"), Number(opts.today.slice(0, 4)));
  if (!items.some((i) => !i.done)) throw new Error(`no open Owner queue items in ${opts.state}`);
  const groups = groupByDeadline(items, opts.today);
  if (opts.html) {
    writeFileSync(opts.html, renderHtml(groups, opts.today));
    console.log(`written: ${opts.html}`);
  } else {
    for (const line of renderText(groups, opts.today)) console.log(line);
  }
} catch (e) {
  console.error(`owner queue failed: ${e.message}`);
  process.exit(2);
}
