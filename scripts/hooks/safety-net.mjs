// Fail-closed wrapper around the cc-safety-net PreToolUse hook (DAN-137).
//
// Claude Code blocks a PreToolUse call only on exit 2. Any other exit, a
// timeout or a missing command lets the call through, so calling the package
// directly fails open whenever node_modules is absent (every fresh worktree).
// This wrapper imports only node: modules, finds the package relative to its
// own location (never through node_modules resolution) and turns everything
// except a clean "allowed" or the package's own block into exit 2.
//
// Exit 0: allowed (package answered cleanly, or the exact install command ran
// while the package is unusable). Exit 2: blocked, reason on stderr.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Must stay below the 10 s `timeout` of the hook in .claude/settings.json: an
// expiry left to the harness is fail-open. One budget covers the analysis and,
// on the first run for a package state, the control probes.
export const ANALYSIS_TIMEOUT_MS = 7000;
export const RECOVERY = "Run `pnpm install --frozen-lockfile` in a terminal (or ask for exactly that command), then retry.";

// The only commands allowed while the package is unusable: the whole command,
// no operators, redirection or substitution, one literal spelling each.
const INSTALL_COMMANDS = /^pnpm install(?: --frozen-lockfile)?$/;

export function isInstallCommand(command) {
  return typeof command === "string" && INSTALL_COMMANDS.test(command.trim());
}

function defaultRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

// Returns null when the installed package is usable, else the reason. The
// analysis itself lives in dist/bin/hook.js; cc-safety-net.js only requires it.
export function packageProblem(root) {
  const dir = path.join(root, "node_modules", "cc-safety-net");
  for (const [file, label] of [
    ["cc-safety-net.js", "binary"],
    ["hook.js", "analysis module"],
  ]) {
    try {
      if (fs.statSync(path.join(dir, "dist", "bin", file)).size === 0) return `the cc-safety-net ${label} (dist/bin/${file}) is an empty file`;
    } catch {
      return `cc-safety-net is not installed or incomplete (node_modules/cc-safety-net/dist/bin/${file} is missing)`;
    }
  }
  try {
    const wanted = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).devDependencies?.["cc-safety-net"];
    const have = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).version;
    if (typeof wanted !== "string" || have !== wanted) return `installed cc-safety-net ${have} differs from the ${wanted} pinned in package.json`;
  } catch {
    return "cc-safety-net version could not be verified against package.json";
  }
  return null;
}


const RULEBOOK = [".cc-safety-net", "rules", "ductus-rules", "rulebook.json"];
const PROJECT_CONFIG = ".cc-safety-net";
// One built-in rule and one project rule; a working package denies both.
export const PROBES = ["git push --force origin ductus-probe", "git add -A"];

// SHA-256 of the file content (about 375 KB for hook.js, a couple of ms), so
// restoring size and mtime does not keep an old verdict alive.
const fingerprint = (file) => {
  try {
    return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  } catch {
    return "absent";
  }
};

// Content hash of a whole directory tree (names, kinds, file contents, link
// targets). `skip` lists relative paths left out. Throws when the tree is
// unreasonably large, which makes the caller refuse to remember a verdict.
const MAX_ENTRIES = 5000;
export function treeDigest(dir, skip = []) {
  try {
    fs.lstatSync(dir);
  } catch {
    return "absent";
  }
  const hash = createHash("sha256");
  let count = 0;
  const walk = (current, rel) => {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
    } catch {
      hash.update(`unreadable:${rel}\n`);
      return;
    }
    for (const entry of entries) {
      const name = rel ? `${rel}/${entry.name}` : entry.name;
      if (skip.includes(name)) continue;
      if (++count > MAX_ENTRIES) throw new Error("too many entries");
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        hash.update(`d:${name}\n`);
        walk(full, name);
      } else if (entry.isSymbolicLink()) {
        let target = "?";
        try {
          target = fs.readlinkSync(full);
        } catch {
          // keep the placeholder
        }
        hash.update(`l:${name}:${target}\n`);
      } else {
        hash.update(`f:${name}:`);
        try {
          hash.update(fs.readFileSync(full));
        } catch {
          hash.update("unreadable");
        }
        hash.update("\n");
      }
    }
  };
  walk(dir, "");
  return hash.digest("hex");
}

function eventCwd(input, root) {
  try {
    const cwd = JSON.parse(input).cwd;
    if (typeof cwd === "string" && cwd !== "") return path.resolve(cwd);
  } catch {
    // No usable cwd in the event: the package then uses its own process cwd, the root.
  }
  return root;
}

