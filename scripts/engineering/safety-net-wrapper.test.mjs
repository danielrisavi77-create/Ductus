import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { decide, isInstallCommand, runCli } from "../hooks/safety-net.mjs";

// DAN-137: the cc-safety-net PreToolUse hook must fail closed. Trees are built
// in temporary directories; the real node_modules is never touched.
const repo = fileURLToPath(new URL("../../", import.meta.url));
const wrapperSource = fileURLToPath(new URL("../hooks/safety-net.mjs", import.meta.url));
const precheck = fileURLToPath(new URL("../hooks/pr-metadata-precheck.mjs", import.meta.url));
const settings = JSON.parse(fs.readFileSync(path.join(repo, ".claude", "settings.json"), "utf8"));
const pinned = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8")).devDependencies["cc-safety-net"];
const TOOLS = ["Bash", "PowerShell"];
const IN_CI = process.env.CI === "true";

const hookEntry = settings.hooks.PreToolUse.flatMap((group) => (group.matcher === "Bash|PowerShell" ? group.hooks : [])).find((hook) => /safety-net\.mjs/.test(hook.command ?? ""));
const event = (tool, command, cwd) => JSON.stringify({ hook_event_name: "PreToolUse", tool_name: tool, ...(cwd ? { cwd } : {}), tool_input: { command } });

const FAKES = {
  // Denies the control-probe commands (logged as "p"), stays silent for the rest (logged as "x").
  allow:
    "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const probe=/push --force|add -A/.test(d);require('fs').appendFileSync(__dirname+'/calls.log',probe?'p':'x');if(probe)process.stdout.write(JSON.stringify({hookSpecificOutput:{permissionDecision:'deny'}}));process.exit(0)});",
  stubjson: "process.stdin.resume();process.stdin.on('end',()=>{process.stdout.write('{}');process.exit(0)});",
  silent:"process.stdin.resume();process.stdin.on('end',()=>process.exit(0));",
  big: "process.stdout.write('x'.repeat(5*1024*1024));",
  crash1: "process.exit(1);",
  crash3: "process.exit(3);",
  throws: "throw new Error('boom');",
  garbage: "process.stdin.resume();process.stdin.on('end',()=>{process.stdout.write('not json');process.exit(0)});",
  deny: "process.stdin.resume();process.stdin.on('end',()=>{process.stdout.write(JSON.stringify({hookSpecificOutput:{permissionDecision:'deny'}}));process.exit(0)});",
  hang: "setInterval(()=>{},1000);",
  block2: "process.stdin.resume();process.stdin.on('end',()=>{console.error('nope');process.exit(2)});",
};

