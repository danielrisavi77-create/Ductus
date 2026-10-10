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
// One built-in rule and one project rule; a working package denies both.
export const PROBES = ["git push --force origin ductus-probe", "git add -A"];

const fingerprint = (file) => {
  try {
    const stat = fs.statSync(file);
    return `${stat.size}:${stat.mtimeMs}`;
  } catch {
    return "absent";
  }
};

// A package that exits 0 and prints nothing is also what an emptied or stubbed
// hook.js does, so silence alone proves nothing. The control probe asks it
// about commands it must deny. The verdict is remembered per package and
// rulebook state (size and mtime), so the extra runs happen once, not per call.
function probeMark(root) {
  const bin = path.join(root, "node_modules", "cc-safety-net", "dist", "bin");
  const key = createHash("sha256")
    .update([root, fingerprint(path.join(bin, "cc-safety-net.js")), fingerprint(path.join(bin, "hook.js")), fingerprint(path.join(root, ...RULEBOOK))].join("|"))
    .digest("hex");
  return path.join(os.tmpdir(), "ductus-safety-net-probe", key);
}

function runPackage(root, input, timeout) {
  const bin = path.join(root, "node_modules", "cc-safety-net", "dist", "bin", "cc-safety-net.js");
  return spawnSync(process.execPath, [bin, "hook", "--coding-cli"], {
    input,
    encoding: "utf8",
    timeout,
    killSignal: "SIGKILL",
    cwd: root,
    maxBuffer: 4 * 1024 * 1024,
  });
}

function probe(root, deadline) {
  const mark = probeMark(root);
  if (fs.existsSync(mark)) return null;
  for (const command of PROBES) {
    const left = deadline - Date.now();
    if (left <= 0) return "the control probe ran out of time";
    const event = JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", cwd: root, tool_input: { command } });
    const run = runPackage(root, event, left);
    let decision;
    try {
      decision = JSON.parse(run.stdout || "{}").hookSpecificOutput?.permissionDecision;
    } catch {
      decision = undefined;
    }
    if (!(run.status === 0 && decision === "deny") && run.status !== 2) {
      return `the control probe "${command}" was not denied (silent or stubbed package, or the project rulebook ${RULEBOOK.join("/")} is missing or invalid)`;
    }
  }
  try {
    fs.mkdirSync(path.dirname(mark), { recursive: true });
    fs.writeFileSync(mark, "ok");
  } catch {
    // Not remembered: the probe simply runs again next time.
  }
  return null;
}

const blockedFor = (problem) => ({ code: 2, stdout: "", stderr: `Safety hook blocked this command: ${problem}. ${RECOVERY}\n` });

function commandOf(input) {
  try {
    return JSON.parse(input).tool_input?.command;
  } catch {
    return undefined;
  }
}

// Pure decision: { code, stdout, stderr }. `input` is the raw hook stdin.
export function decide({ root = defaultRoot(), input, timeoutMs = ANALYSIS_TIMEOUT_MS }) {
  const deadline = Date.now() + timeoutMs;
  // The exact install command is the way out of an unusable package.
  const unusable = (problem) => (isInstallCommand(commandOf(input)) ? { code: 0, stdout: "", stderr: "" } : blockedFor(problem));
  const problem = packageProblem(root);
  if (problem) return unusable(problem);

  const run = runPackage(root, input, timeoutMs);
  const stdout = run.stdout ?? "";
  const stderr = run.stderr ?? "";
  const failed = (why) => ({ code: 2, stdout: "", stderr: `Safety hook blocked this command: cc-safety-net ${why}. ${RECOVERY}\n${stderr}` });
  if (run.error) return failed(run.error.code === "ETIMEDOUT" ? `did not answer within ${timeoutMs} ms` : `could not run (${run.error.message})`);
  if (run.signal) return failed(`was killed by ${run.signal}`);
  if (run.status === 2) return { code: 2, stdout, stderr };
  if (run.status !== 0) return failed(`exited with status ${run.status}`);
  if (stdout.trim()) {
    try {
      JSON.parse(stdout);
    } catch {
      return failed("returned output that is not JSON");
    }
    return { code: 0, stdout, stderr };
  }
  const probeProblem = probe(root, deadline);
  if (probeProblem) return unusable(probeProblem);
  return { code: 0, stdout, stderr };
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
