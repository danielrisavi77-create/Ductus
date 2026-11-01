// The merge loop after the owner's "Spoji n" for one PR (D-97, D-156).
// Usage: node scripts/orchestrator/merge-loop.mjs <pr> <commanded-head> "<owner's words>" [--rounds N] [--interval S] [--dry-run]
// Writes only two things, each once per head: the Owner-Command comment (when
// merge-ready says WAITS_OWNER) and "@Mergifyio queue" (when it says READY).
// Exit: 0 MERGED, 3 PATCH (patch-id changed), 4 FAIL, 5 TIMEOUT, 6 BLOK, 7 unfilled text, 8 too many heads, 2 usage.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { canonicalBlock, field } from "../engineering/metadata-parser.mjs";
import { ghJson, ghList, withRetry } from "./gh.mjs";
import { commandProblem, EXIT, newMemory, ownerCommandText, step, zagrebDate } from "./merge-loop-core.mjs";
import { readiness, requiredOfMain } from "./merge-ready.mjs";

const SHA_RE = /^[0-9a-f]{40}$/;
const why = (e) => String(e?.stderr || e?.message || e).trim().split("\n")[0];
const git = (args, input) => execFileSync("git", args, { encoding: "utf8", input, maxBuffer: 256 * 1024 * 1024, windowsHide: true });

/** D-156 patch-id of a PR head against main: git diff $(merge-base) head | git patch-id --stable. null when unreadable. */
export function patchId(n, head, run = git) {
  try {
    run(["fetch", "-q", "origin", "main", `+pull/${n}/head:refs/remotes/pr/${n}`]);
    const base = run(["merge-base", head, "origin/main"]).trim();
    const id = run(["patch-id", "--stable"], run(["diff", base, head])).trim().split(/\s+/)[0];
    return SHA_RE.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** An Owner-Command by the owner for this exact head is already on the PR (also from an earlier run). */
export const commandOnHead = (comments, head) =>
  comments.some((c) => c?.author_association === "OWNER" && !c?.performed_via_github_app && canonicalBlock(c.body, "Owner-Command") && field(c.body, "Owner-Command") === "merge" && field(c.body, "Command-Head") === head);

export function parseArgs(argv) {
  const [n, head, quote, ...rest] = argv;
  if (!/^[1-9]\d*$/.test(n ?? "") || !SHA_RE.test(head ?? "") || !quote?.trim()) return null;
  const o = { n: Number(n), head, quote: quote.trim(), rounds: 75, interval: 120, dryRun: false };
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === "--dry-run") o.dryRun = true;
    else if (rest[i] === "--rounds" && /^[1-9]\d*$/.test(rest[i + 1] ?? "")) o.rounds = Number(rest[++i]);
    else if (rest[i] === "--interval" && /^\d+$/.test(rest[i + 1] ?? "")) o.interval = Number(rest[++i]);
    else return null;
  }
  return o;
}

const post = (n, body) => withRetry(() => ghJson(["api", "-X", "POST", `repos/{owner}/{repo}/issues/${n}/comments`, "-f", `body=${body}`]));

async function main(argv) {
  const o = parseArgs(argv);
  if (!o) {
    console.error('usage: node scripts/orchestrator/merge-loop.mjs <pr> <commanded-head (40 hex)> "<owner\'s words>" [--rounds N] [--interval S] [--dry-run]');
    return EXIT.USAGE;
  }
  const commandedPatch = patchId(o.n, o.head);
  if (!commandedPatch) {
    console.log(`#${o.n} FAIL: patch-id of the commanded head ${o.head.slice(0, 8)} could not be computed`);
    return EXIT.FAIL;
  }
  console.log(`#${o.n} commanded ${o.head.slice(0, 8)} patch ${commandedPatch.slice(0, 12)}`);
  const memory = newMemory({ commandedHead: o.head, commandedPatch, maxRounds: o.rounds });
  const required = await requiredOfMain();
  for (;;) {
    const now = new Date().toISOString().slice(11, 16);
    let observation;
    try {
      const { pr, result } = await readiness(o.n, required);
      const comments = await withRetry(() => ghList(`repos/{owner}/{repo}/issues/${o.n}/comments?per_page=100`));
      observation = {
        state: pr.state,
        head: pr.headRefOid,
        patchId: pr.headRefOid === o.head ? commandedPatch : patchId(o.n, pr.headRefOid),
        readiness: result,
        commandOnHead: commandOnHead(comments, pr.headRefOid),
      };
    } catch (e) {
      observation = { state: "OPEN", head: memory.commandedHead, patchId: commandedPatch, readiness: { state: "UNREAD", reason: why(e), checks: [] }, commandOnHead: true };
    }
    const action = step(memory, observation);
    if (action.action === "exit") {
      console.log(`${now} #${o.n} ${action.reason}`);
      return action.code;
    }
    if (action.action === "post-command") {
      const text = ownerCommandText({ number: o.n, head: observation.head, commandedHead: o.head, quote: o.quote, date: zagrebDate() });
      const problem = commandProblem(text, observation.head);
      if (problem) {
        console.log(`${now} #${o.n} BLOK: ${problem}; nothing posted`);
        return EXIT.UNFILLED;
      }
      if (o.dryRun) console.log(`${now} #${o.n} would post:\n${text}`);
      else console.log(`${now} #${o.n} owner-command ${(await post(o.n, text)).html_url}`);
      memory.posted.add(observation.head);
    } else if (action.action === "queue") {
      if (!o.dryRun) await post(o.n, "@Mergifyio queue");
      console.log(`${now} #${o.n} ${o.dryRun ? "would queue" : "queued"} at ${observation.head.slice(0, 8)}`);
      memory.queued.add(observation.head);
    } else console.log(`${now} #${o.n} ${action.reason}`);
    await new Promise((r) => setTimeout(r, o.interval * 1000));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.log(`merge-loop FAIL: ${why(e)}`);
      process.exit(EXIT.FAIL);
    },
  );
}