// bin: a FAKES key, "empty" or "missing"; pkg: false = no package directory;
// modules: false = no node_modules at all.
// hook: content of dist/bin/hook.js ("ok", "missing", "empty", "spaces", "exit0");
// real: copy the installed package and the project rulebook instead of a fake
// (rulebook: false leaves the project rules out).
const HOOKS = { ok: "//ok", empty: "", spaces: "  \n\t\n", exit0: "process.exit(0);" };
const realPackage = path.join(repo, "node_modules", "cc-safety-net");
function makeTree({ dir = "tree", bin = "allow", pkg = true, modules = true, version = pinned, wrapper = true, hook = "ok", real = false, rulebook = true } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "ductus-sn-"));
  const root = path.join(base, dir);
  fs.mkdirSync(path.join(root, "scripts", "hooks"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ devDependencies: { "cc-safety-net": pinned } }));
  if (wrapper === true) fs.copyFileSync(wrapperSource, path.join(root, "scripts", "hooks", "safety-net.mjs"));
  else if (typeof wrapper === "string") fs.writeFileSync(path.join(root, "scripts", "hooks", "safety-net.mjs"), wrapper);
  if (modules) {
    fs.mkdirSync(path.join(root, "node_modules"), { recursive: true });
    if (pkg) {
      const binDir = path.join(root, "node_modules", "cc-safety-net", "dist", "bin");
      if (real) {
        assert.ok(fs.existsSync(realPackage), "cc-safety-net is not installed: run `pnpm install --frozen-lockfile`");
        fs.cpSync(fs.realpathSync(realPackage), path.join(root, "node_modules", "cc-safety-net"), { recursive: true, dereference: true });
        if (rulebook) fs.cpSync(path.join(repo, ".cc-safety-net"), path.join(root, ".cc-safety-net"), { recursive: true });
      } else {
        fs.mkdirSync(binDir, { recursive: true });
        fs.writeFileSync(path.join(root, "node_modules", "cc-safety-net", "package.json"), JSON.stringify({ version }));
        if (bin === "empty") fs.writeFileSync(path.join(binDir, "cc-safety-net.js"), "");
        else if (bin !== "missing") fs.writeFileSync(path.join(binDir, "cc-safety-net.js"), FAKES[bin]);
      }
      if (hook === "missing") fs.rmSync(path.join(binDir, "hook.js"), { force: true });
      else if (!real || hook !== "ok") fs.writeFileSync(path.join(binDir, "hook.js"), HOOKS[hook]);
    }
  }
  return { root, calls: path.join(root, "node_modules", "cc-safety-net", "dist", "bin", "calls.log"), done: () => fs.rmSync(base, { recursive: true, force: true }) };
}

const run = (tree, tool, command, cwd) => decide({ root: tree.root, input: event(tool, command, cwd) });
const withTree = (options, fn) => {
  const tree = makeTree(options);
  try {
    return fn(tree);
  } finally {
    tree.done();
  }
};
const blocked = (result, label) => {
  assert.equal(result.code, 2, label);
  assert.match(result.stderr, /pnpm install --frozen-lockfile/, label);
};

// Real shell path: the exact command from .claude/settings.json under bash.
const bash = spawnSync("bash", ["-c", "exit 0"]).status === 0;
function viaSettings(tree, tool, command, { prefix = "" } = {}) {
  return spawnSync("bash", ["-c", prefix + hookEntry.command], {
    input: event(tool, command),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: tree.root },
  });
}
const shellTest = (name, fn) =>
  test(name, (t) => {
    if (!bash) {
      assert.ok(!IN_CI, "bash is required in CI to test the hook command from .claude/settings.json");
      return t.skip("bash not found; run on Linux CI or install Git Bash");
    }
    fn();
  });

test("settings.json routes Bash and PowerShell through the wrapper, not the bare package", () => {
  assert.ok(hookEntry, "PreToolUse Bash|PowerShell hook for safety-net.mjs");
  assert.equal(hookEntry.shell, "bash");
  // Claude Code >= 2.1.295: a hook that cannot start, times out or exits other than 0/2 blocks.
  assert.equal(hookEntry.onFailure, "block");
  assert.ok(hookEntry.timeout >= 8, "hook timeout leaves room for the wrapper analysis limit");
  const all = JSON.stringify(settings.hooks);
  assert.ok(!/node_modules\/cc-safety-net/.test(all), "no hook calls node_modules directly");
  for (const group of settings.hooks.PreToolUse) {
    if (/cc-safety-net/.test(JSON.stringify(group))) assert.equal(group.matcher, "Bash|PowerShell");
  }
});

test("analysis limit stays below the hook timeout in settings.json", async () => {
  const { ANALYSIS_TIMEOUT_MS } = await import("../hooks/safety-net.mjs");
  assert.ok(ANALYSIS_TIMEOUT_MS < hookEntry.timeout * 1000);
});

