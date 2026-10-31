// One read-only look at the CI of a PR head; exits at once, never waits.
// Usage: node scripts/orchestrator/ci-once.mjs <pr-number> [--head <sha>]
//   exit 0 = green, 1 = red (failed check named), 3 = still running,
//   2 = usage or read error, or the head moved away from --head
import { checkRollup, ghJson, prView, repoId } from "./gh.mjs";
import { ciOnce, ciOnceLines, EXIT } from "./ci-once-core.mjs";
import { requiredStatusChecks } from "./preflight-core.mjs";

const args = process.argv.slice(2);
const n = Number(args[0]);
const hi = args.indexOf("--head");
const expectHead = hi === -1 ? null : args[hi + 1];
const known = hi === -1 ? args.length === 1 : args.length === 3 && hi === 1;
if (!Number.isInteger(n) || n <= 0 || !known || (hi !== -1 && !/^[0-9a-f]{40}$/i.test(expectHead ?? ""))) {
  console.error("usage: ci-once.mjs <pr-number> [--head <40-char sha>]");
  process.exit(EXIT.error);
}

try {
  const pr = await prView(n);
  const head = pr.headRefOid;
  if (!head) throw new Error(`head of #${n} could not be read`);
  if (expectHead && head.toLowerCase() !== expectHead.toLowerCase()) {
    console.error(`CI HEAD MOVED #${n}: expected ${expectHead.slice(0, 8)}, PR is at ${head.slice(0, 8)}`);
    process.exit(EXIT.error);
  }
  const { owner, repo } = await repoId();
  const main = await ghJson(["api", `repos/${owner}/${repo}/branches/main`]);
  const result = ciOnce({ rollup: await checkRollup(head), required: requiredStatusChecks(main?.protection?.required_status_checks) });
  for (const line of ciOnceLines(n, head, result)) console.log(line);
  process.exit(EXIT[result.verdict]);
} catch (e) {
  console.error(`CI READ ERROR #${args[0]}: ${e.message}`);
  process.exit(EXIT.error);
}
