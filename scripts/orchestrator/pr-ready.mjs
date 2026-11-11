// Merge-readiness checklist for one PR. Read-only: never merges or edits.
// Usage: node pr-ready.mjs <number>   (exit 0 only if all required checks pass)
import "./help.mjs";
import { pathToFileURL } from "node:url";

import { checkRollup, ghJson, prPaths, prView, readGate, repoId, reviewThreads } from "./gh.mjs";
import {
  allRequiredPass, evaluateReady, intersectFiles, parseAgentRisk, summarizeThreads,
} from "./orchestrator-core.mjs";

const attempt = async (fn) => {
  try {
    return await fn();
  } catch {
    return null;
  }
};

/**
 * The checklist over the reads of one PR; pure, so a test can feed it any shape.
 * `pr` is prView() (toPr shape), `id` is repoId(), `compare` the head...main compare.
 */
export function readyChecks({ pr, id, gate, rollup, files, compare, threadNodes }) {
  // compare head...main lists what main changed since the merge base; 300-file cap means unknown.
  const mainFiles = compare && Array.isArray(compare.files) && compare.files.length < 300
    ? compare.files.map((f) => f.filename) : null;
  return evaluateReady({
    head: pr.headRefOid,
    pr,
    repository: `${id.owner}/${id.repo}`,
    ownerLogin: id.owner,
    gate,
    rollup,
    base: pr.baseRefName,
    mergeable: pr.mergeable,
    overlap: mainFiles && files ? intersectFiles(mainFiles, files) : null,
    threads: threadNodes ? summarizeThreads(threadNodes) : null,
    autoMerge: Boolean(pr.autoMergeRequest),
    files,
    agent: parseAgentRisk(pr.body).agent,
    draft: pr.isDraft,
  });
}

async function main(n) {
  const pr = await prView(n);
  if (pr.state !== "OPEN") {
    console.error(`PR #${n} is ${pr.state}`);
    return 2;
  }
  // REST list: a rename counts under both names, and a cut list is an error.
  const files = await attempt(() => prPaths(n));
  const rollup = await checkRollup(pr.headRefOid);
  const id = await repoId();
  const compare = await attempt(() =>
    ghJson(["api", `repos/${id.owner}/${id.repo}/compare/${pr.headRefOid}...main`]));
  const threadNodes = await attempt(() => reviewThreads(n));
  const checks = readyChecks({ pr, id, gate: await readGate(pr.headRefOid), rollup, files, compare, threadNodes });
  console.log(`PR #${n} head ${String(pr.headRefOid).slice(0, 8)}`);
  for (const c of checks) console.log(`${c.level.padEnd(4)} ${c.text}`);
  const ok = allRequiredPass(checks);
  console.log(ok ? "READY: all required checks pass" : "NOT READY");
  return ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const n = Number(process.argv[2]);
  if (!Number.isInteger(n) || n <= 0) {
    console.error("usage: pr-ready <pr-number>");
    process.exit(2);
  }
  main(n).then(
    (code) => process.exit(code),
    (e) => {
      console.error(`pr-ready failed: ${e.message}`);
      process.exit(2);
    },
  );
}
