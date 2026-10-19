// P1-1: preflight before the orchestrator starts review or QA on one PR.
// Read-only: never merges, edits, comments or re-runs anything.
// Usage: node preflight.mjs <number> [--head <sha>]
//   exit 0 = every check PASS, 1 = at least one FAIL, 2 = usage or read error
import { checkRollup, ghJson, ghList, prPaths as readPrPaths, prView, repoId } from "./gh.mjs";
import { changedPaths } from "../engineering/protected-paths.mjs";
import { evaluatePreflight, preflightExitCode, requiredStatusChecks } from "./preflight-core.mjs";

const args = process.argv.slice(2);
const n = Number(args[0]);
const hi = args.indexOf("--head");
const expectHead = hi === -1 ? null : args[hi + 1];
const known = hi === -1 ? args.length === 1 : args.length === 3 && hi === 1;
if (!Number.isInteger(n) || n <= 0 || !known || (hi !== -1 && !/^[0-9a-f]{40}$/i.test(expectHead ?? ""))) {
  console.error("usage: orch:preflight <pr-number> [--head <40-char sha>]");
  process.exit(2);
}

const COMPARE_FILES_CAP = 300; // GitHub cuts a compare file list at 300 files

const readErrors = [];
const attempt = async (name, fn) => {
  try {
    return await fn();
  } catch {
    readErrors.push(name);
    return null;
  }
};

try {
  const pr = await prView(n);
  const { owner, repo } = await repoId();
  // One read of main for the whole run: the SHA the report compares against and
  // the required status contexts of its branch protection.
  const main = await attempt("main branch", () => ghJson(["api", `repos/${owner}/${repo}/branches/main`]));
  const mainSha = main?.commit?.sha ?? null;
  const rsc = main?.protection?.required_status_checks;
  const required = requiredStatusChecks(rsc);
  const compare = mainSha && pr.headRefOid
    ? await attempt("main comparison", () => ghJson(["api", `repos/${owner}/${repo}/compare/${mainSha}...${pr.headRefOid}`]))
    : null;
  // Only a lagging head needs the file lists; they decide whether main touched this PR's files.
  const behind = Number.isInteger(compare?.behind_by) && compare.behind_by > 0;
  const prPaths = behind ? await attempt("PR file list", () => readPrPaths(n)) : null;
  const mainPaths = behind
    ? await attempt("main file list", async () => {
      const files = await ghList(`repos/${owner}/${repo}/compare/${pr.headRefOid}...${mainSha}?per_page=100`, undefined, { key: "files" });
      if (files.length >= COMPARE_FILES_CAP) throw new Error("compare file list may be cut");
      return changedPaths(files);
    })
    : null;
  const rollup = pr.headRefOid ? await attempt("head checks", () => checkRollup(pr.headRefOid)) : null;
  const checks = evaluatePreflight({ pr, mainSha, compare, rollup, required, expectHead, mainPaths, prPaths });
  console.log(`PR #${n} head ${String(pr.headRefOid ?? "?").slice(0, 8)} main ${String(mainSha ?? "?").slice(0, 8)}`);
  for (const c of checks) console.log(`${c.level.padEnd(4)} ${c.text}`);
  if (readErrors.length) console.error(`PREFLIGHT READ ERROR: retry GitHub reads (${readErrors.join(", ")})`);
  const exitCode = preflightExitCode(checks, readErrors);
  console.log(exitCode === 0 ? "PREFLIGHT PASS: review or QA may start" : "PREFLIGHT FAIL: do not start review or QA");
  process.exit(exitCode);
} catch (e) {
  console.error(`preflight failed: ${e.message}`);
  process.exit(2);
}
