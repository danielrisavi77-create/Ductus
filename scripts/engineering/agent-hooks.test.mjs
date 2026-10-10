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
  OUTLINE_LIMIT,
  PROFILE_ROLES,
  ROTATE_AT,
  STATE_LIMIT,
  budgetNotice,
  isProtected,
  lastContext,
  outline,
  reviewRead,
  sessionRole,
  stateContext,
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

test("read entry point never puts content of a deny-listed file in its output", () => {
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
    let linked = true;
    try {
      fs.symlinkSync(path.join(dir, "secrets", "runbook.md"), path.join(dir, "docs", "link.md"));
    } catch {
      linked = false; // Windows without the symlink privilege.
    }
    if (linked) assert.equal(raw("docs/link.md"), "");
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
