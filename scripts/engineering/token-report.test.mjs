import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeTranscript, parseArgs, collect } from './token-report.mjs';
import { formatStatus } from './claude-statusline.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const record = (type, message) => JSON.stringify({ type, message });
const usage = (fresh, read, write, out) => ({ input_tokens:fresh, cache_read_input_tokens:read,
  cache_creation_input_tokens:write, output_tokens:out });
const assistant = (id, model, u, content=[]) => record('assistant', { id, model, usage:u, content });

test('stream repeats count once; counts split by model and cache class', () => {
  const x = [
    assistant('m1','claude-sonnet-5-5',usage(100,200,10,20),[{type:'tool_use',id:'t1',name:'Read'}]),
    assistant('m1','claude-sonnet-5-5',usage(100,200,10,20),[]),
    record('user',{content:[{type:'tool_result',tool_use_id:'t1',content:[{type:'text',text:'private document SECRET'}]}]}),
    record('user',{content:[{type:'tool_result',tool_use_id:'t1',content:'duplicate'}]}),
    assistant('m2','claude-opus-5-5',usage(50,70,0,10)),
  ];
  const s = summarizeTranscript(x, 100);
  assert.equal(s.calls,2);
  assert.equal(s.input,430);
  assert.equal(s.freshInput,150);
  assert.equal(s.cacheRead,270);
  assert.equal(s.cacheWrite,10);
  assert.equal(s.output,30);
  assert.equal(s.modelSwitches,1);
  assert.equal(s.tools.Read.calls,1);
  assert.equal(s.models['claude-opus-5-5'].output,10);
  assert.equal(s.baseline,620);
  assert.equal(s.overBudget,230);
  assert.ok(!JSON.stringify(s).includes('SECRET'));
});

test('handles malformed usage and names without leaking text', () => {
  const s = summarizeTranscript([ 'not-json', assistant('x', 'token\nSECRET', usage(-5, '99', NaN, 7)),
    assistant('y', 'claude-sonnet-5-5', usage(0,0,0,0)),
  ]);
  assert.equal(s.freshInput,0);
  assert.equal(s.cacheRead,0);
  assert.equal(s.output,7);
  assert.ok(Object.hasOwn(s.models,'unknown'));
  assert.ok(!JSON.stringify(s).includes('SECRET'));
  assert.equal(s.cacheReadShare,null);
});

test('argument parser validates ranges and existing flags', () => {
  assert.deepEqual(parseArgs(['--days','7','--budget','100000','--json']), {days:7,budget:100000,json:true});
  for (const input of [['--days','-2'],['--budget','12'],['--wrong'],['--days'],['--days','NaN']])
    assert.throws(() => parseArgs(input),/USAGE/);
});

test('collect finds Ductus JSONL only and reports aggregate counters', (t) => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ductus-token-test-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  for (const dir of ['ductus-project','other-project']) fs.mkdirSync(path.join(root,dir));
  const lines=[assistant('m1','claude-sonnet-5-5',usage(10,10,10,2)),
    assistant('m2','claude-sonnet-5-5',usage(20,20,20,3)), assistant('m3','claude-opus-5-5',usage(30,30,30,4))];
  fs.writeFileSync(path.join(root,'ductus-project','abc12345678.jsonl'),lines.join('\n'));
  fs.writeFileSync(path.join(root,'other-project','other.jsonl'),lines.join('\n'));
  const result=collect(root,Date.now(),10,150000);
  assert.equal(result.totals.sessions,1);
  assert.equal(result.totals.freshInput,60);
  assert.equal(result.totals.output,9);
  assert.equal(result.sessions[0].session,'abc12345');
  assert.equal(result.models['claude-opus-5-5'].calls,1);
});

test('statusline shows optional fields and does not evaluate text', () => {
  const line=formatStatus({model:{display_name:'Opus 5.5'},context_window:{used_percentage:42.7},
    rate_limits:{five_hour:{used_percentage:33},seven_day:{used_percentage:71}},
    prompt_cache:{hit_ratio:0.91}});
  assert.equal(line,'Opus 5.5 | CTX 43% | 5h 33% | 7d 71% | Cache 91%');
  assert.equal(formatStatus({model:{display_name:'SECRET\nnew-line'},rate_limits:{five_hour:{used_percentage:200}}}),
    'Claude | CTX n/a | 5h n/a | 7d n/a | Cache n/a');
});

test('CLI statusline suppresses private parser exceptions', () => {
  const script=path.resolve('scripts/engineering/claude-statusline.mjs');
  const stdout=execFileSync(process.execPath,[script],{input:'{broken data',cwd:path.resolve('..','..'),encoding:'utf8'});
  assert.equal(stdout.trim(),'Claude | CTX n/a | 5h n/a | 7d n/a | Cache n/a');
});

test('metadata named like object prototypes cannot corrupt counters', () => {
  const s=summarizeTranscript([assistant('a','__proto__',usage(1,2,3,4),[{type:'tool_use',id:'t',name:'constructor'}]),
    record('user',{content:[{type:'tool_result',tool_use_id:'t',content:'x'}]})]);
  assert.equal(s.models.__proto__.calls,1);
  assert.equal(s.tools.constructor.calls,1);
});
