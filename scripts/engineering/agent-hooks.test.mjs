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
  ROTATE_AT,
  STATE_LIMIT,
  budgetNotice,
  lastContext,
  outline,
  reviewRead,
  stateContext,
} from "./agent-hooks.mjs";
import { summarizeTranscript } from "./token-report.mjs";

const script = fileURLToPath(new URL("./agent-hooks.mjs", import.meta.url));
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
