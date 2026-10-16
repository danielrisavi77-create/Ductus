// Print the Owner-Override comment for each PR's current head, for Daniel to
// post himself. Read-only: an agent never posts an override (self-approval).
// Usage: node override-block.mjs <pr...> --reason "<concrete reason>"
import { ghJson } from "./gh.mjs";
import { overrideOutput, parseOverrideArgs } from "./orchestrator-core.mjs";

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
    const { stdout, stderr } = overrideOutput(n, pr, parsed.reason);
    process.stderr.write(stderr);
    process.stdout.write(stdout);
  } catch (e) {
    failed = true;
    console.error(`#${n}: ${e.message}`);
  }
}
process.exit(failed ? 1 : 0);
