// Print the Owner-Override comment for each PR's current head, for Daniel to
// post himself. Read-only: an agent never posts an override (self-approval).
// Usage: node override-block.mjs <pr...> --reason "<concrete reason>"
import { ghJson } from "./gh.mjs";
import { overrideBlock, parseOverrideArgs } from "./orchestrator-core.mjs";

let parsed;
try {
  parsed = parseOverrideArgs(process.argv.slice(2));
} catch (e) {
  console.error(e.message);
  process.exit(2);
}

let failed = false;
for (const n of parsed.nums) {
  try {
    const pr = await ghJson(["api", `repos/{owner}/{repo}/pulls/${n}`]);
    if (pr.state !== "open") throw new Error(`PR is ${pr.merged_at ? "merged" : pr.state}`);
    console.log(`# PR #${n} (head ${pr.head.sha.slice(0, 8)}); a new push makes this block stale`);
    console.log(overrideBlock(pr.head.sha, parsed.reason));
  } catch (e) {
    failed = true;
    console.error(`#${n}: ${e.message}`);
  }
}
process.exit(failed ? 1 : 0);
