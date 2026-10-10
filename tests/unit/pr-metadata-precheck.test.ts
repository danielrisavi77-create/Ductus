import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const script = fileURLToPath(
  new URL("../../scripts/hooks/pr-metadata-precheck.mjs", import.meta.url),
);
// A directory outside any git repository, so no changed files raise the
// minimum risk and the tests depend only on the body. Git hooks export
// GIT_DIR and friends, which would point git back at this repository.
const cwd = mkdtempSync(join(tmpdir(), "pr-precheck-"));
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
) as NodeJS.ProcessEnv;

function run(command: string) {
  return spawnSync(process.execPath, [script], {
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command }, cwd }),
    encoding: "utf8",
    env,
  });
}

const heredoc = (agent: string) =>
  [
    'gh pr create --base main --title "chore: x" --body "$(cat <<\'EOF\'',
    "## Engineering metadata",
    "",
    `Agent: ${agent}`,
    "Risk: low",
    "Task: DAN-1",
    "EOF",
    ')"',
  ].join("\n");

// Each case starts a Node process; the default 5 s is tight on a loaded machine.
describe("pr-metadata-precheck hook", { timeout: 30_000 }, () => {
  it("ignores commands that do not create or edit a PR", () => {
    expect(run("git status").status).toBe(0);
    expect(run("gh pr view 12").status).toBe(0);
  });

  it("passes a heredoc body with valid metadata", () => {
    expect(run(heredoc("claude:desktop:platforma")).status).toBe(0);
  });

  it("blocks an unknown role and names the problem", () => {
    const result = run(heredoc("claude:desktop:platform"));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Agent");
  });

  it("blocks metadata that only appears inside a code block", () => {
    const command = [
      'gh pr create --title "x" --body "$(cat <<\'EOF\'',
      "```",
      "Agent: claude:a:backend",
      "Risk: low",
      "Task: DAN-1",
      "```",
      "EOF",
      ')"',
    ].join("\n");
    expect(run(command).status).toBe(2);
  });

  it("checks an inline body on the command line", () => {
    const ok = 'gh pr create --title "x" --body "Agent: codex:a:backend\nRisk: low\nTask: DAN-2"';
    expect(run(ok).status).toBe(0);
    expect(run('gh pr create --title "x" --body "no metadata"').status).toBe(2);
  });

  it("blocks gh pr create without any body", () => {
    expect(run("gh pr create --fill").status).toBe(2);
  });

  it("reads --body-file and leaves a missing file to CI", () => {
    const file = join(cwd, "body.md");
    writeFileSync(file, "Agent: claude:a:qa\nRisk: low\nTask: DAN-3\n");
    expect(run(`gh pr create --title "x" --body-file "${file}"`).status).toBe(0);
    writeFileSync(file, "Risk: low\nTask: DAN-3\n");
    expect(run(`gh pr edit 5 --body-file "${file}"`).status).toBe(2);
    expect(run('gh pr create --title "x" --body-file missing.md').status).toBe(0);
  });

  it("lets gh pr edit through when the body is untouched", () => {
    expect(run('gh pr edit 5 --title "new title"').status).toBe(0);
  });
});
