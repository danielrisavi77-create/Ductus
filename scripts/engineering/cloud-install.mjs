#!/usr/bin/env node
// SessionStart hook for Claude Code cloud sessions (DAN-521, #1516). A cloud
// session starts from a fresh clone without node_modules, so the fail-closed
// safety hook (scripts/hooks/safety-net.mjs) blocks every Bash command until
// cc-safety-net is installed. This hook installs the locked dependencies
// before the first tool call, and only in the cloud (CLAUDE_CODE_REMOTE=true).
//
// It never weakens the safety hook: when the install is skipped or fails, the
// safety hook keeps blocking. The hook itself always exits 0 (a failed install
// must not stop the session from starting); one line goes to the session
// context on stdout.
//
// F-214: the checkout may be a head the session reviews or tests, so nothing
// from it may run with the session's credentials. The install therefore
//   - runs only when every file pnpm reads to decide what to install is
//     byte-identical to origin/main (INSTALL_INPUTS), so it installs exactly
//     what main installs; otherwise it only prints the advice;
//   - never runs lifecycle scripts or the pnpmfile (--ignore-scripts,
//     --ignore-pnpmfile);
//   - gets an allowlisted environment without tokens or other credentials;
//   - reports success or failure only, never the installer's output.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { packageProblem } from "../hooks/safety-net.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const INSTALL_ARGS = Object.freeze(["install", "--frozen-lockfile", "--ignore-scripts", "--ignore-pnpmfile"]);
// pnpm on PATH first; corepack ships with Node and runs the pinned packageManager.
export const INSTALLERS = Object.freeze([
  Object.freeze({ command: "pnpm", args: INSTALL_ARGS }),
  Object.freeze({ command: "corepack", args: Object.freeze(["pnpm", ...INSTALL_ARGS]) }),
]);
// Below the 600 s hook timeout in .claude/settings.json.
export const INSTALL_TIMEOUT_MS = 540_000;
const GIT_TIMEOUT_MS = 20_000;
const LEFTHOOK_BIN = path.join("node_modules", "lefthook", "bin", "index.js");
export const BASE_REF = "refs/remotes/origin/main";
// What pnpm and corepack read in the repo root to decide what gets installed
// and how. A file missing on both sides counts as identical.
export const INSTALL_INPUTS = Object.freeze([
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  ".npmrc",
  ".pnpmfile.cjs",
  ".pnpmfile.mjs",
]);
// Only what pnpm needs to find itself, the network and a temp dir. No token,
// secret, password or other credential reaches the installer.
const ENV_ALLOW = new Set([
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "TERM", "TMPDIR", "TMP", "TEMP",
  "CI", "PNPM_HOME", "COREPACK_HOME", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR",
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy",
  "SYSTEMROOT", "COMSPEC", "PATHEXT", "APPDATA", "LOCALAPPDATA", "USERPROFILE",
]);
const ENV_ALLOW_PREFIX = /^(?:LC_|XDG_)/;
const CREDENTIAL = /TOKEN|SECRET|PASSW|CREDENTIAL|API_?KEY|PRIVATE|AUTH/i;
const ADVICE = "The safety hook keeps blocking Bash and PowerShell until node_modules/cc-safety-net is complete. Run pnpm install --frozen-lockfile only on main or on a branch this session writes, never on a head it reviews or tests.";

/** Only the exact value Claude Code sets in its cloud sessions. */
export const isCloud = (env) => env.CLAUDE_CODE_REMOTE === "true";

/** The allowlisted environment for git and the installer. */
export function installEnv(env) {
  return Object.fromEntries(
    Object.entries(env).filter(([name, value]) =>
      typeof value === "string" && (ENV_ALLOW.has(name) || ENV_ALLOW_PREFIX.test(name)) && !CREDENTIAL.test(name)),
  );
}

