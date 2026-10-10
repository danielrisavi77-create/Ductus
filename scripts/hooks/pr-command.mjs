// Shared parsing of `gh pr create` / `gh pr edit` commands for the Claude
// Code hooks in this directory.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export function readInput() {
  try {
    return JSON.parse(fs.readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}

export function prAction(command) {
  return command.match(/\bgh\s+pr\s+(create|edit)\b/)?.[1] ?? null;
}

// Returns the body text, or null when the command does not set one.
export function extractBody(command, cwd) {
  const file = command.match(/(?:--body-file|-F)[=\s]+(?:"([^"]+)"|'([^']+)'|(\S+))/);
  if (file) {
    const target = file[1] ?? file[2] ?? file[3];
    try {
      return fs.readFileSync(path.resolve(cwd, target), "utf8");
    } catch {
      // The file may be created earlier in the same command line.
      return null;
    }
  }

  const flag = command.match(/(?:--body|-b)[=\s]+/);
  if (!flag) return null;
  let body = command.slice(flag.index + flag[0].length);
  // Drop the opening quote, or the whole `"$(cat <<'EOF'` line of a heredoc.
  body = /^["']?\$\(/.test(body) ? body.slice(body.indexOf("\n") + 1) : body.replace(/^["']/, "");
  return body;
}

// Files the branch changes against origin/main, or null when that cannot be
// read. A rename is listed under both names.
export function changedFiles(cwd) {
  try {
    const out = execFileSync("git", ["diff", "--name-only", "--no-renames", "-z", "origin/main...HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split("\0").filter(Boolean);
  } catch {
    return null;
  }
}
