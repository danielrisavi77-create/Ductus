import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  HARD_AT,
  LARGE_DOC_BYTES,
  MODE_NAMES,
  ORCHESTRATOR_LIMIT,
  OUTLINE_LIMIT,
  PROFILE_ROLES,
  ROTATE_AT,
  STATE_LIMIT,
  budgetNotice,
  isProtected,
  lastContext,
  outline,
  realProjectPath,
  reviewRead,
  runHook,
  sessionRole,
  stateContext,
  withCheckedFile,
} from "./agent-hooks.mjs";
import { summarizeTranscript } from "./token-report.mjs";

const script = fileURLToPath(new URL("./agent-hooks.mjs", import.meta.url));
const repo = fileURLToPath(new URL("../../", import.meta.url));
const BAN = /Do not (start|take)/;
const big = { size: LARGE_DOC_BYTES + 1 };
const doc = "# Title\n\n## 1. One\ntext\n```\n## not a heading\n```\n## 2. Two\n";

const assistant = (id, usage, extra = {}) => JSON.stringify({ type: "assistant", message: { id, usage, content: [] }, ...extra });

function run(mode, event, projectDir) {
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  if (projectDir) env.CLAUDE_PROJECT_DIR = projectDir;
  const result = spawnSync(process.execPath, [script, mode], { input: JSON.stringify(event), encoding: "utf8", env });
  assert.equal(result.status, 0);
  return result.stdout ? JSON.parse(result.stdout).hookSpecificOutput : null;
}

// Everything a hook run printed, unparsed: "" means it neither decided nor quoted anything.
function raw(mode, event, projectDir) {
  const result = spawnSync(process.execPath, [script, mode], {
    input: JSON.stringify(event),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
  });
  assert.equal(result.status, 0);
  return result.stdout + result.stderr;
}

const MARK = "FAKE-CONTENT-MARKER";
const bigDoc = `## ${MARK}\n` + "x".repeat(LARGE_DOC_BYTES);
const bigTranscript = assistant("a", { cache_read_input_tokens: HARD_AT }, { note: MARK }) + "\n";

// A made-up project with deny-listed files, next to a directory outside it.
function sandbox() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ductus-link-")));
  const dir = path.join(base, "repo");
  const outside = path.join(base, "outside");
  for (const folder of [path.join(dir, "docs"), path.join(dir, "secrets"), path.join(outside, "notes")]) fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(dir, ".env"), `FAKE_TOKEN=${MARK}\n`);
  fs.writeFileSync(path.join(dir, "docs", "open.md"), bigDoc);
  fs.writeFileSync(path.join(dir, "docs", "small.md"), `# ${MARK}\n`);
  fs.writeFileSync(path.join(dir, "secrets", "runbook.md"), bigDoc);
  fs.writeFileSync(path.join(dir, "secrets", "STATE.md"), `# ${MARK}\n`);
  fs.writeFileSync(path.join(dir, "secrets", "t.jsonl"), bigTranscript);
  fs.writeFileSync(path.join(outside, "notes", "private.md"), bigDoc);
  fs.writeFileSync(path.join(outside, "STATE.md"), `# ${MARK}\n`);
  return { base, dir, outside };
}

// Directory links work everywhere (a junction on Windows). File links need a
// privilege on Windows; only that one case may skip, and it says so.
const dirLink = (target, at) => fs.symlinkSync(target, at, "junction");
function fileLink(t, target, at) {
  try {
    fs.symlinkSync(target, at, "file");
    return true;
  } catch (error) {
    if (process.platform !== "win32" || error.code !== "EPERM") throw error;
    t.skip("Windows without the symlink privilege cannot create a file link; this case runs on Linux CI");
    return false;
  }
}

test("outline lists headings with line numbers and skips fenced code", () => {
  assert.deepEqual(outline(doc), ["1: # Title", "3: ## 1. One", "8: ## 2. Two"]);
});

