import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { answer, decide, isCdToRoot, isInstallCommand, main, runCli } from "../hooks/safety-net.mjs";

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
  // Run 1 (cwd SN_SUB), run 2 and the probes each behave as told: allow, deny, hang or crash, after SN_DELAY ms.
  split:
    "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const e=JSON.parse(d),v=process.env;const probe=/ductus-probe|^git add -A$/.test(e.tool_input.command);const mode=probe?v.SN_PROBE||'deny':e.cwd===v.SN_SUB?v.SN_RUN1:v.SN_RUN2;setTimeout(()=>{if(mode==='hang')return setInterval(()=>{},1000);if(mode==='crash')process.exit(1);if(mode==='deny')process.stdout.write(JSON.stringify({hookSpecificOutput:{permissionDecision:'deny'}}));process.exit(0)},+(v.SN_DELAY||0))});",
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
        if (rulebook) {
          fs.mkdirSync(path.join(root, ".cc-safety-net", "rules", "ductus-rules"), { recursive: true });
          fs.writeFileSync(path.join(root, ".cc-safety-net", "rules", "ductus-rules", "rulebook.json"), "{}"); // read only by the real package
        }
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

const run = (tree, tool, command, cwd, env) => decide({ root: tree.root, input: event(tool, command, cwd), ...(env ? { env } : {}) });
// fn may be async: the tree is removed once its promise settles.
const withTree = (options, fn) => {
  const tree = makeTree(options);
  let result;
  try {
    result = fn(tree);
  } finally {
    if (typeof result?.then !== "function") tree.done();
  }
  return typeof result?.then === "function" ? result.finally(() => tree.done()) : result;
};
// Run 1 and the probes start together, so the log is compared as a tally.
const tally = (log) => [...log].sort().join("");
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
  assert.equal(hookEntry.timeout, 30, "hook timeout survives Node start-up on a loaded machine");
  const all = JSON.stringify(settings.hooks);
  assert.ok(!/node_modules\/cc-safety-net/.test(all), "no hook calls node_modules directly");
  for (const group of settings.hooks.PreToolUse) {
    if (/cc-safety-net/.test(JSON.stringify(group))) assert.equal(group.matcher, "Bash|PowerShell");
  }
});

test("analysis limit stays below the hook timeout in settings.json", async () => {
  const { ANALYSIS_TIMEOUT_MS, DEFAULT_LIMITS } = await import("../hooks/safety-net.mjs");
  assert.ok(ANALYSIS_TIMEOUT_MS + DEFAULT_LIMITS.maxMs <= hookEntry.timeout * 1000 - 5000, "analysis budget plus configuration read leaves 5 s of start-up margin");
});

for (const tool of TOOLS) {
  test(`A1 no node_modules at all blocks (${tool})`, () =>
    withTree({ modules: false }, async (tree) => {
      blocked(await run(tree, tool, "git reset --hard origin/main"), "A1");
    }));

  test(`A2 node_modules without the package blocks (${tool})`, () =>
    withTree({ pkg: false }, async (tree) => {
      blocked(await run(tree, tool, "git reset --hard origin/main"), "A2");
    }));

  test(`A3 missing or empty binary blocks (${tool})`, async () => {
    for (const bin of ["missing", "empty"]) {
      await withTree({ bin }, async (tree) => blocked(await run(tree, tool, "git reset --hard origin/main"), `A3 ${bin}`));
    }
  });

  test(`A4 crash, odd exit, exception and non-JSON output all block (${tool})`, async () => {
    for (const bin of ["crash1", "crash3", "throws", "garbage"]) {
      await withTree({ bin }, async (tree) => blocked(await run(tree, tool, "git status"), `A4 ${bin}`));
    }
  });

  test(`A4 the package's own exit 2 block is passed through (${tool})`, () =>
    withTree({ bin: "block2" }, async (tree) => {
      const result = await run(tree, tool, "git status");
      assert.equal(result.code, 2);
      assert.match(result.stderr, /nope/);
    }));

  test(`A5 a hanging analysis is killed by the wrapper and blocks (${tool})`, { timeout: 20000 }, () =>
    withTree({ bin: "hang" }, async (tree) => {
      const started = Date.now();
      const result = await decide({ root: tree.root, input: event(tool, "git status"), timeoutMs: 400 });
      blocked(result, "A5");
      assert.match(result.stderr, /did not answer/);
      assert.ok(Date.now() - started < 5000);
    }));

  test(`A7/A8 install exception does not survive chaining, operators or other pnpm commands (${tool})`, async () => {
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
      await withTree({ pkg: false }, async (tree) => blocked(await run(tree, tool, command), `A7 ${JSON.stringify(command)}`));
    }
  });

  test(`F2 the exact install commands are allowed while the package is unusable (${tool})`, async () => {
    for (const command of ["pnpm install", "pnpm install --frozen-lockfile", "pnpm install\n"]) {
      for (const options of [{ modules: false }, { pkg: false }, { bin: "empty" }, { version: "0.0.1" }]) {
        await withTree(options, async (tree) => assert.equal((await run(tree, tool, command)).code, 0, `${JSON.stringify(command)} ${JSON.stringify(options)}`));
      }
    }
  });

  test(`A9 with a healthy package the install command goes through the analysis (${tool})`, async () => {
    await withTree({ bin: "deny" }, async (tree) => {
      const result = await run(tree, tool, "pnpm install");
      assert.equal(result.code, 0);
      assert.match(result.stdout, /deny/);
    });
    await withTree({ bin: "allow" }, async (tree) => {
      assert.equal((await run(tree, tool, "pnpm install")).code, 0);
      assert.ok(fs.existsSync(tree.calls), "analysis ran");
    });
    await withTree({ bin: "crash1" }, async (tree) => blocked(await run(tree, tool, "pnpm install"), "healthy but crashing"));
  });

  test(`A12 a package of the wrong version blocks, install still allowed (${tool})`, () =>
    withTree({ version: "0.0.1" }, async (tree) => {
      const result = await run(tree, tool, "git status");
      blocked(result, "A12");
      assert.match(result.stderr, /0\.0\.1/);
      assert.equal((await run(tree, tool, "pnpm install --frozen-lockfile")).code, 0);
    }));

  test(`A10/F5 a project path with spaces is analysed, not blocked (${tool})`, () =>
    withTree({ dir: "Moji radovi 'a b'/Ductus" }, async (tree) => {
      assert.equal((await run(tree, tool, "git status")).code, 0);
      assert.ok(fs.existsSync(tree.calls));
    }));

  test(`F1 real package: routine commands pass, force push is denied (${tool})`, async () => {
    assert.ok(fs.existsSync(path.join(repo, "node_modules", "cc-safety-net", "dist", "bin", "cc-safety-net.js")), "cc-safety-net is not installed: run `pnpm install --frozen-lockfile`");
    for (const command of ["git status", "pnpm test", "git push -u origin feat/x"]) {
      const result = await decide({ input: event(tool, command) });
      assert.equal(result.code, 0, command);
      assert.equal(result.stdout.trim(), "", command);
    }
    const result = await decide({ input: event(tool, "git push --force origin x") });
    assert.equal(result.code, 0);
    assert.match(result.stdout, /"permissionDecision":\s*"deny"/);
  });

  test(`F-017 a command that names the secret-scan skip is blocked, before and without the package (${tool})`, async () => {
    const name = "DUCTUS_ALLOW_SECRET_SCAN_SKIP";
    for (const command of [
      `${name}=$(git write-tree) git commit -m x`,
      `export ${name}=abc; git commit -m x`,
      `$env:${name} = (git write-tree); git commit -m x`,
      `env ${name.toLowerCase()}=1 git commit -m x`,
      `echo ${name}`,
    ]) {
      const result = await decide({ input: event(tool, command) });
      assert.equal(result.code, 2, command);
      assert.match(result.stderr, /for a human only/, command);
      // A root without the package would otherwise only allow the install command.
      assert.equal((await decide({ root: path.join(os.tmpdir(), "no-such-ductus-root"), input: event(tool, command) })).code, 2, command);
    }
    assert.equal((await decide({ input: event(tool, "git commit -m 'secret scan passed'") })).code, 0);
  });
}

