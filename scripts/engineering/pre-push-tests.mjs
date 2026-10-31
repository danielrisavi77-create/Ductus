// Pre-push test run (DAN-239, D-161). A push that changes only application
// source and unit or property tests runs the tests those changes can reach; one
// that changes only listed scripts and documents runs the script tests and every
// test that reads files (DAN-361); anything else, and any doubt, runs the whole
// `pnpm test`. CI always runs everything, so this only shortens the wait before
// a push.
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

// The only list of what the tooling run accepts: a positive, flat, case-sensitive
// allowlist. It is a local pre-push exception and deliberately not ORDINARY_DOCS
// in ci-docs-scope.mjs, which decides what CI may skip. Nested files, data and
// config, agent instructions and any other document get the full run. Rule
// documents leave only the full local set, not review, QA or the owner's
// command: their readers are script tests and file-reading tests, and all of
// those run here (orchestrator, #87 c.6523882827, answer 3).
const TOOLING_SCRIPT_RE = /^scripts\/(?:engineering|orchestrator)\/[a-z0-9][a-z0-9-]*(?:\.test)?\.mjs$/;
export const TOOLING_DOCS = new Set([
  "README.md", "STATE.md", "docs/ARCHITECTURE.md", "docs/BACKEND.md", "docs/DECISIONS.md",
  "docs/DEMO-SUHI-PROLAZ.md", "docs/DEMO-TEACHER-BOOTSTRAP.md", "docs/DEMO-UP.md",
  "docs/ENGINEERING_SYSTEM-SAZETAK.md", "docs/ENGINEERING_SYSTEM.md", "docs/FEATURES.md",
  "docs/FUNCTIONAL_ARCHITECTURE_V1.md", "docs/MULTI-ACCOUNT.md", "docs/ORKESTRATOR-SAZETAK.md",
  "docs/ORKESTRATOR.md", "docs/PLAN-DEMO.md", "docs/PRODUCT.md", "docs/PRODUCT_SPEC_V1.md",
  "docs/PROGRAM.md", "docs/REPOZITORIJI.md", "docs/SECURITY.md", "docs/SESSIONS.md",
  "docs/TESTING.md", "docs/UX-EVAL.md",
]);
// Vitest tests that always join a tooling run: the first guards docs/PRODUCT.md
// section 5 from code, without reading the file; the next two load the scripts;
// the last describes the pre-push run itself.
const TOOLING_CONSUMERS = [
  "tests/property/forbidden-terms.property.test.ts", "tests/unit/codeowners.test.ts",
  "tests/unit/pr-metadata-precheck.test.ts", "tests/unit/vitest-workers.test.ts",
];

/**
 * Whether a change may take the tooling run. Both sides of the diff must be a
 * regular non-executable file: a new file, or one that already was that. A mode
 * change, a symlink, a gitlink and a type change therefore never qualify.
 */
export function isToolingChange({ status, file, oldMode, mode }) {
  const regular = (status === "A" && oldMode === "000000") || (status === "M" && oldMode === "100644");
  return regular && mode === "100644" && typeof file === "string" && (TOOLING_SCRIPT_RE.test(file) || TOOLING_DOCS.has(file));
}

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
 * The run and why: {mode: "full" | "scoped" | "tooling", reason, files}. `files` lists the
 * changes that stopped a scoped run (all of them; the caller shortens the text).
 */
export function explain(changes, env = {}) {
  if (env[FULL_VARIABLE] === "1") return { mode: "full", reason: `${FULL_VARIABLE}=1`, files: [] };
  if (!Array.isArray(changes)) return { mode: "full", reason: "changed files against origin/main are unknown", files: [] };
  if (changes.length === 0) return { mode: "full", reason: "no changed files against origin/main", files: [] };
  if (Array.from(changes).every((change) => isToolingChange(change ?? {}))) {
    return { mode: "tooling", reason: "only allowlisted scripts or documents; script tests and readers retained", files: [] };
  }
  const blocking = Array.from(changes).filter((change) => !isScopedChange(change ?? {}));
  if (blocking.length === 0) return { mode: "scoped", reason: "only added or modified src/ and unit or property test files", files: [] };
  const files = blocking.map((c) => (c && typeof c === "object" ? `${c.status ?? "?"} ${c.file ?? "?"}` : String(c)));
  return { mode: "full", reason: "changes a test may reach other than through imports", files };
}

