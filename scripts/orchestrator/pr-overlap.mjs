// Overlap map of open PRs (drafts included): which pairs touch the same files,
// or the same collision directory (db/migrations, db/tests). Read-only.
// Usage: node pr-overlap.mjs [--json]   Exit 1 when some PR's files could not be read.
import { openPrsWithPaths } from "./gh.mjs";
import { overlapPairs, renderOverlap } from "./orchestrator-core.mjs";

try {
  const prs = await openPrsWithPaths("number,isDraft,baseRefName");
  const pairs = overlapPairs(prs);
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({
      prs: prs.map((p) => ({
        number: p.number, draft: p.isDraft, base: p.baseRefName, files: p.paths ? p.paths.length : null,
      })),
      pairs,
    }, null, 2));
  } else {
    for (const line of renderOverlap(prs, pairs)) console.log(line);
  }
  process.exitCode = prs.some((p) => !p.paths) ? 1 : 0;
} catch (e) {
  console.error(`pr-overlap failed: ${e.message}`);
  process.exit(2);
}
