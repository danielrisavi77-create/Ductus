// Overlap map of open PRs (drafts included): which pairs touch the same files,
// or the same collision directory (db/migrations, db/tests). Read-only.
// Usage: node pr-overlap.mjs [--json] [--plan [--contract <file>] [--independent A:B]...]
//   --plan adds advice per PR (plan-core.mjs); the work contract defaults to
//   $DUCTUS_WORK_CONTRACT; --independent records the orchestrator's own check that
//   two writers' PRs share no contract. Exit 1 when some PR's files could not be read.
import { openPrsWithPaths } from "./gh.mjs";
import { overlapPairs, renderOverlap } from "./orchestrator-core.mjs";
import { parseArgs, planParallel, renderPlan } from "./plan-core.mjs";
import { readContract } from "./work-guard.mjs";

try {
  const args = parseArgs(process.argv.slice(2), process.env);
  const prs = await openPrsWithPaths();
  const pairs = overlapPairs(prs);
  // An unreadable contract is passed on as an invalid one: it never counts as "no checks needed".
  const contract = args.plan && args.contract ? await readContract(args.contract).catch(() => ({})) : null;
  const plan = args.plan ? planParallel({ prs, pairs, contract, independent: args.independent }) : null;
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
