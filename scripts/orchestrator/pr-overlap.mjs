// Overlap map of open PRs (drafts included): which pairs touch the same files,
// or the same collision directory (db/migrations, db/tests). Read-only.
// Usage: node pr-overlap.mjs [--repo <owner/name>] [--json] [--plan [--contract <file>] [--independent A:B]...]
//   --repo reads only that tracked repository (tracked-repos.json) instead of the
//   one of the working directory.
//   --plan adds advice per PR (plan-core.mjs); the work contract defaults to
//   $DUCTUS_WORK_CONTRACT; --independent records the orchestrator's own check that
//   two writers' PRs share no contract. Exit 1 when some PR's files could not be read.
import "./help.mjs";
import { openPrsWithPaths, repoArgs, repoId } from "./gh.mjs";
import { overlapPairs, renderOverlap } from "./orchestrator-core.mjs";
import { parseArgs, planParallel, renderPlan } from "./plan-core.mjs";
import { readContract } from "./work-guard.mjs";

const argv = repoArgs(process.argv.slice(2));

try {
  const args = parseArgs(argv, process.env);
  const prs = await openPrsWithPaths();
  const pairs = overlapPairs(prs);
  // An unreadable contract is passed on as an invalid one: it never counts as "no checks needed".
  const contract = args.plan && args.contract ? await readContract(args.contract).catch(() => ({})) : null;
  // F-010: an unread repository judges every head as unread, never as this repository's.
  const repository = args.plan ? await repoId().then(({ owner, repo }) => `${owner}/${repo}`, () => null) : null;
  const plan = args.plan ? planParallel({ prs, pairs, contract, independent: args.independent, repository }) : null;
  if (args.json) {
    console.log(JSON.stringify({
      prs: prs.map((p) => ({
        number: p.number, draft: p.isDraft, base: p.baseRefName, files: p.paths ? p.paths.length : null,
      })),
      pairs,
      ...(plan ? { plan } : {}),
    }, null, 2));
  } else {
    for (const line of renderOverlap(prs, pairs)) console.log(line);
    if (plan) for (const line of ["", ...renderPlan(plan)]) console.log(line);
  }
  process.exitCode = prs.some((p) => !p.paths) ? 1 : 0;
} catch (e) {
  console.error(`pr-overlap failed: ${e.message}`);
  process.exit(2);
}