for (const tool of TOOLS) {
  test(`A1 no node_modules at all blocks (${tool})`, () =>
    withTree({ modules: false }, (tree) => {
      blocked(run(tree, tool, "git reset --hard origin/main"), "A1");
    }));

  test(`A2 node_modules without the package blocks (${tool})`, () =>
    withTree({ pkg: false }, (tree) => {
      blocked(run(tree, tool, "git reset --hard origin/main"), "A2");
    }));

  test(`A3 missing or empty binary blocks (${tool})`, () => {
    for (const bin of ["missing", "empty"]) {
      withTree({ bin }, (tree) => blocked(run(tree, tool, "git reset --hard origin/main"), `A3 ${bin}`));
    }
  });

  test(`A4 crash, odd exit, exception and non-JSON output all block (${tool})`, () => {
    for (const bin of ["crash1", "crash3", "throws", "garbage"]) {
      withTree({ bin }, (tree) => blocked(run(tree, tool, "git status"), `A4 ${bin}`));
    }
  });

  test(`A4 the package's own exit 2 block is passed through (${tool})`, () =>
    withTree({ bin: "block2" }, (tree) => {
      const result = run(tree, tool, "git status");
      assert.equal(result.code, 2);
      assert.match(result.stderr, /nope/);
    }));

  test(`A5 a hanging analysis is killed by the wrapper and blocks (${tool})`, { timeout: 20000 }, () =>
    withTree({ bin: "hang" }, (tree) => {
      const started = Date.now();
      const result = decide({ root: tree.root, input: event(tool, "git status"), timeoutMs: 400 });
      blocked(result, "A5");
      assert.match(result.stderr, /did not answer/);
      assert.ok(Date.now() - started < 5000);
    }));

  test(`A7/A8 install exception does not survive chaining, operators or other pnpm commands (${tool})`, () => {
    const attacks = [
      "pnpm install && git reset --hard origin/main",
      "pnpm install; git push -f",
      "pnpm install | sh",
      "pnpm i x && git push origin x",
      "pnpm install $(whoami)",
      "pnpm install `whoami`",
      "pnpm add left-pad",
      "pnpm dlx cowsay hi",
      "pnpm exec rm -rf x",
      "pnpm install\ngit reset --hard origin/main",
      "pnpm install\r\ngit push -f",
      "pnpm install `n git push -f",
      "pnpm install; git reset --hard origin/main",
      "pnpm install -and git reset --hard origin/main",
      "pnpm install -and (git push -f)",
      "pnpm install > out.txt",
      "pnpm install --frozen-lockfile; git push -f",
      "pnpm install --frozen-lockfile && node x.js",
      "pnpm install --ignore-scripts",
      "pnpm  install",
      "PNPM install",
      "pnpm install x",
      "cd /tmp && pnpm install",
      "",
    ];
    for (const command of attacks) {
      withTree({ pkg: false }, (tree) => blocked(run(tree, tool, command), `A7 ${JSON.stringify(command)}`));
    }
  });

  test(`F2 the exact install commands are allowed while the package is unusable (${tool})`, () => {
    for (const command of ["pnpm install", "pnpm install --frozen-lockfile", "pnpm install\n"]) {
      for (const options of [{ modules: false }, { pkg: false }, { bin: "empty" }, { version: "0.0.1" }]) {
        withTree(options, (tree) => assert.equal(run(tree, tool, command).code, 0, `${JSON.stringify(command)} ${JSON.stringify(options)}`));
      }
    }
  });

  test(`A9 with a healthy package the install command goes through the analysis (${tool})`, () => {
    withTree({ bin: "deny" }, (tree) => {
      const result = run(tree, tool, "pnpm install");
      assert.equal(result.code, 0);
      assert.match(result.stdout, /deny/);
    });
    withTree({ bin: "allow" }, (tree) => {
      assert.equal(run(tree, tool, "pnpm install").code, 0);
      assert.ok(fs.existsSync(tree.calls), "analysis ran");
    });
    withTree({ bin: "crash1" }, (tree) => blocked(run(tree, tool, "pnpm install"), "healthy but crashing"));
  });

  test(`A12 a package of the wrong version blocks, install still allowed (${tool})`, () =>
    withTree({ version: "0.0.1" }, (tree) => {
      const result = run(tree, tool, "git status");
      blocked(result, "A12");
      assert.match(result.stderr, /0\.0\.1/);
      assert.equal(run(tree, tool, "pnpm install --frozen-lockfile").code, 0);
    }));

  test(`A10/F5 a project path with spaces is analysed, not blocked (${tool})`, () =>
    withTree({ dir: "Moji radovi 'a b'/Ductus" }, (tree) => {
      assert.equal(run(tree, tool, "git status").code, 0);
      assert.ok(fs.existsSync(tree.calls));
    }));

  test(`F1 real package: routine commands pass, force push is denied (${tool})`, () => {
    assert.ok(fs.existsSync(path.join(repo, "node_modules", "cc-safety-net", "dist", "bin", "cc-safety-net.js")), "cc-safety-net is not installed: run `pnpm install --frozen-lockfile`");
    for (const command of ["git status", "pnpm test", "git push -u origin feat/x"]) {
      const result = decide({ input: event(tool, command) });
      assert.equal(result.code, 0, command);
      assert.equal(result.stdout.trim(), "", command);
    }
    const result = decide({ input: event(tool, "git push --force origin x") });
    assert.equal(result.code, 0);
    assert.match(result.stdout, /"permissionDecision":\s*"deny"/);
  });
}

