// Non-force push, then fetch and compare local and remote heads.
// Usage: node push-verify.mjs [remote] [refspec]   (default: origin HEAD)
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { parsePushArgs, pushVerdict } from "./orchestrator-core.mjs";

const run = promisify(execFile);
const git = async (...args) => (await run("git", args, { windowsHide: true })).stdout.trim();

let remote;
let refspec;
try {
  ({ remote, refspec } = parsePushArgs(process.argv.slice(2)));
} catch (e) {
  console.error(`push-verify: ${e.message}`);
  process.exit(2);
}

let pushOk = true;
try {
  await git("push", remote, refspec);
} catch (e) {
  pushOk = false;
  console.error(`git push failed: ${e.stderr?.trim() || e.message}`);
}

let local = null;
let remoteSha = null;
try {
  const branch = refspec === "HEAD"
    ? await git("symbolic-ref", "--short", "HEAD")
    : refspec.split(":").pop().replace(/^refs\/heads\//, "");
  const src = refspec.includes(":") ? refspec.split(":")[0] : refspec;
  await git("fetch", remote);
  local = await git("rev-parse", src || "HEAD");
  remoteSha = await git("rev-parse", `${remote}/${branch}`);
} catch (e) {
  console.error(`verification failed: ${e.stderr?.trim() || e.message}`);
}

const v = pushVerdict(pushOk, local, remoteSha);
console.log(`local  ${local ?? "?"}`);
console.log(`remote ${remoteSha ?? "?"}`);
console.log(v.ok ? `OK: ${v.reason}` : `FAIL: ${v.reason}`);
process.exit(v.ok ? 0 : 1);
