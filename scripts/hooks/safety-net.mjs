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
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Must stay below the 10 s `timeout` of the hook in .claude/settings.json: an
// expiry left to the harness is fail-open.
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

// Returns null when the installed package is usable, else the reason.
export function packageProblem(root) {
  const dir = path.join(root, "node_modules", "cc-safety-net");
  const bin = path.join(dir, "dist", "bin", "cc-safety-net.js");
  try {
    if (fs.statSync(bin).size === 0) return "the cc-safety-net binary is an empty file";
  } catch {
    return "cc-safety-net is not installed (node_modules/cc-safety-net/dist/bin/cc-safety-net.js is missing)";
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

// Pure decision: { code, stdout, stderr }. `input` is the raw hook stdin.
export function decide({ root = defaultRoot(), input, timeoutMs = ANALYSIS_TIMEOUT_MS }) {
  const problem = packageProblem(root);
  if (problem) {
    let command;
    try {
      command = JSON.parse(input).tool_input?.command;
    } catch {
      command = undefined;
    }
    if (isInstallCommand(command)) return { code: 0, stdout: "", stderr: "" };
    return { code: 2, stdout: "", stderr: `Safety hook blocked this command: ${problem}. ${RECOVERY}\n` };
  }

  const bin = path.join(root, "node_modules", "cc-safety-net", "dist", "bin", "cc-safety-net.js");
  const run = spawnSync(process.execPath, [bin, "hook", "--coding-cli"], {
    input,
    encoding: "utf8",
    timeout: timeoutMs,
    killSignal: "SIGKILL",
    cwd: root,
    maxBuffer: 4 * 1024 * 1024,
  });
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
  }
  return { code: 0, stdout, stderr };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let input = "";
  try {
    input = fs.readFileSync(0, "utf8");
  } catch {
    // An unreadable stdin is handled by the decision: no command, not an install.
  }
  let result;
  try {
    result = decide({ input });
  } catch (error) {
    result = { code: 2, stdout: "", stderr: `Safety hook blocked this command: wrapper error (${error?.message}). ${RECOVERY}\n` };
  }
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.code;
}
