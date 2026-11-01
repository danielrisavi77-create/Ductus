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
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isD97Path, normalizePath } from "./protected-paths.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const CODE_EXT = "mjs|cjs|js|ts|mts|cts|ps1|sh|py";
// A repo path to a script, with or without the $CLAUDE_PROJECT_DIR prefix.
const SCRIPT_RE = new RegExp(`(?:\\$\\{?CLAUDE_PROJECT_DIR\\}?/)?((?:[\\w.-]+/)+[\\w.-]+\\.(?:${CODE_EXT}))\\b`, "g");
// Relative code specifiers: static and dynamic import, require, new URL.
const IMPORT_RE = new RegExp(
  `(?:\\bfrom\\s*|\\bimport\\s*\\(\\s*|\\brequire\\s*\\(\\s*|\\bnew\\s+URL\\s*\\(\\s*)["'](\\.{1,2}/[^"'?#]+\\.(?:${CODE_EXT}))(?:[?#][^"']*)?["']`,
  "g",
);

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

/** Repo scripts named in hook text. */
function entryScripts(texts) {
  const found = new Set();
  for (const text of texts) for (const m of text.matchAll(SCRIPT_RE)) found.add(normalizePath(m[1]));
  return [...found].sort();
}

/** Entry scripts plus every module they reach by relative imports; `read(file)` returns source or null. */
function reachableFiles(entries, read) {
  const seen = new Set();
  const missing = [];
  const stack = [...entries];
  while (stack.length > 0) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const src = read(file);
    if (src === null) {
      missing.push(file);
      continue;
    }
    for (const m of src.matchAll(IMPORT_RE)) {
      stack.push(path.posix.normalize(path.posix.join(path.posix.dirname(file), m[1])));
    }
  }
  return { files: [...seen].sort(), missing: missing.sort() };
}

/** Files a hook runs or loads, those missing, and those that are not D-97. */
function hookFiles({ settings, lefthook, read }) {
  const texts = [...settingsHookTexts(settings), lefthookText(lefthook)];
  const { files, missing } = reachableFiles(entryScripts(texts), read);
  return { files, missing, offenders: files.filter((f) => !isD97Path(f)) };
}

const readRepo = (file) => {
  const full = path.join(repo, file);
  return fs.existsSync(full) && fs.statSync(full).isFile() ? fs.readFileSync(full, "utf8") : null;
};

test("every repo file an agent or git hook runs or imports is a D-97 path", () => {
  const settings = JSON.parse(fs.readFileSync(path.join(repo, ".claude/settings.json"), "utf8"));
  const lefthook = fs.readFileSync(path.join(repo, "lefthook.yml"), "utf8");
  const { files, missing, offenders } = hookFiles({ settings, lefthook, read: readRepo });
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

test("a hook naming a file that does not exist is reported as missing", () => {
  const settings = { hooks: { Stop: [{ hooks: [{ command: "node scripts/hooks/gone.mjs" }] }] } };
  const { missing } = hookFiles({ settings, lefthook: "", read: () => null });
  assert.deepEqual(missing, ["scripts/hooks/gone.mjs"]);
});
