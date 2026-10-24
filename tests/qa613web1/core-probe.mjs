// Additional direct probes after the subprocess EPERM. No process/network calls.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { jobMinutes, queueMinutes, runShape, summarizeRuns, parseTwinArgs, renderTwin, shardWhatIf } from '../../scripts/orchestrator/ci-twin-core.mjs';
import { ghList } from '../../scripts/orchestrator/gh.mjs';
const results=[];
const test=async(name,fn)=>{try{await fn();results.push({name,status:'PASS'});console.log('PASS',name);}catch(e){results.push({name,status:'FAIL',error:e.stack});console.log('FAIL',name,e.message);}};
const time=n=>new Date(Date.UTC(2026,9,23)+n*60000).toISOString();
const job=(name,n=7)=>({name,status:'completed',conclusion:'success',created_at:time(0),started_at:time(0),completed_at:time(n)});
const run={id:613,run_started_at:time(0),updated_at:time(9)};
const observations={};
await test('valid __proto__ job preserves the run and duration',()=>{
  const input=job('__proto__'); const shape=runShape(run,[input]);
  observations.protoOnly={input,shape,summary:summarizeRuns([shape].filter(Boolean))};
  console.log(JSON.stringify(observations.protoOnly));
  assert.notEqual(shape,null,'A valid successful 7-minute job must not discard the whole run');
  assert.equal(shape.jobs.__proto__,7);
});
await test('valid __proto__ slowest job is included with ordinary jobs',()=>{
  const shape=runShape(run,[job('unit',1),job('__proto__',7)]);
  observations.protoMixed={shape,summary:summarizeRuns([shape])}; console.log(JSON.stringify(observations.protoMixed));
  assert.equal(shape.critical,'__proto__'); assert.equal(Object.keys(shape.jobs).length,2);
});
for(const date of ['2026-02-29','2026-02-30','2026-04-31','2026-13-01','2026-00-01','2026-10-00']) await test(`invalid calendar date rejected: ${date}`,()=>{
  observations[date]=parseTwinArgs(['--since',date]);
  assert.throws(()=>parseTwinArgs(['--since',date]));
});
await test('empty and small-sample text/JSON representations',()=>{
  const empty=summarizeRuns([]); assert.deepEqual(empty,{runs:0,wall:{n:0,p50:null,p95:null},jobs:[]});
  assert.deepEqual(renderTwin(empty,'2026-10-23'),['CI od 2026-10-23: 0 uspjesnih prolaza (read-only, nije verdikt)','Zid: p50 - min, p95 - min (n=0)','','Job | n | p50 min | p95 min | najsporiji u']);
  const shapes=[1,2].map(n=>runShape({...run,id:n,updated_at:time(n)},[job('unit',n)]));
  const summary=summarizeRuns(shapes); assert.deepEqual(JSON.parse(JSON.stringify(summary)),summary);
  assert.deepEqual(summary.wall,{n:2,p50:1.5,p95:2});
  const text=renderTwin(summary,'2026-10-23').join('\n');assert.match(text,/unit \| 2 \| 1.5 \| 2.0 \| 2/);assert.doesNotMatch(text,/Model podjele|queue/);
});
await test('large sample (10000), precision and null wall denominator',()=>{
  const shapes=Array.from({length:10000},(_,i)=>({id:i,wall:i+1,critical:'unit',jobs:{unit:i+1}}));
  const s=summarizeRuns(shapes);assert.deepEqual(s.wall,{n:10000,p50:5000.5,p95:9500});
  assert.equal(s.jobs[0].p50,5000.5);assert.equal(s.jobs[0].p95,9500);
  const mixed=summarizeRuns([{id:1,wall:null,critical:'unit',jobs:{unit:1}},{id:2,wall:1.25,critical:'unit',jobs:{unit:1.25}}]);
  assert.equal(mixed.runs,2);assert.equal(mixed.wall.n,1);assert.equal(mixed.jobs[0].n,2);assert.match(renderTwin(mixed,'2026-10-23')[1],/p50 1.3 min/);
});
await test('invalid/missing limits and unknown arguments reject in pure parser',()=>{
  for(const limit of ['0','-1','201','1.5','NaN','Infinity','abc',''])assert.throws(()=>parseTwinArgs(['--since','2026-10-23','--limit',limit]));
  for(const a of [[],['--since'],['--since','2026-1-01'],['--since','2026-10-23','--limit'],['--since','2026-10-23','--bogus'],['--since','2026-10-23','--shards','2'],['--since','2026-10-23','--queue']])assert.throws(()=>parseTwinArgs(a));
});
await test('ghList actual helper reads 0/1/100/101/200 items, GET-shaped calls only',async()=>{
  for(const n of [0,1,100,101,200]){
    const rows=Array.from({length:n},(_,i)=>i),calls=[];
    const out=await ghList('repos/{owner}/{repo}/actions/runs/1/jobs?per_page=100&filter=latest',async(cmd,args)=>{
      calls.push([cmd,args]);assert.equal(cmd,'gh');assert.equal(args.length,2);assert.equal(args[0],'api');
      const p=Number(args[1].split('page=').at(-1));return JSON.stringify({jobs:rows.slice((p-1)*100,p*100)});
    },{key:'jobs'});
    assert.deepEqual(out,rows);assert.equal(calls.length,Math.floor(n/100)+1);
  }
});
await test('job conclusions, timestamp offsets and equal/reversed wall',()=>{
  const j=job('unit',1);assert.equal(jobMinutes({...j,started_at:'2026-10-23T02:00:00+02:00'}),1);
  for(const status of ['queued','in_progress','waiting'])assert.equal(jobMinutes({...j,status,conclusion:null,completed_at:null}),null);
  assert.equal(jobMinutes({...j,completed_at:time(-1)}),null);assert.equal(jobMinutes({...j,completed_at:time(0)}),0);
  assert.equal(runShape({...run,updated_at:time(-1)},[j]).wall,null);assert.equal(runShape({...run,updated_at:time(0)},[j]).wall,0);
});
await test('library-only boundaries remain explicitly observations, not CLI promises',()=>{
  assert.equal(queueMinutes({...job('unit'),created_at:time(-2)}),2);
  assert.equal(queueMinutes({...job('unit'),created_at:time(2)}),null);
  assert.equal(queueMinutes({...job('unit'),created_at:undefined}),null);
  assert.deepEqual(shardWhatIf({jobMinutes:0,setupMinutes:0,shards:1}),{shards:1,wall:0,runnerMinutes:0,savedWall:0,extraRunnerMinutes:0});
  observations.library={fractional:shardWhatIf({jobMinutes:10,setupMinutes:2,shards:1.5}),infinite:String(shardWhatIf({jobMinutes:10,setupMinutes:2,shards:Infinity}).runnerMinutes)};
});
const summary={pass:results.filter(r=>r.status==='PASS').length,fail:results.filter(r=>r.status==='FAIL').length};
writeFileSync(new URL('./core-results.json',import.meta.url),JSON.stringify({sourceHead:'98471f3ba5fafe112dab510edce5eef488944351',node:process.version,summary,results,observations},null,2)+'\n');
console.log(JSON.stringify(summary));process.exitCode=summary.fail?1:0;