/** "full" unless every change passes isToolingChange or every one isScopedChange. */
export function plan(changes, env = {}) {
  return explain(changes, env).mode;
}

const TEST_NAME_RE = /\.test\.tsx?$/;
// Reading the disk directly, or through a child process that can read anything.
const READS_FILES_RE = /(?:from\s+|import\s*\(\s*|require\(\s*)["'](?:node:)?(?:fs|fs\/promises|child_process)["']|import\s+["'](?:node:)?(?:fs|fs\/promises|child_process)["']/;
// The tooling run has no `vitest --changed` answer for a script, so it counts
// anything that can reach a file other than through a plain static import:
// computed imports and require, the module and worker APIs, packages that glob
// or start processes, and Vite's own file imports.
const REACHES_FILES_RE = /\bimport\s*\(|\brequire\s*\(|\bcreateRequire\b|\bnew\s+Worker\b|\bprocess\.(?:binding|getBuiltinModule)\b|\bimport\.meta\.glob|["'`](?:node:)?(?:fs|fs\/promises|child_process|module|worker_threads)["'`]|["'`](?:execa|tinyexec|glob|globby|fast-glob|tinyglobby)["'`]|\?(?:raw|url)["'`]/;
// A path handed to vi.mock and friends: followed like an import, read if computed.
const VI_MODULE_RE = /\bvi\.(?:mock|doMock|importActual|importMock)(?:<[^>]*>)?\(\s*["']([^"']+)["']/g;
const VI_COMPUTED_RE = /\bvi\.(?:mock|doMock|importActual|importMock)(?:<[^>]*>)?\(\s*[^"'\s]/;
const IMPORT_RE = /(?:from\s+|import\s*\(\s*|import\s+|require\(\s*)["']([^"']+)["']/g;
const EXTENSIONS = ["", ".ts", ".tsx", ".mts", ".mjs", ".js", "/index.ts", "/index.tsx"];

/** Repository files a module imports: relative and "@/" paths only; packages are not followed. */
export function localImports(file, source, exists, pattern = IMPORT_RE) {
  const out = [];
  for (const [, spec] of source.matchAll(pattern)) {
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
 * always run. An unreadable module counts as reading files. `strict` is the
 * tooling run's stricter reading: REACHES_FILES_RE and vi.* paths also count, a
 * file that is not valid UTF-8 counts as reading files, and a directory that
 * cannot be listed throws.
 */
const isFile = (file) => {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
};

export function fileReadingTests(root, read = (file) => readFileSync(file, "utf8"), exists = isFile, strict = false) {
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
      if (strict && (REACHES_FILES_RE.test(text) || VI_COMPUTED_RE.test(text) || text.includes("\uFFFD"))) return true;
      const present = (f) => exists(join(root, f));
      const deps = [...localImports(rel, text, present), ...(strict ? localImports(rel, text, present, VI_MODULE_RE) : [])];
      for (const dep of deps) {
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
    } catch (error) {
      if (strict) throw error;
      continue;
    }
    for (const file of files) {
      const rel = file.slice(root.length).replace(/^[/\\]+/, "").replaceAll("\\", "/");
      if (TEST_NAME_RE.test(file) && reads(rel)) found.push(rel);
    }
  }
  return found.sort();
}

// A hook can inherit GIT_DIR and friends, which would point git elsewhere than
// the worktree being pushed from. Stdout that outgrows the spawn buffer ends with
// status null, so a shortened answer is never read as a complete one.
export function withoutGit(env) {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !/^GIT_/i.test(name)));
}

function gitOutput(args, cwd, env) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", env: withoutGit(env) });
  return result.status === 0 ? result.stdout : null;
}

/**
 * `git diff-tree --raw -z` as [{status, file, oldMode, mode}], or null when any
 * part of it is not a complete record. Unlike text output this carries both
 * modes, and no config (colour, prefixes, quoting) changes it.
 */
export function parseRawDiff(raw) {
  if (typeof raw !== "string") return null;
  const fields = raw.split("\0");
  if (fields.pop() !== "" || fields.length % 2 !== 0) return null;
  const changes = [];
  for (let i = 0; i < fields.length; i += 2) {
    const match = /^:(\d{6}) (\d{6}) [0-9a-f]{40,64} [0-9a-f]{40,64} ([A-Z])$/.exec(fields[i]);
    if (!match || !fields[i + 1]) return null;
    changes.push({ oldMode: match[1], mode: match[2], status: match[3], file: fields[i + 1] });
  }
  return changes;
}

/** Changed paths against the merge base with origin/main, or null when unknown. */
export function changedAgainstMain(cwd, env = process.env) {
  // The full ref name: a branch or tag called origin/main must not stand in. More
  // than one merge base means there is no single diff to judge.
  const bases = gitOutput(["merge-base", "--all", "HEAD", "refs/remotes/origin/main"], cwd, env)?.trim().split("\n");
  if (bases?.length !== 1 || !bases[0]) return null;
  const raw = gitOutput(["diff-tree", "-r", "-z", "--raw", "--no-abbrev", "--no-renames", "--no-ext-diff", "--ignore-submodules=none", bases[0], "HEAD"], cwd, env);
  const files = parseRawDiff(raw);
  return files && { base: bases[0], files };
}

/**
 * Whether the pre-push lines say exactly one branch update, of the commit at
 * HEAD. What is classified is HEAD, so anything else pushed is unknown: another
 * branch, several refs, a deletion or a tag.
 */
export function pushesOnlyHead(lines, head) {
  if (typeof lines !== "string" || !head) return false;
  const refs = lines.split(/\r?\n/).filter(Boolean);
  if (refs.length !== 1) return false;
  const [localRef, localSha, remoteRef, remoteSha, ...extra] = refs[0].split(" ");
  return extra.length === 0 && Boolean(remoteSha) && localSha === head && /^(?:HEAD|refs\/heads\/.+)$/.test(localRef) && remoteRef.startsWith("refs/heads/");
}

/** Console lines for a decision; at most `max` files are listed. */
export function describe(why, max = 5) {
  const lines = [`pre-push: ${why.mode === "full" ? "full test run (pnpm test)" : `${why.mode} run`}: ${why.reason}.`];
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

const WINDOWS_COMMAND_LIMIT = 8191;

// Every test process gets the environment without GIT_*: a hook in a linked
// worktree inherits GIT_DIR, and a test fixture that runs git in its own
// directory would otherwise commit into the branch being pushed.
function run(args, cwd, execute, env) {
  const [command, commandArgs] = pnpmCommand(args);
  const result = execute(command, commandArgs, { cwd, stdio: "inherit", env: withoutGit(env) });
  return result.status ?? 1;
}

/**
 * Whether GNU `timeout` (with --kill-after) runs here: the script tests of a
 * tooling run need it (scripts/engineering/playwright-install.sh). Without it,
 * as on macOS without coreutils, the tooling run would fail a correct push.
 */
export function gnuTimeoutAvailable(env = process.env) {
  const probe = spawnSync("timeout", ["--kill-after=1", "10", process.execPath, "-e", ""], { stdio: "ignore", env: withoutGit(env) });
  return probe.status === 0;
}

function readPushLines() {
  return process.stdin.isTTY ? null : readFileSync(0, "utf8");
}

/** Why the commit at HEAD cannot be what this tooling run proves, or null. */
function toolingDoubt(cwd, env, readLines) {
  let lines = null;
  try {
    lines = readLines();
  } catch {
    // no readable stdin: nothing says what is being pushed
  }
  if (!pushesOnlyHead(lines, gitOutput(["rev-parse", "--verify", "HEAD^{commit}"], cwd, env)?.trim())) return "the pushed ref is unknown or is not HEAD";
  const dirty = gitOutput(["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=none"], cwd, env);
  return dirty === "" ? null : "the working tree differs from HEAD, or its state is unknown";
}

/** The tests of a tooling run; throws when any part of the inventory is missing. */
export function toolingInventory(cwd) {
  const readers = new Set([...fileReadingTests(cwd, undefined, undefined, true), ...TOOLING_CONSUMERS]);
  for (const file of TOOLING_CONSUMERS) {
    if (!isFile(join(cwd, file))) throw new Error("missing script consumer");
  }
  // A list, not a glob: the same on Windows and on every Node version, and it
  // cannot expand to nothing. CI's glob covers the same flat directories.
  const scriptTests = ["scripts/engineering", "scripts/orchestrator"].flatMap((dir) => {
    const tests = readdirSync(join(cwd, dir), { withFileTypes: true }).filter((e) => e.name.endsWith(".test.mjs"));
    if (!tests.length || tests.some((e) => !e.isFile())) throw new Error("missing or non-regular script tests");
    return tests.map((e) => `${dir}/${e.name}`).sort();
  });
  return { readers: [...readers].sort(), scriptTests };
}

export function main(cwd = fileURLToPath(new URL("../../", import.meta.url)), env = process.env, execute = spawnSync, readLines = readPushLines, platform = process.platform, hasTimeout = gnuTimeoutAvailable) {
  const changed = changedAgainstMain(cwd, env);
  let why = explain(changed?.files, env);
  let readers = why.mode === "scoped" ? fileReadingTests(cwd) : [];
  let scriptTests = [];
  if (why.mode === "tooling") {
    const doubt = toolingDoubt(cwd, env, readLines);
    if (doubt) why = { mode: "full", reason: doubt, files: [] };
  }
  if (why.mode === "tooling") {
    try {
      ({ readers, scriptTests } = toolingInventory(cwd));
    } catch {
      why = { mode: "full", reason: "test inventory is unknown or incomplete", files: [] };
    }
  }
  const unsafe = [...readers, ...scriptTests].filter((file) => !SAFE_PATH_RE.test(file));
  const projects = ["--project", "unit", "--project", "property"];
  const readerRun = ["exec", "vitest", "run", ...projects, ...readers];
  if (why.mode === "tooling" && platform === "win32" && pnpmCommand(readerRun, platform).flat().join(" ").length >= WINDOWS_COMMAND_LIMIT) {
    why = { mode: "full", reason: "the reader list is too long for one Windows command", files: [] };
  }
  // `node --test` is outside `pnpm test`, so here the tooling run would be a slower
  // superset of the full run, with failures of its own. Lifted by DAN-369 (#995).
  if (why.mode === "tooling" && platform === "win32") {
    why = { mode: "full", reason: "the tooling run does not pass on Windows yet (DAN-369)", files: [] };
  }
  if (why.mode === "tooling" && !hasTimeout(env)) {
    why = { mode: "full", reason: "GNU timeout, which the script tests need, is not available", files: [] };
  }
  if (why.mode === "full" || unsafe.length) {
    for (const line of describe(unsafe.length ? { mode: "full", reason: "a file-reading test has an unusual name", files: unsafe } : why)) console.log(line);
    return run(["test"], cwd, execute, env);
  }
  for (const line of describe(why)) console.log(line);
  console.log(`pre-push: ${changed.files.length} changed file(s), plus ${readers.length} file-reading test(s). CI runs everything.`);
  if (why.mode === "tooling") {
    const scripts = execute(process.execPath, ["--test", ...scriptTests], { cwd, stdio: "inherit", env: withoutGit(env) });
    if (scripts.status !== 0) return scripts.status ?? 1;
  }
  // A script may have no static Vitest importer, so only here may the selection
  // be empty; the reader run below never passes on nothing.
  const emptySelection = why.mode === "tooling" ? ["--passWithNoTests"] : [];
  const reached = run(["exec", "vitest", "run", ...projects, "--changed", changed.base, ...emptySelection], cwd, execute, env);
  if (reached !== 0) return reached;
  return readers.length === 0 ? 0 : run(readerRun, cwd, execute, env);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exit(main());
