#!/usr/bin/env node
// Read-only diagnostics for Claude Code usage. Never adjusts models, tools, hooks, or gates.
// Usage: claude-audit.mjs models --role writer --risk standard --area ui --model opus
//        claude-audit.mjs surface | duplicates | cache --usage <token-report-v2.json>
//        claude-audit.mjs roi --usage <token-report-v2.json> --mapping <manual-map.json>
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const limited = s => typeof s === 'string' && /^[A-Za-z0-9_.:/@-]{1,130}$/.test(s) ? s : 'unknown';
const nonneg = n => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const fail = k => { throw new Error(k); };
const MAX_BYTES = 2_000_000;
const MODES = ['models', 'surface', 'duplicates', 'cache', 'roi'];
const OPTIONS = new Set(['--role','--risk','--area','--model','--usage','--mapping']);

export function readJsonBounded(file, max = MAX_BYTES) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > max || stat.size < 2) fail('JSON_FILE');
    return JSON.parse(fs.readFileSync(fd, 'utf8'));
  } finally { fs.closeSync(fd); }
}

export function dispatchAudit(root, { role, risk, area, model }) {
  const validRole = ['writer','review','qa','security','scout'].includes(role);
  if (!validRole || !['low','standard','critical'].includes(risk) || !['ui','platform','identity','evidence','auth','sync','other'].includes(area) || !/^(?:opus|sonnet|haiku)(?:-[A-Za-z0-9.-]+)?$/.test(String(model ?? ''))) fail('MODEL_ARGS');
  const rules = fs.readFileSync(path.join(root, 'docs/ORKESTRATOR.md'), 'utf8');
  // A changed policy must not silently leave this advisory detector claiming correctness.
  const known = /\| Pisac \| `low` i `standard` \| Sonnet/.test(rules) && /\| Pisac \| `critical` \| Opus/.test(rules) && /\| Pretrage i metapodaci \| sve razine \| Haiku/.test(rules);
  let expected = null;
  if (known) {
    if (role === 'scout') expected = 'haiku';
    else if (role === 'writer') expected = risk === 'critical' || ['identity','evidence','auth','sync'].includes(area) ? 'opus' : 'sonnet';
    else if (role === 'review') expected = risk === 'critical' || ['identity','evidence','auth','sync'].includes(area) ? 'opus' : 'sonnet';
    else if (role === 'qa' || role === 'security') expected = 'opus'; // conservative, never suggests downgrading these roles
  }
  const result = !expected ? 'POLICY_UNKNOWN' : String(model).startsWith(expected) ? 'MATCH' : 'REVIEW_MODEL_SELECTION';
  return { result, role, risk, area, declared: limited(model), expected, note: 'Advisory only: caller must validate real task scope and model against canonical governance. Does not change risk, model, or gate.' };
}

