import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const script = fileURLToPath(
  new URL("../../scripts/hooks/pr-metadata-precheck.mjs", import.meta.url),
);
// A directory outside any git repository, where the changed files cannot be
// read. Git hooks export GIT_DIR and friends, which would point git back at
// this repository.
const cwd = mkdtempSync(join(tmpdir(), "pr-precheck-"));
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
) as NodeJS.ProcessEnv;

function runIn(command: string, dir: string, childEnv = env) {
  return spawnSync(process.execPath, [script], {
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command }, cwd: dir }),
    encoding: "utf8",
    env: childEnv,
  });
}

// A docs-only branch: the changed files are readable and raise no floor.
// Outside a repository the hook blocks instead (DAN-137).
const run = (command: string) => runIn(command, docsOnly);

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

  // DAN-481: relevant shapes still get the full check (a bad Agent line blocks).
  const bad = "Agent: claude:desktop:platform\nRisk: low\nTask: DAN-1";
  it.each([
    ["extra spaces", `gh   pr  create --title x --body "${bad}"`],
    ["gh.exe path", `"C:\\Program Files\\GitHub CLI\\gh.exe" pr create --title x --body "${bad}"`],
    ["chained command", `cd docs && git status && gh pr create --title x --body "${bad}"`],
    ["PowerShell form", `& 'C:\\gh\\gh.exe' pr create --title x --body "${bad}"; echo done`],
  ])("still runs the full check for %s", (_name, command) => {
    expect(run(command).status).toBe(2);
  });

  it("exits 0 at once for commands that are neither gh pr nor git push", () => {
    for (const command of ["ls -la", "pnpm test", "echo gh", "git status", ""]) {
      expect(run(command).status).toBe(0);
    }
    // Outside a repository a PR command would block (DAN-137); these never reach that.
    expect(runIn("pnpm lint", cwd).status).toBe(0);
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

  it("blocks when the changed files cannot be read, with a clear message", () => {
    const result = spawnSync(process.execPath, [script], {
      input: JSON.stringify({ tool_name: "Bash", tool_input: { command: heredoc("claude:desktop:platforma") }, cwd }),
      encoding: "utf8",
      env,
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("could not read the changed files");
  });

  it("lets gh pr edit through when the body is untouched", () => {
    expect(run('gh pr edit 5 --title "new title"').status).toBe(0);
  });
});

const autoMerge = fileURLToPath(new URL("../../scripts/hooks/pr-auto-merge.mjs", import.meta.url));

// A repository whose branch changes exactly `files` against origin/main.
function branchChanging(...files: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "pr-automerge-"));
  const git = (...args: string[]) => {
    const identity = ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false"];
    const done = spawnSync("git", [...identity, ...args], { cwd: dir, env, encoding: "utf8" });
    if (done.status !== 0) throw new Error(`git ${args[0]}: ${done.stderr}`);
  };
  const commit = (paths: string[], message: string) => {
    for (const path of paths) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), `${message}\n`);
      git("add", "--", path);
    }
    git("commit", "-q", "-m", message);
  };
  git("init", "-q");
  commit(["README.md", "scripts/hooks/old.mjs"], "base");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  commit(files, "change");
  return dir;
}

const docsOnly = branchChanging("docs/notes.md");

function decide(command: string, stdout: string, dir = docsOnly, childEnv = env) {
  const result = spawnSync(process.execPath, [autoMerge, "--dry-run"], {
    input: JSON.stringify({ tool_input: { command }, tool_response: { stdout }, cwd: dir }),
    encoding: "utf8",
    env: childEnv,
  });
  return result.stdout.trim();
}

