// DAN-269: Shadow Integration Lab, first cut. Local only; nothing is pushed or written to GitHub.
// Usage: node shadow.mjs <prA> <prB> [--check typecheck] [--json]
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ghJson } from "./gh.mjs";
import { parseShadowArgs, renderShadow, shadowMerge } from "./shadow-core.mjs";

// Inherited repository-location variables (set inside git hooks) would point every git call elsewhere.
const REPO_ENV = /^GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|PREFIX)$/i;

function git(args, cwd) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !REPO_ENV.test(k)));
  const r = spawnSync("git", args, { cwd, env, encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: 600_000 });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

const fail = (msg) => {
  throw new Error(msg);
};

try {
  const { prs, checks, json } = parseShadowArgs(process.argv.slice(2));
  const repo = git(["rev-parse", "--show-toplevel"]).stdout.trim() || fail("not inside a git checkout");
  const heads = [];
  for (const n of prs) {
    const pr = await ghJson(["api", `repos/{owner}/{repo}/pulls/${n}`]);
    if (pr.state !== "open") fail(`#${n} is not open`);
    // A fork's branch is outside code: nothing from it is merged or run here.
    if (pr.head?.repo?.full_name !== pr.base?.repo?.full_name) fail(`#${n} comes from a fork`);
    if (git(["fetch", "--quiet", "origin", `refs/pull/${n}/head`], repo).status !== 0) fail(`fetch of #${n} failed`);
    const sha = git(["rev-parse", "FETCH_HEAD"], repo).stdout.trim();
    if (sha !== pr.head.sha) fail(`#${n} moved while it was read; run again`);
    heads.push({ pr: n, sha });
  }
  if (git(["fetch", "--quiet", "origin", "main"], repo).status !== 0) fail("fetch of main failed");
  const base = git(["rev-parse", "FETCH_HEAD"], repo).stdout.trim();
  const tmp = mkdtempSync(join(tmpdir(), "ductus-"));
  const dir = join(tmp, "shadow");
  let result;
  const checkResults = [];
  try {
    // The checks run inside shadowMerge's worktree only while it exists, so they are passed in.
    result = shadowMerge({ git, repo, dir, base, heads, after: (wt) => {
      for (const name of checks) {
        const changed = git(["diff", "--name-only", base, "HEAD"], wt).stdout.split("\n");
        if (changed.some((f) => f === "package.json" || f === "pnpm-lock.yaml")) {
          checkResults.push({ name, outcome: "skipped (dependencies changed)" });
          continue;
        }
        if (!existsSync(join(repo, "node_modules"))) {
          checkResults.push({ name, outcome: "skipped (no node_modules in the checkout)" });
          continue;
        }
        symlinkSync(join(repo, "node_modules"), join(wt, "node_modules"), "junction");
        const r = spawnSync("pnpm", ["exec", "tsc", "--noEmit"], { cwd: wt, encoding: "utf8", windowsHide: true, timeout: 900_000 });
        checkResults.push({ name, outcome: r.status === 0 ? "passes" : "FAILS (see tsc on the merged tree)" });
      }
    } });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  const report = { prs, base, heads, steps: result.steps, checks: checkResults };
  console.log(json ? JSON.stringify(report, null, 2) : renderShadow(report).join("\n"));
  process.exitCode = result.steps.every((s) => s.outcome === "clean") ? 0 : 1;
} catch (e) {
  console.error(`shadow failed: ${e.message}`);
  process.exit(2);
}