function ordinaryFiles(dir, depth = 0) {
  if (depth > 6 || !fs.existsSync(dir)) return [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  return entries.flatMap(e => {
    if (e.isSymbolicLink()) return [];
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return ordinaryFiles(full, depth + 1);
    return e.isFile() && (e.name === 'SKILL.md' || e.name.endsWith('.md')) ? [full] : [];
  });
}

export function surfaceAudit(root) {
  const cfg = readJsonBounded(path.join(root,'.claude/settings.json'), 256_000);
  const skills = ordinaryFiles(path.join(root,'.claude/skills')).filter(s => path.basename(s) === 'SKILL.md');
  const agents = ordinaryFiles(path.join(root,'.claude/agents'));
  const descriptions = skills.concat(agents).map(f => {
    const text = fs.readFileSync(f, 'utf8').slice(0, 40_000);
    const fm = /^---\s*\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';
    const line = fm.split('\n').find(x => /^description:/.test(x)) ?? '';
    return { file: path.relative(root, f).replaceAll('\\','/'), descriptionChars: line.length, frontmatterChars: fm.length };
  });
  const plugins = Object.entries(cfg.enabledPlugins ?? {}).filter(([,on]) => on === true).map(([name]) => limited(name));
  const frontmatterChars = descriptions.reduce((sum,d) => sum + d.frontmatterChars, 0);
  return { skills: skills.length, agents: agents.length, enabledPluginNames: plugins.sort(), frontmatterChars,
    largestDescriptors: descriptions.sort((a,b) => b.descriptionChars - a.descriptionChars).slice(0,8),
    note: 'Static local configuration; not exact Claude runtime token use. Does not disable plugins or change settings.' };
}

export function duplicatesAudit(root) {
  const targets = ['AGENTS.md','CLAUDE.md','docs/ENGINEERING_SYSTEM-SAZETAK.md','docs/ORKESTRATOR-SAZETAK.md'];
  const files = targets.map(f => path.join(root,f)).filter(f => fs.existsSync(f)).concat(ordinaryFiles(path.join(root,'.claude/rules')));
  const paragraphs = new Map();
  for (const file of files) {
    const rel = path.relative(root,file).replaceAll('\\','/');
    const txt = fs.readFileSync(file,'utf8');
    for (const p of txt.split(/\n\s*\n/)) {
      const str = p.trim().replace(/\s+/g,' ');
      if (str.length < 100 || str.length > 2000) continue;
      const hash = createHash('sha256').update(str).digest('hex').slice(0,12);
      const entry = paragraphs.get(hash) ?? { hash, chars: str.length, files: [] };
      if (!entry.files.includes(rel)) entry.files.push(rel);
      paragraphs.set(hash, entry);
    }
  }
  const matches = [...paragraphs.values()].filter(x=>x.files.length>1);
  return { duplicateGroups: matches.length, repeatedChars: matches.reduce((n,x)=>n+(x.files.length-1)*x.chars,0),
    groups: matches.slice(0,12), note: 'Exact-paragraph heuristic only; do not remove mandatory safety/governance instructions based on this report.' };
}

export function cacheAudit(report) {
  if (report?.schemaVersion !== 2 || !report.totals) fail('USAGE_SCHEMA');
  const t = report.totals;
  if (!['freshInput','cacheRead','cacheWrite','output','calls','modelSwitches'].every(k=>nonneg(t[k]))) fail('USAGE_SCHEMA');
  const prompt = t.freshInput+t.cacheRead+t.cacheWrite;
  return { calls:t.calls, freshInput:t.freshInput, cacheRead:t.cacheRead, cacheWrite:t.cacheWrite, output:t.output,
    modelSwitches:t.modelSwitches, cacheReadShare:prompt?Number((t.cacheRead/prompt).toFixed(4)):null,
    note:'Local transcript counters, not subscription quota or bill. Cache share is descriptive, not predicted savings.' };
}

export function roiAudit(root, report, mapping, runner = spawnSync) {
  if (report?.schemaVersion !== 2 || !Array.isArray(report.sessions) || !Array.isArray(mapping?.assignments) || mapping.assignments.length > 50) fail('ROI_SCHEMA');
  const observed = new Set();
  const results = mapping.assignments.map(item => {
    if (!Number.isSafeInteger(item.pr) || item.pr < 1 || !/^[0-9a-f]{8}$/.test(item.session) || observed.has(item.session)) fail('ROI_MAPPING');
    observed.add(item.session);
    const session = report.sessions.find(s=>s.session===item.session);
    if (!session || !['input','output','calls'].every(k=>nonneg(session[k]))) fail('ROI_MAPPING');
    const res = runner('gh',['pr','view',String(item.pr),'--json','mergedAt,mergeCommit'],{cwd:root,encoding:'utf8',timeout:15000,maxBuffer:100000});
    let merged = false;
    if (!res.error && res.status === 0) {
      try {const obj=JSON.parse(res.stdout);merged=Boolean(obj.mergedAt && /^[0-9a-f]{40}$/i.test(obj.mergeCommit?.oid ?? ''));}catch{}
    }
    return { pr:item.pr, session:item.session, promptTokens:session.input, outputTokens:session.output,
      calls:session.calls, result:merged?'GITHUB_MERGED':'NOT_VERIFIED', attribution:'MANUAL_SESSION_MAPPING' };
  });
  return { results, note:'Manual session-to-PR mapping is not proof of causality; GitHub-merged status alone cannot attribute all effort. No pricing inference.' };
}

export function parseOptions(args) {
  const [mode,...rest]=args;
  if (!MODES.includes(mode) || rest.length%2) fail('USAGE');
  const opts={ mode };
  for(let i=0;i<rest.length;i+=2){if(!OPTIONS.has(rest[i]) || Object.hasOwn(opts,rest[i].slice(2)) || !rest[i+1]) fail('USAGE');opts[rest[i].slice(2)]=rest[i+1];}
  return opts;
}

function main(){
  try {
    const o=parseOptions(process.argv.slice(2));
    const root=execFileSync('git',['rev-parse','--show-toplevel'],{encoding:'utf8',timeout:10000}).trim();
    let result;
    if(o.mode==='models') result=dispatchAudit(root,o);
    else if(o.mode==='surface') result=surfaceAudit(root);
    else if(o.mode==='duplicates') result=duplicatesAudit(root);
    else if(o.mode==='cache' && o.usage) result=cacheAudit(readJsonBounded(path.resolve(o.usage)));
    else if(o.mode==='roi' && o.usage && o.mapping) result=roiAudit(root,readJsonBounded(path.resolve(o.usage)),readJsonBounded(path.resolve(o.mapping),256000));
    else fail('USAGE');
    console.log(JSON.stringify(result,null,2));
  } catch(e) {console.error(`CLAUDE_AUDIT ${String(e.message).replace(/[^A-Z_]/g,'').slice(0,40) || 'ERROR'}`);process.exitCode=2;}
}
if(process.argv[1] && fileURLToPath(import.meta.url)===path.resolve(process.argv[1])) main();