for (const tool of TOOLS) {
  test(`B1 a hollowed-out analysis module blocks, install allowed (${tool})`, { timeout: 60000 }, async () => {
    for (const hook of ["missing", "empty", "spaces", "exit0"]) {
      await withTree({ real: true, hook }, async (tree) => {
        for (const command of ["git push --force origin x", "git add -A", "ls"]) blocked(await run(tree, tool, command), `${hook}: ${command}`);
        assert.equal((await run(tree, tool, "pnpm install --frozen-lockfile")).code, 0, hook);
        assert.equal((await run(tree, tool, "pnpm install && git push -f")).code, 2, hook);
      });
    }
  });

  test(`B1 a silent package fails the control probe (${tool})`, () =>
    withTree({ bin: "silent" }, async (tree) => {
      const result = await run(tree, tool, "git status");
      blocked(result, "silent");
      assert.match(result.stderr, /control probe/);
    }));

  test(`B1/M1 intact real package: project and built-in rules deny, routine passes (${tool})`, { timeout: 60000 }, () =>
    withTree({ real: true }, async (tree) => {
      for (const command of ["git add -A", "git push --force origin x"]) {
        const result = await run(tree, tool, command);
        assert.equal(result.code, 0, command);
        assert.match(result.stdout, /"permissionDecision":\s*"deny"/, command);
      }
      const ok = await run(tree, tool, "ls");
      assert.equal(ok.code, 0);
      assert.equal(ok.stdout.trim(), "");
    }));

  test(`M1 a missing project rulebook is caught by the probe (${tool})`, { timeout: 60000 }, () =>
    withTree({ real: true, rulebook: false }, async (tree) => {
      const result = await run(tree, tool, "ls");
      assert.equal(result.code, 2);
      assert.match(result.stderr, /no project rulebook/);
      assert.equal((await run(tree, tool, "pnpm install")).code, 0);
    }));
}

test("B1 the probe verdict is remembered per package state, and a changed module is probed again", { timeout: 60000 }, async () => {
  await withTree({ bin: "allow" }, async (tree) => {
    for (let i = 0; i < 3; i++) assert.equal((await run(tree, "Bash", "ls")).code, 0);
    assert.equal(tally(fs.readFileSync(tree.calls, "utf8")), tally("xppxx"), "the call, two probes once, then one run per call");
  });
  await withTree({ real: true }, async (tree) => {
    assert.equal((await run(tree, "Bash", "ls")).code, 0);
    assert.equal((await run(tree, "Bash", "ls")).code, 0);
    fs.writeFileSync(path.join(tree.root, "node_modules", "cc-safety-net", "dist", "bin", "hook.js"), "process.exit(0);");
    blocked(await run(tree, "Bash", "ls"), "hook.js replaced after a good verdict");
  });
});

test("review: a stub that prints JSON instead of nothing fails the probe too", () =>
  withTree({ bin: "stubjson" }, async (tree) => blocked(await run(tree, "Bash", "git push --force origin x"), "stubjson")));

