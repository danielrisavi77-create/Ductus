// Merge readiness of open PRs as the gate and GitHub see it. Read-only: never
// merges, comments, edits or re-runs anything. Every read is repeated on a
// GitHub 502/503/504, and a read that still fails is UNREAD, never "fine".
// Usage: node merge-ready.mjs <number>   one PR, every line, exit code by state
//        node merge-ready.mjs --all      every open non-draft PR, one line each
// Exit (one PR): 0 READY, 1 BLOCKED, 2 UNREAD or usage, 3 WAITING, 4 WAITS_OWNER.
// Exit (--all): 0 when every PR was read, 2 when any is UNREAD.
import { pathToFileURL } from "node:url";

import { checkRollup, ghJson, ghList, readOpenPrs, repoId, reviewThreads, toPr, withRetry } from "./gh.mjs";
import { AUTHORIZATION_CONTEXT, EXIT_CODES, evaluateMergeReady, pickStatus } from "./merge-ready-core.mjs";
import { GATE_CONTEXT, summarizeThreads } from "./orchestrator-core.mjs";
import { requiredStatusChecks } from "./preflight-core.mjs";

const why = (e) => String(e?.stderr || e?.message || e).trim().split("\n")[0];
const read = async (fn) => {
  try {
    return await withRetry(fn);
  } catch (e) {
    return { error: why(e) };
  }
};

/** Everything evaluateMergeReady needs for PR n; `required` is read once by the caller. */
export async function readiness(n, required) {
  const raw = await withRetry(() => ghJson(["api", `repos/{owner}/{repo}/pulls/${n}`]));
  const pr = toPr(raw);
  const head = pr.headRefOid;
  const statuses = await read(() => ghList(`repos/{owner}/{repo}/commits/${head}/statuses?per_page=100`));
  const pick = (context) => (statuses.error ? statuses : pickStatus(statuses, context));
  const threads = await read(async () => summarizeThreads(await reviewThreads(n)));
  return {
    pr,
    result: evaluateMergeReady({
      pr,
      mergeState: String(raw.mergeable_state ?? "unknown").toUpperCase(),
      gate: pick(GATE_CONTEXT),
      authorization: pick(AUTHORIZATION_CONTEXT),
      rollup: await read(() => checkRollup(head)),
      required,
      threads,
    }),
  };
}

/** Required checks of main; null (so every PR is UNREAD) when a read still fails after retries. */
export async function requiredOfMain({ repo = repoId, json = ghJson, retry = withRetry } = {}) {
  const tryRead = async (fn) => {
    try {
      return await retry(fn);
    } catch (e) {
      return { error: why(e) };
    }
  };
  const id = await tryRead(() => repo());
  if (id.error) return null;
  const main = await tryRead(() => json(["api", `repos/${id.owner}/${id.repo}/branches/main`]));
  return main.error ? null : requiredStatusChecks(main?.protection?.required_status_checks);
}

const line = (pr, r) => `#${pr.number} ${r.state} ${String(pr.headRefOid).slice(0, 8)} | ${String(pr.title ?? "").slice(0, 60)}\n    ${r.reason}`;

async function main(args) {
  if (args.length !== 1 || !(args[0] === "--all" || /^[1-9]\d*$/.test(args[0]))) {
    console.error("usage: node scripts/orchestrator/merge-ready.mjs <pr-number> | --all");
    return 2;
  }
  const required = await requiredOfMain();
  if (args[0] !== "--all") {
    const { pr, result } = await readiness(Number(args[0]), required);
    console.log(`PR #${pr.number} head ${String(pr.headRefOid).slice(0, 8)}`);
    for (const c of result.checks) console.log(`${c.level.padEnd(6)} ${c.text}`);
    console.log(`MERGE-READY ${result.state}: ${result.reason}`);
    return EXIT_CODES[result.state];
  }
  const all = await readOpenPrs((n) => readiness(n, required));
  let unread = false;
  for (const item of all) {
    if (item.error) {
      unread = true;
      console.log(`#${item.number} UNREAD\n    ${item.error}`);
    } else if (!item.value.pr.isDraft) {
      unread ||= item.value.result.state === "UNREAD";
      console.log(line(item.value.pr, item.value.result));
    }
  }
  return unread ? 2 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(`merge-ready failed: ${why(e)}`);
      process.exit(2);
    },
  );
}
