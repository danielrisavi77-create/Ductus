// Non-force push, then fetch and compare local and remote heads.
// Usage: node push-verify.mjs [remote] [refspec]   (default: origin HEAD)
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { parsePushArgs, pushVerdict } from "./orchestrator-core.mjs";

const run = promisify(execFile);
const git = async (...args) => (await run("git", args, { windowsHide: true })).stdout.trim();

const argv = process.argv.slice(2);
const tryGit = async (...a) => {
  try {
    return await git(...a);
  } catch {
    return null;
  }
};
const currentBranch = await tryGit("symbolic-ref", "--short", "HEAD");
const head = await tryGit("symbolic-ref", "--short", `refs/remotes/${argv[0] ?? "origin"}/HEAD`);
const defaultBranch = head ? head.split("/").slice(1).join("/") : "main";

let remote;
let src;
let dst;
try {
  ({ remote, src, dst } = parsePushArgs(argv, { currentBranch, defaultBranch }));
} catch (e) {
  console.error(`push-verify: ${e.message}`);
  process.exit(2);
}

let pushOk = true;
try {
  await git("push", remote, `${src}:refs/heads/${dst}`);
} catch (e) {
  pushOk = false;
  console.error(`git push failed: ${e.stderr?.trim() || e.message}`);
}

let local = null;
let remoteSha = null;
try {
  await git("fetch", remote);
  local = await git("rev-parse", src);
  remoteSha = await git("rev-parse", `${remote}/${dst}`);
} catch (e) {
  console.error(`verification failed: ${e.stderr?.trim() || e.message}`);
}

const v = pushVerdict(pushOk, local, remoteSha);
console.log(`local  ${local ?? "?"}`);
console.log(`remote ${remoteSha ?? "?"}`);
console.log(v.ok ? `OK: ${v.reason}` : `FAIL: ${v.reason}`);
process.exit(v.ok ? 0 : 1);
