#!/usr/bin/env node
// Read Claude Code statusLine stdin; no network, subprocess or persisted data.
// Opt-in example: statusLine.command = "node scripts/engineering/claude-statusline.mjs"
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const percent = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100
  ? `${Math.round(n)}%` : 'n/a';
const clean = s => typeof s === 'string' && /^[A-Za-z0-9 ._+-]{1,60}$/.test(s) ? s : 'Claude';
export function formatStatus(d) {
  const model = clean(d?.model?.display_name);
  const ctx = percent(d?.context_window?.used_percentage);
  const five = percent(d?.rate_limits?.five_hour?.used_percentage);
  const week = percent(d?.rate_limits?.seven_day?.used_percentage);
  const ratio = d?.prompt_cache?.hit_ratio;
  const cache = typeof ratio === 'number' && ratio >= 0 && ratio <= 1 && Number.isFinite(ratio)
    ? percent(ratio * 100) : 'n/a';
  return `${model} | CTX ${ctx} | 5h ${five} | 7d ${week} | Cache ${cache}`;
}

async function main() {
  let raw = '';
  try {
    for await (const block of process.stdin) {
      raw += block;
      if (raw.length > 131072) throw new Error('oversize');
    }
    console.log(formatStatus(JSON.parse(raw)));
  } catch { console.log(formatStatus(null)); }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();
