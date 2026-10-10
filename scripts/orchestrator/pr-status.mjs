// Table of all open PRs. Read-only. Usage: node pr-status.mjs [--json]
import { openPrsWithPaths, prComments, readGate } from "./gh.mjs";
import {
  formatOverlaps, formatVerdict, latestVerdict, overlapPairs, overlapsOf, parseAgentRisk,
} from "./orchestrator-core.mjs";

const json = process.argv.includes("--json");

async function row(pr) {
  const [gate, comments] = await Promise.all([
    readGate(pr.headRefOid).then((g) => (g?.error ? undefined : g)),
    prComments(pr.number).catch(() => undefined),
  ]);
  const { agent, risk } = parseAgentRisk(pr.body);
  const review = comments ? latestVerdict(comments, "review", pr.headRefOid) : undefined;
  const qa = comments ? latestVerdict(comments, "qa", pr.headRefOid) : undefined;
  return {
    number: pr.number,
    head: pr.headRefOid.slice(0, 8),
    base: pr.baseRefName,
    draft: pr.isDraft,
    agent,
    risk,
    gate: gate === undefined ? "?" : gate ? `${gate.state}: ${(gate.description ?? "").slice(0, 60)}` : "none",
    review: comments ? formatVerdict(review) : "?",
    qa: comments ? formatVerdict(qa) : "?",
  };
}

try {
  const prs = await openPrsWithPaths("number,headRefOid,baseRefName,isDraft,body");
  const pairs = overlapPairs(prs);
  const rows = (await Promise.all(prs.map(row))).map((r) => ({ ...r, overlaps: overlapsOf(r.number, prs, pairs) }));
  if (json) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    for (const r of rows) {
      console.log(
        `#${r.number} ${r.head} ${r.base}${r.draft ? " DRAFT" : ""} | ${r.agent ?? "-"} | ${r.risk ?? "-"} | gate ${r.gate} | review ${r.review} | qa ${r.qa} | preklapa: ${formatOverlaps(r.overlaps)}`,
      );
    }
    if (!rows.length) console.log("no open PRs");
  }
} catch (e) {
  console.error(`pr-status failed: ${e.message}`);
  process.exit(2);
}