// The package reads project rules only from the exact cwd it is given, never
// from a parent. The rules therefore come from the nearest directory, from the
// event cwd up to the checkout root (the directory holding `.git`, which a
// worktree also has), that contains the rulebook. The search never leaves the
// checkout: a cwd outside any checkout looks only at itself, and a worktree
// without a rulebook does not inherit the rulebook of the checkout above it.
export function findRulebookDir(cwd) {
  const chain = [];
  let dir = cwd;
  let bounded = false;
  for (;;) {
    chain.push(dir);
    if (fs.existsSync(path.join(dir, ".git"))) {
      bounded = true;
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return (bounded ? chain : [cwd]).find((candidate) => fs.existsSync(path.join(candidate, ...RULEBOOK))) ?? null;
}

// Every place the package reads configuration from, for the key of a remembered
// verdict: the whole project config directory, the whole user config directory
// (the one named by CC_SAFETY_NET_HOME, and the one under each home the
// package may resolve), minus logs and the Node compile cache, and every
// CC_SAFETY_NET_* variable of the hook environment. Not covered: the compile
// cache and the git configuration of the checkout.
const USER_SKIP = ["logs", "compile-cache"];
function userConfigDirs(env) {
  const dirs = new Set();
  if (env.CC_SAFETY_NET_HOME) dirs.add(path.resolve(env.CC_SAFETY_NET_HOME));
  let homedir;
  try {
    homedir = os.homedir();
  } catch {
    homedir = undefined;
  }
  for (const home of [env.HOME, env.USERPROFILE, homedir]) if (home) dirs.add(path.join(home, PROJECT_CONFIG));
  return [...dirs].sort();
}

// Returns the key, or null when the state cannot be described reliably.
function stateKey(root, rulebookDir, env) {
  try {
    const bin = path.join(root, "node_modules", "cc-safety-net", "dist", "bin");
    const parts = [
      root,
      rulebookDir,
      fingerprint(path.join(bin, "cc-safety-net.js")),
      fingerprint(path.join(bin, "hook.js")),
      `project:${treeDigest(path.join(rulebookDir, PROJECT_CONFIG))}`,
      ...userConfigDirs(env).map((dir) => `user:${dir}:${treeDigest(dir, USER_SKIP)}`),
      ...Object.keys(env)
        .filter((name) => name.startsWith("CC_SAFETY_NET_"))
        .sort()
        .map((name) => `env:${name}=${env[name]}`),
    ];
    return createHash("sha256").update(parts.join("|")).digest("hex");
  } catch {
    return null;
  }
}

// Remembered verdicts live in a directory private to the current user; one that
// is shared, foreign or a link is not used at all (the probe then runs again).
function markDir() {
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  const dir = path.join(os.tmpdir(), `ductus-safety-net-probe${uid === null ? "" : `-${uid}`}`);
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const stat = fs.lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
    if (uid !== null && (stat.uid !== uid || (stat.mode & 0o022) !== 0)) return null;
    return dir;
  } catch {
    return null;
  }
}

function hasVerdict(dir, key) {
  try {
    const file = path.join(dir, key);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || (typeof process.getuid === "function" && stat.uid !== process.getuid())) return false;
    return fs.readFileSync(file, "utf8") === key;
  } catch {
    return false;
  }
}

function runPackage(root, input, timeout, env) {
  const bin = path.join(root, "node_modules", "cc-safety-net", "dist", "bin", "cc-safety-net.js");
  return spawnSync(process.execPath, [bin, "hook", "--coding-cli"], {
    input,
    encoding: "utf8",
    timeout: Math.max(1, timeout),
    killSignal: "SIGKILL",
    cwd: root,
    env,
    maxBuffer: 4 * 1024 * 1024,
  });
}

// A package that exits 0 and prints nothing (or "{}") is also what an emptied
// or stubbed hook.js does, so its answer alone proves nothing. The control
// probe asks it about commands it must deny, run in the directory whose
// rulebook applies. The verdict is remembered per state key, so the extra runs
// happen once per state.
function probe(root, rulebookDir, deadline, env) {
  const key = stateKey(root, rulebookDir, env);
  const dir = key ? markDir() : null;
  if (key && dir && hasVerdict(dir, key)) return null;
  for (const command of PROBES) {
    const left = deadline - Date.now();
    if (left <= 0) return "the control probe ran out of time";
    const event = JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", cwd: rulebookDir, tool_input: { command } });
    const run = runPackage(root, event, left, env);
    let decision;
    try {
      decision = JSON.parse(run.stdout || "{}").hookSpecificOutput?.permissionDecision;
    } catch {
      decision = undefined;
    }
    if (!(run.status === 0 && decision === "deny") && run.status !== 2) {
      return `the control probe "${command}" was not denied (silent or stubbed package, or the project rulebook ${RULEBOOK.join("/")} in ${rulebookDir} is invalid)`;
    }
  }
  if (key && dir) {
    try {
      fs.writeFileSync(path.join(dir, key), key, { mode: 0o600 });
    } catch {
      // Not remembered: the probe simply runs again next time.
    }
  }
  return null;
}

const blockedFor = (problem, hint = RECOVERY) => ({ code: 2, stdout: "", stderr: `Safety hook blocked this command: ${problem}. ${hint}\n` });

function commandOf(input) {
  try {
    return JSON.parse(input).tool_input?.command;
  } catch {
    return undefined;
  }
}

