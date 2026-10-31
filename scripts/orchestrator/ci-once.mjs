// One read-only look at the CI of a PR head; exits at once, never waits.
// Usage: node scripts/orchestrator/ci-once.mjs <pr-number> [--head <sha>]
//   exit 0 = green, 1 = red (failed check named), 3 = still running,
//   2 = usage or read error, or the head moved (from --head, or during the read)
import { checkRollup, ghJson, prView, repoId } from "./gh.mjs";
import { EXIT, runCiOnce } from "./ci-once-core.mjs";
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

const result = await runCiOnce({
  n,
  expectHead,
  gh: { prView, repoId, ghJson, checkRollup },
  requiredOf: requiredStatusChecks,
});
for (const line of result.out) console.log(line);
for (const line of result.err) console.error(line);
process.exit(result.exit);