describe("pr-auto-merge hook", { timeout: 30_000 }, () => {
  const url = "https://github.com/example/repo/pull/7";
  const create = (risk: string) =>
    `gh pr create --title "x" --body "Agent: claude:a:platforma\nRisk: ${risk}\nTask: DAN-1"`;

  it("selects a newly created low-risk PR", () => {
    expect(decide(create("low"), `${url}\n`)).toBe(url);
  });

  it("leaves standard and critical PRs alone", () => {
    expect(decide(create("standard"), url)).toBe("");
    expect(decide(create("critical"), url)).toBe("");
  });

  it("does nothing for commands that cannot create a PR (DAN-481)", () => {
    expect(decide("pnpm test", url)).toBe("");
    expect(decide("git status", url)).toBe("");
  });

  it("still selects a low-risk create in a chained or spaced command", () => {
    expect(decide(`cd . && gh   pr create --title "x" --body "Agent: claude:a:platforma\nRisk: low\nTask: DAN-1"`, url)).toBe(url);
  });

  it("does nothing when no PR was created", () => {
    expect(decide(create("low"), "pull request create failed")).toBe("");
    expect(decide('gh pr edit 7 --body "Risk: low"', url)).toBe("");
    expect(decide("gh pr view 7", url)).toBe("");
  });

  // One case per file: each builds a repository, and a shared time budget is tight on a loaded machine.
  it.each([
    ".github/workflows/ci.yml",
    "scripts/engineering/review-gate.mjs",
    "scripts/orchestrator/pr-ready.mjs",
    ".claude/skills/x/SKILL.md",
    ".agents/skills/x/SKILL.md",
    "docs/SESSIONS.md",
    "docs/DECISIONS.md",
    "tests/unit/codeowners.test.ts",
    "STATE.md",
    "src/domain/document/index.ts",
  ])("leaves a PR alone when %s puts the floor above the declared low", (file) => {
    expect(decide(create("low"), url, branchChanging("docs/notes.md", file))).toBe("");
  });

  it("counts a file moved out of a protected directory under its old name", () => {
    const dir = branchChanging("docs/notes.md");
    const git = (...args: string[]) => spawnSync("git", args, { cwd: dir, env, encoding: "utf8" }).status;
    expect(git("mv", "scripts/hooks/old.mjs", "docs/old.md")).toBe(0);
    expect(git("-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "move")).toBe(0);
    expect(decide(create("low"), url, dir)).toBe("");
  });

  // The list of changed files must not depend on the directory the session runs in or on
  // git settings that narrow a diff to it (a class of silent truncation, DAN-137).
  describe("from a subdirectory with a setting that narrows the diff to it", () => {
    const protectedChange = () => {
      const dir = branchChanging("docs/notes.md", ".github/workflows/ci.yml");
      return { dir, sub: join(dir, "docs") };
    };
    const low = () => `gh pr create --title "x" --body "Agent: claude:a:platforma\nRisk: low\nTask: DAN-1"`;
    const git = (dir: string, ...args: string[]) => spawnSync("git", args, { cwd: dir, env, encoding: "utf8" });

    it("keeps the full list when the repository sets diff.relative", () => {
      const { dir, sub } = protectedChange();
      expect(git(dir, "config", "diff.relative", "true").status).toBe(0);
      expect(runIn(low(), sub).status).toBe(2);
      expect(decide(low(), url, sub)).toBe("");
    });

    it("keeps the full list when the user config sets it", () => {
      const { sub } = protectedChange();
      const globalConfig = join(mkdtempSync(join(tmpdir(), "pr-gitconfig-")), "config");
      writeFileSync(globalConfig, "[diff]\n\trelative = true\n");
      const childEnv = { ...env, GIT_CONFIG_GLOBAL: globalConfig } as NodeJS.ProcessEnv;
      expect(runIn(low(), sub, childEnv).status).toBe(2);
      expect(decide(low(), url, sub, childEnv)).toBe("");
    });

    it("still selects a docs-only branch from a subdirectory", () => {
      const dir = branchChanging("docs/notes.md");
      expect(git(dir, "config", "diff.relative", "true").status).toBe(0);
      expect(decide(low(), url, join(dir, "docs"))).toBe(url);
    });
  });

  it("leaves a PR alone when the changed files cannot be read", () => {
    expect(decide(create("low"), url, cwd)).toBe("");
  });

  it("leaves a PR alone when its metadata is not valid", () => {
    expect(decide('gh pr create --title "x" --body "Risk: low\nTask: DAN-1"', url)).toBe("");
    expect(decide('gh pr create --title "x" --body "Agent: claude:a:nobody\nRisk: low\nTask: DAN-1"', url)).toBe("");
    expect(decide('gh pr create --title "x" --body-file missing.md', url)).toBe("");
  });
});