// The one way out of a directory without usable project rules: the command is
// exactly `cd <project root>`, bare or in one pair of quotes, and nothing else.
// A root with characters a shell would treat specially gets no exit.
const UNSAFE_ROOT = /[$`"';&|<>()*?!{}[\]#~^%\r\n]/;
export function isCdToRoot(command, root) {
  if (typeof command !== "string" || UNSAFE_ROOT.test(root)) return false;
  const forms = [`cd "${root}"`, `cd '${root}'`];
  if (!/\s/.test(root)) forms.push(`cd ${root}`);
  return forms.includes(command.trim());
}

// Reads one package run: { block } when it must end the decision, else { stdout, stderr }.
export function answer(run, timeoutMs) {
  const stdout = run.stdout ?? "";
  const stderr = run.stderr ?? "";
  const failed = (why) => ({ block: { code: 2, stdout: "", stderr: `Safety hook blocked this command: cc-safety-net ${why}. ${RECOVERY}\n${stderr}` } });
  if (run.error) return failed(run.error.code === "ETIMEDOUT" ? `did not answer within ${timeoutMs} ms` : `could not run (${run.error.message})`);
  if (run.signal) return failed(`was killed by ${run.signal}`);
  if (run.status === 2) return { block: { code: 2, stdout, stderr } };
  if (run.status !== 0) return failed(`exited with status ${run.status}`);
  if (stdout.trim()) {
    try {
      JSON.parse(stdout);
    } catch {
      return failed("returned output that is not JSON");
    }
  }
  return { stdout, stderr };
}

const denies = (stdout) => {
  try {
    return JSON.parse(stdout).hookSpecificOutput?.permissionDecision === "deny";
  } catch {
    return false;
  }
};

// Pure decision: { code, stdout, stderr }. `input` is the raw hook stdin.
export function decide({ root = defaultRoot(), input, timeoutMs = ANALYSIS_TIMEOUT_MS, env = process.env }) {
  const deadline = Date.now() + timeoutMs;
  const command = commandOf(input);
  // The exact install command is the way out of an unusable package.
  const unusable = (problem, hint) => (isInstallCommand(command) ? { code: 0, stdout: "", stderr: "" } : blockedFor(problem, hint));
  const problem = packageProblem(root);
  if (problem) return unusable(problem);

  // Run 1: the event as sent (built-in rules, relative paths keep their meaning).
  const first = answer(runPackage(root, input, timeoutMs, env), timeoutMs);
  if (first.block) return first.block;

  const cwd = eventCwd(input, root);
  const rulebookDir = findRulebookDir(cwd);
  // Without usable project rules here, only the way back to the project root stays open.
  const noRules = (problem) => {
    if (isCdToRoot(command, root)) return { code: 0, stdout: first.stdout, stderr: first.stderr };
    return unusable(
      problem,
      `Run exactly \`cd ${root}\` (nothing else in the command) to return to the project root, or leave the worktree with the worktree exit tool, or from the project root run: git -C <this directory> merge origin/main (or git -C <this directory> checkout origin/main -- .cc-safety-net)`,
    );
  };
  if (!rulebookDir) {
    return noRules(`no project rulebook (${RULEBOOK.join("/")}) found from ${cwd} up to the checkout root, so the project rules (git add -A, --no-verify, commit -a) would be off`);
  }
  // The package reads configuration from the exact cwd too; one below the
  // rulebook directory would change the first run in ways the probe cannot see.
  if (rulebookDir !== cwd && fs.existsSync(path.join(cwd, PROJECT_CONFIG))) {
    return noRules(`${cwd} has its own ${PROJECT_CONFIG} directory below the project's, which the safety check does not accept`);
  }
  // Any clean answer is checked once per state, not only a silent one: a stub
  // that prints "{}" or an allow decision is as useless as one that prints nothing.
  const probeProblem = probe(root, rulebookDir, deadline, env);
  if (probeProblem) return unusable(probeProblem);

  // Run 2: in a subdirectory the project rules live in a parent the package does not search.
  if (rulebookDir !== cwd && !denies(first.stdout)) {
    let moved;
    try {
      moved = JSON.stringify({ ...JSON.parse(input), cwd: rulebookDir });
    } catch {
      moved = null;
    }
    if (moved) {
      const second = answer(runPackage(root, moved, deadline - Date.now(), env), timeoutMs);
      if (second.block) return second.block;
      if (second.stdout.trim()) return { code: 0, stdout: second.stdout, stderr: second.stderr };
    }
  }
  return { code: 0, stdout: first.stdout, stderr: first.stderr };
}

// Process entry point: reads stdin; an error never becomes a pass.
export function runCli({ read = () => fs.readFileSync(0, "utf8"), decideFn = decide } = {}) {
  let input = "";
  try {
    input = read();
  } catch {
    // An unreadable stdin is handled by the decision: no command, not an install.
  }
  try {
    return decideFn({ input });
  } catch (error) {
    return blockedFor(`wrapper error (${error?.message})`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = runCli();
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.code;
}