for (const tool of TOOLS) {
  test(`B1 a hollowed-out analysis module blocks, install allowed (${tool})`, { timeout: 60000 }, () => {
    for (const hook of ["missing", "empty", "spaces", "exit0"]) {
      withTree({ real: true, hook }, (tree) => {
        for (const command of ["git push --force origin x", "git add -A", "ls"]) blocked(run(tree, tool, command), `${hook}: ${command}`);
        assert.equal(run(tree, tool, "pnpm install --frozen-lockfile").code, 0, hook);
        assert.equal(run(tree, tool, "pnpm install && git push -f").code, 2, hook);
      });
    }
  });

  test(`B1 a silent package fails the control probe (${tool})`, () =>
    withTree({ bin: "silent" }, (tree) => {
      const result = run(tree, tool, "git status");
      blocked(result, "silent");
      assert.match(result.stderr, /control probe/);
    }));

  test(`B1/M1 intact real package: project and built-in rules deny, routine passes (${tool})`, { timeout: 60000 }, () =>
    withTree({ real: true }, (tree) => {
      for (const command of ["git add -A", "git push --force origin x"]) {
        const result = run(tree, tool, command);
        assert.equal(result.code, 0, command);
        assert.match(result.stdout, /"permissionDecision":\s*"deny"/, command);
      }
      const ok = run(tree, tool, "ls");
      assert.equal(ok.code, 0);
      assert.equal(ok.stdout.trim(), "");
    }));

  test(`M1 a missing project rulebook is caught by the probe (${tool})`, { timeout: 60000 }, () =>
    withTree({ real: true, rulebook: false }, (tree) => {
      const result = run(tree, tool, "ls");
      blocked(result, "rulebook");
      assert.match(result.stderr, /rulebook/);
      assert.equal(run(tree, tool, "pnpm install").code, 0);
    }));
}

test("B1 the probe verdict is remembered per package state, and a changed module is probed again", { timeout: 60000 }, () => {
  withTree({ bin: "allow" }, (tree) => {
    for (let i = 0; i < 3; i++) assert.equal(run(tree, "Bash", "ls").code, 0);
    assert.equal(fs.readFileSync(tree.calls, "utf8"), "xppxx", "the call, two probes once, then one run per call");
  });
  withTree({ real: true }, (tree) => {
    assert.equal(run(tree, "Bash", "ls").code, 0);
    assert.equal(run(tree, "Bash", "ls").code, 0);
    fs.writeFileSync(path.join(tree.root, "node_modules", "cc-safety-net", "dist", "bin", "hook.js"), "process.exit(0);");
    blocked(run(tree, "Bash", "ls"), "hook.js replaced after a good verdict");
  });
});

