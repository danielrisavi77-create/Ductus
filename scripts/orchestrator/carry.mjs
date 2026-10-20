// Does Daniel's merge command carry over a branch refresh? Writes only loose git objects
// (merge-tree results) locally and reads GitHub; it never changes a branch or the PR.
// Usage: node carry.mjs <pr> <old-head-sha>   (exit 0 only on CARRY)
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

import { carryEnv, carryVerdict, DIFF_ARGS, gitEnv, patchIdOf, refreshOnly, remoteIs, treesProven } from "./carry-core.mjs";
import { prView, readGate } from "./gh.mjs";
import { EXPECTED_REPO } from "./verdict-core.mjs";

const run = promisify(execFile);
// Variables that redirect git or gh are dropped for this process and every child.
const clean = carryEnv(process.env);
for (const key of Object.keys(process.env)) if (!(key in clean)) delete process.env[key];
const env = gitEnv(process.env);

const git = async (...a) =>
  (await run("git", ["--no-replace-objects", ...a], { windowsHide: true, maxBuffer: 256 * 1024 * 1024, env })).stdout;

const n = Number(process.argv[2]);
const oldHead = process.argv[3];
if (!Number.isInteger(n) || n <= 0 || !/^[0-9a-f]{40}$/.test(oldHead ?? "")) {
  console.error("usage: carry <pr-number> <old-head-full-sha>");
  process.exit(2);
}

// `git patch-id --stable` of the PR diff (merge-base with origin/main to head).
const patchId = async (head) => {
  const base = (await git("merge-base", head, "origin/main")).trim();
  const diff = await git(...DIFF_ARGS, base, head);
  if (diff === "") return null;
  return patchIdOf(execFileSync("git", ["--no-replace-objects", "patch-id", "--stable"], { input: diff, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
};

const isMainAncestor = async (sha) => {
  try {
    await git("merge-base", "--is-ancestor", sha, "origin/main");
    return true;
  } catch {
    return false;
  }
};

// `rev-list --first-parent --parents old..new`, newest first: "<sha> <parent> <parent>".
const refreshChain = async (head) => {
  const out = await git("rev-list", "--first-parent", "--parents", `${oldHead}..${head}`);
  return out.split("\n").filter(Boolean).map((line) => {
    const [sha, ...parents] = line.split(" ");
    return { sha, parents };
  });
};

// The tree of each refresh commit against what git itself merges from its parents.
const treePairs = async (chain) =>
  Promise.all(chain.map(async (step) => {
    const actual = (await git("rev-parse", `${step.sha}^{tree}`)).trim();
    let merged = null;
    try {
      merged = (await git("merge-tree", "--write-tree", "--no-messages", step.parents[0], step.parents[1])).split("\n")[0].trim();
    } catch { /* conflicts or unreadable: not a clean merge */ }
    return { actual, merged };
  }));

try {
  // The GitHub reads must be about the canonical repository, like the local fetch.
  const repo = JSON.parse((await run("gh", ["api", "repos/{owner}/{repo}"], { windowsHide: true, env: clean })).stdout);
  if (String(repo.full_name ?? "").toLowerCase() !== EXPECTED_REPO.toLowerCase()) {
    throw new Error(`this checkout points at ${repo.full_name ?? "?"}, not ${EXPECTED_REPO}`);
  }
  // The fetch must come from the repository gh just confirmed, not from a fork behind origin.
  const origin = (await git("remote", "get-url", "origin")).trim();
  if (!remoteIs(origin, EXPECTED_REPO)) throw new Error(`origin (${origin}) is not ${EXPECTED_REPO}`);
  // Explicit destinations: the result must not depend on the local remote.origin.fetch.
  await git("fetch", "origin", "+refs/heads/main:refs/remotes/origin/main", `+refs/pull/${n}/head:refs/remotes/origin/pr/${n}`);
  const pr = await prView(n);
  const newHead = pr.headRefOid;
  // The old head must still be reachable locally; if it is not, nothing can be compared.
  let oldPatchId = null;
  let newPatchId = null;
  let refreshed = false;
  let proven = false;
  try { oldPatchId = await patchId(oldHead); } catch { /* unreadable */ }
  try { newPatchId = await patchId(newHead); } catch { /* unreadable */ }
  try {
    const chain = await refreshChain(newHead);
    const flags = new Map(await Promise.all(chain.map(async (s) => [s.parents[1], await isMainAncestor(s.parents[1])])));
    refreshed = refreshOnly({ oldHead, chain, mainContains: (sha) => flags.get(sha) === true });
    if (refreshed) proven = treesProven(await treePairs(chain));
  } catch { /* not a refresh */ }
  const v = carryVerdict({ refreshed, treeProven: proven, oldPatchId, newPatchId, gate: await readGate(newHead) });
  console.log(`${v.carry ? "CARRY" : "NO-CARRY"} #${n} ${oldHead.slice(0, 8)} -> ${newHead.slice(0, 8)}: ${v.reason}`);
  process.exit(v.carry ? 0 : 1);
} catch (e) {
  console.error(`NO-CARRY: ${String(e.message ?? e).split("\n")[0]}`);
  process.exit(2);
}
