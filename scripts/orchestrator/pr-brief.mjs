// One short block about a PR for a session that starts review, QA or a fix:
// state, head, risk, lag behind main, CI, gate, review and QA verdicts on the
// current head, the open items of the author's report and the latest bot comments.
// Read-only. It reports; it is not a verdict and does not replace orch:preflight.
// Usage: node pr-brief.mjs <number>
//   exit 0 = printed, 1 = printed but some read failed ("?" lines), 2 = usage or PR read error
import "./help.mjs";
import { checkRollup, ghJson, prComments, prView, readGate, repoId } from "./gh.mjs";
import { buildBrief } from "./brief-core.mjs";

const args = process.argv.slice(2);
const n = Number(args[0]);
if (args.length !== 1 || !Number.isInteger(n) || n <= 0) {
  console.error("usage: orch:brief <pr-number>");
  process.exit(2);
}

try {
  const pr = await prView(n);
  if (!pr.headRefOid) throw new Error("no head in response");
  const { owner, repo } = await repoId();
  const failed = [];
  const attempt = (name, p) => p.catch(() => { failed.push(name); return undefined; });
  const [compare, rollup, gate, comments] = await Promise.all([
    attempt("main comparison", ghJson(["api", `repos/${owner}/${repo}/compare/${pr.baseRefName}...${pr.headRefOid}`])),
    attempt("head checks", checkRollup(pr.headRefOid)),
    readGate(pr.headRefOid),
    attempt("comments", prComments(n)),
  ]);
  if (gate?.error) failed.push("gate");
  for (const line of buildBrief({ pr, repository: `${owner}/${repo}`, compare, rollup, gate, comments })) console.log(line);
  if (failed.length) console.error(`brief note: not read (${failed.join(", ")})`);
  process.exit(failed.length ? 1 : 0);
} catch (e) {
  console.error(`brief failed: ${e.message}`);
  process.exit(2);
}
