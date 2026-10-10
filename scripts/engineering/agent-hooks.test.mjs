import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { HARD_AT, LARGE_DOC_BYTES, ROTATE_AT, budgetNotice, lastContext, outline, reviewRead } from "./agent-hooks.mjs";
import { summarizeTranscript } from "./token-report.mjs";

const script = fileURLToPath(new URL("./agent-hooks.mjs", import.meta.url));
const big = { size: LARGE_DOC_BYTES + 1 };
const doc = "# Title\n\n## 1. One\ntext\n```\n## not a heading\n```\n## 2. Two\n";

const assistant = (id, usage, extra = {}) => JSON.stringify({ type: "assistant", message: { id, usage, content: [] }, ...extra });

function run(mode, event) {
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
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
});

test("ranged read, small document and non-markdown file are allowed", () => {
  const fail = () => assert.fail("must not read the file");
  assert.equal(reviewRead({ file_path: "docs/BACKEND.md", offset: 10, limit: 40 }, big, fail), null);
  assert.equal(reviewRead({ file_path: "STATE.md" }, { size: LARGE_DOC_BYTES }, fail), null);
  assert.equal(reviewRead({ file_path: "src/domain/json.ts" }, big, fail), null);
  assert.equal(reviewRead({ file_path: "docs/missing.md" }, undefined, fail), null);
});

test("generated output is denied even with a range", () => {
  for (const file of ["pnpm-lock.yaml", "C:\\repo\\tsconfig.tsbuildinfo", ".next/server/app.js"]) {
    assert.match(reviewRead({ file_path: file, limit: 5 }, { size: 10 }, () => ""), /generated output/);
  }
  assert.equal(reviewRead({ file_path: "docs/next-steps.md" }, { size: 10 }, () => ""), null);
});

test("lastContext takes the newest main-thread call and ignores a cut first line", () => {
  const tail = [
    '"usage":{"input_tokens":999999}}',
    assistant("a", { input_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 }),
    assistant("b", { input_tokens: 1, cache_read_input_tokens: 200_000 }),
    assistant("c", { input_tokens: 7 }, { isSidechain: true }),
    JSON.stringify({ type: "user", message: { content: "hi" } }),
  ].join("\n");
  assert.equal(lastContext(tail), 200_001);
  assert.equal(lastContext(""), 0);
});

test("budget notice appears only past the rotation point and escalates", () => {
  assert.equal(budgetNotice(ROTATE_AT - 1), null);
  assert.match(budgetNotice(ROTATE_AT), /150k rotation point/);
  assert.match(budgetNotice(HARD_AT), /hard limit/);
});

test("hook entry point denies, stays silent and fails open", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ductus-hooks-"));
  try {
    const file = path.join(dir, "BIG.md");
    fs.writeFileSync(file, doc + "x".repeat(LARGE_DOC_BYTES));
    fs.writeFileSync(path.join(dir, "STATE.md"), "# Stanje rada\n");
    const transcript = path.join(dir, "t.jsonl");
    fs.writeFileSync(transcript, assistant("a", { cache_read_input_tokens: HARD_AT }) + "\n");

    const denied = run("read", { cwd: dir, tool_input: { file_path: "BIG.md" } });
    assert.equal(denied.permissionDecision, "deny");
    assert.equal(run("read", { cwd: dir, tool_input: { file_path: "STATE.md" } }), null);
    assert.match(run("budget", { transcript_path: transcript }).additionalContext, /hard limit/);
    assert.match(run("start", { cwd: dir }).additionalContext, /# Stanje rada/);

    assert.equal(run("budget", { transcript_path: path.join(dir, "missing.jsonl") }), null);
    assert.equal(run("start", { cwd: path.join(dir, "missing") }), null);
    assert.equal(run("unknown", {}), null);
    const garbage = spawnSync(process.execPath, [script, "read"], { input: "not json", encoding: "utf8" });
    assert.equal(garbage.status, 0);
    assert.equal(garbage.stdout, "");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("token report de-duplicates streamed calls and measures over-budget context", () => {
  const lines = [
    assistant("a", { input_tokens: 10, cache_read_input_tokens: 90 }),
    assistant("a", { input_tokens: 10, cache_read_input_tokens: 90 }),
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
