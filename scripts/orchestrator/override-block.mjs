// Print the Owner-Override comment for each PR's current head, for Daniel to
// post himself. Read-only: an agent never posts an override (self-approval).
// Usage: node override-block.mjs <pr...> --reason "<concrete reason>"
import { ghJson, repoId, toPr } from "./gh.mjs";
import { headOrigin, overrideOutput, parseOverrideArgs } from "./orchestrator-core.mjs";

let parsed;
try {
  parsed = parseOverrideArgs(process.argv.slice(2));
} catch (e) {
  console.error(e.message);
  process.exit(2);
}

// F-010: a failed read is no repository, so headOrigin refuses every head.
const repository = await repoId().then(({ owner, repo }) => `${owner}/${repo}`, () => null);
let failed = false;
for (const n of parsed.nums) {
  try {
    const pr = await ghJson(["api", `repos/{owner}/{repo}/pulls/${n}`]);
    const { stdout, stderr } = overrideOutput(n, pr, parsed.reason, headOrigin(toPr(pr), repository));
    process.stderr.write(stderr);
    process.stdout.write(stdout);
  } catch (e) {
    failed = true;
    console.error(`#${n}: ${e.message}`);
  }
}
process.exit(failed ? 1 : 0);
