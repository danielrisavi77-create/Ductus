// Does Daniel's merge command carry over a branch refresh? Read-only.
// Usage: node carry.mjs <pr> <old-head-sha>   (exit 0 only on CARRY)
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { carryVerdict } from "./carry-core.mjs";
import { prView, readGate } from "./gh.mjs";

const run = promisify(execFile);
const git = async (...a) => (await run("git", a, { windowsHide: true, maxBuffer: 256 * 1024 * 1024 })).stdout;

const n = Number(process.argv[2]);
const oldHead = process.argv[3];
if (!Number.isInteger(n) || n <= 0 || !/^[0-9a-f]{40}$/.test(oldHead ?? "")) {
  console.error("usage: carry <pr-number> <old-head-full-sha>");
  process.exit(2);
}

const diffOf = async (head) => {
  const base = (await git("merge-base", head, "origin/main")).trim();
  return git("diff", "--binary", "--full-index", base, head);
};

try {
  await git("fetch", "origin", "main", `refs/pull/${n}/head`);
  const pr = await prView(n);
  const newHead = pr.headRefOid;
  // The old head must still be reachable locally; if it is not, nothing can be compared.
  let oldDiff = null;
  let newDiff = null;
  try { oldDiff = await diffOf(oldHead); } catch { /* unreadable */ }
  try { newDiff = await diffOf(newHead); } catch { /* unreadable */ }
  const v = carryVerdict({ oldDiff, newDiff, gate: await readGate(newHead) });
  console.log(`${v.carry ? "CARRY" : "NO-CARRY"} #${n} ${oldHead.slice(0, 8)} -> ${newHead.slice(0, 8)}: ${v.reason}`);
  process.exit(v.carry ? 0 : 1);
} catch (e) {
  console.error(`NO-CARRY: ${String(e.message ?? e).split("\n")[0]}`);
  process.exit(2);
}