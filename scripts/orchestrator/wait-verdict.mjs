// Wait for a new canonical verdict or new head on the given PRs. Read-only.
// Usage: node wait-verdict.mjs <pr...> [--timeout-min N]
// Exit: 10 new verdict, 11 new head, 12 timeout, 2 usage/baseline error.
import { ghJson, prComments } from "./gh.mjs";
import { compareSnapshots, snapshot } from "./orchestrator-core.mjs";

const POLL_MS = 30_000;
const args = process.argv.slice(2);
let timeoutMin = 10;
const nums = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--timeout-min") timeoutMin = Number(args[++i]);
  else nums.push(Number(args[i]));
}
if (!nums.length || nums.some((x) => !Number.isInteger(x) || x <= 0) ||
  !Number.isFinite(timeoutMin) || timeoutMin <= 0) {
  console.error("usage: wait-verdict <pr...> [--timeout-min N]");
  process.exit(2);
}

async function take(n) {
  const pr = await ghJson(["api", `repos/{owner}/{repo}/pulls/${n}`]);
  const comments = await prComments(n);
  if (!pr.head?.sha) throw new Error("no head in response");
  return snapshot(pr.head.sha, comments);
}

const base = new Map();
for (const n of nums) {
  try {
    base.set(n, await take(n));
  } catch (e) {
    console.error(`baseline for #${n} failed: ${e.message}`);
    process.exit(2);
  }
}
console.log(`watching ${nums.map((n) => `#${n}`).join(" ")} for ${timeoutMin} min`);

const deadline = Date.now() + timeoutMin * 60_000;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, Math.min(POLL_MS, Math.max(0, deadline - Date.now()))));
  let gotVerdict = false;
  let gotHead = false;
  for (const n of nums) {
    let cur = null;
    try {
      cur = await take(n);
    } catch {
      // unavailable or empty response is not a change
    }
    const diff = compareSnapshots(base.get(n), cur);
    if (diff.head || diff.verdict) console.log(`#${n}: ${diff.details.join("; ")}`);
    gotVerdict ||= diff.verdict;
    gotHead ||= diff.head;
  }
  if (gotVerdict) process.exit(10);
  if (gotHead) process.exit(11);
}
console.log("timeout: no change");
process.exit(12);
