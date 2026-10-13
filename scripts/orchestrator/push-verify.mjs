// Non-force push, then compare the local head with `git ls-remote` of the destination.
// Usage: node push-verify.mjs [remote] [refspec] [--to <branch>]
// Default destination: the upstream branch of the current branch. Without an
// upstream give `--to <branch>` (first push, or a local branch named differently).
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { parseLsRemote, pushVerdict, resolvePushTarget } from "./orchestrator-core.mjs";
import { guardPush } from "./work-guard.mjs";

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
const remoteArg = argv[0] && argv[0] !== "--to" ? argv[0] : "origin";
const head = await tryGit("symbolic-ref", "--short", `refs/remotes/${remoteArg}/HEAD`);
const defaultBranch = head ? head.split("/").slice(1).join("/") : "main";
const upRemote = currentBranch && await tryGit("config", "--get", `branch.${currentBranch}.remote`);
const upMerge = currentBranch && await tryGit("config", "--get", `branch.${currentBranch}.merge`);
const upstream = upRemote && upMerge?.startsWith("refs/heads/")
  ? { remote: upRemote, branch: upMerge.slice("refs/heads/".length) } : null;

let remote;
let src;
let dst;
try {
  ({ remote, src, dst } = resolvePushTarget(argv, { currentBranch, defaultBranch, upstream }));
} catch (e) {
  console.error(`FAIL: nothing pushed: ${e.message}`);
  process.exit(2);
}

// The existing push path automatically enforces a configured task snapshot.
// No configuration preserves the existing path; incomplete configuration blocks.
const guard = await guardPush({ remote, src, dst, currentBranch });
if (guard) {
  console.log(JSON.stringify(guard));
  if (!guard.ok) process.exit(1);
  // Pin the checked endpoint for BOTH push and verification, not a mutable remote name.
  remote = guard.pushUrl;
}

// Full ref names: a tag or remote-tracking ref of the same name cannot be picked up instead.
const srcRef = src === "HEAD" ? "HEAD" : `refs/heads/${src}`;
const pushSource = guard?.ok ? guard.head : srcRef;
let pushOk = true;
try {
  await git("push", remote, `${pushSource}:refs/heads/${dst}`);
} catch (e) {
  pushOk = false;
  console.error(`git push failed: ${e.stderr?.trim() || e.message}`);
}

// Ask the remote itself. Local remote-tracking refs depend on the fetch refspec
// (single-branch clones have none for a new branch) and on name resolution.
let local = null;
let remoteSha = null;
try {
  local = await git("rev-parse", "--verify", `${pushSource}^{commit}`);
  remoteSha = parseLsRemote(await git("ls-remote", remote, `refs/heads/${dst}`), dst);
} catch (e) {
  console.error(`verification failed: ${e.stderr?.trim() || e.message}`);
}

const v = pushVerdict(pushOk, local, remoteSha);
console.log(`target ${remote} refs/heads/${dst}`);
console.log(`local  ${local ?? "?"}`);
console.log(`remote ${remoteSha ?? "?"}`);
console.log(v.ok ? `OK: ${v.reason}` : `FAIL: ${v.reason}`);
process.exit(v.ok ? 0 : 1);