function defaultRun(command, args, { root, env, timeout = INSTALL_TIMEOUT_MS, capture = false }) {
  return spawnSync(command, args, {
    cwd: root,
    env,
    encoding: capture ? "buffer" : "utf8",
    stdio: ["ignore", capture ? "pipe" : "ignore", "ignore"],
    timeout,
    maxBuffer: 64 * 1024 * 1024,
  });
}

function defaultReadFile(file) {
  try {
    return fs.readFileSync(file);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Why the checkout may not be installed, or null when every install input is
 * byte-identical to origin/main. Reads blobs with git cat-file, which runs no
 * filter or textconv.
 */
export function installInputsProblem({ root, env, run = defaultRun, readFile = defaultReadFile, inputs = INSTALL_INPUTS }) {
  const git = (args) => run("git", args, { root, env, timeout: GIT_TIMEOUT_MS, capture: true });
  const base = git(["rev-parse", "--verify", "--quiet", `${BASE_REF}^{commit}`]);
  if (base.status !== 0) return `${BASE_REF} is not available`;
  for (const name of inputs) {
    const local = readFile(path.join(root, name));
    const exists = git(["cat-file", "-e", `${BASE_REF}:${name}`]).status === 0;
    if (!exists) {
      if (local !== null) return `${name} is not on origin/main`;
      continue;
    }
    if (local === null) return `${name} is missing in this checkout`;
    const blob = git(["cat-file", "blob", `${BASE_REF}:${name}`]);
    if (blob.status !== 0 || !Buffer.isBuffer(blob.stdout)) return `${name} could not be read from origin/main`;
    if (!blob.stdout.equals(local)) return `${name} differs from origin/main`;
  }
  return null;
}

/**
 * --ignore-scripts also skips the root `prepare` (lefthook install), so the
 * git hooks are installed here, with the installed lefthook, and only when
 * lefthook.yml is byte-identical to origin/main as well.
 */
export function gitHooks({ root, env, run = defaultRun, readFile = defaultReadFile }) {
  const why = installInputsProblem({ root, env, run, readFile, inputs: ["lefthook.yml"] });
  if (why !== null) return `Git hooks not installed because ${why}; run pnpm exec lefthook install on your own branch.`;
  const result = run(process.execPath, [path.join(root, LEFTHOOK_BIN), "install"], { root, env, timeout: GIT_TIMEOUT_MS });
  return result.status === 0 ? "Git hooks installed." : "Git hooks could not be installed; run pnpm exec lefthook install.";
}

/**
 * Decides and, when allowed, runs the install. `problem(root)` is the safety
 * hook's own check, so "installed" means exactly what the safety hook needs.
 * Returns the text for the session context ("" when nothing was needed).
 */
export function cloudInstall({ env, root = ROOT, problem = packageProblem, run = defaultRun, readFile = defaultReadFile }) {
  if (!isCloud(env)) return "";
  const before = problem(root);
  if (before === null) return "";
  const clean = installEnv(env);
  const untrusted = installInputsProblem({ root, env: clean, run, readFile });
  if (untrusted !== null) return `Cloud session: ${before}; not installing because ${untrusted}. ${ADVICE}`;
  for (const { command, args } of INSTALLERS) {
    const result = run(command, [...args], { root, env: clean });
    if (result.error?.code === "ENOENT") continue;
    const after = problem(root);
    if (result.status === 0 && after === null) {
      return `Cloud session: ${before}; the locked install (${command}, no scripts) succeeded and the safety hook's package is now complete. ${gitHooks({ root, env: clean, run, readFile })}`;
    }
    return `Cloud session: the locked install (${command}) failed. ${ADVICE}`;
  }
  return `Cloud session: ${before}, and neither pnpm nor corepack is on PATH. ${ADVICE}`;
}

function main() {
  try {
    const message = cloudInstall({ env: process.env });
    if (message) process.stdout.write(`${message}\n`);
  } catch {
    process.stdout.write("Cloud session install hook failed. The safety hook still blocks until dependencies are installed.\n");
  }
  process.exitCode = 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
