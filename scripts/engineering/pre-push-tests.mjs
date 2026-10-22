// Pre-push test run (DAN-239, D-161). A push that changes only application
// source and unit or property tests runs the tests those changes can reach;
// anything else, and any doubt, runs the whole `pnpm test`. CI always runs
// everything, so this only shortens the wait before a push.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Only these may be the sole changes of a scoped run. Everything a test can
// read from elsewhere (config, docs, scripts, lockfile, fixtures) is not here.
export const SCOPED_PREFIXES = ["src/", "tests/unit/", "tests/property/"];

export const FULL_VARIABLE = "DUCTUS_PREPUSH_FULL";

/** "full" unless every changed path lies under a scoped prefix. */
export function plan(changedFiles, env = {}) {
  if (env[FULL_VARIABLE] === "1") return "full";
  if (!Array.isArray(changedFiles) || changedFiles.length === 0) return "full";
  const scoped = changedFiles.every(
    (file) => typeof file === "string" && SCOPED_PREFIXES.some((prefix) => file.startsWith(prefix)) && !file.includes(".."),
  );
  return scoped ? "scoped" : "full";
}

const TEST_NAME_RE = /\.test\.tsx?$/;
const READS_FILES_RE = /from\s+["']node:(?:fs|fs\/promises)["']|require\(\s*["'](?:node:)?fs["']\s*\)/;

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

/**
 * Test files that read files from disk. `vitest --changed` follows imports
 * only, so a test that scans the tree would be missed; these always run.
 */
export function fileReadingTests(root, read = (file) => readFileSync(file, "utf8")) {
  const found = [];
  for (const base of ["src", "tests/unit", "tests/property"]) {
    let files;
    try {
      files = [...walk(join(root, base))];
    } catch {
      continue;
    }
    for (const file of files) {
      if (TEST_NAME_RE.test(file) && READS_FILES_RE.test(read(file))) {
        found.push(file.slice(root.length).replace(/^[/\\]+/, "").replaceAll("\\", "/"));
      }
    }
  }
  return found.sort();
}

function git(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

/** Changed paths against the merge base with origin/main, or null when unknown. */
export function changedAgainstMain(cwd) {
  const base = git(["merge-base", "HEAD", "origin/main"], cwd);
  if (!base) return null;
  const names = git(["diff", "--name-only", "--no-renames", base, "HEAD"], cwd);
  return names === null ? null : { base, files: names.split("\n").filter(Boolean) };
}

// pnpm is a .cmd file on Windows, which Node starts only through cmd.exe. The
// arguments are fixed strings or test paths that passed SAFE_PATH_RE; no shell
// option is set (Semgrep spawn-shell-true).
export const SAFE_PATH_RE = /^[\w./@-]+$/;

export function pnpmCommand(args, platform = process.platform) {
  return platform === "win32" ? ["cmd.exe", ["/d", "/s", "/c", "pnpm", ...args]] : ["pnpm", args];
}

function run(args, cwd) {
  const [command, commandArgs] = pnpmCommand(args);
  const result = spawnSync(command, commandArgs, { cwd, stdio: "inherit" });
  return result.status ?? 1;
}

export function main(cwd = fileURLToPath(new URL("../../", import.meta.url)), env = process.env) {
  const changed = changedAgainstMain(cwd);
  const readers = plan(changed?.files, env) === "scoped" ? fileReadingTests(cwd) : [];
  if (plan(changed?.files, env) === "full" || !readers.every((file) => SAFE_PATH_RE.test(file))) {
    console.log("pre-push: full test run (pnpm test).");
    return run(["test"], cwd);
  }
  console.log(`pre-push: scoped run for ${changed.files.length} changed file(s) plus ${readers.length} file-reading test(s). CI runs everything.`);
  const projects = ["--project", "unit", "--project", "property"];
  const reached = run(["exec", "vitest", "run", ...projects, "--changed", changed.base], cwd);
  if (reached !== 0) return reached;
  return readers.length === 0 ? 0 : run(["exec", "vitest", "run", ...projects, ...readers], cwd);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exit(main());
