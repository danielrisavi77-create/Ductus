// Merge readiness of open PRs as the gate and GitHub see it. Read-only: never
// merges, comments, edits or re-runs anything. Every read is repeated on a
// GitHub 502/503/504, and a read that still fails is UNREAD, never "fine".
// Usage: node merge-ready.mjs <number>   one PR, every line, exit code by state
//        node merge-ready.mjs --all      every open non-draft PR, one line each
//   either with [--repo <owner/name>]: only that tracked repository (tracked-repos.json)
// Exit (one PR): 0 READY, 1 BLOCKED, 2 UNREAD or usage, 3 WAITING, 4 WAITS_OWNER.
// Exit (--all): 0 when every PR was read, 2 when any is UNREAD.
import { pathToFileURL } from "node:url";

import { checkRollup, ghJson, ghList, readOpenPrs, repoArgs, repoId, reviewThreads, toPr, withRetry } from "./gh.mjs";
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

/** evaluateMergeReady over the reads of one PR; pure, so a test can feed it any REST shape. */
export function readinessOf({ raw, statuses, rollup, threads, required, repository }) {
  const pr = toPr(raw);
  const pick = (context) => (statuses?.error ? statuses : pickStatus(statuses, context));
  return {
    pr,
    result: evaluateMergeReady({
      pr,
      mergeState: String(raw?.mergeable_state ?? "unknown").toUpperCase(),
      gate: pick(GATE_CONTEXT),
      authorization: pick(AUTHORIZATION_CONTEXT),
      rollup,
      required,
      threads,
      repository,
    }),
  };
}

/** Everything evaluateMergeReady needs for PR n; `required` and `repository` are read once by the caller. */
export async function readiness(n, required, repository = null) {
  const raw = await withRetry(() => ghJson(["api", `repos/{owner}/{repo}/pulls/${n}`]));
  const head = raw?.head?.sha;
  const statuses = await read(() => ghList(`repos/{owner}/{repo}/commits/${head}/statuses?per_page=100`));
  const threads = await read(async () => summarizeThreads(await reviewThreads(n)));
  const rollup = await read(() => checkRollup(head));
  return readinessOf({ raw, statuses, rollup, threads, required, repository });
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

const line = (number, pr, r) => `#${number} ${r.state} ${String(pr.headRefOid).slice(0, 8)} | ${String(pr.title ?? "").slice(0, 60)}\n    ${r.reason}`;

/** --all output of readOpenPrs items: {lines, unread}. The number is the listed one (C3, O6). */
export function allLines(items) {
  const lines = [];
  let unread = false;
  for (const item of items) {
    if (item.error) {
      unread = true;
      lines.push(`#${item.number} UNREAD\n    ${item.error}`);
    } else if (!item.value.pr.isDraft) {
      unread ||= item.value.result.state === "UNREAD";
      lines.push(line(item.number, item.value.pr, item.value.result));
    }
  }
  return { lines, unread };
}

async function main(args) {
  if (args.length !== 1 || !(args[0] === "--all" || /^[1-9]\d*$/.test(args[0]))) {
    console.error("usage: node scripts/orchestrator/merge-ready.mjs <pr-number> | --all [--repo <owner/name>]");
    return 2;
  }
  const required = await requiredOfMain();
  // F-010: this repository's name, against which the base is checked; null (UNREAD) when unread.
  const id = await read(() => repoId());
  const repository = id.error ? null : `${id.owner}/${id.repo}`;
  if (args[0] !== "--all") {
    const n = Number(args[0]);
    const { pr, result } = await readiness(n, required, repository);
    console.log(`PR #${n} head ${String(pr.headRefOid).slice(0, 8)}`);
    for (const c of result.checks) console.log(`${c.level.padEnd(6)} ${c.text}`);
    console.log(`MERGE-READY ${result.state}: ${result.reason}`);
    return EXIT_CODES[result.state];
  }
  const { lines, unread } = allLines(await readOpenPrs((n) => readiness(n, required, repository)));
  for (const l of lines) console.log(l);
  return unread ? 2 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(repoArgs(process.argv.slice(2))).then(
    (code) => process.exit(code),
    (e) => {
      console.error(`merge-ready failed: ${why(e)}`);
      process.exit(2);
    },
  );
}
