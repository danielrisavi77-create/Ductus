// F-176: scripts/codex-review.ps1 treats the branch under review as untrusted.
// The script needs Codex and a network, so these checks read its source; the
// order checks keep each guard before the Codex call or before the post.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { D97_PATHS, ownerCommandPaths } from "./protected-paths.mjs";

const src = readFileSync(new URL("../codex-review.ps1", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const codexCall = src.search(/^[ \t]*codex exec review/m);
const post = src.indexOf("Review saved, not posted");
const at = (needle) => {
  const i = src.indexOf(needle);
  assert.notEqual(i, -1, `missing: ${needle}`);
  return i;
};

test("Codex runs read-only with no approval prompts, overriding the user config", () => {
  const line = src.slice(codexCall, src.indexOf("\n", codexCall));
  assert.match(line, /-c 'sandbox_mode="read-only"'/);
  assert.match(line, /-c 'approval_policy="never"'/);
  assert.doesNotMatch(line, /danger-full-access|workspace-write|--full-auto|--dangerously/);
  const calls = src.split("\n").filter((l) => /^[ \t]*codex\s/.test(l));
  assert.equal(calls.length, 1, "exactly one Codex call");
});

test("GitHub tokens are removed from the environment around the Codex call and restored after", () => {
  for (const name of ["GH_TOKEN", "GITHUB_TOKEN", "OWNER_COMMAND_TOKEN"]) assert.ok(src.includes(`'${name}'`), name);
  // Remove-Item, not SetEnvironmentVariable($null): pwsh on Linux leaves an empty variable.
  assert.ok(at('Remove-Item -LiteralPath "Env:$name"') < codexCall);
  const restore = at("} finally {");
  assert.ok(restore > codexCall && restore < post);
});

test("only main's copy runs, and a branch that changes agent instructions is refused, before Codex", () => {
  assert.ok(at("git show origin/main:scripts/codex-review.ps1") < codexCall);
  assert.ok(at("$PSCommandPath") < codexCall);
  assert.ok(at("differs from origin/main") < codexCall);
  const instructions = at("changes agent instructions");
  assert.ok(instructions < codexCall);
  const re = /\$_ -match '([^']+)' -or \$_ -match '([^']+)'/.exec(src);
  assert.ok(re, "instruction pattern");
  const [agentRe, codexDir] = [new RegExp(re[1].replace("(?i)", ""), "i"), new RegExp(re[2].replace("(?i)", ""), "i")];
  for (const p of ["AGENTS.md", "src/AGENTS.override.md", "CLAUDE.md", "docs/CLAUDE.local.md", "GEMINI.md", ".github/copilot-instructions.md", "x/y.instructions.md"]) {
    assert.ok(agentRe.test(p), p);
  }
  for (const p of [".codex/config.toml", "a/.codex/x", ".claude/uloge/reviewer.md", ".agents/skills/ductus-review/SKILL.md", "x/.claude/settings.json", ".mcp.json", "a/.mcp.json"]) {
    assert.ok(codexDir.test(p), p);
  }
  for (const p of ["src/agents/list.ts", "docs/PRODUCT.md", "README.md", "src/claude.ts", "docs/x.mcp.json.md"]) assert.ok(!agentRe.test(p) && !codexDir.test(p), p);
});

test("changed names are read unquoted and NUL-separated, so a non-ASCII control path is still refused (F-176-QA-01)", () => {
  const line = src.split("\n").find((l) => l.includes("diff --name-only"));
  assert.match(line, /git -c core\.quotePath=false diff --name-only -z origin\/main\.\.\.HEAD/);
  assert.ok(src.includes(`$_.StartsWith('"')`), "a quoted name is refused");
  const re = /\$_ -match '([^']+)' -or \$_ -match '([^']+)'/.exec(src);
  const patterns = [new RegExp(re[1].replace("(?i)", ""), "i"), new RegExp(re[2].replace("(?i)", ""), "i")];
  const dir = mkdtempSync(path.join(tmpdir(), "codex-review-names-"));
  try {
    const git = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
    git("init", "-q");
    const file = path.join(dir, ".agents", "skills", "qa-é", "SKILL.md");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "synthetic\n");
    git("add", "--", ".agents");
    const quoted = git("diff", "--cached", "--name-only").trim();
    assert.ok(quoted.startsWith('"'), "control: git quotes the name by default");
    const names = git("-c", "core.quotePath=false", "diff", "--cached", "--name-only", "-z").split("\0").filter(Boolean);
    assert.equal(names.length, 1);
    assert.ok(patterns.some((p) => p.test(names[0])), names[0]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a document that AGENTS.md or CLAUDE.md names as reading is refused too (Codex r4433772598)", () => {
  const block = src.slice(at("$entryDocs = @(foreach ($entry in 'AGENTS.md', 'CLAUDE.md')"), codexCall);
  assert.ok(block.includes('git show "origin/main:$entry"'), "the list comes from main");
  assert.ok(block.includes("could not be read; refusing to run"), "an unreadable entry file stops the run");
  assert.ok(block.includes("[regex]::Matches($text, '`([A-Za-z0-9_./-]+\\.md)`')"), "named documents pattern");
  assert.ok(block.includes("$instructions += @($changed | Where-Object { $entryDocs -contains $_ })"));
  assert.ok(at("$instructions += ") < at("if ($instructions.Count -gt 0)"), "added before the refusal");
  const named = new Set();
  for (const entry of ["AGENTS.md", "CLAUDE.md"]) {
    const text = readFileSync(new URL(`../../${entry}`, import.meta.url), "utf8");
    for (const m of text.matchAll(/`([A-Za-z0-9_./-]+\.md)`/g)) named.add(m[1]);
  }
  for (const p of ["STATE.md", "docs/ENGINEERING_SYSTEM-SAZETAK.md", "docs/ENGINEERING_SYSTEM.md", "docs/SESSIONS.md"]) assert.ok(named.has(p), p);
});

test("a review that looks like it carries a credential is never posted", () => {
  const check = at("looks like it contains a credential");
  assert.ok(check > codexCall && check < post);
  const pattern = /\$secretRe = '([^']+)'/.exec(src)?.[1];
  assert.ok(pattern);
  const secretRe = new RegExp(pattern.replace("(?i)", ""), "i");
  for (const leak of [`ghp_${"a".repeat(36)}`, `github_pat_${"b".repeat(30)}`, `sk-${"c".repeat(30)}`, `eyJ${"d".repeat(20)}.${"e".repeat(20)}`, '"refresh_token": "x"', "access_token=x"]) {
    assert.ok(secretRe.test(leak), leak);
  }
  for (const fine of ["Review-Verdict: PASS", "token budget", "src/server/auth/session.ts:12"]) assert.ok(!secretRe.test(fine), fine);
});

// F-182: run main's copy end to end in a throwaway repository with a fake
// codex and a fake gh on PATH. The fake codex records what it was started
// with; the fake gh records any call.
test("Codex runs with its own minimal CODEX_HOME and the script never posts (F-182)", () => {
  const root = mkdtempSync(path.join(tmpdir(), "codex-review-run-"));
  try {
    const sh = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
    const origin = path.join(root, "origin.git");
    const work = path.join(root, "work");
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
    execFileSync("git", ["clone", "-q", origin, work]);
    sh(work, "symbolic-ref", "HEAD", "refs/heads/main");
    for (const [k, v] of [["user.email", "t@example.invalid"], ["user.name", "t"], ["core.autocrlf", "false"]]) sh(work, "config", k, v);
    const script = readFileSync(new URL("../codex-review.ps1", import.meta.url));
    mkdirSync(path.join(work, "scripts"));
    writeFileSync(path.join(work, "scripts", "codex-review.ps1"), script);
    writeFileSync(path.join(work, "AGENTS.md"), "synthetic\n");
    writeFileSync(path.join(work, "CLAUDE.md"), "synthetic\n");
    sh(work, "add", "--", ".");
    sh(work, "commit", "-q", "-m", "main");
    sh(work, "push", "-q", "origin", "main");
    sh(work, "checkout", "-q", "-b", "feature");
    mkdirSync(path.join(work, "src"));
    writeFileSync(path.join(work, "src", "x.ts"), "export const x = 1;\n");
    sh(work, "add", "--", "src");
    sh(work, "commit", "-q", "-m", "feature");
    const copy = path.join(root, "codex-review.ps1");
    writeFileSync(copy, script);

    // The owner's home is user/.codex, reached through CODEX_HOME or, without
    // it, through $HOME (HOME on Linux and macOS, USERPROFILE on Windows).
    const userDir = path.join(root, "user");
    const ownerHome = path.join(userDir, ".codex");
    mkdirSync(ownerHome, { recursive: true });
    writeFileSync(path.join(ownerHome, "auth.json"), '{"synthetic":true}\n');
    writeFileSync(path.join(ownerHome, "config.toml"), 'sandbox_mode = "danger-full-access"\n[mcp_servers.node_repl]\ncommand = "node"\n');
    writeFileSync(path.join(ownerHome, "AGENTS.md"), "owner instructions\n");
    mkdirSync(path.join(ownerHome, "plugins"));

    const bin = path.join(root, "bin");
    mkdirSync(bin);
    const record = path.join(root, "codex-record.json");
    const ghCalls = path.join(root, "gh-calls.txt");
    writeFileSync(path.join(bin, "fake-codex.mjs"), [
      'import { readdirSync, readFileSync, writeFileSync } from "node:fs";',
      'import path from "node:path";',
      "const args = process.argv.slice(2);",
      "const home = process.env.CODEX_HOME;",
      `writeFileSync(${JSON.stringify(record)}, JSON.stringify({ args, home, files: readdirSync(home).sort(), config: readFileSync(path.join(home, "config.toml"), "utf8"), auth: readFileSync(path.join(home, "auth.json"), "utf8"), gh: process.env.GH_TOKEN ?? null }));`,
      'writeFileSync(args[args.indexOf("-o") + 1], "No findings.\\n");',
    ].join("\n"));
    writeFileSync(path.join(bin, "fake-gh.mjs"), `import { appendFileSync } from "node:fs"; appendFileSync(${JSON.stringify(ghCalls)}, process.argv.slice(2).join(" ") + "\\n");`);
    for (const name of ["codex", "gh"]) {
      writeFileSync(path.join(bin, `${name}.cmd`), `@node "%~dp0fake-${name}.mjs" %*\r\n`);
      writeFileSync(path.join(bin, name), `#!/bin/sh\nexec node "$(dirname "$0")/fake-${name}.mjs" "$@"\n`, { mode: 0o755 });
    }

    const shell = process.platform === "win32" ? "powershell" : "pwsh";
    try {
      execFileSync(shell, ["-NoProfile", "-Command", "exit 0"]);
    } catch (error) {
      assert.fail(`this test needs PowerShell (${shell}) on PATH, see README.md: ${error.message}`);
    }
    const base = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, GH_TOKEN: "synthetic-token" };
    const withoutCodexHome = { ...base, HOME: userDir, USERPROFILE: userDir };
    delete withoutCodexHome.CODEX_HOME;
    for (const env of [{ ...base, CODEX_HOME: ownerHome }, withoutCodexHome]) {
      rmSync(record, { force: true });
      const stdout = execFileSync(shell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", copy, "-Level", "standard", "-Pr", "7"], { cwd: work, env, encoding: "utf8" });

      const seen = JSON.parse(readFileSync(record, "utf8"));
      assert.notEqual(path.resolve(seen.home), path.resolve(ownerHome), "not the owner's Codex home");
      assert.deepEqual(seen.files, ["auth.json", "config.toml"], "only the login file and the minimal config");
      assert.equal(seen.auth, '{"synthetic":true}\n', "the login file comes from the owner home of this run");
      assert.equal(seen.config.replaceAll("\r\n", "\n"), 'sandbox_mode = "read-only"\napproval_policy = "never"\n');
      assert.equal(seen.gh, null, "no GitHub token in the Codex environment");
      // Windows PowerShell 5.1 drops the inner quotes of a native argument; Codex
      // reads a bare value that is not TOML as a string, so both forms are read-only.
      assert.ok(seen.args.includes("--ignore-user-config"));
      assert.ok(seen.args.some((a) => /^sandbox_mode="?read-only"?$/.test(a)), seen.args.join(' '));
      assert.throws(() => readFileSync(ghCalls), "gh is never called");
      assert.throws(() => readdirSync(seen.home), "the review home is removed");
      assert.match(stdout, /Review saved, not posted: /);
      assert.match(stdout, /No findings\./);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the review scripts are D-97 paths", () => {
  for (const p of ["scripts/codex-review.ps1", "scripts/grok-review.ps1"]) {
    assert.ok(D97_PATHS.includes(p), p);
    assert.deepEqual(ownerCommandPaths([p]), [p]);
  }
});
