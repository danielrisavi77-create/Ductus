#!/usr/bin/env node
// Where the input tokens of Ductus Claude Code sessions go, read from local
// session transcripts. Read-only; prints counts only, never transcript text.
// Usage: node scripts/engineering/token-report.mjs [--days 10] [--budget 150000] [--json]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const contextOf = (usage) =>
  (usage.input_tokens ?? 0) +
  (usage.cache_read_input_tokens ?? 0) +
  (usage.cache_creation_input_tokens ?? 0);

const resultChars = (content) => {
  if (typeof content === "string") return content.length;
  if (!Array.isArray(content)) return 0;
  return content.reduce((sum, block) => sum + (block.type === "text" ? (block.text?.length ?? 0) : 0), 0);
};

// One transcript -> per-call context sizes and tool-result sizes. A streamed
// assistant message is logged once per content block with the same usage, so
// calls are de-duplicated by message id.
export function summarizeTranscript(lines, budget) {
  const seen = new Set();
  const pending = new Map();
  const tools = {};
  const contexts = [];
  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const message = entry.message;
    if (!message) continue;
    if (entry.type === "assistant" && message.usage && !seen.has(message.id)) {
      seen.add(message.id);
      contexts.push(contextOf(message.usage));
    }
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (block.type === "tool_use") pending.set(block.id, block.name);
      if (block.type === "tool_result") {
        const name = pending.get(block.tool_use_id) ?? "unknown";
        const tool = (tools[name] ??= { calls: 0, chars: 0 });
        tool.calls += 1;
        tool.chars += resultChars(block.content);
      }
    }
  }
  const input = contexts.reduce((a, b) => a + b, 0);
  return {
    calls: contexts.length,
    input,
    baseline: contexts.length ? contexts[0] * contexts.length : 0,
    overBudget: contexts.reduce((a, c) => a + Math.max(0, c - budget), 0),
    first: contexts[0] ?? 0,
    max: contexts.length ? Math.max(...contexts) : 0,
    tools,
  };
}

function* transcripts(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* transcripts(full);
    else if (entry.name.endsWith(".jsonl")) yield full;
  }
}

function main() {
  const arg = (name, fallback) => {
    const at = process.argv.indexOf(name);
    return at > 0 ? Number(process.argv[at + 1]) : fallback;
  };
  const days = arg("--days", 10);
  const budget = arg("--budget", 150_000);
  const root = path.join(os.homedir(), ".claude", "projects");
  const since = Date.now() - days * 86_400_000;

  const sessions = [];
  const tools = {};
  for (const dir of fs.readdirSync(root).filter((name) => /ductus/i.test(name))) {
    for (const file of transcripts(path.join(root, dir))) {
      if (fs.statSync(file).mtimeMs < since) continue;
      const summary = summarizeTranscript(fs.readFileSync(file, "utf8").split("\n"), budget);
      if (summary.calls < 3) continue;
      for (const [name, tool] of Object.entries(summary.tools)) {
        const total = (tools[name] ??= { calls: 0, chars: 0 });
        total.calls += tool.calls;
        total.chars += tool.chars;
      }
      delete summary.tools;
      sessions.push({ session: path.basename(file, ".jsonl").slice(0, 8), subagent: file.includes("subagents"), ...summary });
    }
  }
  sessions.sort((a, b) => b.input - a.input);
  const sum = (key) => sessions.reduce((a, s) => a + s[key], 0);
  const totals = { sessions: sessions.length, calls: sum("calls"), input: sum("input"), baseline: sum("baseline"), overBudget: sum("overBudget") };

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ days, budget, totals, sessions, tools }, null, 2));
    return;
  }
  const millions = (n) => `${(n / 1e6).toFixed(1)}M`;
  const share = (n) => (totals.input ? `${Math.round((100 * n) / totals.input)}%` : "0%");
  console.log(`Last ${days} days: ${totals.sessions} transcripts, ${totals.calls} model calls, ${millions(totals.input)} input tokens`);
  console.log(`  starting context repeated on every call: ${millions(totals.baseline)} (${share(totals.baseline)})`);
  console.log(`  context above ${budget / 1000}k per call:          ${millions(totals.overBudget)} (${share(totals.overBudget)})`);
  console.table(sessions.slice(0, 12).map((s) => ({ ...s, input: millions(s.input), baseline: millions(s.baseline), overBudget: millions(s.overBudget) })));
  console.table(
    Object.entries(tools)
      .sort((a, b) => b[1].chars - a[1].chars)
      .slice(0, 10)
      .map(([tool, t]) => ({ tool, calls: t.calls, resultKChars: Math.round(t.chars / 1000) })),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