test("review: a stub that prints JSON instead of nothing fails the probe too", () =>
  withTree({ bin: "stubjson" }, (tree) => blocked(run(tree, "Bash", "git push --force origin x"), "stubjson")));

test("review: the verdict follows the event cwd; a cwd without the project rulebook loses no rule silently", { timeout: 60000 }, () => {
  withTree({ real: true }, (tree) => {
    // A good verdict for the project root exists ...
    assert.equal(run(tree, "Bash", "ls").code, 0);
    assert.equal(run(tree, "Bash", "git add -A").code, 0);
    // ... but a worktree or any other cwd without .cc-safety-net must not inherit it.
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), "ductus-bare-"));
    const withRules = fs.mkdtempSync(path.join(os.tmpdir(), "ductus-rules-"));
    try {
      fs.cpSync(path.join(tree.root, ".cc-safety-net"), path.join(withRules, ".cc-safety-net"), { recursive: true });
      for (const tool of TOOLS) {
        const lost = run(tree, tool, "git add -A", bare);
        blocked(lost, "cwd without rulebook");
        assert.match(lost.stderr, /rulebook/);
        assert.equal(run(tree, tool, "ls", bare).code, 2);
        assert.equal(run(tree, tool, "pnpm install", bare).code, 0, "install stays possible");
        const ok = run(tree, tool, "git add -A", withRules);
        assert.equal(ok.code, 0);
        assert.match(ok.stdout, /deny/);
      }
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
      fs.rmSync(withRules, { recursive: true, force: true });
    }
  });
});

test("review: a same-size stub with the old mtime does not keep an old verdict", { timeout: 60000 }, () =>
  withTree({ real: true }, (tree) => {
    const hook = path.join(tree.root, "node_modules", "cc-safety-net", "dist", "bin", "hook.js");
    assert.equal(run(tree, "Bash", "ls").code, 0);
    const { size, atime, mtime } = fs.statSync(hook);
    fs.writeFileSync(hook, "process.exit(0);".padEnd(size, " "));
    fs.utimesSync(hook, atime, mtime);
    assert.equal(fs.statSync(hook).size, size);
    blocked(run(tree, "Bash", "git push --force origin x"), "same-size stub");
  }));

test("M2 a package that floods stdout is stopped by the buffer limit", () =>
  withTree({ bin: "big" }, (tree) => {
    const result = run(tree, "Bash", "git status");
    blocked(result, "big");
    assert.match(result.stderr, /ENOBUFS|could not run/);
  }));

test("M2 unreadable or mismatching version information blocks", () => {
  withTree({}, (tree) => {
    fs.writeFileSync(path.join(tree.root, "node_modules", "cc-safety-net", "package.json"), "{ not json");
    const result = run(tree, "Bash", "git status");
    blocked(result, "bad package.json");
    assert.match(result.stderr, /could not be verified/);
  });
  withTree({}, (tree) => {
    fs.writeFileSync(path.join(tree.root, "package.json"), "{}");
    const result = run(tree, "Bash", "git status");
    blocked(result, "no pin");
    assert.match(result.stderr, /differs/);
  });
});

test("M2 the entry point turns any internal error into a block", () => {
  const thrown = runCli({ read: () => "", decideFn: () => { throw new Error("boom"); } });
  assert.equal(thrown.code, 2);
  assert.match(thrown.stderr, /wrapper error \(boom\)/);
  const unreadable = runCli({ read: () => { throw new Error("no stdin"); }, decideFn: ({ input }) => ({ code: input === "" ? 2 : 0, stdout: "", stderr: "" }) });
  assert.equal(unreadable.code, 2);
});

