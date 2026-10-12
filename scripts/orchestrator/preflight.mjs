// P1-1: preflight before the orchestrator starts review or QA on one PR.
// Read-only: never merges, edits, comments or re-runs anything.
// Usage: node preflight.mjs <number> [--head <sha>]
//   exit 0 = every check PASS, 1 = at least one FAIL, 2 = usage or read error
import { checkRollup, ghJson, prView, repoId } from "./gh.mjs";
import { evaluatePreflight, preflightPass } from "./preflight-core.mjs";

const args = process.argv.slice(2);
const n = Number(args[0]);
const hi = args.indexOf("--head");
const expectHead = hi === -1 ? null : args[hi + 1];
const known = hi === -1 ? args.length === 1 : args.length === 3 && hi === 1;
if (!Number.isInteger(n) || n <= 0 || !known || (hi !== -1 && !/^[0-9a-f]{40}$/i.test(expectHead ?? ""))) {
  console.error("usage: orch:preflight <pr-number> [--head <40-char sha>]");
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
  const pr = await prView(n);
  const { owner, repo } = await repoId();
  // One main SHA for the whole run, so the report names what it compared against.
  const main = await attempt(() => ghJson(["api", `repos/${owner}/${repo}/commits/main`]));
  const mainSha = main?.sha ?? null;
  const compare = mainSha && pr.headRefOid
    ? await attempt(() => ghJson(["api", `repos/${owner}/${repo}/compare/${mainSha}...${pr.headRefOid}`]))
    : null;
  const rollup = pr.headRefOid ? await attempt(() => checkRollup(pr.headRefOid)) : null;
  const checks = evaluatePreflight({ pr, mainSha, compare, rollup, expectHead });
  console.log(`PR #${n} head ${String(pr.headRefOid ?? "?").slice(0, 8)} main ${String(mainSha ?? "?").slice(0, 8)}`);
  for (const c of checks) console.log(`${c.level.padEnd(4)} ${c.text}`);
  const ok = preflightPass(checks);
  console.log(ok ? "PREFLIGHT PASS: review or QA may start" : "PREFLIGHT FAIL: do not start review or QA");
  process.exit(ok ? 0 : 1);
} catch (e) {
  console.error(`preflight failed: ${e.message}`);
  process.exit(2);
}
