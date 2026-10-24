// DAN-269: Shadow Integration Lab, first cut. Pure logic around an injectable `git`.
// Merges the heads of two open PRs into a throw-away detached worktree made from main and
// says whether they merge cleanly together. It never touches a branch, never pushes and never
// replaces CI or QA on the real head of either PR.
//   git(args, cwd) -> { status: number, stdout: string, stderr: string }
import { join } from "node:path";

const IDENTITY = ["-c", "user.name=shadow-lab", "-c", "user.email=shadow-lab@invalid", "-c", "commit.gpgsign=false"];
const SHA_RE = /^[0-9a-f]{40}$/i;
const PATH_RE = /^[\w@+%=,. \-/[\]()]{1,300}$/;
const CHECKS = new Set(["typecheck"]);

/** `<prA> <prB> [--check typecheck] [--json]`; two different PR numbers. */
export function parseShadowArgs(args) {
  const prs = [];
  const checks = [];
  let json = false;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--json") json = true;
    else if (a === "--check" && CHECKS.has(args[i + 1] ?? "")) checks.push(args[++i]);
    else if (/^[1-9]\d{0,8}$/.test(a)) prs.push(Number(a));
    else throw new Error(`unknown or invalid argument: ${a}`);
  }
  if (prs.length !== 2 || prs[0] === prs[1]) throw new Error("usage: orch:shadow <prA> <prB> [--check typecheck] [--json]");
  return { prs, checks: [...new Set(checks)], json };
}

const shownPath = (p) => (PATH_RE.test(p) ? p : "<not printed>");

function unmerged(git, dir) {
  const r = git(["diff", "--name-only", "--diff-filter=U"], dir);
  return r.status === 0 ? r.stdout.split("\n").map((l) => l.trim()).filter(Boolean).map(shownPath) : [];
}

/**
 * Merge `heads` ([{ pr, sha }], in order) into a detached worktree at `base` under `dir`.
 * Every step is { pr, outcome: "clean" | "conflict" | "error", files? }. After the first
 * conflict or error the remaining heads are not tried, since the combination is already shown
 * to fail. When everything merged, `after(dir)` may run checks on the merged tree. The worktree
 * is always removed, whatever happens.
 */
export function shadowMerge({ git, repo, dir, base, heads, after }) {
  if (!SHA_RE.test(base) || heads.some((h) => !SHA_RE.test(h.sha))) throw new Error("base and heads must be full SHAs");
  const steps = [];
  const add = git(["worktree", "add", "--detach", dir, base], repo);
  if (add.status !== 0) return { steps: [{ pr: null, outcome: "error" }], head: null };
  let head = base;
  try {
    for (const h of heads) {
      const m = git([...IDENTITY, "merge", "--no-ff", "--no-edit", h.sha], dir);
      if (m.status === 0) {
        steps.push({ pr: h.pr, outcome: "clean" });
        head = git(["rev-parse", "HEAD"], dir).stdout.trim();
        continue;
      }
      const files = unmerged(git, dir);
      steps.push(files.length ? { pr: h.pr, outcome: "conflict", files } : { pr: h.pr, outcome: "error" });
      git(["merge", "--abort"], dir);
      break;
    }
    const clean = steps.every((s) => s.outcome === "clean");
    if (clean && after) after(dir);
    return { steps, head: clean ? head : null };
  } finally {
    git(["worktree", "remove", "--force", dir], repo);
  }
}

/** Where the worktree lives: a fresh directory name under `tmp`. */
export const worktreeDir = (tmp, stamp) => join(tmp, `shadow-lab-${String(stamp).replace(/\W/g, "")}`);

/** Text lines of the report; same facts as the JSON. */
export function renderShadow({ prs, steps, checks = [] }) {
  const out = [`Shadow merge of #${prs[0]} and #${prs[1]} on main (throw-away, nothing pushed)`];
  for (const s of steps) {
    const who = s.pr === null ? "worktree" : `#${s.pr}`;
    if (s.outcome === "clean") out.push(`- ${who}: merges cleanly`);
    else if (s.outcome === "conflict") out.push(`- ${who}: CONFLICT in ${s.files.length} file${s.files.length === 1 ? "" : "s"}: ${s.files.slice(0, 10).join(", ")}${s.files.length > 10 ? ", ..." : ""}`);
    else out.push(`- ${who}: merge could not be run`);
  }
  for (const c of checks) out.push(`- check ${c.name}: ${c.outcome}`);
  out.push("", "Advisory only: this does not replace CI or QA on the real head of either PR.");
  return out;
}