test("isInstallCommand accepts only the two literal spellings", () => {
  assert.ok(isInstallCommand("pnpm install"));
  assert.ok(isInstallCommand(" pnpm install --frozen-lockfile "));
  assert.ok(!isInstallCommand(undefined));
  assert.ok(!isInstallCommand({ toString: () => "pnpm install" }));
});

test("malformed hook input never counts as an install", () =>
  withTree({ pkg: false }, (tree) => {
    for (const input of ["", "not json", "null", "[]", JSON.stringify({ tool_input: { command: ["pnpm install"] } })]) {
      blocked(decide({ root: tree.root, input }), JSON.stringify(input));
    }
  }));

shellTest("A1/A2/A7 through the real settings.json command: blocked with exit 2 (both tools)", () => {
  for (const tool of TOOLS) {
    withTree({ modules: false }, (tree) => {
      const result = viaSettings(tree, tool, "git reset --hard origin/main");
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, /pnpm install --frozen-lockfile/);
      assert.equal(viaSettings(tree, tool, "pnpm install --frozen-lockfile").status, 0);
      assert.equal(viaSettings(tree, tool, "pnpm install && git push -f").status, 2);
    });
  }
});

shellTest("F4/A4 shell layer: healthy tree allows, every failure becomes exit 2 (both tools)", () => {
  for (const tool of TOOLS) {
    withTree({ bin: "allow" }, (tree) => assert.equal(viaSettings(tree, tool, "git status").status, 0));
    withTree({ bin: "crash1" }, (tree) => assert.equal(viaSettings(tree, tool, "git status").status, 2));
    // The wrapper itself is broken (exit 1 from node) or gone: still blocked.
    withTree({ wrapper: "this is not javascript" }, (tree) => assert.equal(viaSettings(tree, tool, "git status").status, 2));
    withTree({ wrapper: false }, (tree) => assert.equal(viaSettings(tree, tool, "git status").status, 2));
  }
});

shellTest("A10 shell layer: project path with spaces and quotes works", () =>
  withTree({ dir: "Moji radovi/a b Ductus" }, (tree) => {
    assert.equal(viaSettings(tree, "Bash", "git status").status, 0);
    assert.ok(fs.existsSync(tree.calls));
  }));

shellTest("A6 node missing from PATH is blocked by the shell layer", () =>
  withTree({ bin: "allow" }, (tree) => {
    const result = viaSettings(tree, "Bash", "git reset --hard origin/main", { prefix: "PATH=/nonexistent; " });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /node or scripts\/hooks\/safety-net\.mjs is missing/);
  }));

test("the symlink and /proc cases of agent-hooks.test.mjs run only on Linux CI (CI=true)", () => {
  if (!IN_CI) return;
  assert.equal(process.platform, "linux", "those cases skip on other platforms; CI must not run there");
});

test("A13 the PR metadata precheck blocks when it throws on a PR command, and ignores other commands", () => {
  // The preload makes the metadata parser throw, as an internal error would.
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "ductus-pre-"));
  try {
    const preload = path.join(base, "preload.mjs");
    fs.writeFileSync(preload, "const o = String.prototype.startsWith; String.prototype.startsWith = function (...a) { if (a[0] === 'agent:') throw new Error('injected'); return o.apply(this, a); };");
    const go = (command, args = []) => spawnSync(process.execPath, [...args, precheck], { input: JSON.stringify({ tool_input: { command }, cwd: base }), encoding: "utf8" });
    const broken = ["--import", pathToFileURL(preload).href];
    const prCommand = 'gh pr create --title t --body "Agent: x"';
    const thrown = go(prCommand, broken);
    assert.equal(thrown.status, 2, thrown.stderr);
    assert.match(thrown.stderr, /could not run/);
    assert.equal(go("git status", broken).status, 0);
    // Without the injected error the same command still gets the normal verdict.
    const normal = go(prCommand);
    assert.equal(normal.status, 2);
    assert.match(normal.stderr, /metadata check failed/);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
