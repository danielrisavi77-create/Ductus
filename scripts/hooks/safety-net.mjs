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
export const ANALYSIS_TIMEOUT_MS = 8000;
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
// targets). `skip` lists relative paths left out. The walk is bounded by entry
// count, bytes read and time, shared through `budget`: the first overrun throws
// a LimitError, so a link to a huge directory or file is refused quickly instead
// of being read to the end. A caller that gets the error must block.
export const DEFAULT_LIMITS = { maxEntries: 5000, maxBytes: 8 * 1024 * 1024, maxMs: 1500 };
export class LimitError extends Error {}
export const newBudget = (limits = DEFAULT_LIMITS) => ({ ...DEFAULT_LIMITS, ...limits, entries: 0, bytes: 0, deadline: Date.now() + (limits.maxMs ?? DEFAULT_LIMITS.maxMs) });

export function treeDigest(dir, skip = [], budget = newBudget()) {
  try {
    fs.lstatSync(dir);
  } catch {
    return "absent";
  }
  const check = () => {
    if (++budget.entries > budget.maxEntries) throw new LimitError(`more than ${budget.maxEntries} entries`);
    if (Date.now() > budget.deadline) throw new LimitError(`more than ${budget.maxMs} ms`);
  };
  const hash = createHash("sha256");
  const seen = new Set();
  const walk = (current, rel) => {
    const entries = [];
    try {
      const handle = fs.opendirSync(current);
      try {
        for (let entry = handle.readSync(); entry; entry = handle.readSync()) {
          check();
          entries.push(entry);
        }
      } finally {
        handle.closeSync();
      }
    } catch (error) {
      if (error instanceof LimitError) throw error;
      hash.update(`unreadable:${rel}\n`);
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const entry of entries) {
      const name = rel ? `${rel}/${entry.name}` : entry.name;
      if (skip.includes(name)) continue;
      const full = path.join(current, entry.name);
      let kind = entry.isDirectory() ? "d" : entry.isFile() ? "f" : "o";
      let size = 0;
      if (entry.isSymbolicLink()) {
        // The package follows links in the user configuration, so what a link
        // points to counts, not only where it points.
        let target = "?";
        try {
          target = fs.readlinkSync(full);
        } catch {
          // keep the placeholder
        }
        hash.update(`l:${name}:${target}\n`);
        try {
          const stat = fs.statSync(full);
          kind = stat.isDirectory() ? "d" : stat.isFile() ? "f" : "o";
          size = stat.size;
          if (kind === "d") {
            const real = fs.realpathSync(full);
            if (seen.has(real)) continue;
            seen.add(real);
          }
        } catch {
          hash.update(`dangling:${name}\n`);
          continue;
        }
      }
      if (kind === "d") {
        hash.update(`d:${name}\n`);
        walk(full, name);
      } else if (kind === "f") {
        if (!size) {
          try {
            size = fs.statSync(full).size;
          } catch {
            size = 0;
          }
        }
        budget.bytes += size;
        if (budget.bytes > budget.maxBytes) throw new LimitError(`more than ${budget.maxBytes} bytes`);
        hash.update(`f:${name}:`);
        try {
          hash.update(fs.readFileSync(full));
        } catch {
          hash.update("unreadable");
        }
        hash.update("\n");
      } else {
        hash.update(`other:${name}\n`);
      }
    }
  };
  try {
    seen.add(fs.realpathSync(dir));
  } catch {
    // no real path: the entry limit still bounds the walk
  }
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

// Every input of the package 2.6.1 that can change what it denies, for the key
// of a remembered verdict (read from its source, not guessed):
//  - the two package files (hash), the rulebook directory;
//  - the whole project config directory `.cc-safety-net/` of that directory
//    (rulebooks, rule list, policy); the package refuses links there, the hash
//    follows them anyway;
//  - the whole user config directory, minus `logs` and `compile-cache`, with
//    links followed: `CC_SAFETY_NET_HOME` resolved as the package does
//    (win32 `/c/..` form, relative to its working directory, the root), else
//    `HOME` or the OS home directory (the package takes HOME first); USERPROFILE
//    is added as a harmless superset;
//  - the environment: every `CC_SAFETY_NET_*` and legacy `SAFETY_NET_*` name,
//    and the variables the package consults for home and tool directories.
// Not covered: the Node compile cache of the package and the git configuration
// of the checkout, which the package also reads.
const USER_SKIP = ["logs", "compile-cache"];
const ENV_NAMES = [
  "AMP_SETTINGS_FILE", "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CONFIG_DIR", "CODEX_HOME", "COPILOT_CLI", "COPILOT_HOME",
  "CURSOR_DATA_DIR", "GEMINI_CLI_HOME", "GEMINI_CLI_SYSTEM_SETTINGS_PATH", "GROK_HOME", "HOME", "KIMI_CODE_HOME", "KIMI_SHARE_DIR",
  "NODE_ENV", "OPENCODE_CONFIG", "OPENCODE_CONFIG_DIR", "OPENCODE_DB", "PARALLEL", "PI_CODING_AGENT_DIR", "ProgramData", "TMPDIR",
  "XDG_CONFIG_HOME", "XDG_DATA_HOME", "USERPROFILE",
];
const packagePath = (value) => (process.platform === "win32" ? value.replace(/^\/([A-Za-z])(?:\/|$)/, "$1:/") : value);
export function userConfigDirs(root, env) {
  const dirs = new Set();
  if (env.CC_SAFETY_NET_HOME) dirs.add(path.resolve(root, packagePath(env.CC_SAFETY_NET_HOME)));
  let homedir;
  try {
    homedir = os.homedir();
  } catch {
    homedir = undefined;
  }
  for (const home of [env.HOME, env.USERPROFILE, homedir]) if (home) dirs.add(path.join(path.resolve(root, packagePath(home)), PROJECT_CONFIG));
  return [...dirs].sort();
}
const envNames = (env) => [...new Set([...ENV_NAMES, ...Object.keys(env).filter((name) => name.startsWith("CC_SAFETY_NET_") || name.startsWith("SAFETY_NET_"))])].sort();

// The key of the state, or a LimitError when the configuration is too large or
// too slow to describe within the limits (the caller then blocks).
function stateKey(root, rulebookDir, env, limits) {
  const bin = path.join(root, "node_modules", "cc-safety-net", "dist", "bin");
  const budget = newBudget(limits);
  const parts = [
    rulebookDir,
    fingerprint(path.join(bin, "cc-safety-net.js")),
    fingerprint(path.join(bin, "hook.js")),
    `project:${treeDigest(path.join(rulebookDir, PROJECT_CONFIG), [], budget)}`,
    ...userConfigDirs(root, env).map((dir) => `user:${dir}:${treeDigest(dir, USER_SKIP, budget)}`),
    ...envNames(env).map((name) => `env:${name}=${env[name] ?? "<unset>"}`),
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex");
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
const failure = (problem, hint) => ({ problem, hint });
function probe(root, rulebookDir, deadline, env, limits) {
  let key;
  try {
    key = stateKey(root, rulebookDir, env, limits);
  } catch (error) {
    if (!(error instanceof LimitError)) throw error;
    return failure(
      `the safety check cannot verify the configuration it depends on: .cc-safety-net under ${rulebookDir} or the user's .cc-safety-net is too large or too slow to read (${error.message}), for example a link to a big directory or file`,
      "Remove or shrink what the links in those directories point to, then retry",
    );
  }
  const dir = markDir();
  if (dir && hasVerdict(dir, key)) return null;
  for (const command of PROBES) {
    const left = deadline - Date.now();
    if (left <= 0) return failure("the control probe ran out of time");
    const event = JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", cwd: rulebookDir, tool_input: { command } });
    const run = runPackage(root, event, left, env);
    let decision;
    try {
      decision = JSON.parse(run.stdout || "{}").hookSpecificOutput?.permissionDecision;
    } catch {
      decision = undefined;
    }
    if (!(run.status === 0 && decision === "deny") && run.status !== 2) {
      return failure(`the control probe "${command}" was not denied (silent or stubbed package, or the project rulebook ${RULEBOOK.join("/")} in ${rulebookDir} is invalid)`);
    }
  }
  if (dir) {
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
export function decide({ root = defaultRoot(), input, timeoutMs = ANALYSIS_TIMEOUT_MS, env = process.env, limits }) {
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
      `${isCdToRoot(`cd "${root}"`, root) ? `Run exactly: cd "${root}" (nothing else in the command) to return to the project root, or ` : ""}leave the worktree with the worktree exit tool, or from the project root run: git -C <this directory> merge origin/main (or git -C <this directory> checkout origin/main -- .cc-safety-net)`,
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
  const refused = probe(root, rulebookDir, deadline, env, limits);
  if (refused) return unusable(refused.problem, refused.hint);

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