test("review: the verdict follows the event cwd; a cwd without the project rulebook loses no rule silently", { timeout: 60000 }, async () => {
  await withTree({ real: true }, async (tree) => {
    // A good verdict for the project root exists ...
    assert.equal((await run(tree, "Bash", "ls")).code, 0);
    assert.equal((await run(tree, "Bash", "git add -A")).code, 0);
    // ... but a worktree or any other cwd without .cc-safety-net must not inherit it.
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), "ductus-bare-"));
    const withRules = fs.mkdtempSync(path.join(os.tmpdir(), "ductus-rules-"));
    try {
      fs.cpSync(path.join(tree.root, ".cc-safety-net"), path.join(withRules, ".cc-safety-net"), { recursive: true });
      for (const tool of TOOLS) {
        const lost = await run(tree, tool, "git add -A", bare);
        assert.equal(lost.code, 2, "cwd without rulebook");
        assert.match(lost.stderr, /rulebook/);
        assert.equal((await run(tree, tool, "ls", bare)).code, 2);
        assert.equal((await run(tree, tool, "pnpm install", bare)).code, 0, "install stays possible");
        const ok = await run(tree, tool, "git add -A", withRules);
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
  withTree({ real: true }, async (tree) => {
    const hook = path.join(tree.root, "node_modules", "cc-safety-net", "dist", "bin", "hook.js");
    // Whole seconds, so that restoring the time is exact on every file system.
    fs.utimesSync(hook, 1_700_000_000, 1_700_000_000);
    assert.equal((await run(tree, "Bash", "ls")).code, 0);
    const { size, mtimeMs } = fs.statSync(hook);
    fs.writeFileSync(hook, "process.exit(0);".padEnd(size, " "));
    fs.utimesSync(hook, 1_700_000_000, 1_700_000_000);
    assert.equal(fs.statSync(hook).size, size);
    assert.equal(fs.statSync(hook).mtimeMs, mtimeMs, "size and mtime identical to the verdict's");
    blocked(await run(tree, "Bash", "git push --force origin x"), "same-size stub");
  }));

test("review: in a subdirectory the root rulebook still applies; no checkout above is inherited", { timeout: 90000 }, async () => {
  await withTree({ real: true }, async (tree) => {
    fs.writeFileSync(path.join(tree.root, ".git"), "gitdir: elsewhere");
    const src = path.join(tree.root, "src", "deep");
    fs.mkdirSync(src, { recursive: true });
    // A worktree inside the checkout, with its own .git and no rulebook.
    const worktree = path.join(tree.root, ".claude", "worktrees", "w");
    fs.mkdirSync(path.join(worktree, "sub"), { recursive: true });
    fs.writeFileSync(path.join(worktree, ".git"), "gitdir: elsewhere");
    // Not a checkout at all: a rulebook above must not be inherited.
    const outer = fs.mkdtempSync(path.join(os.tmpdir(), "ductus-outer-"));
    try {
      fs.cpSync(path.join(tree.root, ".cc-safety-net"), path.join(outer, ".cc-safety-net"), { recursive: true });
      fs.mkdirSync(path.join(outer, "child"));
      for (const tool of TOOLS) {
        // ls and cd .. work from a subdirectory, and the project rule still denies.
        for (const cwd of [src, path.join(tree.root, "src")]) {
          assert.equal((await run(tree, tool, "ls", cwd)).code, 0, `ls in ${cwd}`);
          assert.equal((await run(tree, tool, "cd ..", cwd)).code, 0, `cd .. in ${cwd}`);
          const denied = await run(tree, tool, "git add -A", cwd);
          assert.equal(denied.code, 0);
          assert.match(denied.stdout, /deny/, `git add -A in ${cwd}`);
          assert.match((await run(tree, tool, "git push --force origin x", cwd)).stdout, /deny/);
        }
        for (const cwd of [worktree, path.join(worktree, "sub"), path.join(outer, "child")]) {
          const result = await run(tree, tool, "ls", cwd);
          assert.equal(result.code, 2, `no inherited rulebook for ${cwd}`);
          assert.match(result.stderr, /no project rulebook/);
          assert.match(result.stderr, /git -C <this directory> merge origin\/main/);
          assert.doesNotMatch(result.stderr, /pnpm install --frozen-lockfile/);
        }
      }
    } finally {
      fs.rmSync(outer, { recursive: true, force: true });
    }
  });
});

// A command of the rulebook is either blocked or denied by the package, never let through.
const safe = (result) => result.code === 2 || (result.code === 0 && /"permissionDecision":\s*"deny"/.test(result.stdout));

test("QA B1: no configuration input of the package can be changed, removed or corrupted behind a remembered verdict", { timeout: 280000 }, async () => {
  await withTree({ real: true }, async (tree) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ductus-home-"));
    try {
      const userDir = path.join(home, ".cc-safety-net");
      fs.mkdirSync(path.join(userDir, "rules", "extra"), { recursive: true });
      // Never the real home: the package is pointed at this one.
      const env = { ...process.env, HOME: home, USERPROFILE: home, CC_SAFETY_NET_HOME: userDir };
      const project = path.join(tree.root, ".cc-safety-net");
      const files = [
        path.join(project, "policy.json"),
        path.join(project, "rules", "rule.json"),
        path.join(project, "rules", "ductus-rules", "rulebook.json"),
        path.join(userDir, "policy.json"),
        path.join(userDir, "rules", "rule.json"),
        path.join(userDir, "rules", "extra", "rulebook.json"),
      ];
      const mutations = [
        ["garbage", (file) => fs.writeFileSync(file, "{ not json")],
        ["empty object", (file) => fs.writeFileSync(file, "{}")],
        ["emptied", (file) => fs.writeFileSync(file, "")],
        ["deleted", (file) => fs.rmSync(file, { force: true })],
      ];
      assert.equal((await run(tree, "Bash", "ls", undefined, env)).code, 0, "baseline");
      for (const file of files) {
        const original = fs.existsSync(file) ? fs.readFileSync(file) : null;
        for (const [label, mutate] of mutations) {
          mutate(file);
          for (const command of ["git add -A", "git push --force origin x", "git commit --no-verify -m x"]) {
            const result = await run(tree, "Bash", command, undefined, env);
            assert.ok(safe(result), `${path.relative(tree.root, file)} ${label}: ${command} -> ${result.code} ${result.stdout}`);
          }
          if (original === null) fs.rmSync(file, { force: true });
          else fs.writeFileSync(file, original);
        }
        assert.equal((await run(tree, "Bash", "ls", undefined, env)).code, 0, `restored ${file}`);
      }
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

test("QA V1: the only way out of a directory without rules is the exact cd to the project root", async () => {
  for (const dir of ["tree", "dir with spaces"]) {
    await withTree({ dir, bin: "allow" }, async (tree) => {
      const bare = fs.mkdtempSync(path.join(os.tmpdir(), "ductus-bare-"));
      const nested = path.join(tree.root, "nested");
      fs.mkdirSync(path.join(nested, ".cc-safety-net"), { recursive: true });
      try {
        const R = tree.root;
        const allowed = [`cd "${R}"`, `cd '${R}'`, ` cd "${R}" `, ...(/\s/.test(R) ? [] : [`cd ${R}`])];
        const refused = [
          `cd "${R}" && git add -A`, `cd "${R}"; ls`, `cd "${R}" | cat`, `cd "${R}" $(id)`, `cd "${R}"/..`, `cd "${R}/src"`, `cd "${R}"\nls`, `cd "${R}"\r\ngit push -f`,
          "cd -", "cd", `cd "${R}" x`, `cd "${R}" > f`, `cd "${R}" #x`, `cd "${R}"x`, `cd ""`, `cd "${R}`, `CD "${R}"`, `cd  "${R}"  extra`, "ls", `cd "${R}" `.repeat(2),
          `Set-Location "${R}"`, `cd "${R}" -and (git add -A)`, `cd "${R}"\`n git push -f`,
        ];
        for (const tool of TOOLS) {
          for (const cwd of [bare, nested]) {
            for (const command of allowed) assert.equal((await run(tree, tool, command, cwd)).code, 0, `${tool} ${JSON.stringify(command)} in ${cwd}`);
            for (const command of refused) assert.equal((await run(tree, tool, command, cwd)).code, 2, `${tool} ${JSON.stringify(command)} in ${cwd}`);
          }
          // After the cd the session is at the root, where everything works again.
          assert.equal((await run(tree, tool, "ls", R)).code, 0);
        }
      } finally {
        fs.rmSync(bare, { recursive: true, force: true });
      }
    });
  }
  // A root a shell would read specially gets no exit at all.
  for (const root of ["/tmp/a$b", "/tmp/a`b", "/tmp/a;b", "/tmp/a'b", '/tmp/a"b', "/tmp/a&b", "/tmp/a\nb"]) {
    assert.equal(isCdToRoot(`cd "${root}"`, root), false, root);
  }
});

test("QA M1: each part of the verdict key triggers a new probe", { timeout: 60000 }, () =>
  withTree({ bin: "allow" }, async (tree) => {
    const rulebook = path.join(tree.root, ".cc-safety-net", "rules", "ductus-rules", "rulebook.json");
    const log = () => tally(fs.readFileSync(tree.calls, "utf8"));
    await run(tree, "Bash", "ls");
    await run(tree, "Bash", "ls");
    assert.equal(log(), tally("xppx"), "one probe for two calls");
    fs.writeFileSync(rulebook, '{"changed":1}');
    await run(tree, "Bash", "ls");
    assert.equal(log(), tally("xppxxpp"), "changed rulebook probes again");
    // The same rulebook content in another checkout directory is another state.
    const other = path.join(tree.root, "other");
    fs.mkdirSync(path.join(other, ".cc-safety-net", "rules", "ductus-rules"), { recursive: true });
    fs.copyFileSync(rulebook, path.join(other, ".cc-safety-net", "rules", "ductus-rules", "rulebook.json"));
    fs.writeFileSync(path.join(other, ".git"), "gitdir: elsewhere");
    await run(tree, "Bash", "ls", other);
    assert.equal(log(), tally("xppxxppxpp"), "another directory probes again");
    // Another file of the project config directory is part of the state too.
    fs.writeFileSync(path.join(tree.root, ".cc-safety-net", "policy.json"), "{}");
    await run(tree, "Bash", "ls");
    assert.equal(log(), tally("xppxxppxppxpp"));
  }));

// Fake package, probes counted: each part of the verdict key must start a new probe on its own.
test("review: every part of the verdict key starts a new probe", { timeout: 180000 }, async () => {
  await withTree({ bin: "allow" }, async (tree) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ductus-keyhome-"));
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ductus-keyprofile-"));
    const other = path.join(tree.root, "other");
    try {
      let env = { ...process.env, HOME: home, USERPROFILE: profile };
      for (const name of Object.keys(env)) if (name.startsWith("CC_SAFETY_NET_") || name.startsWith("SAFETY_NET_")) delete env[name];
      const probes = () => (fs.readFileSync(tree.calls, "utf8").match(/p/g) ?? []).length;
      const ls = (cwd) => run(tree, "Bash", "ls", cwd, env);
      const step = async (label, change, cwd) => {
        assert.equal((await ls(cwd)).code, 0, `${label}: settle`);
        const before = probes();
        change();
        assert.equal((await ls(cwd)).code, 0, label);
        assert.equal(probes() - before, 2, `${label}: a changed input must start a new probe`);
        assert.equal((await ls(cwd)).code, 0);
        assert.equal(probes() - before, 2, `${label}: and then be remembered`);
      };
      const bin = path.join(tree.root, "node_modules", "cc-safety-net", "dist", "bin");
      const project = path.join(tree.root, ".cc-safety-net");
      const write = (file, content) => {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
      };
      await step("loader", () => fs.appendFileSync(path.join(bin, "cc-safety-net.js"), "\n//changed"));
      await step("hook.js", () => write(path.join(bin, "hook.js"), "//changed"));
      await step("rulebook", () => write(path.join(project, "rules", "ductus-rules", "rulebook.json"), '{"changed":1}'));
      await step("project rule list", () => write(path.join(project, "rules", "rule.json"), "{}"));
      await step("project policy", () => write(path.join(project, "policy.json"), "{}"));
      await step("user config under HOME", () => write(path.join(home, ".cc-safety-net", "policy.json"), "{}"));
      await step("user config under USERPROFILE", () => write(path.join(profile, ".cc-safety-net", "policy.json"), "{}"));
      const named = path.join(home, "named-config");
      await step("CC_SAFETY_NET_HOME set", () => {
        env = { ...env, CC_SAFETY_NET_HOME: named };
        fs.mkdirSync(named);
      });
      await step("user config under CC_SAFETY_NET_HOME", () => write(path.join(named, "rules", "rule.json"), "{}"));
      await step("user config under a relative CC_SAFETY_NET_HOME is read relative to the project root", () => {
        env = { ...env, CC_SAFETY_NET_HOME: "relative-config" };
        write(path.join(tree.root, "relative-config", "policy.json"), "{}");
      });
      await step("file inside it", () => write(path.join(tree.root, "relative-config", "policy.json"), '{"a":1}'));
      await step("same-size change of a file", () => write(path.join(tree.root, "relative-config", "policy.json"), '{"a":2}'));
      await step("CC_SAFETY_NET_ variable", () => (env = { ...env, CC_SAFETY_NET_STRICT: "1" }));
      await step("legacy SAFETY_NET_ variable", () => (env = { ...env, SAFETY_NET_WORKTREE: "1" }));
      await step("listed tool-directory variable", () => (env = { ...env, XDG_CONFIG_HOME: path.join(home, "xdg") }));
      {
        // Same rulebook content in another checkout directory: another state.
        write(path.join(other, ".cc-safety-net", "rules", "ductus-rules", "rulebook.json"), "{}");
        write(path.join(other, ".git"), "gitdir: elsewhere");
        const before = probes();
        assert.equal((await ls(other)).code, 0);
        assert.equal(probes() - before, 2, "rulebook directory is part of the key");
      }
      // Links in the user configuration: what they point to counts.
      const config = path.join(profile, ".cc-safety-net");
      const target = path.join(home, "link-target.json");
      const targetDir = path.join(home, "link-target-dir");
      write(target, "{}");
      write(path.join(targetDir, "inner.json"), "{}");
      const link = (to, from, type) => {
        try {
          fs.symlinkSync(to, from, type);
          return true;
        } catch {
          // Creating file links needs a privilege on Windows; CI (Linux) must have it.
          assert.ok(!IN_CI, "symlinks must be available in CI");
          return false;
        }
      };
      const dirType = process.platform === "win32" ? "junction" : "dir";
      if (link(targetDir, path.join(config, "linked-dir"), dirType)) {
        await step("file inside a linked directory", () => fs.writeFileSync(path.join(targetDir, "inner.json"), '{"changed":1}'));
        if (link(config, path.join(targetDir, "loop"), dirType)) await step("link loop does not hang or break the key", () => fs.writeFileSync(path.join(config, "x.json"), "{}"));
      }
      if (link(target, path.join(config, "linked-file.json"), "file")) {
        await step("target of a linked file", () => fs.writeFileSync(target, '{"changed":1}'));
        await step("link target removed", () => fs.rmSync(target));
      }
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(profile, { recursive: true, force: true });
    }
  });
});

test("review: the real package never lets a changed linked policy through behind a remembered verdict", { timeout: 180000 }, async () => {
  await withTree({ real: true }, async (tree) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ductus-linkhome-"));
    try {
      const userDir = path.join(home, ".cc-safety-net");
      const target = path.join(home, "policy-target.json");
      const targetDir = path.join(home, "rules-target");
      fs.mkdirSync(userDir, { recursive: true });
      fs.writeFileSync(target, "{}");
      fs.mkdirSync(targetDir);
      const env = { ...process.env, HOME: home, USERPROFILE: home, CC_SAFETY_NET_HOME: userDir };
      const base = await run(tree, "Bash", "ls", undefined, env);
      assert.equal(base.code, 0, `baseline: ${base.stderr}`);
      const policy = path.join(userDir, "policy.json");
      // A policy that really switches a built-in protection off (checked against the package).
      const weakening = '{"version":1,"destructive_command_protection":{"enabled":false}}';
      let linked = true;
      const linkPolicy = () => {
        try {
          fs.symlinkSync(target, policy, "file");
        } catch {
          // Creating file links needs a privilege on Windows; CI (Linux) must have it.
          assert.ok(!IN_CI, "symlinks must be available in CI");
          linked = false;
          fs.writeFileSync(policy, fs.readFileSync(target));
        }
      };
      // Writes the "target"; without a working link the policy file itself is written too.
      const setTarget = (content) => {
        fs.writeFileSync(target, content);
        if (!linked) fs.writeFileSync(policy, content);
      };
      for (const [label, change] of [
        ["policy link added", linkPolicy],
        ["policy target garbage", () => setTarget("{ not json")],
        ["policy target emptied", () => setTarget("")],
        ["policy target changed", () => setTarget('{"changed":true}')],
        ["policy target removed", () => { fs.rmSync(target); if (!linked) fs.rmSync(policy, { force: true }); }],
      ]) {
        change();
        for (const command of ["git add -A", "git push --force origin x", "git commit --no-verify -m x"]) {
          const result = await run(tree, "Bash", command, undefined, env);
          assert.ok(safe(result), `${label}: ${command} -> ${result.code} ${result.stdout}`);
        }
      }
      // The case that matters: a good verdict is remembered for a harmless linked
      // policy, then its target is swapped for one that really switches a built-in
      // protection off. The package alone would then let the force push through.
      setTarget('{"version":1}');
      const ok = await run(tree, "Bash", "ls", undefined, env);
      assert.equal(ok.code, 0, `harmless linked policy: ${ok.stderr}`);
      assert.equal((await run(tree, "Bash", "ls", undefined, env)).code, 0);
      setTarget(weakening);
      const swapped = await run(tree, "Bash", "git push --force origin x", undefined, env);
      assert.equal(swapped.code, 2, `weakening policy behind the link: ${swapped.stdout}`);
      assert.equal(swapped.stdout, "");
      // And the package really does let it through on its own with that policy.
      const direct = spawnSync(process.execPath, [path.join(tree.root, "node_modules", "cc-safety-net", "dist", "bin", "cc-safety-net.js"), "hook", "--coding-cli"], {
        input: event("Bash", "git push --force origin x", tree.root),
        encoding: "utf8",
        env,
        cwd: tree.root,
      });
      assert.doesNotMatch(direct.stdout, /deny/, "the weakening policy does weaken the package");
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

test("review: a configuration too large or too slow to read is refused within the budget, never let through", { timeout: 120000 }, async () => {
  await withTree({ bin: "allow" }, async (tree) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ductus-limit-"));
    try {
      const config = path.join(home, ".cc-safety-net");
      const many = path.join(home, "many");
      const big = path.join(home, "big");
      fs.mkdirSync(config, { recursive: true });
      fs.mkdirSync(many);
      fs.mkdirSync(big);
      for (let i = 0; i < 30; i++) fs.writeFileSync(path.join(many, `f${i}.json`), "{}");
      fs.writeFileSync(path.join(big, "huge.bin"), Buffer.alloc(2 * 1024 * 1024));
      const env = { ...process.env, HOME: home, USERPROFILE: home };
      const linkDir = (target, name) => fs.symlinkSync(target, path.join(config, name), process.platform === "win32" ? "junction" : "dir");
      const probes = () => (fs.readFileSync(tree.calls, "utf8").match(/p/g) ?? []).length;
      const refused = async (limits, label) => {
        const before = probes();
        const started = Date.now();
        const result = await decide({ root: tree.root, input: event("Bash", "ls"), env, limits });
        assert.equal(result.code, 2, `${label}: ${result.stdout}`);
        assert.equal(result.stdout, "", label);
        assert.match(result.stderr, /too large or too slow/, label);
        assert.ok(Date.now() - started < 4000, `${label}: answered within the budget`);
        // The refusal comes before any probe: nothing was asked of the package for it.
        assert.equal(probes(), before, label);
      };
      assert.equal((await run(tree, "Bash", "ls", undefined, env)).code, 0, "baseline under the default limits");
      linkDir(many, "many");
      await refused({ maxEntries: 20 }, "many entries behind a link");
      assert.equal((await run(tree, "Bash", "ls", undefined, env)).code, 0, "within the default limits it still works");
      fs.rmSync(path.join(config, "many"), { recursive: true, force: true });
      linkDir(big, "big");
      await refused({ maxBytes: 1024 * 1024 }, "a big file behind a link");
      assert.equal((await run(tree, "Bash", "ls", undefined, env)).code, 0, "within the default limits it still works (2 MiB)");
      await refused({ maxMs: -1 }, "time budget");
      // A big file linked directly (needs a privilege on Windows; CI must have it).
      fs.rmSync(path.join(config, "big"), { recursive: true, force: true });
      try {
        fs.symlinkSync(path.join(big, "huge.bin"), path.join(config, "huge.bin"), "file");
        await refused({ maxBytes: 1024 * 1024 }, "a big file linked directly");
      } catch (error) {
        if (error?.code !== "EPERM") throw error;
        assert.ok(!IN_CI, "symlinks must be available in CI");
      }
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

// Several trees, each under the limit and together over it: the budget is one for all of them.
test("review: the limits are one shared budget across all trees (entries, bytes, time)", { timeout: 120000 }, async () => {
  await withTree({ bin: "allow" }, async (tree) => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "ductus-shared-"));
    const realNow = Date.now;
    try {
      const home = path.join(base, "home");
      const named = path.join(base, "named");
      const empty = path.join(base, "empty");
      const treeA = path.join(home, ".cc-safety-net");
      for (const dir of [treeA, named, empty]) fs.mkdirSync(dir, { recursive: true });
      const both = { ...process.env, HOME: home, USERPROFILE: home, CC_SAFETY_NET_HOME: named };
      const onlyA = { ...process.env, HOME: home, USERPROFILE: home };
      delete onlyA.CC_SAFETY_NET_HOME;
      const onlyB = { ...process.env, HOME: empty, USERPROFILE: empty, CC_SAFETY_NET_HOME: named };
      const attempt = (env, limits) => decide({ root: tree.root, input: event("Bash", "ls"), env, limits });
      const fill = (count, size) => {
        for (const dir of [treeA, named]) {
          fs.rmSync(dir, { recursive: true, force: true });
          fs.mkdirSync(dir, { recursive: true });
          for (let i = 0; i < count; i++) fs.writeFileSync(path.join(dir, `f${i}.json`), size ? Buffer.alloc(size) : "{}");
        }
      };
      const expectShared = async (limits, label) => {
        assert.equal((await attempt(onlyA, limits)).code, 0, `${label}: the first tree alone is under the limit`);
        assert.equal((await attempt(onlyB, limits)).code, 0, `${label}: the second tree alone is under the limit`);
        const together = await attempt(both, limits);
        assert.equal(together.code, 2, `${label}: together they are over it`);
        assert.equal(together.stdout, "", label);
        assert.match(together.stderr, /too large or too slow/, label);
      };
      // Entries: 15 + 15 (+ the project's few) against 25.
      fill(15, 0);
      await expectShared({ maxEntries: 25 }, "entries");
      // Bytes: 600 KiB + 600 KiB against 1 MiB.
      fill(1, 600 * 1024);
      await expectShared({ maxBytes: 1024 * 1024 }, "bytes");
      // Time, on a clock that advances one millisecond per reading: 20 + 20 entries against 40 ms.
      fill(20, 0);
      let now = 1_700_000_000_000;
      Date.now = () => now++;
      await expectShared({ maxMs: 40 }, "time");
      // The project's own tree draws on the same budget as the user's.
      const project = path.join(tree.root, ".cc-safety-net");
      fs.rmSync(treeA, { recursive: true, force: true });
      fs.rmSync(named, { recursive: true, force: true });
      fs.mkdirSync(named, { recursive: true });
      const onlyNamed = { ...onlyB };
      const withProject = async (count, size, limits, label) => {
        const extra = path.join(project, "extra");
        fs.rmSync(extra, { recursive: true, force: true });
        assert.equal((await attempt(onlyNamed, limits)).code, 0, `${label}: the project tree alone is under the limit`);
        fs.mkdirSync(extra, { recursive: true });
        for (let i = 0; i < count; i++) fs.writeFileSync(path.join(extra, `p${i}.json`), size ? Buffer.alloc(size) : "{}");
        fs.rmSync(named, { recursive: true, force: true });
        fs.mkdirSync(named, { recursive: true });
        for (let i = 0; i < count; i++) fs.writeFileSync(path.join(named, `u${i}.json`), size ? Buffer.alloc(size) : "{}");
        const together = await attempt(onlyNamed, limits);
        assert.equal(together.code, 2, `${label}: project and user together are over it`);
        assert.match(together.stderr, /too large or too slow/, label);
        fs.rmSync(extra, { recursive: true, force: true });
      };
      await withProject(15, 0, { maxEntries: 30 }, "project entries");
      await withProject(1, 600 * 1024, { maxBytes: 1024 * 1024 }, "project bytes");
    } finally {
      Date.now = realNow;
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

test("review: the instruction in the message is a command that passes", async () => {
  for (const dir of ["tree", "dir with spaces"]) {
    await withTree({ dir, bin: "allow" }, async (tree) => {
      const bare = fs.mkdtempSync(path.join(os.tmpdir(), "ductus-hint-"));
      try {
        const result = await run(tree, "Bash", "ls", bare);
        assert.equal(result.code, 2);
        const quoted = /Run exactly: (cd "[^"]+") \(/.exec(result.stderr)?.[1];
        assert.ok(quoted, result.stderr);
        assert.ok(isCdToRoot(quoted, tree.root));
        assert.equal((await run(tree, "Bash", quoted, bare)).code, 0);
      } finally {
        fs.rmSync(bare, { recursive: true, force: true });
      }
    });
  }
  // A root with characters a shell reads specially gets no cd instruction at all.
  await withTree({ dir: "odd$dir", bin: "allow" }, async (tree) => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), "ductus-hint-"));
    try {
      assert.doesNotMatch((await run(tree, "Bash", "ls", bare)).stderr, /Run exactly/);
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });
});

test("QA M1: answer() rejects non-JSON output, signals, bad statuses and errors on its own", () => {
  assert.ok(answer({ status: 0, stdout: "not json", stderr: "" }, 1).block);
  assert.ok(answer({ status: 0, signal: "SIGKILL", stdout: "", stderr: "" }, 1).block);
  assert.ok(answer({ status: null, signal: "SIGTERM", stdout: "", stderr: "" }, 1).block);
  assert.ok(answer({ status: 1, stdout: "", stderr: "" }, 1).block);
  assert.ok(answer({ error: Object.assign(new Error("x"), { code: "ETIMEDOUT" }), stdout: "", stderr: "" }, 1).block);
  assert.equal(answer({ status: 2, stdout: "", stderr: "no" }, 1).block.code, 2);
  assert.equal(answer({ status: 0, stdout: "{}", stderr: "" }, 1).block, undefined);
  assert.equal(answer({ status: 0, stdout: "", stderr: "" }, 1).block, undefined);
});

test("M2 a package that floods stdout is stopped by the buffer limit", () =>
  withTree({ bin: "big" }, async (tree) => {
    const result = await run(tree, "Bash", "git status");
    blocked(result, "big");
    assert.match(result.stderr, /ENOBUFS|could not run/);
  }));

test("M2 unreadable or mismatching version information blocks", async () => {
  await withTree({}, async (tree) => {
    fs.writeFileSync(path.join(tree.root, "node_modules", "cc-safety-net", "package.json"), "{ not json");
    const result = await run(tree, "Bash", "git status");
    blocked(result, "bad package.json");
    assert.match(result.stderr, /could not be verified/);
  });
  await withTree({}, async (tree) => {
    fs.writeFileSync(path.join(tree.root, "package.json"), "{}");
    const result = await run(tree, "Bash", "git status");
    blocked(result, "no pin");
    assert.match(result.stderr, /differs/);
  });
});

test("M2 the entry point turns any internal error into a block", async () => {
  const thrown = await runCli({ read: () => "", decideFn: () => { throw new Error("boom"); } });
  assert.equal(thrown.code, 2);
  assert.match(thrown.stderr, /wrapper error \(boom\)/);
  const unreadable = await runCli({ read: () => { throw new Error("no stdin"); }, decideFn: ({ input }) => ({ code: input === "" ? 2 : 0, stdout: "", stderr: "" }) });
  assert.equal(unreadable.code, 2);
});

test("isInstallCommand accepts only the two literal spellings", () => {
  assert.ok(isInstallCommand("pnpm install"));
  assert.ok(isInstallCommand(" pnpm install --frozen-lockfile "));
  assert.ok(!isInstallCommand(undefined));
  assert.ok(!isInstallCommand({ toString: () => "pnpm install" }));
});

test("malformed hook input never counts as an install", () =>
  withTree({ pkg: false }, async (tree) => {
    for (const input of ["", "not json", "null", "[]", JSON.stringify({ tool_input: { command: ["pnpm install"] } })]) {
      blocked(await decide({ root: tree.root, input }), JSON.stringify(input));
    }
  }));

// DAN-480: run 1, run 2 and the probes start together; the verdict is put together in the old order.
const denied = (result) => result.code === 0 && /"permissionDecision":\s*"deny"/.test(result.stdout);
const withSubdir = (options, fn) =>
  withTree(options, (tree) => {
    fs.writeFileSync(path.join(tree.root, ".git"), "gitdir: elsewhere");
    const sub = path.join(tree.root, "src");
    fs.mkdirSync(sub);
    return fn(tree, sub);
  });

test("DAN-480 real package: chaining, substitution and redirection are denied from the root and from a subdirectory", { timeout: 90000 }, () =>
  withSubdir({ real: true }, async (tree, sub) => {
    const attacks = ["ls; git add -A", "ls && git add -A", "ls || git add -A", "ls | git add -A", "echo $(git add -A)", "echo `git add -A`", "cat README.md > /dev/null; git add -A", "ls && git push --force origin x"];
    for (const cwd of [tree.root, sub]) {
      for (const command of attacks) assert.ok(denied(await run(tree, "Bash", command, cwd)), `${command} in ${cwd}`);
      assert.equal((await run(tree, "Bash", "ls", cwd)).stdout.trim(), "", `ls in ${cwd}`);
    }
    // Aliases are a gap of the rulebook, not of the wrapper: the verdict is the same from both directories.
    for (const command of ["alias ll='git add -A'; ll", "git -c alias.st='add -A' st"]) {
      const [atRoot, below] = [await run(tree, "Bash", command, tree.root), await run(tree, "Bash", command, sub)];
      assert.deepEqual([below.code, denied(below)], [atRoot.code, denied(atRoot)], command);
    }
  }));

test("DAN-480 a run that denies wins, and a run that hangs or crashes blocks, whichever finishes first", { timeout: 60000 }, () =>
  withSubdir({ bin: "split" }, async (tree, sub) => {
    const ask = (modes) => decide({ root: tree.root, input: event("Bash", "ls", sub), timeoutMs: 1500, env: { ...process.env, SN_SUB: sub, ...modes } });
    for (const run2 of ["hang", "crash", "allow"]) assert.ok(denied(await ask({ SN_RUN1: "deny", SN_RUN2: run2 })), `run 1 denies, run 2 ${run2}`);
    assert.ok(denied(await ask({ SN_RUN1: "allow", SN_RUN2: "deny" })), "run 2 denies, run 1 allows");
    for (const [run1, run2] of [["allow", "hang"], ["allow", "crash"], ["hang", "allow"], ["crash", "allow"]]) {
      const result = await ask({ SN_RUN1: run1, SN_RUN2: run2 });
      assert.equal(result.code, 2, `run 1 ${run1}, run 2 ${run2}: ${result.stdout}`);
      assert.equal(result.stdout, "");
    }
    assert.equal((await ask({ SN_RUN1: "allow", SN_RUN2: "allow" })).code, 0);
  }));

test("DAN-480 a probe that fails while both runs allow blocks", { timeout: 60000 }, async () => {
  for (const probe of ["allow", "hang", "crash"]) {
    await withSubdir({ bin: "split" }, async (tree, sub) => {
      const result = await decide({ root: tree.root, input: event("Bash", "ls", sub), timeoutMs: 1500, env: { ...process.env, SN_SUB: sub, SN_RUN1: "allow", SN_RUN2: "allow", SN_PROBE: probe } });
      blocked(result, `probe ${probe}`);
      assert.match(result.stderr, /control probe/);
    });
  }
});

test("DAN-480 in a subdirectory with a cold probe the four runs overlap", { timeout: 60000 }, () =>
  withSubdir({ bin: "split" }, async (tree, sub) => {
    const started = Date.now();
    const result = await decide({ root: tree.root, input: event("Bash", "ls", sub), env: { ...process.env, SN_SUB: sub, SN_RUN1: "allow", SN_RUN2: "allow", SN_DELAY: "400" } });
    assert.equal(result.code, 0, result.stderr);
    // One after another the four runs take at least 1600 ms.
    assert.ok(Date.now() - started < 1200, `${Date.now() - started} ms`);
  }));

test("DAN-480 the exit code is 2 until a verdict exists, and stays 2 when the verdict fails", async () => {
  const saved = process.exitCode;
  const write = process.stderr.write;
  try {
    process.stderr.write = () => true;
    main(() => new Promise(() => {}));
    assert.equal(process.exitCode, 2, "a verdict that never comes leaves exit 2");
    await main(() => Promise.reject(new Error("late")));
    assert.equal(process.exitCode, 2, "a rejected verdict");
    await main(() => ({ code: 0, stdout: "", stderr: "" }));
    assert.equal(process.exitCode, 0, "only a verdict sets another code");
  } finally {
    process.stderr.write = write;
    process.exitCode = saved;
  }
});

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

// Git hooks export GIT_DIR and friends; a child git or the precheck would then act on the
// repository running the tests instead of the temporary one.
const gitFreeEnv = (env = process.env) => Object.fromEntries(Object.entries(env).filter(([key]) => !key.toUpperCase().startsWith("GIT_")));
const gitIn = (dir, ...args) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: dir, encoding: "utf8", env: gitFreeEnv() });
const withOriginMain = (dir) => {
  gitIn(dir, "init", "-q");
  gitIn(dir, "commit", "-q", "--allow-empty", "-m", "x");
  gitIn(dir, "update-ref", "refs/remotes/origin/main", "HEAD");
};

test("A13c the test helpers drop inherited GIT_* variables, so a decoy repository is never read or written", () => {
  const decoy = fs.mkdtempSync(path.join(os.tmpdir(), "ductus-decoy-"));
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "ductus-pre3-"));
  // Hooks and CI runners export these; the helpers must neither obey nor leak them.
  const names = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_CONFIG_GLOBAL", "GIT_CEILING_DIRECTORIES", "GIT_OBJECT_DIRECTORY", "GIT_NAMESPACE"];
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    withOriginMain(decoy);
    const refBefore = gitIn(decoy, "rev-parse", "refs/remotes/origin/main").stdout;
    process.env.GIT_DIR = path.join(decoy, ".git");
    process.env.GIT_WORK_TREE = decoy;
    process.env.GIT_INDEX_FILE = path.join(decoy, "index-decoy");
    process.env.GIT_CONFIG_GLOBAL = path.join(decoy, "gitconfig-decoy");
    process.env.GIT_CEILING_DIRECTORIES = base;
    process.env.GIT_OBJECT_DIRECTORY = path.join(decoy, "objects-decoy");
    process.env.GIT_NAMESPACE = "decoy";
    assert.deepEqual(Object.keys(gitFreeEnv()).filter((key) => key.toUpperCase().startsWith("GIT_")), [], "no GIT_* reaches a child");
    // A plain directory: with the inherited GIT_DIR the decoy would make the file list readable.
    const body = path.join(base, "body.md");
    fs.writeFileSync(body, "Agent: claude:a:platforma\nRisk: low\nTask: DAN-1\n");
    const go = () => spawnSync(process.execPath, [precheck], { input: JSON.stringify({ tool_input: { command: `gh pr create --title t --body-file "${body}"` }, cwd: base }), encoding: "utf8", env: gitFreeEnv() });
    assert.equal(go().status, 2, "no repository in the directory: blocked, whatever the inherited GIT_* say");
    withOriginMain(base);
    assert.equal(go().status, 0);
    assert.equal(gitIn(decoy, "rev-parse", "refs/remotes/origin/main").stdout, refBefore, "the decoy repository is untouched");
    assert.equal(gitIn(decoy, "log", "--oneline").stdout.trim().split("\n").length, 1, "no extra commit landed in the decoy");
    assert.equal(fs.existsSync(path.join(decoy, "index-decoy")), false, "no decoy index was created");
  } finally {
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(decoy, { recursive: true, force: true });
  }
});

test("A13b the PR metadata precheck blocks when the changed files cannot be read, and allows an empty list", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "ductus-pre2-"));
  try {
    const body = path.join(base, "body.md");
    fs.writeFileSync(body, "Agent: claude:a:platforma\nRisk: low\nTask: DAN-1\n");
    const go = () => spawnSync(process.execPath, [precheck], { input: JSON.stringify({ tool_input: { command: `gh pr create --title t --body-file "${body}"` }, cwd: base }), encoding: "utf8", env: gitFreeEnv() });
    // Not a repository (or no origin/main): the risk floor cannot be computed.
    const unreadable = go();
    assert.equal(unreadable.status, 2, unreadable.stderr);
    assert.match(unreadable.stderr, /could not read the changed files/);
    // A readable origin/main with nothing changed is an empty list, not an error.
    withOriginMain(base);
    const ok = go();
    assert.equal(ok.status, 0, ok.stderr);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("A13 the PR metadata precheck blocks when it throws on a PR command, and ignores other commands", () => {
  // The preload makes the metadata parser throw, as an internal error would.
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "ductus-pre-"));
  try {
    const preload = path.join(base, "preload.mjs");
    fs.writeFileSync(preload, "const o = String.prototype.startsWith; String.prototype.startsWith = function (...a) { if (a[0] === 'agent:') throw new Error('injected'); return o.apply(this, a); };");
    const go = (command, args = []) => spawnSync(process.execPath, [...args, precheck], { input: JSON.stringify({ tool_input: { command }, cwd: base }), encoding: "utf8", env: gitFreeEnv() });
    const broken = ["--import", pathToFileURL(preload).href];
    // The directory needs a readable origin/main, or the changed files cannot be listed.
    withOriginMain(base);
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
