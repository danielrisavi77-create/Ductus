#!/usr/bin/env node
// Aggregate LOCAL Claude Code transcript usage. Do not print prompt/result bodies.
// Counts are not a Claude Max quota, invoice, or a prediction of token savings.
// Usage: node scripts/engineering/token-report.mjs [--days 10] [--budget 150000] [--json]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const valid = (n) => Number.isSafeInteger(n) && n >= 0 ? n : 0;
const cleanName = (v) => typeof v === 'string' && /^[a-zA-Z0-9_.:-]{1,80}$/.test(v) ? v : 'unknown';
const kinds = ['freshInput', 'cacheRead', 'cacheWrite', 'output'];
const emptyUsage = () => Object.fromEntries(kinds.map(k => [k, 0]));
const countChars = (parts) => {
  if (typeof parts === 'string') return parts.length;
  if (!Array.isArray(parts)) return 0;
  return parts.reduce((n, b) => n + (b?.type === 'text' && typeof b.text === 'string' ? b.text.length : 0), 0);
};

// Streamed assistant messages repeat usage; count each message id only once.
// Tool bodies are never returned, only the lengths of text blocks.
export function summarizeTranscript(lines, budget = 150_000) {
  const seen = new Set(), seenTools = new Set(), seenResults = new Set(), pending = new Map();
  const contexts = [], tools = Object.create(null), models = Object.create(null);
  const usage = emptyUsage();
  let previousModel = null, modelSwitches = 0, previousTool = null, toolStreak = 0, maxToolStreak = 0;
  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const message = entry?.message;
    if (!message || typeof message !== 'object') continue;
    if (entry.type === 'assistant' && message.usage && typeof message.id === 'string' && !seen.has(message.id)) {
      seen.add(message.id);
      const u = message.usage;
      const counts = {
        freshInput: valid(u.input_tokens), cacheRead: valid(u.cache_read_input_tokens),
        cacheWrite: valid(u.cache_creation_input_tokens), output: valid(u.output_tokens),
      };
      const model = cleanName(message.model);
      const bucket = models[model] ??= { calls: 0, ...emptyUsage() };
      bucket.calls++;
      for (const k of kinds) { usage[k] += counts[k]; bucket[k] += counts[k]; }
      contexts.push(counts.freshInput + counts.cacheRead + counts.cacheWrite);
      if (previousModel && previousModel !== model) modelSwitches++;
      previousModel = model;
    }
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (block?.type === 'tool_use' && typeof block.id === 'string' && !seenTools.has(block.id)) {
        seenTools.add(block.id);
        const name = cleanName(block.name);
        pending.set(block.id, name);
        toolStreak = previousTool === name ? toolStreak + 1 : 1;
        maxToolStreak = Math.max(maxToolStreak, toolStreak);
        previousTool = name;
      }
      if (block?.type === 'tool_result' && typeof block.tool_use_id === 'string' && !seenResults.has(block.tool_use_id)) {
        seenResults.add(block.tool_use_id);
        const name = pending.get(block.tool_use_id) ?? 'unknown';
        const t = tools[name] ??= { calls: 0, chars: 0 };
        t.calls++;
        t.chars += countChars(block.content);
        pending.delete(block.tool_use_id);
      }
    }
  }
  const input = contexts.reduce((a, b) => a + b, 0);
  const prompt = usage.freshInput + usage.cacheRead + usage.cacheWrite;
  return {
    calls: contexts.length, input, baseline: contexts.length ? contexts[0] * contexts.length : 0,
    overBudget: contexts.reduce((a, n) => a + Math.max(0, n - budget), 0),
    first: contexts[0] ?? 0, max: contexts.length ? Math.max(...contexts) : 0,
    ...usage, cacheReadShare: prompt ? Number((usage.cacheRead / prompt).toFixed(4)) : null,
    modelSwitches, maxConsecutiveToolUses: maxToolStreak, models, tools,
  };
}

function* transcripts(dir) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, d.name);
    if (d.isSymbolicLink()) continue;
    if (d.isDirectory()) yield* transcripts(full);
    else if (d.isFile() && d.name.endsWith('.jsonl')) yield full;
  }
}

