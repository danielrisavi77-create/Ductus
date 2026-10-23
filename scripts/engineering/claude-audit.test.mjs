import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dispatchAudit, surfaceAudit, duplicatesAudit, cacheAudit, roiAudit, parseOptions, readJsonBounded } from './claude-audit.mjs';
function root(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ductus-token-audit-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  for(const x of ['docs','.claude','.claude/skills/alpha','.claude/agents/eng','.claude/rules'])fs.mkdirSync(path.join(dir,x),{recursive:true});
  fs.writeFileSync(path.join(dir,'docs/ORKESTRATOR.md'), '| Pisac | `low` i `standard` | Sonnet | po riziku |\n| Pisac | `critical` | Opus | po riziku |\n| Pretrage i metapodaci | sve razine | Haiku | po riziku |\n');
  fs.writeFileSync(path.join(dir,'.claude/settings.json'),JSON.stringify({enabledPlugins:{'context7@official':true,'dead@plugin':false}}));
  fs.writeFileSync(path.join(dir,'.claude/skills/alpha/SKILL.md'),'---\nname: alpha\ndescription: A small helper\n---\nSome private SECRET in body');
  fs.writeFileSync(path.join(dir,'.claude/agents/eng/agent.md'),'---\nname: worker\ndescription: Employee agent\n---\n');
  return dir;}

test('dispatch checks policy and preserves critical Opus requirements',t=>{
  const d=root(t);
  assert.equal(dispatchAudit(d,{role:'writer',risk:'standard',area:'ui',model:'opus'}).result,'REVIEW_MODEL_SELECTION');
  assert.equal(dispatchAudit(d,{role:'writer',risk:'critical',area:'ui',model:'opus'}).result,'MATCH');
  assert.equal(dispatchAudit(d,{role:'writer',risk:'standard',area:'auth',model:'sonnet'}).expected,'opus');
  assert.equal(dispatchAudit(d,{role:'scout',risk:'low',area:'other',model:'haiku'}).result,'MATCH');
  fs.writeFileSync(path.join(d,'docs/ORKESTRATOR.md'),'Owner policy changed');
  assert.equal(dispatchAudit(d,{role:'writer',risk:'standard',area:'ui',model:'sonnet'}).result,'POLICY_UNKNOWN');
  assert.throws(()=>dispatchAudit(d,{role:'writer',risk:'wrong',area:'ui',model:'opus'}),/MODEL_ARGS/);
});

test('surface audit reads only descriptions and enabled plugin names',t=>{
  const d=root(t),a=surfaceAudit(d);
  assert.equal(a.skills,1);assert.equal(a.agents,1);
  assert.deepEqual(a.enabledPluginNames,['context7@official']);
  assert.ok(!JSON.stringify(a).includes('SECRET'));
});

test('duplicate paragraphs produce hashes not source contents',t=>{
  const d=root(t),p='Duplicated but confidential repeated paragraph '+('SECRET '.repeat(18));
  fs.writeFileSync(path.join(d,'AGENTS.md'),p+'\n\nOther');
  fs.writeFileSync(path.join(d,'CLAUDE.md'),p+'\n\nOther');
  const a=duplicatesAudit(d);assert.equal(a.duplicateGroups,1);
  assert.ok(!JSON.stringify(a).includes('SECRET'));
});

test('cache report validates counters and never reports unearned saving',()=>{
  const a=cacheAudit({schemaVersion:2,totals:{freshInput:100,cacheRead:300,cacheWrite:100,output:7,calls:3,modelSwitches:1}});
  assert.equal(a.cacheReadShare,0.6);assert.equal(a.calls,3);
  assert.throws(()=>cacheAudit({schemaVersion:2,totals:{freshInput:-1}}),/USAGE_SCHEMA/);
});

test('ROI requires a real GH merge plus explicit manual session mapping',t=>{
  const d=root(t),report={schemaVersion:2,sessions:[{session:'abcdef01',input:400,output:15,calls:3}]};
  const mapping={assignments:[{pr:42,session:'abcdef01'}]};
  assert.equal(roiAudit(d,report,mapping,()=>({status:2,stdout:'Forbidden'})).results[0].result,'NOT_VERIFIED');
  const r=roiAudit(d,report,mapping,()=>({status:0,stdout:JSON.stringify({mergedAt:'2026-10-23T12:00:00Z',mergeCommit:{oid:'a'.repeat(40)}})}));
  assert.equal(r.results[0].result,'GITHUB_MERGED');
  assert.equal(r.results[0].attribution,'MANUAL_SESSION_MAPPING');
  assert.throws(()=>roiAudit(d,report,{assignments:[{pr:42,session:'abcdef01'},{pr:43,session:'abcdef01'}]},()=>({status:0})),/ROI_MAPPING/);
});

test('bounded JSON parser refuses huge and symlinked files',t=>{
  const d=root(t),p=path.join(d,'report.json');fs.writeFileSync(p,'{"a":3}');
  assert.equal(readJsonBounded(p).a,3);
  assert.throws(()=>readJsonBounded(p,3),/JSON_FILE/);
  fs.symlinkSync(p,path.join(d,'link.json'));
  assert.throws(()=>readJsonBounded(path.join(d,'link.json')));
});

test('argument parser rejects unknown and repeated modes',()=>{
  assert.deepEqual(parseOptions(['cache','--usage','usage.json']),{mode:'cache',usage:'usage.json'});
  for(const a of [['bad'],['models','--role'],['cache','--usage','a','--usage','b']])assert.throws(()=>parseOptions(a),/USAGE/);
});
