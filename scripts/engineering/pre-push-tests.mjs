// Pre-push test run (DAN-239, D-161). A push that changes only application
// source and unit or property tests runs the tests those changes can reach;
// anything else, and any doubt, runs the whole `pnpm test`. CI always runs
// everything, so this only shortens the wait before a push.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const FULL_VARIABLE = "DUCTUS_PREPUSH_FULL";

// A path that ends the scoped run's path check must be plain; git quotes names
// with unusual characters, and those never match.
export const SAFE_PATH_RE = /^[\w./@-]+$/;

const SOURCE_RE = /^src\/.+\.tsx?$/;
const TEST_FILE_RE = /^tests\/(?:unit|property)\/.+\.test\.tsx?$/;

/**
 * Whether `vitest --changed` can stand in for the whole suite for this change:
 * only added or modified TypeScript source or unit/property test files, because
 * those are the files vitest follows through imports. A deleted or renamed
 * file (its importers are no longer reachable), a data file such as JSON or
 * SQL, test setup or helpers, config and documents are not.
 */
export function isScopedChange({ status, file }) {
  return (
    (status === "A" || status === "M") &&
    typeof file === "string" &&
    SAFE_PATH_RE.test(file) &&
    !file.includes("..") &&
    (SOURCE_RE.test(file) || TEST_FILE_RE.test(file))
  );
}

/**
 * The run and why: {mode: "full" | "scoped", reason, files}. `files` lists the
 * changes that stopped a scoped run (all of them; the caller shortens the text).
 */
export function explain(changes, env = {}) {
  if (env[FULL_VARIABLE] === "1") return { mode: "full", reason: `${FULL_VARIABLE}=1`, files: [] };
  if (!Array.isArray(changes)) return { mode: "full", reason: "changed files against origin/main are unknown", files: [] };
  if (changes.length === 0) return { mode: "full", reason: "no changed files against origin/main", files: [] };
  const blocking = changes.filter((change) => !isScopedChange(change ?? {}));
  if (blocking.length === 0) return { mode: "scoped", reason: "only added or modified src/ and unit or property test files", files: [] };
  const files = blocking.map((c) => (c && typeof c === "object" ? `${c.status ?? "?"} ${c.file ?? "?"}` : String(c)));
  return { mode: "full", reason: "changes a test may reach other than through imports", files };
}

/** "full" unless every change passes isScopedChange. `changes`: [{status, file}]. */
export function plan(changes, env = {}) {
  return explain(changes, env).mode;
}

const TEST_NAME_RE = /\.test\.tsx?$/;
// Reading the disk directly, or through a child process that can read anything.
const READS_FILES_RE = /(?:from\s+|import\s*\(\s*|require\(\s*)["'](?:node:)?(?:fs|fs\/promises|child_process)["']|import\s+["'](?:node:)?(?:fs|fs\/promises|child_process)["']/;
const IMPORT_RE = /(?:from\s+|import\s*\(\s*|import\s+|require\(\s*)["']([^"']+)["']/g;
const EXTENSIONS = ["", ".ts", ".tsx", ".mts", ".mjs", ".js", "/index.ts", "/index.tsx"];

/** Repository files a module imports: relative and "@/" paths only; packages are not followed. */
export function localImports(file, source, exists) {
  const out = [];
  for (const [, spec] of source.matchAll(IMPORT_RE)) {
    let base;
    if (spec.startsWith("@/")) base = join("src", spec.slice(2));
    else if (spec.startsWith("./") || spec.startsWith("../")) base = join(dirname(file), spec);
    else continue;
    const bare = base.replace(/\.[cm]?js$/, "");
    const found = [...EXTENSIONS.map((e) => base + e), ...EXTENSIONS.slice(1).map((e) => bare + e)].find(exists);
    if (found) out.push(found.replaceAll("\\", "/"));
  }
  return out;
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

/**
 * Test files that read files from disk, themselves or through any repository
 * module they import (a helper, a scanner in scripts/). `vitest --changed`
 * follows imports only, so a test that scans the tree would be missed; these
 * always run. An unreadable module counts as reading files.
 */
const isFile = (file) => {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
};

export function fileReadingTests(root, read = (file) => readFileSync(file, "utf8"), exists = isFile) {
  // Sources are read once; the walk itself starts fresh per test, so a cycle
  // can never leave a wrong answer behind for a later test.
  const sources = new Map();
  const source = (rel) => {
    if (!sources.has(rel)) {
      try {
        sources.set(rel, read(join(root, rel)));
      } catch {
        sources.set(rel, null);
      }
    }
    return sources.get(rel);
  };
  const reads = (start) => {
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const rel = queue.shift();
      const text = source(rel);
      if (text === null || READS_FILES_RE.test(text)) return true;
      for (const dep of localImports(rel, text, (f) => exists(join(root, f)))) {
        if (!seen.has(dep)) {
          seen.add(dep);
          queue.push(dep);
        }
      }
    }
    return false;
  };
  const found = [];
  for (const base of ["src", "tests/unit", "tests/property"]) {
    let files;
    try {
      files = [...walk(join(root, base))];
    } catch {
      continue;
    }
    for (const file of files) {
      const rel = file.slice(root.length).replace(/^[/\\]+/, "").replaceAll("\\", "/");
      if (TEST_NAME_RE.test(file) && reads(rel)) found.push(rel);
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
  const lines = git(["diff", "--name-status", "--no-renames", base, "HEAD"], cwd);
  if (lines === null) return null;
  const changes = lines
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [status, ...rest] = line.split("\t");
      return { status, file: rest.join("\t") };
    });
  return { base, files: changes };
}

/** Console lines for a decision; at most `max` files are listed. */
export function describe(why, max = 5) {
  const lines = [`pre-push: ${why.mode === "full" ? "full test run (pnpm test)" : "scoped run"}: ${why.reason}.`];
  for (const file of why.files.slice(0, max)) lines.push(`  ${file}`);
  if (why.files.length > max) lines.push(`  ... and ${why.files.length - max} more`);
  return lines;
}

// pnpm is a .cmd file on Windows, which Node starts only through cmd.exe. The
// arguments are fixed strings or test paths that passed SAFE_PATH_RE; no shell
// option is set (Semgrep spawn-shell-true).

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
  const why = explain(changed?.files, env);
  const readers = why.mode === "scoped" ? fileReadingTests(cwd) : [];
  const unsafe = readers.filter((file) => !SAFE_PATH_RE.test(file));
  if (why.mode === "full" || unsafe.length) {
    for (const line of describe(unsafe.length ? { mode: "full", reason: "a file-reading test has an unusual name", files: unsafe } : why)) console.log(line);
    return run(["test"], cwd);
  }
  for (const line of describe(why)) console.log(line);
  console.log(`pre-push: ${changed.files.length} changed file(s), plus ${readers.length} file-reading test(s). CI runs everything.`);
  const projects = ["--project", "unit", "--project", "property"];
  const reached = run(["exec", "vitest", "run", ...projects, "--changed", changed.base], cwd);
  if (reached !== 0) return reached;
  return readers.length === 0 ? 0 : run(["exec", "vitest", "run", ...projects, ...readers], cwd);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exit(main());