export function parseArgs(args) {
  let days = 10, budget = 150_000, json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') { json = true; continue; }
    if (!['--days', '--budget'].includes(a) || i + 1 >= args.length || !/^\d+$/.test(args[i + 1])) throw new Error('USAGE');
    const n = Number(args[++i]);
    if (!Number.isSafeInteger(n) || n < (a === '--days' ? 1 : 10_000) || n > (a === '--days' ? 365 : 1_000_000)) throw new Error('USAGE');
    if (a === '--days') days = n; else budget = n;
  }
  return { days, budget, json };
}

export function collect(root, now, days, budget) {
  const since = now - days * 86_400_000;
  const sessions = [], tools = Object.create(null), models = Object.create(null);
  if (!fs.existsSync(root)) return { sessions, tools, models, totals: totalsOf(sessions) };
  for (const dir of fs.readdirSync(root).filter(d => /ductus/i.test(d) && fs.lstatSync(path.join(root, d)).isDirectory())) {
    for (const file of transcripts(path.join(root, dir))) {
      if (fs.statSync(file).mtimeMs < since) continue;
      const s = summarizeTranscript(fs.readFileSync(file, 'utf8').split('\n'), budget);
      if (s.calls < 3) continue;
      for (const [name, t] of Object.entries(s.tools)) {
        const target = tools[name] ??= { calls: 0, chars: 0 };
        target.calls += t.calls; target.chars += t.chars;
      }
      for (const [name, m] of Object.entries(s.models)) {
        const target = models[name] ??= { calls: 0, ...emptyUsage() };
        target.calls += m.calls;
        for (const k of kinds) target[k] += m[k];
      }
      delete s.tools; delete s.models;
      sessions.push({ session: path.basename(file, '.jsonl').slice(0, 8), subagent: file.includes('subagents'), ...s });
    }
  }
  sessions.sort((a, b) => b.input - a.input);
  return { sessions, tools, models, totals: totalsOf(sessions) };
}

function totalsOf(sessions) {
  const sum = k => sessions.reduce((n, s) => n + (s[k] ?? 0), 0);
  return {
    sessions: sessions.length, calls: sum('calls'), input: sum('input'), baseline: sum('baseline'),
    overBudget: sum('overBudget'), freshInput: sum('freshInput'), cacheRead: sum('cacheRead'),
    cacheWrite: sum('cacheWrite'), output: sum('output'), modelSwitches: sum('modelSwitches'),
  };
}

function main() {
  try {
    const { days, budget, json } = parseArgs(process.argv.slice(2));
    const root = path.join(os.homedir(), '.claude', 'projects');
    const data = collect(root, Date.now(), days, budget);
    if (json) {
      console.log(JSON.stringify({ schemaVersion: 2, days, budget,
        disclaimer: 'Transcript usage counters; not Max quota or actual bill. Context/baseline are diagnostic sums, not cost.',
        ...data }, null, 2));
      return;
    }
    const m = n => `${(n / 1e6).toFixed(2)}M`;
    const t = data.totals;
    console.log(`Last ${days} days: ${t.sessions} transcripts, ${t.calls} calls, ${m(t.input)} total prompt tokens (including cached).`);
    console.log(`  Fresh input ${m(t.freshInput)} | Cache read ${m(t.cacheRead)} | Cache write ${m(t.cacheWrite)} | Output ${m(t.output)}`);
    console.log(`  Above context budget ${m(t.overBudget)} (not billing); model switches ${t.modelSwitches}.`);
    console.table(Object.entries(data.models).map(([model, u]) => ({ model, ...u })));
    console.table(Object.entries(data.tools).sort((a,b) => b[1].chars - a[1].chars).slice(0, 10)
      .map(([tool, u]) => ({ tool, calls: u.calls, resultKChars: Math.round(u.chars / 1000) })));
  } catch { console.error('Usage: token-report.mjs [--days 1..365] [--budget 10000..1000000] [--json]'); process.exitCode = 2; }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
