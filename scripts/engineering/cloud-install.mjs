#!/usr/bin/env node
// SessionStart hook for Claude Code cloud sessions (DAN-521, #1516). A cloud
// session starts from a fresh clone without node_modules, so the fail-closed
// safety hook (scripts/hooks/safety-net.mjs) blocks every Bash command until
// cc-safety-net is installed. This hook installs the locked dependencies
// before the first tool call, and only in the cloud (CLAUDE_CODE_REMOTE=true).
//
// It never weakens the safety hook: it only runs `pnpm install
// --frozen-lockfile`, and when that fails the safety hook keeps blocking.
// The hook itself always exits 0 (a failed install must not stop the session
// from starting); what happened goes to the session context on stdout.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { packageProblem } from "../hooks/safety-net.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const INSTALL_ARGS = Object.freeze(["install", "--frozen-lockfile"]);
// pnpm on PATH first; corepack ships with Node and runs the pinned packageManager.
export const INSTALLERS = Object.freeze([
  Object.freeze({ command: "pnpm", args: INSTALL_ARGS }),
  Object.freeze({ command: "corepack", args: Object.freeze(["pnpm", ...INSTALL_ARGS]) }),
]);
// Below the 600 s hook timeout in .claude/settings.json.
export const INSTALL_TIMEOUT_MS = 540_000;
const TAIL_LINES = 20;
const TAIL_CHARS = 2000;

/** Only the exact value Claude Code sets in its cloud sessions. */
export const isCloud = (env) => env.CLAUDE_CODE_REMOTE === "true";

function tail(text) {
  const lines = String(text ?? "").trimEnd().split(/\r?\n/).slice(-TAIL_LINES).join("\n");
  return lines.length > TAIL_CHARS ? lines.slice(-TAIL_CHARS) : lines;
}

function defaultRun(command, args, { root, env }) {
  return spawnSync(command, args, {
    cwd: root,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: INSTALL_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
}

/**
 * Decides and, when needed, runs the install. `problem(root)` is the safety
 * hook's own check, so "installed" means exactly what the safety hook needs.
 * Returns the text for the session context ("" when nothing was done).
 */
export function cloudInstall({ env, root = ROOT, problem = packageProblem, run = defaultRun }) {
  if (!isCloud(env)) return "";
  const before = problem(root);
  if (before === null) return "";
  const blocked = "The safety hook keeps blocking Bash and PowerShell until node_modules/cc-safety-net is complete; start a new session or ask the user to run pnpm install --frozen-lockfile.";
  for (const { command, args } of INSTALLERS) {
    const result = run(command, [...args], { root, env });
    if (result.error?.code === "ENOENT") continue;
    const after = problem(root);
    if (result.status === 0 && after === null) {
      return `Cloud session: ${before}; ran ${command} ${args.join(" ")} and the safety hook's package is now complete.`;
    }
    const why = result.error ? result.error.message : `exit status ${result.status ?? "none"}`;
    const output = tail(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
    return `Cloud session: ${command} ${args.join(" ")} did not complete the install (${why}${after ? `; ${after}` : ""}). ${blocked}${output ? `\n${output}` : ""}`;
  }
  return `Cloud session: ${before}, and neither pnpm nor corepack is on PATH. ${blocked}`;
}

function main() {
  try {
    const message = cloudInstall({ env: process.env });
    if (message) process.stdout.write(`${message}\n`);
  } catch (error) {
    process.stdout.write(`Cloud session install hook failed: ${error instanceof Error ? error.message : "unknown error"}. The safety hook still blocks until dependencies are installed.\n`);
  }
  process.exitCode = 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