test("full read of a large markdown document is denied with its outline", () => {
  const reason = reviewRead({ file_path: "docs\\BACKEND.md" }, big, () => doc);
  assert.match(reason, /BACKEND\.md is 16 KB/);
  assert.match(reason, /3: ## 1\. One/);
  assert.match(reviewRead({ file_path: "CHANGELOG.MD" }, big, () => doc), /CHANGELOG\.MD is 16 KB/);
});

test("deny message reports truncated and empty outlines", () => {
  const many = Array.from({ length: OUTLINE_LIMIT + 3 }, (_, i) => `## H${i}`).join("\n");
  assert.match(reviewRead({ file_path: "docs/LONG.md" }, big, () => many), /\+3 more headings/);
  assert.match(reviewRead({ file_path: "docs/FLAT.md" }, big, () => "a\nb\nc"), /no headings and 3 lines/);
});

test("ranged read, small document, non-markdown and out-of-project files are allowed", () => {
  const fail = () => assert.fail("must not read the file");
  assert.equal(reviewRead({ file_path: "docs/BACKEND.md", offset: 10, limit: 40 }, big, fail), null);
  assert.equal(reviewRead({ file_path: "STATE.md" }, { size: LARGE_DOC_BYTES }, fail), null);
  assert.equal(reviewRead({ file_path: "src/domain/json.ts" }, big, fail), null);
  assert.equal(reviewRead({ file_path: "docs/missing.md" }, undefined, fail), null);
  assert.equal(reviewRead({ file_path: "../other/SKILL.md" }, big, fail, false), null);
  assert.equal(reviewRead({ file_path: "../other/pnpm-lock.yaml" }, big, fail, false), null);
});

test("generated output is denied even with a range; test artefacts are readable", () => {
  for (const file of ["pnpm-lock.yaml", "tsconfig.tsbuildinfo", ".next/server/app.js"]) {
    assert.match(reviewRead({ file_path: file, limit: 5 }, { size: 10 }, () => ""), /generated output/);
  }
  for (const file of ["docs/next-steps.md", "test-results/sync/error-context.md", "playwright-report/index.html", "node_modules/pg/lib/index.js"]) {
    assert.equal(reviewRead({ file_path: file, limit: 5 }, { size: 10 }, () => ""), null);
  }
});

test("lastContext sums all three usage fields of the newest main-thread call", () => {
  const tail = [
    assistant("a", { input_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 }),
    assistant("b", { input_tokens: 1, cache_read_input_tokens: 200_000, cache_creation_input_tokens: 30 }),
    assistant("c", { input_tokens: 7 }, { isSidechain: true }),
    JSON.stringify({ type: "user", message: { usage: { input_tokens: 9 }, content: "hi" } }),
  ].join("\n");
  assert.equal(lastContext(tail), 200_031);
  assert.equal(lastContext(""), 0);
});

test("lastContext skips cut lines and zero-usage error records", () => {
  const tail = [
    assistant("a", { cache_read_input_tokens: 260_000 }),
    '{"type":"assistant","message":{"usage":{"input_tokens":999999',
    assistant("err", { input_tokens: 0, cache_read_input_tokens: 0 }, { model: "<synthetic>" }),
  ].join("\n");
  assert.equal(lastContext(tail), 260_000);
});

test("lastContext resets at a compaction boundary", () => {
  const before = assistant("a", { cache_read_input_tokens: 188_000 });
  const boundary = JSON.stringify({ type: "system", subtype: "compact_boundary" });
  const summary = JSON.stringify({ type: "user", isCompactSummary: true, message: { content: "summary" } });
  assert.equal(lastContext([before, boundary].join("\n")), 0);
  assert.equal(lastContext([before, summary].join("\n")), 0);
  assert.equal(lastContext([before, boundary, summary, assistant("b", { cache_read_input_tokens: 40_000 })].join("\n")), 40_000);
});

test("budget notice appears only past the rotation point and escalates", () => {
  assert.equal(budgetNotice(ROTATE_AT - 1), null);
  assert.match(budgetNotice(ROTATE_AT), /150k rotation point/);
  assert.match(budgetNotice(HARD_AT), /hard limit/);
});

test("state context names its path and is withheld when it would be truncated", () => {
  assert.match(stateContext("C:\\repo\\STATE.md", "# Stanje rada\n"), /^C:\/repo\/STATE\.md as of session start[\s\S]*# Stanje rada/);
  assert.equal(stateContext("STATE.md", "x".repeat(STATE_LIMIT + 1)), null);
});

test("hook entry point denies, stays silent and fails open", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ductus-hooks-"));
  const other = fs.mkdtempSync(path.join(os.tmpdir(), "ductus-other-"));
  try {
    fs.writeFileSync(path.join(dir, "BIG.md"), doc + "x".repeat(LARGE_DOC_BYTES));
    fs.writeFileSync(path.join(other, "BIG.md"), doc + "x".repeat(LARGE_DOC_BYTES));
    fs.writeFileSync(path.join(dir, "STATE.md"), "# Stanje rada\n");
    fs.writeFileSync(path.join(other, "STATE.md"), "# Drugo stanje\n");
    const transcript = path.join(dir, "t.jsonl");
    fs.writeFileSync(transcript, assistant("a", { cache_read_input_tokens: HARD_AT }) + "\n");

    assert.equal(run("read", { cwd: dir, tool_input: { file_path: "BIG.md" } }).permissionDecision, "deny");
    assert.equal(run("read", { cwd: dir, tool_input: { file_path: path.join(dir, "BIG.md") } }, dir).permissionDecision, "deny");
    assert.equal(run("read", { cwd: dir, tool_input: { file_path: path.join(other, "BIG.md") } }, dir), null);
    assert.equal(run("read", { cwd: dir, tool_input: { file_path: "STATE.md" } }), null);
    assert.match(run("budget", { transcript_path: transcript }).additionalContext, /hard limit/);
    assert.match(run("start", { cwd: dir }).additionalContext, /# Stanje rada/);
    assert.match(run("start", { cwd: dir }, other).additionalContext, /# Drugo stanje/);

    assert.equal(run("budget", { transcript_path: path.join(dir, "missing.jsonl") }), null);
    assert.equal(run("start", { cwd: path.join(dir, "missing") }), null);
    assert.equal(run("unknown", {}), null);
    const garbage = spawnSync(process.execPath, [script, "read"], { input: "not json", encoding: "utf8" });
    assert.equal(garbage.status, 0);
    assert.equal(garbage.stdout, "");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(other, { recursive: true, force: true });
  }
});

test("session role comes from the agent profile and is unknown otherwise", () => {
  assert.equal(sessionRole({ agent_type: "ductus-orchestrator" }), "orchestrator");
  assert.equal(sessionRole({ agent_type: "ductus-platform-sre" }), "worker");
  for (const profile of ["ductus-independent-reviewer", "ductus-adversarial-qa", "ductus-bug-hunter"]) {
    assert.equal(sessionRole({ agent_type: profile }), "control");
  }
  for (const event of [{}, undefined, { agent_type: "Explore" }, { agent_type: "constructor" }, { agent_type: 7 }, { agent_type: "" }]) {
    assert.equal(sessionRole(event), "unknown");
  }
});

test("every agent profile in the repo has a role, except the read-only scout", () => {
  const profiles = fs
    .readdirSync(path.join(repo, ".claude/agents"), { recursive: true })
    .filter((file) => String(file).endsWith(".md"))
    .map((file) => path.basename(String(file), ".md"));
  assert.ok(profiles.length > 5);
  for (const profile of profiles) {
    if (profile !== "ductus-scout") assert.ok(Object.hasOwn(PROFILE_ROLES, profile), `${profile} has no role`);
  }
  for (const profile of Object.keys(PROFILE_ROLES)) assert.ok(profiles.includes(profile), `${profile} is not a profile`);
});

test("every profile in PROFILE_ROLES gets the notice of its own role from the budget hook", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ductus-roles-"));
  try {
    const transcript = path.join(dir, "t.jsonl");
    fs.writeFileSync(transcript, assistant("a", { cache_read_input_tokens: ROTATE_AT }) + "\n");
    const expected = { orchestrator: /Reminder, not a stop/, worker: /IZVJEŠTAJ block of your own PR/, control: /your own comment on the PR or issue/ };
    assert.deepEqual([...new Set(Object.values(PROFILE_ROLES))].sort(), Object.keys(expected).sort());
    for (const [profile, role] of Object.entries(PROFILE_ROLES)) {
      assert.equal(sessionRole({ agent_type: profile }), role, profile);
      const notice = runHook("budget", { transcript_path: transcript, agent_type: profile }).additionalContext;
      for (const [other, pattern] of Object.entries(expected)) {
        if (other === role) assert.match(notice, pattern, profile);
        else assert.doesNotMatch(notice, pattern, profile);
      }
      if (role === "orchestrator") assert.doesNotMatch(notice, BAN, profile);
      else assert.match(notice, BAN, profile);
    }
    // A name near a profile is not that profile.
    for (const profile of ["ductus-scout", "Ductus-Orchestrator", "ductus-orchestrator ", "orchestrator"]) {
      assert.equal(sessionRole({ agent_type: profile }), "unknown", profile);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the orchestrator is reminded to hand off and compact, never told to rotate or stop", () => {
  for (const tokens of [ROTATE_AT, HARD_AT, HARD_AT * 2]) {
    const notice = budgetNotice(tokens, "orchestrator");
    assert.match(notice, /docs\/ORKESTRATOR\.md §7/);
    assert.match(notice, /board/);
    assert.match(notice, /coordination issue/);
    assert.match(notice, /compact/);
    assert.doesNotMatch(notice, BAN);
    assert.doesNotMatch(notice, /ductus-handoff|should be rotated|fresh session/);
  }
  assert.equal(budgetNotice(ROTATE_AT - 1, "orchestrator"), null);
});

test("an unrecognised role is never forbidden to work and gets the orchestrator exemption", () => {
  for (const tokens of [ROTATE_AT, HARD_AT]) {
    for (const notice of [budgetNotice(tokens), budgetNotice(tokens, "unknown"), budgetNotice(tokens, "nonsense")]) {
      assert.doesNotMatch(notice, BAN);
      assert.match(notice, /role could not be detected/);
      assert.match(notice, /If you are the orchestrator[^.]*docs\/ORKESTRATOR\.md §7/);
      assert.match(notice, /Any other role[^.]*ductus-handoff/);
    }
  }
});

test("workers hand off in their own PR, control roles in their own comment", () => {
  for (const tokens of [ROTATE_AT, HARD_AT]) {
    const worker = budgetNotice(tokens, "worker");
    assert.match(worker, BAN);
    assert.match(worker, /ductus-handoff/);
    assert.match(worker, /your own PR/);
    const control = budgetNotice(tokens, "control");
    assert.match(control, BAN);
    assert.match(control, /your own comment/);
    assert.match(control, /never edit another author's PR body/);
    assert.doesNotMatch(control, /IZVJEŠTAJ block/);
  }
});

test("budget entry point applies the role from the hook input", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ductus-role-"));
  try {
    const transcript = path.join(dir, "t.jsonl");
    fs.writeFileSync(transcript, assistant("a", { cache_read_input_tokens: HARD_AT }) + "\n");
    const notice = (extra) => run("budget", { transcript_path: transcript, ...extra }).additionalContext;
    assert.doesNotMatch(notice({ agent_type: "ductus-orchestrator" }), BAN);
    assert.match(notice({ agent_type: "ductus-orchestrator" }), /not rotated/);
    assert.match(notice({ agent_type: "ductus-backend-data" }), BAN);
    assert.match(notice({ agent_type: "ductus-independent-reviewer" }), /your own comment/);
    assert.doesNotMatch(notice({}), BAN);
    assert.doesNotMatch(notice({ agent_type: { nested: true } }), BAN);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("paths under the Read deny rules are left to the permission system unread", () => {
  const fail = () => assert.fail("must not read the file");
  const denied = ["secrets/runbook.md", "infra/Secrets/RUNBOOK.MD", ".env", "app/.env.local", ".env.ci.local", ".env.production", "infra/key.md.age", "secrets/pnpm-lock.yaml"];
  for (const file of denied) {
    assert.equal(isProtected(file), true, file);
    assert.equal(reviewRead({ file_path: file }, big, fail), null, file);
  }
  for (const file of ["docs/secrets.md", "docs/environment.md", "src/age.md", "docs/BACKEND.md"]) assert.equal(isProtected(file), false, file);
});

test("every Read deny rule in settings.json is covered by the hook", () => {
  const settings = JSON.parse(fs.readFileSync(path.join(repo, ".claude/settings.json"), "utf8"));
  const rules = settings.permissions.deny.filter((rule) => rule.startsWith("Read("));
  assert.ok(rules.length >= 7);
  for (const rule of rules) {
    const sample = rule.slice(5, -1).replace(/^\*\*\//, "a/").replace(/\*\*/g, "x.md").replace(/\*/g, "x");
    assert.equal(isProtected(sample), true, `${rule} -> ${sample}`);
  }
});

test("read entry point never puts content of a deny-listed file in its output", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ductus-deny-"));
  try {
    const secret = "## TOP-SECRET-HEADING\n" + "x".repeat(LARGE_DOC_BYTES);
    fs.mkdirSync(path.join(dir, "secrets"));
    fs.mkdirSync(path.join(dir, "docs"));
    fs.writeFileSync(path.join(dir, "secrets", "runbook.md"), secret);
    fs.writeFileSync(path.join(dir, ".env.local"), secret);
    fs.writeFileSync(path.join(dir, "docs", "open.md"), secret);
    const raw = (file) => {
      const result = spawnSync(process.execPath, [script, "read"], {
        input: JSON.stringify({ cwd: dir, tool_input: { file_path: file } }),
        encoding: "utf8",
        env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
      });
      assert.equal(result.status, 0);
      return result.stdout + result.stderr;
    };
    // Control: the same content outside the deny rules is outlined.
    assert.match(raw("docs/open.md"), /TOP-SECRET-HEADING/);
    for (const file of ["secrets/runbook.md", path.join(dir, "secrets", "runbook.md"), "docs/../secrets/runbook.md"]) {
      assert.equal(raw(file), "", file);
    }
    dirLink(path.join(dir, "secrets"), path.join(dir, "docs", "linked"));
    assert.equal(raw("docs/linked/runbook.md"), "");
    await t.test("file link to a deny-listed file", (t) => {
      if (fileLink(t, path.join(dir, "secrets", "runbook.md"), path.join(dir, "docs", "link.md"))) assert.equal(raw("docs/link.md"), "");
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("real project path rejects targets outside the project or under a deny rule", () => {
  const root = path.resolve("repo");
  const at = (...parts) => path.join(root, ...parts);
  const links = { [at("STATE.md")]: at(".env"), [at("docs", "out.md")]: path.resolve("elsewhere", "private.md"), [at("docs", "sec.md")]: at("secrets", "a.md") };
  const realpath = (file) => links[file] ?? file;
  assert.deepEqual(realProjectPath(root, at("docs", "BACKEND.md"), realpath), { file: at("docs", "BACKEND.md"), relative: "docs/BACKEND.md" });
  for (const file of [at("STATE.md"), at("docs", "out.md"), at("docs", "sec.md"), root, path.resolve("STATE.md")]) {
    assert.equal(realProjectPath(root, file, realpath), null, file);
  }
  // A project reached through a link is still the project.
  const viaLink = (file) => file.replace(path.resolve("link"), root);
  assert.equal(realProjectPath(path.resolve("link"), path.resolve("link", "STATE.md"), viaLink).relative, "STATE.md");
  assert.equal(realProjectPath(root, at("..notes.md"), realpath).relative, "..notes.md");
});

test("start entry point loads only the project's own STATE.md, never a link target", async (t) => {
  const { base, dir, outside } = sandbox();
  try {
    const state = path.join(dir, "STATE.md");
    assert.equal(raw("start", { cwd: dir }, dir), "");
    // Control: a regular STATE.md is loaded, also when the project is reached through a link.
    fs.writeFileSync(state, "# Stanje rada\n");
    assert.match(raw("start", { cwd: dir }, dir), /# Stanje rada/);
    dirLink(dir, path.join(base, "via"));
    assert.match(raw("start", { cwd: dir }, path.join(base, "via")), /# Stanje rada/);
    fs.rmSync(state);
    fs.mkdirSync(state);
    assert.equal(raw("start", { cwd: dir }, dir), "");
    fs.rmSync(state, { recursive: true });
    const targets = [path.join(dir, ".env"), path.join(dir, "secrets", "STATE.md"), path.join(outside, "STATE.md"), path.join(dir, "docs", "small.md")];
    for (const target of targets) {
      await t.test(`STATE.md linked to ${path.relative(base, target)}`, (t) => {
        if (!fileLink(t, target, state)) return;
        assert.equal(raw("start", { cwd: dir }, dir), "");
        fs.rmSync(state);
      });
    }
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("read entry point leaves a link out of the repo to the permission system", async (t) => {
  const { base, dir, outside } = sandbox();
  try {
    // Control: the same content inside the repo is outlined.
    assert.match(raw("read", { cwd: dir, tool_input: { file_path: "docs/open.md" } }, dir), new RegExp(MARK));
    dirLink(path.join(outside, "notes"), path.join(dir, "docs", "ext"));
    assert.equal(raw("read", { cwd: dir, tool_input: { file_path: "docs/ext/private.md" } }, dir), "");
    await t.test("file link to a document outside the repo", (t) => {
      if (!fileLink(t, path.join(outside, "notes", "private.md"), path.join(dir, "docs", "out.md"))) return;
      assert.equal(raw("read", { cwd: dir, tool_input: { file_path: "docs/out.md" } }, dir), "");
    });
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// QA on 2523825 (#117): with the project root given as a link and Read naming
// the real path, the names alone put the file outside the project and the
// document rule silently did not apply.
test("read entry point knows its own files when the root or the file is named through a link", () => {
  const { base, dir, outside } = sandbox();
  try {
    const via = path.join(base, "via");
    dirLink(dir, via);
    fs.writeFileSync(path.join(dir, "pnpm-lock.yaml"), `# ${MARK}\n`);
    const read = (root, file) => raw("read", { cwd: dir, tool_input: { file_path: file } }, root);
    for (const [root, other] of [[via, dir], [dir, via]]) {
      assert.match(read(root, path.join(other, "docs", "open.md")), new RegExp(`"deny".*${MARK}`), `${root} <- ${other}`);
      assert.match(read(root, path.join(other, "pnpm-lock.yaml")), /generated output/);
      assert.equal(read(root, path.join(other, "docs", "small.md")), "");
      assert.equal(read(root, path.join(other, "docs", "missing.md")), "");
      // Deny-listed and foreign files stay unread however they are named.
      for (const file of [path.join(other, "secrets", "runbook.md"), path.join(other, ".env"), path.join(outside, "notes", "private.md")]) {
        assert.equal(read(root, file), "", `${root} <- ${file}`);
      }
    }
    dirLink(path.join(dir, "secrets"), path.join(dir, "docs", "l"));
    dirLink(path.join(outside, "notes"), path.join(dir, "docs", "ext"));
    assert.equal(read(via, path.join(dir, "docs", "l", "runbook.md")), "");
    assert.equal(read(via, path.join(dir, "docs", "ext", "private.md")), "");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// One probe list per hook mode; `link` is "dir", "file" or absent. Every probe
// points the mode at a file that resolves under a deny rule or outside the repo.
const readOf = (file) => (s) => ({ cwd: s.dir, tool_input: { file_path: file } });
const startOf = (s) => ({ cwd: s.dir });
const PROBES = {
  read: [
    { name: "deny-listed path", event: readOf("secrets/runbook.md") },
    { name: "directory link to secrets/", link: "dir", target: (s) => path.join(s.dir, "secrets"), at: "docs/l", event: readOf("docs/l/runbook.md") },
    { name: "directory link out of the repo", link: "dir", target: (s) => path.join(s.outside, "notes"), at: "docs/l", event: readOf("docs/l/private.md") },
    { name: "file link to secrets/", link: "file", target: (s) => path.join(s.dir, "secrets", "runbook.md"), at: "docs/l.md", event: readOf("docs/l.md") },
    { name: "file link out of the repo", link: "file", target: (s) => path.join(s.outside, "notes", "private.md"), at: "docs/l.md", event: readOf("docs/l.md") },
  ],
  start: [
    { name: "STATE.md is a directory link to secrets/", link: "dir", target: (s) => path.join(s.dir, "secrets"), at: "STATE.md", event: startOf },
    { name: "file link to .env", link: "file", target: (s) => path.join(s.dir, ".env"), at: "STATE.md", event: startOf },
    { name: "file link to secrets/", link: "file", target: (s) => path.join(s.dir, "secrets", "STATE.md"), at: "STATE.md", event: startOf },
    { name: "file link out of the repo", link: "file", target: (s) => path.join(s.outside, "STATE.md"), at: "STATE.md", event: startOf },
  ],
  budget: [
    { name: "deny-listed path", event: (s) => ({ transcript_path: path.join(s.dir, "secrets", "t.jsonl") }) },
    { name: "directory link to secrets/", link: "dir", target: (s) => path.join(s.dir, "secrets"), at: "docs/l", event: (s) => ({ transcript_path: path.join(s.dir, "docs", "l", "t.jsonl") }) },
    { name: "file link to secrets/", link: "file", target: (s) => path.join(s.dir, "secrets", "t.jsonl"), at: "docs/t.jsonl", event: (s) => ({ transcript_path: path.join(s.dir, "docs", "t.jsonl") }) },
  ],
};

test("no hook mode reads or quotes a file that resolves under a deny rule or outside the repo", async (t) => {
  // A new mode has to add its probes here.
  assert.deepEqual(Object.keys(PROBES).sort(), [...MODE_NAMES].sort());
  for (const [mode, probes] of Object.entries(PROBES)) {
    for (const probe of probes) {
      await t.test(`${mode}: ${probe.name}`, (t) => {
        const s = sandbox();
        try {
          const at = probe.at && path.join(s.dir, probe.at);
          if (probe.link === "dir") dirLink(probe.target(s), at);
          if (probe.link === "file" && !fileLink(t, probe.target(s), at)) return;
          assert.equal(raw(mode, probe.event(s), probe.project ? probe.project(s) : s.dir), "");
        } finally {
          fs.rmSync(s.base, { recursive: true, force: true });
        }
      });
    }
  }
  // The transcript is the one file read outside the repo, by design; only its size is reported.
  const s = sandbox();
  try {
    const transcript = path.join(s.outside, "t.jsonl");
    fs.writeFileSync(transcript, bigTranscript);
    const output = raw("budget", { transcript_path: transcript }, s.dir);
    assert.match(output, /Context is 250k tokens/);
    assert.doesNotMatch(output, new RegExp(MARK));
  } finally {
    fs.rmSync(s.base, { recursive: true, force: true });
  }
});

// QA on ab2221d: the path was checked, then opened again by name. The tests
// below change the file system between the two through an injected `io`.
const OK = "OK-FAKE";
const LEAK = "SECRET-FAKE";

// base/repo is the project; repo/secrets is deny-listed and base/vault is outside it.
function raceSandbox() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ductus-race-")));
  const dir = path.join(base, "repo");
  for (const folder of [path.join(dir, "ok"), path.join(dir, "secrets"), path.join(base, "vault")]) fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(dir, "STATE.md"), `# ${OK}\n`);
  fs.writeFileSync(path.join(dir, ".env"), `FAKE_TOKEN=${LEAK}\n`);
  fs.writeFileSync(path.join(dir, "ok", "big.md"), `## ${OK}\n` + "x".repeat(LARGE_DOC_BYTES));
  fs.writeFileSync(path.join(dir, "ok", "t.jsonl"), assistant("a", { cache_read_input_tokens: ROTATE_AT }) + "\n");
  fs.writeFileSync(path.join(dir, "secrets", "big.md"), `## ${LEAK}\n` + "x".repeat(LARGE_DOC_BYTES));
  fs.writeFileSync(path.join(dir, "secrets", "t.jsonl"), assistant("a", { cache_read_input_tokens: HARD_AT }) + "\n");
  fs.writeFileSync(path.join(base, "vault", "STATE.md"), `# ${LEAK}\n`);
  return { base, dir };
}

// Replaces the directory `at` with a link to `target`, and puts it back.
function swapper(at, target) {
  const kept = `${at}.real`;
  return {
    in: () => (fs.renameSync(at, kept), dirLink(target, at)),
    out: () => (fs.rmSync(at), fs.renameSync(kept, at)),
  };
}

// The real file system, except that `before[name]` runs once, just ahead of
// the first by-name call of that function. readFileSync is hooked like
// openSync so that a hook reading by name is caught as well. `io.ran` lists
// the actions that ran and `io.failed` those that threw, so a test can tell a
// swap that happened from one that did not.
function racing(before) {
  const io = { ...fs, ran: [], failed: [] };
  for (const [name, action] of Object.entries(before)) {
    io[name] = (target, ...rest) => {
      if (!io.ran.includes(name) && (typeof target === "string" || name === "fstatSync")) {
        io.ran.push(name);
        try {
          action();
        } catch (error) {
          io.failed.push(`${name}: ${error.message}`);
        }
      }
      return fs[name](target, ...rest);
    };
  }
  return io;
}

// A hook run as main() would see it: a throw is no output (fail open).
function quiet(mode, event, io, env) {
  try {
    return runHook(mode, event, io, env);
  } catch {
    return undefined;
  }
}

// The swaps a timing asked for all happened, in the hook's by-descriptor path.
function assertSwapped(io, hooks) {
  assert.deepEqual(io.failed, []);
  assert.deepEqual(io.ran, Object.keys(hooks).filter((name) => name !== "readFileSync"));
}

// When the swap happens, relative to the hook's own steps.
const TIMINGS = {
  "link swapped in before the open": (swap) => ({ openSync: swap.in, readFileSync: swap.in }),
  "link swapped in before the open and out again after it": (swap) => ({ openSync: swap.in, readFileSync: swap.in, fstatSync: swap.out }),
};

// What each mode is pointed at, which directory is replaced by a link to
// which, and what a correct run and a fooled run would print.
const RACES = {
  read: { at: "repo/ok", target: "repo/secrets", event: (s) => ({ cwd: s.dir, tool_input: { file_path: "ok/big.md" } }), control: new RegExp(OK), leak: new RegExp(LEAK) },
  budget: { at: "repo/ok", target: "repo/secrets", event: (s) => ({ transcript_path: path.join(s.dir, "ok", "t.jsonl") }), control: /150k tokens/, leak: /250k tokens/ },
  start: { at: "repo", target: "vault", event: (s) => ({ cwd: s.dir }), control: new RegExp(OK), leak: new RegExp(LEAK) },
};

test("no hook mode follows a link swapped in between its path check and its read", async (t) => {
  // A new mode has to add its race here.
  assert.deepEqual(Object.keys(RACES).sort(), [...MODE_NAMES].sort());
  for (const [mode, race] of Object.entries(RACES)) {
    for (const [timing, hooks] of Object.entries(TIMINGS)) {
      await t.test(`${mode}: ${timing}`, () => {
        const s = raceSandbox();
        try {
          const env = { CLAUDE_PROJECT_DIR: s.dir };
          // Control: undisturbed, the hook reads the checked file.
          assert.match(JSON.stringify(runHook(mode, race.event(s), fs, env)), race.control);
          const plan = hooks(swapper(path.join(s.base, race.at), path.join(s.base, race.target)));
          const io = racing(plan);
          const output = quiet(mode, race.event(s), io, env);
          assertSwapped(io, plan);
          assert.doesNotMatch(JSON.stringify(output ?? ""), race.leak);
          assert.equal(output, undefined);
        } finally {
          fs.rmSync(s.base, { recursive: true, force: true });
        }
      });
    }
    // Every name check is fooled here: the link is in place for the open and
    // for the stat by name, and gone while the name is resolved. Only the
    // kernel's record of the descriptor's path tells, so this runs on Linux.
    await t.test(`${mode}: link in place for the open and the stat, gone for the realpath`, (t) => {
      if (process.platform !== "linux") return t.skip("needs /proc/self/fd; other platforms have only the name checks (docs/SESSIONS.md §4a)");
      const s = raceSandbox();
      try {
        const swap = swapper(path.join(s.base, race.at), path.join(s.base, race.target));
        let checking = false;
        const io = racing({ openSync: () => (swap.in(), (checking = true)), lstatSync: swap.in });
        io.realpathSync = (...args) => {
          if (checking) {
            swap.out();
            checking = false;
          }
          return fs.realpathSync(...args);
        };
        assert.equal(runHook(mode, race.event(s), io, { CLAUDE_PROJECT_DIR: s.dir }), undefined);
        assert.deepEqual([io.failed, io.ran, checking], [[], ["openSync", "lstatSync"], false]);
      } finally {
        fs.rmSync(s.base, { recursive: true, force: true });
      }
    });
  }
});

test("read does not follow a swapped-in link when the project root is given as a link", async (t) => {
  for (const [timing, hooks] of Object.entries(TIMINGS)) {
    await t.test(timing, () => {
      const s = raceSandbox();
      try {
        const env = { CLAUDE_PROJECT_DIR: path.join(s.base, "via") };
        dirLink(s.dir, env.CLAUDE_PROJECT_DIR);
        const event = { cwd: s.dir, tool_input: { file_path: path.join(s.dir, "ok", "big.md") } };
        assert.match(JSON.stringify(runHook("read", event, fs, env)), new RegExp(OK));
        const plan = hooks(swapper(path.join(s.dir, "ok"), path.join(s.dir, "secrets")));
        const io = racing(plan);
        const output = quiet("read", event, io, env);
        assertSwapped(io, plan);
        assert.doesNotMatch(JSON.stringify(output ?? ""), new RegExp(LEAK));
        assert.equal(output, undefined);
      } finally {
        fs.rmSync(s.base, { recursive: true, force: true });
      }
    });
  }
});

test("start does not follow STATE.md replaced by a file link to .env after the check", async (t) => {
  for (const [timing, hooks] of Object.entries(TIMINGS)) {
    await t.test(timing, (t) => {
      const s = raceSandbox();
      try {
        const state = path.join(s.dir, "STATE.md");
        if (!fileLink(t, path.join(s.dir, ".env"), path.join(s.dir, "probe"))) return;
        const swap = {
          in: () => (fs.renameSync(state, `${state}.real`), fs.symlinkSync(path.join(s.dir, ".env"), state, "file")),
          out: () => (fs.rmSync(state), fs.renameSync(`${state}.real`, state)),
        };
        const io = racing(hooks(swap));
        assert.equal(quiet("start", { cwd: s.dir }, io, { CLAUDE_PROJECT_DIR: s.dir }), undefined);
        // Where O_NOFOLLOW exists the open itself refuses the link, so nothing after it runs.
        assert.deepEqual(io.failed, []);
        assert.equal(io.ran[0], "openSync");
      } finally {
        fs.rmSync(s.base, { recursive: true, force: true });
      }
    });
  }
});

test("a checked file is read only when the open descriptor is the file at the checked path", () => {
  const s = raceSandbox();
  try {
    const file = path.join(s.dir, "STATE.md");
    const read = (io) => withCheckedFile(file, (fd, size) => `${size}:${fs.readFileSync(fd, "utf8")}`, io);
    assert.equal(read(fs), `${OK.length + 3}:# ${OK}\n`);
    assert.equal(withCheckedFile(path.join(s.dir, "ok", "big.md"), () => "read"), "read");
    // Not a regular file. Linux opens a directory and fstat rejects it; Windows refuses the open.
    assert.notEqual(
      (() => {
        try {
          return withCheckedFile(s.dir, () => "read");
        } catch {
          return undefined;
        }
      })(),
      "read",
    );
    // A file system that reports no inode cannot prove identity.
    const noInode = (name) => (...args) => Object.assign(fs[name](...args), { ino: 0n });
    assert.equal(read({ ...fs, fstatSync: noInode("fstatSync"), lstatSync: noInode("lstatSync") }), undefined);
    // Another file now sits at the checked name.
    const other = fs.statSync(path.join(s.dir, ".env"), { bigint: true });
    assert.equal(read({ ...fs, lstatSync: () => other }), undefined);
    // The name now resolves elsewhere.
    assert.equal(read({ ...fs, realpathSync: () => path.join(s.dir, ".env") }), undefined);
    // On Linux the descriptor's own path decides, whatever the names say.
    const linux = (fdPath) => ({ ...fs, platform: "linux", readlinkSync: () => fdPath });
    assert.equal(read(linux(path.join(s.dir, "secrets", "big.md"))), undefined);
    assert.equal(read(linux(`${file} (deleted)`)), undefined);
    assert.equal(read(linux(file)), `${OK.length + 3}:# ${OK}\n`);
    // Every descriptor is closed, also when the file is refused.
    let open = 0;
    const counting = { ...linux("elsewhere"), openSync: (...args) => ((open += 1), fs.openSync(...args)), closeSync: (fd) => ((open -= 1), fs.closeSync(fd)) };
    assert.equal(read(counting), undefined);
    assert.equal(open, 0);
  } finally {
    fs.rmSync(s.base, { recursive: true, force: true });
  }
});

test("a repo below a directory named secrets/ keeps its hooks; its own deny-listed files stay unread", () => {
  const root = path.resolve("secrets", "Ductus");
  const same = (file) => file;
  assert.deepEqual(realProjectPath(root, path.join(root, "docs", "BACKEND.md"), same), { file: path.join(root, "docs", "BACKEND.md"), relative: "docs/BACKEND.md" });
  for (const file of [path.join(root, "secrets", "a.md"), path.join(root, ".env"), path.join(root, "infra", "key.age"), path.resolve("secrets", "other", "a.md")]) {
    assert.equal(realProjectPath(root, file, same), null, file);
  }
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ductus-under-")));
  try {
    const dir = path.join(base, "secrets", "Ductus");
    for (const folder of ["docs", "secrets"]) fs.mkdirSync(path.join(dir, folder), { recursive: true });
    fs.writeFileSync(path.join(dir, "STATE.md"), `# ${OK}\n`);
    fs.writeFileSync(path.join(dir, "docs", "big.md"), `## ${OK}\n` + "x".repeat(LARGE_DOC_BYTES));
    fs.writeFileSync(path.join(dir, "secrets", "big.md"), `## ${LEAK}\n` + "x".repeat(LARGE_DOC_BYTES));
    fs.writeFileSync(path.join(dir, ".env"), `## ${LEAK}\n` + "x".repeat(LARGE_DOC_BYTES));
    fs.writeFileSync(path.join(base, "secrets", "sibling.md"), `## ${LEAK}\n` + "x".repeat(LARGE_DOC_BYTES));
    const readEvent = (file) => ({ cwd: dir, tool_input: { file_path: file } });
    assert.match(run("start", { cwd: dir }, dir).additionalContext, new RegExp(`# ${OK}`));
    assert.match(run("start", { cwd: dir }).additionalContext, new RegExp(`# ${OK}`));
    const denied = run("read", readEvent("docs/big.md"), dir);
    assert.equal(denied.permissionDecision, "deny");
    assert.match(denied.permissionDecisionReason, new RegExp(`1: ## ${OK}`));
    for (const file of ["secrets/big.md", ".env", "../sibling.md", path.join(base, "secrets", "sibling.md")]) {
      assert.equal(raw("read", readEvent(file), dir), "", file);
    }
    dirLink(path.join(dir, "secrets"), path.join(dir, "docs", "l"));
    assert.equal(raw("read", readEvent("docs/l/big.md"), dir), "");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("the orchestrator is told about the 200k safety limit of ORKESTRATOR.md §7 from 200k on", () => {
  const limit = /200k upper safety limit in §7/;
  assert.equal(ORCHESTRATOR_LIMIT, 200_000);
  assert.match(fs.readFileSync(path.join(repo, "docs/ORKESTRATOR.md"), "utf8"), /200\.000 tokena je gornja sigurnosna granica/);
  for (const tokens of [ROTATE_AT, ORCHESTRATOR_LIMIT - 1]) assert.doesNotMatch(budgetNotice(tokens, "orchestrator"), limit);
  for (const tokens of [ORCHESTRATOR_LIMIT, 210_000, HARD_AT]) {
    assert.match(budgetNotice(tokens, "orchestrator"), limit);
    assert.doesNotMatch(budgetNotice(tokens, "orchestrator"), BAN);
  }
  for (const role of ["worker", "control", "unknown"]) assert.doesNotMatch(budgetNotice(210_000, role), limit);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ductus-limit-"));
  try {
    const transcript = path.join(dir, "t.jsonl");
    fs.writeFileSync(transcript, assistant("a", { cache_read_input_tokens: 210_000 }) + "\n");
    assert.match(run("budget", { transcript_path: transcript, agent_type: "ductus-orchestrator" }).additionalContext, limit);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("handoff skill names a destination per role and both copies match", () => {
  const claude = fs.readFileSync(path.join(repo, ".claude/skills/ductus-handoff/SKILL.md"), "utf8");
  assert.equal(fs.readFileSync(path.join(repo, ".agents/skills/ductus-handoff/SKILL.md"), "utf8"), claude);
  assert.match(claude, /Orchestrator[^\n]*not rotated/);
  assert.match(claude, /Reviewer, QA, Bug Hunter[^\n]*own comment[^\n]*never[^\n]*PR body/);
  assert.match(claude, /Worker[^\n]*own PR/);
});

test("token report de-duplicates streamed calls and measures over-budget context", () => {
  const lines = [
    assistant("a", { input_tokens: 10, cache_read_input_tokens: 80, cache_creation_input_tokens: 10 }),
    assistant("a", { input_tokens: 10, cache_read_input_tokens: 80, cache_creation_input_tokens: 10 }),
    JSON.stringify({ type: "assistant", message: { id: "b", usage: { cache_read_input_tokens: 400 }, content: [{ type: "tool_use", id: "t1", name: "Read" }] } }),
    JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "12345" }] }] } }),
    "not json",
  ];
  assert.deepEqual(summarizeTranscript(lines, 150), {
    calls: 2,
    input: 500,
    baseline: 200,
    overBudget: 250,
    first: 100,
    max: 400,
    tools: { Read: { calls: 1, chars: 5 } },
  });
});
