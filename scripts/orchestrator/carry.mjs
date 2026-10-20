// Does Daniel's merge command carry over a branch refresh? Read-only.
// Usage: node carry.mjs <pr> <old-head-sha>   (exit 0 only on CARRY)
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { carryEnv, carryVerdict, DIFF_ARGS, refreshOnly, remoteIs } from "./carry-core.mjs";
import { prView, readGate } from "./gh.mjs";
import { EXPECTED_REPO } from "./verdict-core.mjs";

const run = promisify(execFile);
// Variables that redirect git or gh are dropped for this process and every child.
const clean = carryEnv(process.env);
for (const key of Object.keys(process.env)) if (!(key in clean)) delete process.env[key];

const git = async (...a) =>
  (await run("git", a, { windowsHide: true, maxBuffer: 256 * 1024 * 1024, env: clean })).stdout;

const n = Number(process.argv[2]);
const oldHead = process.argv[3];
if (!Number.isInteger(n) || n <= 0 || !/^[0-9a-f]{40}$/.test(oldHead ?? "")) {
  console.error("usage: carry <pr-number> <old-head-full-sha>");
  process.exit(2);
}

const diffOf = async (head) => {
  const base = (await git("merge-base", head, "origin/main")).trim();
  return git(...DIFF_ARGS, base, head);
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

try {
  // The GitHub reads must be about the canonical repository, like the local fetch.
  const repo = JSON.parse((await run("gh", ["api", "repos/{owner}/{repo}"], { windowsHide: true, env: clean })).stdout);
  if (String(repo.full_name ?? "").toLowerCase() !== EXPECTED_REPO.toLowerCase()) {
    throw new Error(`this checkout points at ${repo.full_name ?? "?"}, not ${EXPECTED_REPO}`);
  }
  // The fetch must come from the repository gh just confirmed, not from a fork behind origin.
  const origin = (await git("remote", "get-url", "origin")).trim();
  if (!remoteIs(origin, EXPECTED_REPO)) throw new Error(`origin (${origin}) is not ${EXPECTED_REPO}`);
  await git("fetch", "origin", "main", `refs/pull/${n}/head`);
  const pr = await prView(n);
  const newHead = pr.headRefOid;
  // The old head must still be reachable locally; if it is not, nothing can be compared.
  let oldDiff = null;
  let newDiff = null;
  let refreshed = false;
  try { oldDiff = await diffOf(oldHead); } catch { /* unreadable */ }
  try { newDiff = await diffOf(newHead); } catch { /* unreadable */ }
  try {
    const chain = await refreshChain(newHead);
    const flags = new Map(await Promise.all(chain.map(async (s) => [s.parents[1], await isMainAncestor(s.parents[1])])));
    refreshed = refreshOnly({ oldHead, chain, mainContains: (sha) => flags.get(sha) === true });
  } catch { /* not a refresh */ }
  const v = carryVerdict({ oldDiff, newDiff, gate: await readGate(newHead), refreshed });
  console.log(`${v.carry ? "CARRY" : "NO-CARRY"} #${n} ${oldHead.slice(0, 8)} -> ${newHead.slice(0, 8)}: ${v.reason}`);
  process.exit(v.carry ? 0 : 1);
} catch (e) {
  console.error(`NO-CARRY: ${String(e.message ?? e).split("\n")[0]}`);
  process.exit(2);
}
