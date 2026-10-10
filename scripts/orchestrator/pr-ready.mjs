// Merge-readiness checklist for one PR. Read-only: never merges or edits.
// Usage: node pr-ready.mjs <number>   (exit 0 only if all required checks pass)
import { gateStatus, ghJson, repoId, reviewThreads } from "./gh.mjs";
import {
  allRequiredPass, evaluateReady, intersectFiles, parseAgentRisk, summarizeThreads,
} from "./orchestrator-core.mjs";

const n = Number(process.argv[2]);
if (!Number.isInteger(n) || n <= 0) {
  console.error("usage: pr-ready <pr-number>");
  process.exit(2);
}

const attempt = async (fn) => {
  try {
    return await fn();
  } catch {
    return null;
  }
};

try {
  const pr = await ghJson([
    "pr", "view", String(n),
    "--json", "headRefOid,baseRefName,mergeable,isDraft,autoMergeRequest,statusCheckRollup,files,body,state",
  ]);
  if (pr.state !== "OPEN") {
    console.error(`PR #${n} is ${pr.state}`);
    process.exit(2);
  }
  const files = (pr.files ?? []).map((f) => f.path);
  const { owner, repo } = await repoId();
  const compare = await attempt(() =>
    ghJson(["api", `repos/${owner}/${repo}/compare/${pr.headRefOid}...main`]));
  // compare head...main lists what main changed since the merge base; 300-file cap means unknown.
  const mainFiles = compare && Array.isArray(compare.files) && compare.files.length < 300
    ? compare.files.map((f) => f.filename) : null;
  const threadNodes = await attempt(() => reviewThreads(n));
  const checks = evaluateReady({
    head: pr.headRefOid,
    gate: await attempt(() => gateStatus(pr.headRefOid)),
    rollup: pr.statusCheckRollup,
    base: pr.baseRefName,
    mergeable: pr.mergeable,
    overlap: mainFiles ? intersectFiles(mainFiles, files) : null,
    threads: threadNodes ? summarizeThreads(threadNodes) : null,
    autoMerge: Boolean(pr.autoMergeRequest),
    files,
    agent: parseAgentRisk(pr.body).agent,
    draft: pr.isDraft,
  });
  console.log(`PR #${n} head ${pr.headRefOid.slice(0, 8)}`);
  for (const c of checks) console.log(`${c.level.padEnd(4)} ${c.text}`);
  const ok = allRequiredPass(checks);
  console.log(ok ? "READY: all required checks pass" : "NOT READY");
  process.exit(ok ? 0 : 1);
} catch (e) {
  console.error(`pr-ready failed: ${e.message}`);
  process.exit(2);
}
