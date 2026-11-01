// F-033 (DAN-166): every repo script that an agent hook (.claude/settings.json)
// or a git hook (lefthook.yml) names, and every module those scripts load by a
// relative path, must be a D-97 path. Such code runs in every session,
// including the owner's, so a change to it needs the owner's merge command.
// `pnpm <script>` in a hook goes through package.json, which carries the
// critical floor (risk-floor.test.mjs); the suites a hook runs are the checked
// code, not hook code, and are not followed here.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isD97Path, normalizePath } from "./protected-paths.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const CODE_EXT = "mjs|cjs|js|ts|mts|cts|ps1|sh|py";
// A repo path to a script, with or without the $CLAUDE_PROJECT_DIR prefix.
const SCRIPT_RE = new RegExp(`(?:\\$\\{?CLAUDE_PROJECT_DIR\\}?/)?((?:[\\w.-]+/)+[\\w.-]+\\.(?:${CODE_EXT}))\\b`, "g");
// A script in the repo root, named without a directory (`node hook.mjs`): a
// whole word after the start, a space, a quote, `=`, `(` or the project
// directory variable, and not followed by `/`.
const ROOT_SCRIPT_RE = new RegExp(
  `(?<=^|[\\s"'=(]|\\$\\{?CLAUDE_PROJECT_DIR\\}?"?/)([\\w-][\\w.-]*\\.(?:${CODE_EXT}))(?![\\w./-])`,
  "g",
);
// A hook that changes directory names its scripts relative to a directory
// this check cannot follow, so it is reported instead.
const CD_RE = /(?:^|[\s;&|("'`])(?:cd|pushd|Set-Location|sl)\s/;
// Relative code specifiers: static import with or without bindings (`import "./x.mjs"`),
// export-from, dynamic import, require, new URL; quoted with ', " or a backtick.
const IMPORT_RE = new RegExp(
  `(?:\\bfrom\\s*|\\bimport\\s*|\\bimport\\s*\\(\\s*|\\brequire\\s*\\(\\s*|\\bnew\\s+URL\\s*\\(\\s*)["'\`](\\.{1,2}/[^"'\`?#]+\\.(?:${CODE_EXT}))(?:[?#][^"'\`]*)?["'\`]`,
  "g",
);
// A shell or PowerShell script that loads another file into itself (`source x`,
// `. x`) at a command position: the start of a line or after ; & | ( then do.
// The argument is any word, quoted or not; a literal one resolves against the
// hook's working directory (the repo root, since a hook that changes directory
// is refused above), a computed one ($VAR, $(...), `...`) cannot be followed
// and is reported (Codex #1164).
const SHELL_EXT = /\.(?:sh|ps1)$/;
const SOURCE_RE = /(?:^|[;&|(]|\bthen\b|\bdo\b)[ \t]*(?:source|\.)[ \t]+("[^"\n]*"|'[^'\n]*'|[^\s;&|)]+)/gm;

/** Command text of every hook in a parsed settings.json. */
function settingsHookTexts(settings) {
  const out = [];
  for (const groups of Object.values(settings?.hooks ?? {})) {
    for (const group of groups ?? []) {
      for (const hook of group?.hooks ?? []) {
        out.push([hook?.command ?? "", ...(hook?.args ?? [])].join(" "));
      }
    }
  }
  return out;
}

/** lefthook.yml without its comment lines, which only describe the hooks. */
const lefthookText = (yaml) =>
  String(yaml ?? "")
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");

// Resolve "." and ".." segments before the D-97 check: scripts/hooks/../../src/x.mjs
// is src/x.mjs. A path that leaves the repo keeps its leading "..", which no
// D-97 entry matches.
const canonical = (p) => path.posix.normalize(normalizePath(p));

/** Repo scripts named in hook text. */
function entryScripts(texts) {
  const found = new Set();
  for (const text of texts) {
    for (const m of text.matchAll(SCRIPT_RE)) found.add(canonical(m[1]));
    for (const m of text.matchAll(ROOT_SCRIPT_RE)) found.add(canonical(m[1]));
  }
  return [...found].sort();
}

/** Hook texts (lefthook.yml as one text, settings.json per hook) that change directory. */
const changesDirectory = (texts) => texts.filter((text) => CD_RE.test(text));

/**
 * Entry scripts plus every file they reach by relative imports or by `source`;
 * `read(file)` returns source or null, `resolve(file)` the repo path of the
 * file's real target (itself unless it is a link).
 */
function reachableFiles(entries, read, resolve) {
  const seen = new Set();
  const missing = [];
  const unfollowed = [];
  const stack = [...entries];
  while (stack.length > 0) {
    const named = stack.pop();
    if (seen.has(named)) continue;
    seen.add(named);
    // A link runs its target: the target is checked too, and imports resolve
    // from the target's directory, as Node resolves them (Codex #1164).
    const file = resolve(named);
    if (file !== named) {
      if (seen.has(file)) continue;
      seen.add(file);
    }
    const src = read(file);
    if (src === null) {
      missing.push(file);
      continue;
    }
    for (const m of src.matchAll(IMPORT_RE)) {
      stack.push(canonical(path.posix.join(path.posix.dirname(file), m[1])));
    }
    if (!SHELL_EXT.test(file)) continue;
    for (const m of src.matchAll(SOURCE_RE)) {
      const arg = m[1].replace(/^(["'])(.*)\1$/, "$2");
      if (/[$`]/.test(arg)) unfollowed.push(`${file}: ${m[0].trim()}`);
      else stack.push(canonical(arg));
    }
  }
  return { files: [...seen].sort(), missing: missing.sort(), unfollowed: unfollowed.sort() };
}

/** Files a hook runs or loads, those missing, those that are not D-97, and loads it cannot follow. */
function hookFiles({ settings, lefthook, read, resolve = (f) => f }) {
  const texts = [...settingsHookTexts(settings), lefthookText(lefthook)];
  const { files, missing, unfollowed } = reachableFiles(entryScripts(texts), read, resolve);
  return { files, missing, unfollowed, offenders: files.filter((f) => !isD97Path(f)), changesDir: changesDirectory(texts) };
}

const readIn = (root) => (file) => {
  const full = path.join(root, file);
  return fs.existsSync(full) && fs.statSync(full).isFile() ? fs.readFileSync(full, "utf8") : null;
};
// The repo path of a file's real target; outside the repo it keeps its leading
// "..", which no D-97 entry matches. A missing file is left as named.
const resolveIn = (root) => (file) => {
  try {
    const realRoot = fs.realpathSync(root);
    return canonical(path.relative(realRoot, fs.realpathSync(path.join(root, file))));
  } catch {
    return file;
  }
};
const readRepo = readIn(repo);
const resolveRepo = resolveIn(repo);

test("every repo file an agent or git hook runs or imports is a D-97 path", () => {
  const settings = JSON.parse(fs.readFileSync(path.join(repo, ".claude/settings.json"), "utf8"));
  const lefthook = fs.readFileSync(path.join(repo, "lefthook.yml"), "utf8");
  const { files, missing, offenders, changesDir, unfollowed } = hookFiles({ settings, lefthook, read: readRepo, resolve: resolveRepo });
  assert.deepEqual(unfollowed, [], "a hook script sources a computed path that this check cannot follow");
  assert.deepEqual(changesDir, [], "a hook changes directory, so its script paths cannot be checked");
  // The extraction must find the known hooks, or an empty result would pass silently.
  for (const known of [
    "scripts/engineering/agent-hooks.mjs",
    "scripts/hooks/safety-net.mjs",
    "scripts/hooks/pr-metadata-precheck.mjs",
    "scripts/orchestrator/session-worktree-clean.mjs",
    "scripts/engineering/pre-push-tests.mjs",
    "scripts/engineering/protected-paths.mjs",
  ]) {
    assert.ok(files.includes(known), `hook extraction misses ${known}`);
  }
  assert.deepEqual(missing, [], "a hook names or imports a file that does not exist");
  assert.deepEqual(offenders, [], "hook code outside the D-97 paths");
});

test("a hook on a script outside D-97 is reported, in settings.json and lefthook.yml", () => {
  const settings = {
    hooks: {
      SessionStart: [{ hooks: [{ command: "node", args: ["${CLAUDE_PROJECT_DIR}/scripts/usage-report.mjs"] }] }],
      Stop: [{ hooks: [{ command: 'bash "$CLAUDE_PROJECT_DIR/tools/x.sh"' }] }],
    },
  };
  const lefthook = "pre-push:\n  commands:\n    y:\n      run: node scripts/demo/y.mjs\n";
  const { offenders } = hookFiles({ settings, lefthook, read: () => "" });
  assert.deepEqual(offenders, ["scripts/demo/y.mjs", "scripts/usage-report.mjs", "tools/x.sh"]);
});

test("a lefthook comment that names a script is not a hook", () => {
  const lefthook = "pre-push:\n  # see scripts/demo/z.mjs\n  commands: {}\n";
  assert.deepEqual(hookFiles({ settings: {}, lefthook, read: () => "" }).files, []);
});

test("a D-97 hook script that imports a module outside D-97 is reported", () => {
  const settings = {
    hooks: { PreToolUse: [{ hooks: [{ command: 'node "$CLAUDE_PROJECT_DIR/scripts/hooks/a.mjs"' }] }] },
  };
  const sources = {
    "scripts/hooks/a.mjs": 'import { b } from "./b.mjs";\nconst c = await import("../demo/c.mjs?x=1");',
    "scripts/hooks/b.mjs": 'const u = new URL("../../src/d.mjs", import.meta.url);\nconst r = new URL("../../", import.meta.url);',
    "scripts/demo/c.mjs": "",
    "src/d.mjs": "",
  };
  const read = (f) => (Object.hasOwn(sources, f) ? sources[f] : null);
  const { offenders, missing } = hookFiles({ settings, lefthook: "", read });
  assert.deepEqual(offenders, ["scripts/demo/c.mjs", "src/d.mjs"]);
  assert.deepEqual(missing, []);
});

test("a side-effect import without bindings is followed (Codex #1164)", () => {
  const settings = { hooks: { Stop: [{ hooks: [{ command: "node scripts/hooks/a.mjs" }] }] } };
  const sources = { "scripts/hooks/a.mjs": 'import "../../src/unprotected.mjs";\nimport\'./b.mjs\';', "scripts/hooks/b.mjs": "", "src/unprotected.mjs": "" };
  const read = (f) => (Object.hasOwn(sources, f) ? sources[f] : null);
  const { offenders, files } = hookFiles({ settings, lefthook: "", read });
  assert.deepEqual(files, ["scripts/hooks/a.mjs", "scripts/hooks/b.mjs", "src/unprotected.mjs"]);
  assert.deepEqual(offenders, ["src/unprotected.mjs"]);
});

test("dot segments are resolved before the D-97 check (Codex #1164)", () => {
  const settings = {
    hooks: {
      Stop: [{ hooks: [{ command: "node scripts/hooks/../../src/unguarded.mjs" }] }],
      PreToolUse: [{ hooks: [{ command: 'node "$CLAUDE_PROJECT_DIR/scripts/hooks/./../engineering/x.mjs"' }] }],
    },
  };
  const lefthook = "pre-push:\n  commands:\n    t:\n      run: node scripts/engineering/../../../outside.mjs\n";
  const { offenders, files } = hookFiles({ settings, lefthook, read: () => "" });
  assert.deepEqual(files, ["../outside.mjs", "scripts/engineering/x.mjs", "src/unguarded.mjs"]);
  assert.deepEqual(offenders, ["../outside.mjs", "src/unguarded.mjs"]);
});

// Review of #1164 (issuecomment-6554428275, Codex r4434477801): a script in the
// repo root named without a directory is a hook entry like any other.
test("a root script named without a directory is reported (review of #1164)", () => {
  const settings = {
    hooks: {
      Stop: [{ hooks: [{ command: "node hook.mjs" }] }],
      SessionStart: [{ hooks: [{ command: 'node "$CLAUDE_PROJECT_DIR"/setup-hook.mjs' }] }],
      PreToolUse: [{ hooks: [{ command: "node", args: ["guard.cjs"] }] }],
    },
  };
  const lefthook = "pre-push:\n  commands:\n    s:\n      run: bash setup.sh && pwsh -File 'check.ps1'\n";
  const { offenders } = hookFiles({ settings, lefthook, read: () => "" });
  assert.deepEqual(offenders, ["check.ps1", "guard.cjs", "hook.mjs", "setup-hook.mjs", "setup.sh"]);
  // Control: a glob, a file extension alone and a path inside a word are not scripts.
  const quiet = "pre-commit:\n  commands:\n    l:\n      glob: \"*.{ts,mjs}\"\n      run: pnpm exec eslint {staged_files} --ext .mjs\n";
  assert.deepEqual(hookFiles({ settings: {}, lefthook: quiet, read: () => "" }).files, []);
});

test("a hook that changes directory is reported (review of #1164)", () => {
  for (const command of ["cd src && node x.mjs", "pushd tools; node x.mjs", "bash -c 'cd src; node x.mjs'"]) {
    const settings = { hooks: { Stop: [{ hooks: [{ command }] }] } };
    assert.deepEqual(hookFiles({ settings, lefthook: "", read: () => "" }).changesDir, [command], command);
  }
  const lefthook = "pre-push:\n  commands:\n    t:\n      run: cd scripts && node x.mjs\n";
  assert.equal(hookFiles({ settings: {}, lefthook, read: () => "" }).changesDir.length, 1);
  // Control: a word that only ends in "cd" is not a directory change.
  const settings = { hooks: { Stop: [{ hooks: [{ command: "node scripts/hooks/abcd.mjs --mode abcd x" }] }] } };
  assert.deepEqual(hookFiles({ settings, lefthook: "", read: () => "" }).changesDir, []);
});

test("an import quoted with a backtick is followed (review of #1164)", () => {
  const settings = { hooks: { Stop: [{ hooks: [{ command: "node scripts/hooks/a.mjs" }] }] } };
  const sources = { "scripts/hooks/a.mjs": "const m = await import(`../../src/t.mjs`);", "src/t.mjs": "" };
  const read = (f) => (Object.hasOwn(sources, f) ? sources[f] : null);
  assert.deepEqual(hookFiles({ settings, lefthook: "", read }).offenders, ["src/t.mjs"]);
});

// Codex #1164 (r4435543005): a shell script that sources another file runs it.
test("a file a hook script sources is followed; a computed source is reported (Codex #1164)", () => {
  const settings = { hooks: { Stop: [{ hooks: [{ command: "bash scripts/hooks/a.sh" }, { command: "pwsh -File scripts/hooks/p.ps1" }] }] } };
  const sources = {
    "scripts/hooks/a.sh": [
      "#!/usr/bin/env bash",
      "source ./tools/unguarded.sh",
      'if true; then . "scripts/hooks/b.sh"; fi',
      "x=1 && . 'tools/env'",
      'source "$HOME/x.sh"',
      "echo done. ok # a dot in text is not a load",
    ].join("\n"),
    "scripts/hooks/b.sh": "",
    "scripts/hooks/p.ps1": ". ./tools/helper.ps1\n. $PSScriptRoot/q.ps1\n",
    "tools/unguarded.sh": "",
    "tools/env": "",
    "tools/helper.ps1": "",
  };
  const read = (f) => (Object.hasOwn(sources, f) ? sources[f] : null);
  const { files, offenders, missing, unfollowed } = hookFiles({ settings, lefthook: "", read });
  assert.deepEqual(files, ["scripts/hooks/a.sh", "scripts/hooks/b.sh", "scripts/hooks/p.ps1", "tools/env", "tools/helper.ps1", "tools/unguarded.sh"]);
  assert.deepEqual(offenders, ["tools/env", "tools/helper.ps1", "tools/unguarded.sh"]);
  assert.deepEqual(missing, []);
  assert.deepEqual(unfollowed, ['scripts/hooks/a.sh: source "$HOME/x.sh"', "scripts/hooks/p.ps1: . $PSScriptRoot/q.ps1"]);
  // Control: a JavaScript file is not read for `source`.
  const js = { "scripts/hooks/a.mjs": "source ./tools/unguarded.sh\n" };
  const jsSettings = { hooks: { Stop: [{ hooks: [{ command: "node scripts/hooks/a.mjs" }] }] } };
  assert.deepEqual(hookFiles({ settings: jsSettings, lefthook: "", read: (f) => js[f] ?? null }).files, ["scripts/hooks/a.mjs"]);
});

// Codex #1164 (r4435543013): a D-97 name that links to a file elsewhere runs
// that file, so the target is checked and its imports are followed.
test("a hook script that is a link is checked at its real target (Codex #1164)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ductus-hook-link-"));
  try {
    fs.mkdirSync(path.join(dir, "scripts"));
    fs.mkdirSync(path.join(dir, "src"));
    fs.writeFileSync(path.join(dir, "src", "a.mjs"), 'import "./dep.mjs";\n');
    fs.writeFileSync(path.join(dir, "src", "dep.mjs"), "");
    // A directory link: a junction on Windows needs no privilege, CI (Linux)
    // uses a directory symlink. scripts/hooks/a.mjs then runs src/a.mjs.
    fs.symlinkSync(path.join(dir, "src"), path.join(dir, "scripts", "hooks"), process.platform === "win32" ? "junction" : "dir");
    const settings = { hooks: { PreToolUse: [{ hooks: [{ command: "node scripts/hooks/a.mjs" }] }] } };
    const { files, offenders, missing } = hookFiles({ settings, lefthook: "", read: readIn(dir), resolve: resolveIn(dir) });
    assert.deepEqual(files, ["scripts/hooks/a.mjs", "src/a.mjs", "src/dep.mjs"]);
    assert.deepEqual(offenders, ["src/a.mjs", "src/dep.mjs"]);
    assert.deepEqual(missing, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a link that leaves the repo is an offender (Codex #1164)", () => {
  const settings = { hooks: { Stop: [{ hooks: [{ command: "node scripts/hooks/a.mjs" }] }] } };
  const resolve = (f) => (f === "scripts/hooks/a.mjs" ? "../elsewhere/x.mjs" : f);
  const read = (f) => (f === "../elsewhere/x.mjs" ? "" : null);
  const { files, offenders, missing } = hookFiles({ settings, lefthook: "", read, resolve });
  assert.deepEqual(files, ["../elsewhere/x.mjs", "scripts/hooks/a.mjs"]);
  assert.deepEqual(offenders, ["../elsewhere/x.mjs"]);
  assert.deepEqual(missing, []);
});

test("a hook naming a file that does not exist is reported as missing", () => {
  const settings = { hooks: { Stop: [{ hooks: [{ command: "node scripts/hooks/gone.mjs" }] }] } };
  const { missing } = hookFiles({ settings, lefthook: "", read: () => null });
  assert.deepEqual(missing, ["scripts/hooks/gone.mjs"]);
});
