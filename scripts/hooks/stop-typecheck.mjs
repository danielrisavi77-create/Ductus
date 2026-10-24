// DAN-213 (#420): Stop hook. Before a Claude session ends its turn, runs `tsc --noEmit` and
// blocks the stop only when tsc reports errors in .ts/.tsx files this checkout changed
// (tracked changes against HEAD plus untracked files). Errors elsewhere never block.
// Fail-open: no git, no tsc, a timeout, unreadable input or any crash → exit 0, no output.
// No loop: when Claude Code says the stop hook already fired (`stop_hook_active`), it does nothing.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TSC_TIMEOUT_MS = 150_000;
export const MAX_SHOWN = 20;
const TS_FILE = /\.(ts|tsx|mts|cts)$/i;
const norm = (p) => String(p).replaceAll("\\", "/").replace(/^\.\//, "");
// What Win32 makes of a path component: a stream suffix and trailing dots and spaces are dropped, so
// a tracked `node_modules./x` or `node_modules /x` lands in the real node_modules (F-101).
const win32Name = (p) => norm(p).split("/").map((part) => part.replace(/:.*$/su, "").replace(/[. ]+$/u, "")).join("/");

/** `git status --porcelain -z` output → changed or untracked TypeScript paths (deleted ones dropped). */
export function changedTsFiles(porcelainZ) {
  const out = new Set();
  const recs = String(porcelainZ).split("\0");
  for (let i = 0; i < recs.length; i += 1) {
    const rec = recs[i];
    if (rec.length < 4) continue;
    const xy = rec.slice(0, 2);
    const file = norm(rec.slice(3));
    if (xy[0] === "R" || xy[0] === "C") i += 1; // the next record is the old name
    if (xy.includes("D") || !TS_FILE.test(file)) continue;
    out.add(file);
  }
  return out;
}

/** tsc output → errors whose file is in `changed`, as "file(line,col): error TSxxxx: text". */
export function errorsIn(tscOut, changed) {
  const hits = [];
  for (const line of String(tscOut).split(/\r?\n/)) {
    const m = /^(.+?)\(\d+,\d+\): error TS\d+: /.exec(line);
    if (m && changed.has(norm(m[1]))) hits.push(line.trim());
  }
  return hits;
}

/** The hook's answer: undefined (let the session stop) or the block object for stdout. */
export function stopDecision(errors) {
  if (!errors.length) return undefined;
  const shown = errors.slice(0, MAX_SHOWN);
  const more = errors.length > shown.length ? `\n…and ${errors.length - shown.length} more.` : "";
  return {
    decision: "block",
    reason: `TypeScript errors in files you changed (pnpm typecheck):\n${shown.join("\n")}${more}\nFix them before you finish.`,
  };
}

/** input: parsed hook JSON. exec(cmd, args, opts) → {status, stdout}. Returns the decision or undefined. */
export function runStopHook(input, { exec = spawnSync, projectDir = process.env.CLAUDE_PROJECT_DIR } = {}) {
  if (!input || input.stop_hook_active === true) return undefined;
  const cwd = typeof input.cwd === "string" && path.isAbsolute(input.cwd) ? input.cwd : projectDir;
  if (!cwd) return undefined;
  const opts = { cwd, encoding: "utf8", windowsHide: true, maxBuffer: 32 * 1024 * 1024 };
  const top = exec("git", ["rev-parse", "--show-toplevel"], opts);
  if (top.status !== 0) return undefined;
  const root = String(top.stdout).trim();
  const st = exec("git", ["status", "--porcelain", "-z", "--untracked-files=all"], { ...opts, cwd: root });
  if (st.status !== 0) return undefined;
  const changed = changedTsFiles(st.stdout);
  if (!changed.size) return undefined;
  // The checkout may be an untrusted PR head: never run a tsc that the checkout itself tracks.
  // Matched in JS, case-insensitively and with the `u` flag (so U+017F folds to s, SEC-2026-10-18-2): git pathspecs are case-sensitive, a case-insensitive filesystem is not.
  const tracked = exec("git", ["ls-files", "-z"], { ...opts, cwd: root });
  if (tracked.status !== 0 || String(tracked.stdout).split("\0").some((f) => /^node_modules(\/|$)/iu.test(win32Name(f)))) return undefined;
  const tsc = path.join(root, "node_modules", "typescript", "bin", "tsc");
  if (!fs.existsSync(tsc)) return undefined;
  const r = exec(process.execPath, [tsc, "--noEmit", "--pretty", "false"], { ...opts, cwd: root, timeout: TSC_TIMEOUT_MS });
  if (r.error || r.status === null) return undefined; // timeout or spawn failure
  return stopDecision(errorsIn(r.stdout, changed));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const decision = runStopHook(JSON.parse(fs.readFileSync(0, "utf8")));
    if (decision) process.stdout.write(JSON.stringify(decision));
  } catch {
    // fail open
  }
  process.exitCode = 0;
}
