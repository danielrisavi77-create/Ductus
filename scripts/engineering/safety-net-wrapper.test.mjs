import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { answer, decide, foreignRules, isCdToRoot, isInstallCommand, main, readRegular, runCli, samePath, treeDigest } from "../hooks/safety-net.mjs";

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
  // A child that leaves a grandchild holding its stdout and stderr open, then hangs (orphan) or exits at once (orphanexit).
  orphan:
    "const g=require('child_process').spawn(process.execPath,['-e','setTimeout(()=>{},60000)'],{stdio:['ignore','inherit','inherit']});require('fs').appendFileSync(__dirname+'/orphan.pid',g.pid+'\\n');setInterval(()=>{},1000);",
  orphanexit:
    "const g=require('child_process').spawn(process.execPath,['-e','setTimeout(()=>{},60000)'],{stdio:['ignore','inherit','inherit']});require('fs').appendFileSync(__dirname+'/orphan.pid',g.pid+'\\n');process.exit(0);",
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
    // Returned, so an async body is awaited and its failures count.
    return fn(t);
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
        // Same configuration in another checkout directory: another state.
        fs.cpSync(project, path.join(other, ".cc-safety-net"), { recursive: true });
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
    // Routine commands get the same verdict from both directories.
    for (const command of ["git status", "cat README.md", "grep -n x README.md"]) {
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

test("DAN-480 a run whose grandchild keeps the pipes open still blocks within the time limit", { timeout: 30000 }, async () => {
  for (const bin of ["orphan", "orphanexit"]) {
    await withTree({ bin }, async (tree) => {
      const pidFile = path.join(path.dirname(tree.calls), "orphan.pid");
      try {
        const started = Date.now();
        const result = await decide({ root: tree.root, input: event("Bash", "ls"), timeoutMs: 400 });
        blocked(result, bin);
        assert.match(result.stderr, /did not answer/, bin);
        assert.ok(Date.now() - started < 5000, `${bin}: ${Date.now() - started} ms`);
      } finally {
        // Run 1 and each probe leave one grandchild.
        const pids = fs.existsSync(pidFile) ? fs.readFileSync(pidFile, "utf8").split("\n").filter(Boolean) : [];
        for (const pid of pids) {
          try {
            process.kill(Number(pid), "SIGKILL");
          } catch {
            // Already gone.
          }
        }
      }
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

// F-035 (a): rules count only from the project root, from the top of a checkout
// that shares the root's git directory, or as a byte-identical copy of the
// root's project config. Any other rule source is refused, also when its
// reduced rulebook still denies the two probe commands.
const RULES = [".cc-safety-net", "rules", "ductus-rules", "rulebook.json"];
const plantRules = (dir, content = '{"reduced":1}') => {
  fs.mkdirSync(path.join(dir, ...RULES.slice(0, -1)), { recursive: true });
  fs.writeFileSync(path.join(dir, ...RULES), content);
};
const foreign = (result, label) => {
  assert.equal(result.code, 2, `${label}: ${result.stdout}`);
  assert.match(result.stderr, /not a checkout of this repository|could not be compared/, label);
};
const gitRepo = (dir) => {
  for (const args of [["init", "-q", "-b", "main"], ["add", "package.json"], ["commit", "-q", "-m", "init"]]) {
    const done = gitIn(dir, ...args);
    assert.equal(done.status, 0, done.stderr);
  }
};
// What `git worktree add` writes, by hand: the admin directory under the common
// git directory and the `.git` file of the worktree that names it.
const linkWorktree = (common, top, name, { back = path.join(top, ".git") } = {}) => {
  const admin = path.join(common, "worktrees", name);
  fs.mkdirSync(admin, { recursive: true });
  fs.writeFileSync(path.join(admin, "gitdir"), `${back}\n`);
  fs.writeFileSync(path.join(admin, "commondir"), "../..\n");
  fs.writeFileSync(path.join(top, ".git"), `gitdir: ${admin}\n`);
  return admin;
};
const scratch = (fn) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "ductus-f035-"));
  const done = () => fs.rmSync(base, { recursive: true, force: true });
  let result;
  try {
    result = fn(base);
  } finally {
    if (typeof result?.then !== "function") done();
  }
  return typeof result?.then === "function" ? result.finally(done) : result;
};

test("F-035 a: rules outside the checkout count only as a byte-identical copy of the project's", { timeout: 60000 }, () =>
  withTree({ bin: "allow" }, (tree) =>
    scratch(async (base) => {
      gitRepo(tree.root);
      const ask = (cwd, command = "ls") => run(tree, "Bash", command, cwd);
      const cases = {
        "no .git": () => {},
        "a .git file naming nothing": (dir) => fs.writeFileSync(path.join(dir, ".git"), "gitdir: elsewhere\n"),
        "a git directory of another repository": (dir) => assert.equal(gitIn(dir, "init", "-q").status, 0),
        "a .git link to the project's git directory": (dir) => fs.symlinkSync(path.join(tree.root, ".git"), path.join(dir, ".git")),
      };
      for (const [label, plant] of Object.entries(cases)) {
        const dir = path.join(base, label.replace(/\W+/g, "-"));
        fs.mkdirSync(path.join(dir, "sub"), { recursive: true });
        plantRules(dir);
        plant(dir);
        foreign(await ask(dir), label);
        const below = await ask(path.join(dir, "sub"));
        // Without a checkout boundary the search looks only at the cwd itself,
        // so from below there is no rulebook at all: blocked either way.
        if (label === "no .git") assert.equal(below.code, 2, `${label}, from below`);
        else foreign(below, `${label}, from below`);
        // The way back to the project root stays open.
        assert.equal((await ask(dir, `cd "${tree.root}"`)).code, 0, `${label}: cd to the root`);
      }
      const copy = path.join(base, "copy");
      fs.cpSync(path.join(tree.root, ".cc-safety-net"), path.join(copy, ".cc-safety-net"), { recursive: true });
      assert.equal((await ask(copy)).code, 0, "a byte-identical copy is accepted");
      fs.appendFileSync(path.join(copy, ...RULES), " ");
      foreign(await ask(copy), "one byte more");
      assert.equal((await ask(tree.root)).code, 0, "the root itself");
    })));

test("F-035 a: a subdirectory with its own reduced rules is refused, the root's rules still apply below it", { timeout: 60000 }, () =>
  withTree({ bin: "allow" }, async (tree) => {
    fs.writeFileSync(path.join(tree.root, ".git"), "gitdir: elsewhere");
    const sub = path.join(tree.root, "src");
    fs.mkdirSync(path.join(sub, "deep"), { recursive: true });
    assert.equal((await run(tree, "Bash", "ls", path.join(sub, "deep"))).code, 0, "before");
    plantRules(sub);
    for (const cwd of [sub, path.join(sub, "deep")]) foreign(await run(tree, "Bash", "ls", cwd), cwd);
  }));

test("F-035 a: a genuine worktree of the repository keeps its own rules, inside or outside the checkout", { timeout: 60000 }, () =>
  withTree({ bin: "allow" }, (tree) =>
    scratch(async (base) => {
      gitRepo(tree.root);
      const inside = path.join(tree.root, ".claude", "worktrees", "w");
      const outside = path.join(base, "wt");
      for (const [dir, branch] of [[inside, "w"], [outside, "o"]]) {
        const added = gitIn(tree.root, "worktree", "add", "-q", "-b", branch, dir);
        assert.equal(added.status, 0, added.stderr);
        plantRules(dir, `{"branch":"${branch}"}`);
        fs.mkdirSync(path.join(dir, "sub"));
        for (const cwd of [dir, path.join(dir, "sub")]) assert.equal((await run(tree, "Bash", "ls", cwd)).code, 0, cwd);
      }
      // The project root may itself be a worktree; the main checkout is then the same repository.
      const main = path.join(base, "main");
      fs.mkdirSync(main);
      fs.writeFileSync(path.join(main, "package.json"), "{}");
      gitRepo(main);
      fs.rmSync(path.join(tree.root, ".git"), { recursive: true, force: true });
      linkWorktree(path.join(main, ".git"), tree.root, "tree");
      plantRules(main, '{"main":1}');
      assert.equal((await run(tree, "Bash", "ls", main)).code, 0, "main checkout of a worktree root");
    })));

test("F-035 a: a forged or copied worktree link is refused", { timeout: 60000 }, () =>
  withTree({ bin: "allow" }, (tree) =>
    scratch(async (base) => {
      gitRepo(tree.root);
      const common = path.join(tree.root, ".git");
      const genuine = path.join(base, "genuine");
      assert.equal(gitIn(tree.root, "worktree", "add", "-q", "-b", "g", genuine).status, 0);
      const cases = {
        "admin directory links back to another checkout": (dir) => linkWorktree(common, dir, "forged", { back: path.join(genuine, ".git") }),
        "the .git file of a genuine worktree, copied": (dir) => fs.copyFileSync(path.join(genuine, ".git"), path.join(dir, ".git")),
        // Codex c.6627100367: a hard link shares the inode of the genuine file.
        "the .git file of a genuine worktree, hard-linked": (dir) => fs.linkSync(path.join(genuine, ".git"), path.join(dir, ".git")),
        "admin directory outside worktrees/": (dir) => {
          const admin = path.join(base, "admin", "x");
          fs.mkdirSync(admin, { recursive: true });
          fs.writeFileSync(path.join(admin, "gitdir"), path.join(dir, ".git"));
          fs.writeFileSync(path.join(admin, "commondir"), common);
          fs.writeFileSync(path.join(dir, ".git"), `gitdir: ${admin}`);
        },
        "gitdir of the admin directory is a link": (dir) => {
          const admin = linkWorktree(common, dir, "linked");
          fs.renameSync(path.join(admin, "gitdir"), path.join(base, "gitdir-target"));
          fs.symlinkSync(path.join(base, "gitdir-target"), path.join(admin, "gitdir"));
        },
        "the .git file is a link to a genuine one": (dir) => {
          linkWorktree(common, dir, "viaLink", { back: path.join(dir, ".git") });
          fs.renameSync(path.join(dir, ".git"), path.join(base, "dotgit-target"));
          fs.symlinkSync(path.join(base, "dotgit-target"), path.join(dir, ".git"));
        },
      };
      for (const [label, plant] of Object.entries(cases)) {
        const dir = path.join(base, label.replace(/\W+/g, "-"));
        fs.mkdirSync(dir);
        plantRules(dir);
        plant(dir);
        foreign(await run(tree, "Bash", "ls", dir), label);
      }
    })));

test("F-035 a (r4435902776): a FIFO in place of .git, gitdir or commondir blocks at once", { timeout: 60000 }, (t) => {
  if (process.platform !== "linux") {
    assert.ok(!IN_CI, "CI runs on Linux, where mkfifo exists");
    return t.skip("mkfifo is Linux-only here; this case runs on Linux CI");
  }
  return withTree({ bin: "allow" }, (tree) =>
    scratch(async (base) => {
      gitRepo(tree.root);
      const common = path.join(tree.root, ".git");
      const fifo = (file) => {
        fs.rmSync(file, { force: true });
        assert.equal(spawnSync("mkfifo", [file]).status, 0, `mkfifo ${file}`);
      };
      const cases = {
        ".git": (dir) => fifo(path.join(dir, ".git")),
        gitdir: (dir) => fifo(path.join(linkWorktree(common, dir, "fifo-gitdir"), "gitdir")),
        commondir: (dir) => fifo(path.join(linkWorktree(common, dir, "fifo-commondir"), "commondir")),
        "a rule file": (dir) => fifo(path.join(dir, ".cc-safety-net", "rules", "extra.json")),
      };
      for (const [label, plant] of Object.entries(cases)) {
        const dir = path.join(base, label.replace(/\W+/g, "-"));
        fs.mkdirSync(dir);
        plantRules(dir);
        plant(dir);
        const started = Date.now();
        const result = await decide({ root: tree.root, input: event("Bash", "ls", dir), timeoutMs: 1500 });
        foreign(result, label);
        assert.ok(Date.now() - started < 3000, `${label}: ${Date.now() - started} ms`);
      }
    }));
});

test("F-035 a: the file reader returns only regular files within the limit, never waits and follows links only when told", () =>
  scratch((base) => {
    const file = path.join(base, "file");
    fs.writeFileSync(file, "abc");
    const link = path.join(base, "link");
    fs.symlinkSync(file, link);
    assert.equal(readRegular(file)?.toString(), "abc");
    assert.equal(readRegular(file, { max: 2 }), null, "too big");
    assert.equal(readRegular(link), null, "a link is refused by default");
    assert.equal(readRegular(link, { follow: true })?.toString(), "abc");
    assert.equal(readRegular(base), null, "a directory");
    assert.equal(readRegular(path.join(base, "missing")), null);
    if (process.platform === "linux") {
      const fifo = path.join(base, "fifo");
      assert.equal(spawnSync("mkfifo", [fifo]).status, 0);
      assert.equal(readRegular(fifo), null, "a FIFO without a writer");
      assert.equal(readRegular(fifo, { follow: true }), null);
    }
  }));

test("F-035 a: a project config too large to compare is refused", { timeout: 60000 }, () =>
  withTree({ bin: "allow" }, (tree) =>
    scratch(async (base) => {
      plantRules(base);
      for (let i = 0; i < 30; i++) fs.writeFileSync(path.join(base, ".cc-safety-net", `f${i}.json`), "{}");
      const result = await decide({ root: tree.root, input: event("Bash", "ls", base), limits: { maxEntries: 10 } });
      foreign(result, "over the entry limit");
      assert.match(result.stderr, /could not be compared/);
    })));

// F-035 (a), review c.6590482994: with foreign rules only the way back to the
// project root stays open, the install commands included; the other ways
// without usable rules keep the install exception.
test("F-035 a: foreign rules leave only cd to the root open, also for the install commands", { timeout: 60000 }, () =>
  withTree({ bin: "allow" }, (tree) =>
    scratch(async (base) => {
      gitRepo(tree.root);
      const installs = ["pnpm install", "pnpm install --frozen-lockfile"];
      const stranger = path.join(base, "stranger");
      fs.mkdirSync(stranger);
      plantRules(stranger);
      const otherRepo = path.join(base, "other-repo");
      fs.mkdirSync(path.join(otherRepo, "sub"), { recursive: true });
      assert.equal(gitIn(otherRepo, "init", "-q").status, 0);
      plantRules(otherRepo);
      const empty = path.join(base, "empty");
      fs.mkdirSync(empty);
      const ownBelow = path.join(tree.root, "src");
      fs.mkdirSync(path.join(ownBelow, ".cc-safety-net"), { recursive: true });
      fs.writeFileSync(path.join(ownBelow, ".cc-safety-net", "config.json"), "{}");
      // Review c.6591599265: a directory with its own config below foreign rules.
      const foreignOwn = path.join(otherRepo, "own");
      fs.mkdirSync(path.join(foreignOwn, ".cc-safety-net"), { recursive: true });
      fs.writeFileSync(path.join(foreignOwn, ".cc-safety-net", "config.json"), "{}");
      const rows = [
        // [class, cwd, command, expected code, stderr pattern when blocked]
        ...installs.flatMap((command) => [
          ["1/2 foreign, no .git", stranger, command, 2, /not a checkout of this repository/],
          ["1/2 foreign, another repository", otherRepo, command, 2, /not a checkout of this repository/],
          ["4 foreign, from below the .git boundary", path.join(otherRepo, "sub"), command, 2, /not a checkout of this repository/],
          ["5 own rules, the project root", tree.root, command, 0],
          ["6 no rulebook, no foreign directory", empty, command, 0],
          ["7 own config below the rulebook", ownBelow, command, 0],
          ["8 own config below foreign rules", foreignOwn, command, 2, /not a checkout of this repository/],
        ]),
        ["8 own config below foreign rules", foreignOwn, "ls", 2, /not a checkout of this repository/],
        ...[stranger, otherRepo, path.join(otherRepo, "sub"), foreignOwn].map((cwd) => ["3 foreign, cd to the root", cwd, `cd "${tree.root}"`, 0]),
        // Controls: the same directories still block an ordinary command.
        ["6 control", empty, "ls", 2, /no project rulebook/],
        ["7 control", ownBelow, "ls", 2, /has its own \.cc-safety-net/],
      ];
      for (const [label, cwd, command, code, stderr] of rows) {
        const result = await run(tree, "Bash", command, cwd);
        assert.equal(result.code, code, `${label}: ${command} in ${cwd}\n${result.stderr}`);
        if (stderr) assert.match(result.stderr, stderr, `${label}: ${command}`);
      }
    })));

// F-035 (a), QA c.6591641283: the tree digest is an unambiguous encoding, so two
// different configuration trees never give the same digest.
test("F-035 a: different trees give different digests, identical copies the same", () =>
  scratch((base) => {
    let n = 0;
    const tree = (build) => {
      const dir = path.join(base, `t${n++}`, "cfg");
      fs.mkdirSync(dir, { recursive: true });
      build(dir);
      return dir;
    };
    const file = (dir, rel, content = "") => {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), content);
    };
    const rulebook = "rules/ductus-rules/rulebook.json";
    const rows = [
      // [class, tree A, tree B, same digest]
      [
        "D1 file content continues as the record of the next file",
        (d) => (file(d, rulebook, "R"), file(d, "rules/rule.json", "M")),
        (d) => file(d, rulebook, "R\nf:rules/rule.json:M"),
        false,
      ],
      ["D4 an empty file against no entry", (d) => file(d, "a"), () => {}, false],
      ["D4 an empty file against an empty directory", (d) => file(d, "a"), (d) => fs.mkdirSync(path.join(d, "a")), false],
      ["D6 a byte-identical copy", (d) => (file(d, rulebook, "R"), file(d, "rules/rule.json", "M")), (d) => (file(d, rulebook, "R"), file(d, "rules/rule.json", "M")), true],
    ];
    // Line breaks and colons in names and link targets exist outside Windows only.
    if (process.platform !== "win32") {
      rows.push(
        ["D2 a name with a line break against two entries", (d) => fs.mkdirSync(path.join(d, "a\nd:b")), (d) => (fs.mkdirSync(path.join(d, "a")), fs.mkdirSync(path.join(d, "b"))), false],
        ["D2 a name with a colon against a file and its content", (d) => file(d, "a:1", ""), (d) => file(d, "a", "1:"), false],
        [
          "D5 a link target with a line break against a link and an entry",
          (d) => fs.symlinkSync("t\ndangling:l\nd:x", path.join(d, "l")),
          (d) => (fs.symlinkSync("t", path.join(d, "l")), fs.mkdirSync(path.join(d, "x\ndangling:l"))),
          false,
        ],
      );
    }
    if (process.platform === "linux") {
      // A link to a file that cannot be read (EIO) against one to a file whose
      // content is the placeholder the walk used for an unreadable file.
      const via = (target) => (d) => {
        fs.symlinkSync(target, path.join(d, "..", "t"));
        fs.symlinkSync("../t", path.join(d, "a"));
      };
      const placeholder = path.join(base, "placeholder");
      fs.writeFileSync(placeholder, "unreadable");
      rows.push(["D3 an unreadable file against its placeholder", via("/proc/self/mem"), via(placeholder), false]);
    } else assert.ok(!IN_CI, "CI runs on Linux, where /proc exists");
    const wrong = rows.filter(([, a, b, same]) => (treeDigest(tree(a)) === treeDigest(tree(b))) !== same).map(([label]) => label);
    assert.deepEqual(wrong, []);
  }));

test("F-035 a (QA c.6591641283): a copy whose rulebook spells out a missing file is not taken as identical", { timeout: 60000 }, () =>
  withTree({ bin: "allow" }, (tree) =>
    scratch(async (base) => {
      const rules = path.join(tree.root, ".cc-safety-net", "rules");
      fs.writeFileSync(path.join(rules, "rule.json"), "M");
      const rulebook = fs.readFileSync(path.join(tree.root, ...RULES), "utf8");
      plantRules(base, `${rulebook}\nf:rules/rule.json:M`);
      foreign(await run(tree, "Bash", "ls", base), "forged copy");
      fs.cpSync(path.join(tree.root, ".cc-safety-net"), path.join(base, "copy", ".cc-safety-net"), { recursive: true });
      assert.equal((await run(tree, "Bash", "ls", path.join(base, "copy"))).code, 0, "a byte-identical copy is still accepted");
    })));

// F-035 a (review c.6592372807, QA c.6592414127): an entry of the project config
// whose content cannot be established never counts as part of a byte-identical
// copy. The same entry in the root and in the foreign copy blocks, for both
// tools, while the root, cd to the root and an identical copy stay open (P1-P3).
// `ask(tool, command, cwd)` is the caller under test and resolves to
// { code, stdout, stderr }; `check(result, label)` adds its own assertions.
const unreadableMatrix = (tree, base, ask, check = () => []) => async () => {
  const config = path.join(tree.root, ".cc-safety-net");
  const asRoot = process.getuid?.() === 0;
  const locked = (target) => {
    try {
      fs.readdirSync(target);
      return false;
    } catch {
      try {
        fs.readFileSync(target);
        return false;
      } catch {
        return true;
      }
    }
  };
  const rows = [];
  // [class, build(config dir, side), clean(config dir)]
  if (process.platform === "linux") {
    rows.push(["U1 a file that cannot be read, also by root (EIO)", (d) => fs.symlinkSync("/proc/self/mem", path.join(d, "extra.bin"))]);
    rows.push(["U4 a FIFO of the same name", (d) => assert.equal(spawnSync("mkfifo", [path.join(d, "pipe")]).status, 0, "mkfifo")]);
  } else assert.ok(!IN_CI, "CI runs on Linux, where /proc and mkfifo exist");
  if (process.platform !== "win32") {
    rows.push(["U5 a dangling link with the same target", (d) => fs.symlinkSync("missing-target", path.join(d, "gone"))]);
    if (!asRoot) {
      rows.push([
        "U2 files of the same name and size, different content, no read permission",
        (d, side) => {
          const file = path.join(d, "extra.bin");
          fs.writeFileSync(file, side === "root" ? "AAAA" : "BBBB");
          fs.chmodSync(file, 0o000);
          assert.ok(locked(file), "the file is unreadable");
        },
        (d) => fs.chmodSync(path.join(d, "extra.bin"), 0o600),
      ]);
      rows.push([
        "U3 a directory of the same name without read permission",
        (d, side) => {
          const dir = path.join(d, "locked");
          fs.mkdirSync(dir);
          fs.writeFileSync(path.join(dir, "x"), side);
          fs.chmodSync(dir, 0o000);
          assert.ok(locked(dir), "the directory is unreadable");
        },
        (d) => fs.chmodSync(path.join(d, "locked"), 0o700),
      ]);
    } else assert.ok(!IN_CI, "CI runs the tests without root, where a mode of 000 takes effect");
  } else assert.ok(!IN_CI, "CI runs on Linux, where links and modes work");
  const before = fs.readdirSync(config);
  const failures = [];
  const expect = (result, label, ok) => {
    if (!ok) failures.push(`${label}: ${result.code} ${result.stdout} ${result.stderr}`);
    failures.push(...check(result, label));
  };
  for (const [i, [label, build, clean]] of rows.entries()) {
    const copy = path.join(base, `u${i}`);
    fs.cpSync(config, path.join(copy, ".cc-safety-net"), { recursive: true });
    build(config, "root");
    build(path.join(copy, ".cc-safety-net"), "copy");
    try {
      try {
        treeDigest(path.join(copy, ".cc-safety-net"), [], undefined, { strict: true });
        failures.push(`${label}: the strict digest gives a value`);
      } catch {
        // refused, as it must be
      }
      for (const tool of TOOLS) {
        const result = await ask(tool, "ls", copy);
        expect(result, `${label} (${tool})`, result.code === 2 && /could not be compared/.test(result.stderr));
        const back = await ask(tool, `cd "${tree.root}"`, copy);
        expect(back, `P1 ${label} (${tool}): cd to the root`, back.code === 0);
        const own = await ask(tool, "ls", tree.root);
        expect(own, `P2 ${label} (${tool}): the root itself`, own.code === 0);
      }
    } finally {
      clean?.(config);
      clean?.(path.join(copy, ".cc-safety-net"));
      for (const name of fs.readdirSync(config)) if (!before.includes(name)) fs.rmSync(path.join(config, name), { recursive: true, force: true });
    }
  }
  // P3: with every extra entry gone, a byte-identical copy is accepted again.
  fs.cpSync(config, path.join(base, "same", ".cc-safety-net"), { recursive: true });
  for (const tool of TOOLS) {
    const same = await ask(tool, "ls", path.join(base, "same"));
    expect(same, `P3 (${tool}): a byte-identical copy`, same.code === 0);
  }
  assert.deepEqual(failures, []);
  return rows.length;
};

test("F-035 a (QA c.6592414127): an entry that cannot be read never makes a foreign copy identical", { timeout: 120000 }, () =>
  withTree({ bin: "allow" }, (tree) => scratch((base) => unreadableMatrix(tree, base, (tool, command, cwd) => run(tree, tool, command, cwd))())));

// F-035 a (QA c.6625690084, #1482 t. 4): the same matrix through the configured
// caller, not a direct call of decide: the exact PreToolUse command of
// .claude/settings.json under bash, so node runs scripts/hooks/safety-net.mjs
// and main -> runCli -> decide read the event from stdin. The event names the
// foreign cwd explicitly and the hook process starts there too. Exit code,
// stdout, stderr and the duration within the hook timeout are checked per call.
// A wrapper that cannot start the hook also exits 2, so its messages never count.
shellTest("F-035 a (QA c.6625690084): U1-U5 and P1-P3 through the configured PreToolUse hook with an explicit foreign cwd", (t) =>
  withTree({ bin: "allow" }, (tree) =>
    scratch(async (base) => {
      // The entry is read from .claude/settings.json; a changed configuration fails here.
      assert.ok(hookEntry, "PreToolUse hook for safety-net.mjs in .claude/settings.json");
      const group = settings.hooks.PreToolUse.find((entry) => entry.hooks?.includes(hookEntry));
      for (const tool of TOOLS) assert.ok(new RegExp(`^(?:${group.matcher})$`).test(tool), `the matcher covers ${tool}`);
      assert.equal(hookEntry.shell, "bash");
      assert.ok(Number.isFinite(hookEntry.timeout) && hookEntry.timeout > 0, "the hook timeout comes from the entry");
      const limitMs = hookEntry.timeout * 1000;
      const calls = [];
      const timings = [];
      const viaHook = (tool, command, cwd) => {
        const started = Date.now();
        const done = spawnSync("bash", ["-c", hookEntry.command], {
          cwd,
          input: event(tool, command, cwd),
          encoding: "utf8",
          env: { ...process.env, CLAUDE_PROJECT_DIR: tree.root },
          timeout: limitMs,
        });
        const result = { code: done.status, stdout: done.stdout, stderr: done.stderr, ms: Date.now() - started, error: done.error };
        calls.push({ tool, command, cwd, ...result });
        return result;
      };
      const check = (result, label) => {
        const problems = [];
        if (result.error) problems.push(`${label}: ${result.error.message}`);
        if (!(result.ms < limitMs)) problems.push(`${label}: ${result.ms} ms is not below the hook timeout of ${limitMs} ms`);
        // A block answers on stderr only, an allow prints nothing.
        if (result.code === 2 && result.stdout !== "") problems.push(`${label}: a block printed to stdout: ${result.stdout}`);
        if (result.code === 2 && !/^Safety hook blocked this command: /.test(result.stderr)) problems.push(`${label}: unexpected block message: ${result.stderr}`);
        if (result.code === 0 && result.stderr !== "") problems.push(`${label}: an allow printed to stderr: ${result.stderr}`);
        if (result.code === 0 && result.stdout !== "") problems.push(`${label}: an allow printed to stdout: ${result.stdout}`);
        for (const wrapper of ["Safety hook cannot run", "failed unexpectedly"]) {
          if (result.stderr.includes(wrapper)) problems.push(`${label}: the wrapper did not run the hook: ${result.stderr}`);
        }
        timings.push(`${label}: exit ${result.code}, ${result.ms} ms`);
        return problems;
      };
      const rows = await unreadableMatrix(tree, base, viaHook, check)();
      for (const line of timings) t.diagnostic(line);
      // Every class row asks 3 times per tool, P3 once per tool: nothing was skipped.
      assert.equal(calls.length, (rows * 3 + 1) * TOOLS.length);
      assert.ok(calls.some((call) => call.cwd !== tree.root && call.code === 2), "a foreign cwd was blocked through the hook");
    })));

// F-035 a (Codex c.6627100367): two paths are the same directory only when the
// file system says so (device and inode, the link itself, never followed), not
// when their spelling matches in lower case. Cases this file system cannot
// produce (it may not tell upper from lower case, or never give inode 0) are
// simulated by swapping fs.lstatSync, fs.realpathSync and process.platform for
// the one call, never skipped.
const swapped = async ({ lstat, realpath, platform }, fn) => {
  const saved = { lstatSync: fs.lstatSync, realpathSync: fs.realpathSync };
  const own = Object.getOwnPropertyDescriptor(process, "platform");
  try {
    if (lstat) fs.lstatSync = lstat(saved.lstatSync);
    if (realpath) fs.realpathSync = realpath(saved.realpathSync);
    if (platform) Object.defineProperty(process, "platform", { ...own, value: platform });
    return await fn();
  } finally {
    Object.assign(fs, saved);
    Object.defineProperty(process, "platform", own);
  }
};
// lstat with the identity of `to` for the path `from`, or a changed result.
const lstatAs = (from, to) => (lstat) => (file, options) => lstat(file === from ? to : file, options);
const lstatEdit = (file, edit) => (lstat) => (name, options) => (name === file ? edit(lstat(name, options)) : lstat(name, options));
// Two directories whose names differ only in case: real ones where this file
// system keeps them apart, else `twin` is a real third directory that answers
// to the lower-case name through the swapped lstat and realpath. The simulation
// also runs where real twins exist, so it is checked on Linux CI as well.
const caseTwins = (base, upper, { simulate = false } = {}) => {
  const lower = path.join(path.dirname(upper), path.basename(upper).toLowerCase());
  assert.notEqual(lower, upper);
  if (!simulate && !fs.existsSync(lower)) {
    fs.mkdirSync(lower);
    return { lower, cwd: lower, swaps: {} };
  }
  const twin = fs.mkdtempSync(path.join(base, "twin-"));
  const realTwin = fs.realpathSync(twin);
  const realLower = path.join(fs.realpathSync(path.dirname(upper)), path.basename(lower));
  return {
    lower: realLower,
    cwd: twin,
    swaps: { lstat: lstatAs(realLower, realTwin), realpath: (realpath) => (file, options) => (realpath(file, options) === realTwin ? realLower : realpath(file, options)) },
  };
};

test("F-035 a (Codex c.6627100367): samePath compares file system identity over every input class", () =>
  scratch(async (base) => {
    const upper = path.join(base, "Same");
    fs.mkdirSync(path.join(upper, "sub"), { recursive: true });
    const twins = caseTwins(base, upper);
    const simulated = caseTwins(base, upper, { simulate: true });
    const missing = path.join(base, "missing");
    const rows = [
      ["1 the same path", upper, upper, {}, true],
      ["2 another spelling of the same entry (..)", path.join(upper, "sub") + `${path.sep}..`, upper, {}, true],
      ["2 a case variant on a file system without case (simulated)", path.join(base, "SAME"), upper, { lstat: lstatAs(path.join(base, "SAME"), upper) }, true],
      ["3 names differing in case only, two directories", twins.lower, upper, twins.swaps, false],
      ["3 the same, with win32 as platform", twins.lower, upper, { ...twins.swaps, platform: "win32" }, false],
      ["3 simulated twins, with win32 as platform", simulated.lower, upper, { ...simulated.swaps, platform: "win32" }, false],
      ["4 one side missing", missing, upper, {}, false],
      ["4 both sides missing", missing, missing, {}, false],
      ["5 lstat fails otherwise (EACCES)", upper, upper, { lstat: lstatEdit(upper, () => { throw Object.assign(new Error("denied"), { code: "EACCES" }); }) }, false],
      ["6 inode 0: no identity", upper, upper, { lstat: lstatEdit(upper, (stat) => Object.assign(stat, { ino: 0n })) }, false],
      ["7 the same inode on another device", path.join(upper, "sub"), upper, { lstat: (lstat) => (file, options) => {
        const stat = lstat(file, options);
        return file === upper ? Object.assign(stat, { ino: lstat(path.join(upper, "sub"), options).ino, dev: stat.dev + 1n }) : stat;
      } }, false],
    ];
    // 9: a file is itself only while it has one name; a hard link is another entry.
    const single = path.join(upper, "single");
    fs.writeFileSync(single, "x");
    rows.push(["9 a file with one name", single, single, {}, true]);
    const file = path.join(upper, "file");
    fs.writeFileSync(file, "x");
    fs.linkSync(file, path.join(upper, "hard"));
    rows.push(["9 a hard link to a file", path.join(upper, "hard"), file, {}, false], ["9 a file with a second name, itself", file, file, {}, false]);
    const link = path.join(base, "link");
    try {
      fs.symlinkSync(upper, link, "dir");
      rows.push(["8 a link to the directory is not the directory", link, upper, {}, false]);
      rows.push(["2 the same link once the caller resolved it", fs.realpathSync(link), upper, {}, true]);
    } catch (error) {
      assert.ok(!IN_CI, `symlinks are available on CI: ${error.message}`);
      rows.push(["8 a link to the directory (simulated)", link, upper, { lstat: lstatAs(link, path.join(upper, "sub")) }, false]);
    }
    for (const [label, a, b, swaps, expected] of rows) {
      for (const [x, y] of [[a, b], [b, a]]) assert.equal(await swapped(swaps, () => samePath(x, y)), expected, `${label}: ${x} vs ${y}`);
    }
  }));

test("F-035 a (Codex c.6627100367): a foreign directory whose name differs in case only is blocked, also on win32", { timeout: 60000 }, () =>
  withTree({ dir: "Ductus", bin: "allow" }, (tree) =>
    scratch(async (base) => {
      for (const twins of [caseTwins(base, tree.root), caseTwins(base, tree.root, { simulate: true })]) {
        plantRules(twins.cwd);
        for (const platform of [process.platform, "win32"]) {
          const swaps = { ...twins.swaps, platform };
          // N1: the reason comes from comparing the config, never from the name.
          assert.match(await swapped(swaps, () => foreignRules(twins.cwd, tree.root)) ?? "", /not a checkout of this repository/, platform);
          const result = await swapped(swaps, () => run(tree, "Bash", "ls", twins.cwd));
          foreign(result, `ls in ${twins.lower} via ${twins.cwd} (${platform})`);
        }
      }
    })));

test("F-035 a (Codex c.6627100367): the root reached by another path keeps its rules; an unknown identity blocks", { timeout: 60000 }, () =>
  withTree({ dir: "Ductus", bin: "allow" }, (tree) =>
    scratch(async (base) => {
      // N2: through a link (the realpath leads back to the root), and through a
      // case variant on a file system that does not tell case apart (simulated).
      const link = path.join(base, "root-link");
      let viaLink = true;
      try {
        fs.symlinkSync(tree.root, link, "dir");
      } catch (error) {
        assert.ok(!IN_CI, `symlinks are available on CI: ${error.message}`);
        viaLink = false;
      }
      if (viaLink) assert.equal(foreignRules(link, tree.root), null, "the root through a link");
      const realRoot = fs.realpathSync(tree.root);
      const variant = path.join(path.dirname(realRoot), "DUCTUS");
      const insensitive = { lstat: lstatAs(variant, realRoot), realpath: (realpath) => (file, options) => (file === variant ? variant : realpath(file, options)) };
      for (const platform of [process.platform, "win32"]) {
        assert.equal(await swapped({ ...insensitive, platform }, () => foreignRules(variant, tree.root)), null, `case variant (${platform})`);
      }
      // N3 / K2: when lstat of the root fails, the rules are compared as config;
      // a different rulebook is then refused.
      const other = path.join(base, "other");
      plantRules(other);
      const failing = { lstat: lstatEdit(realRoot, () => { throw Object.assign(new Error("gone"), { code: "EIO" }); }) };
      assert.match(await swapped(failing, () => foreignRules(other, tree.root)) ?? "", /not a checkout of this repository/);
      // Even the root itself is then only accepted as an identical config, not by name.
      assert.equal(await swapped(failing, () => foreignRules(tree.root, tree.root)), null, "the root compared as config with itself");
      foreign(await swapped(failing, () => run(tree, "Bash", "ls", other)), "unknown identity, different rules");
    })));
