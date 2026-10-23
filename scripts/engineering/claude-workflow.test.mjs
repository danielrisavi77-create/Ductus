import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { contextPack, locate, digestLog, compactHandoff, checkedPreflight, parseOptions } from './claude-workflow.mjs';

const sha = 'a'.repeat(40);
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ductus-workflow-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir,'docs')); fs.mkdirSync(path.join(dir,'src'));
  fs.writeFileSync(path.join(dir,'docs','notes.md'),'# heading with PRIVATE_TOKEN\nmore text\n## next heading\n');
  fs.writeFileSync(path.join(dir,'src','sample.ts'),'export function exampleSymbol() { return true; }\n');
  fs.writeFileSync(path.join(dir,'src','test.log'),'normal\nTypeError: private TOKEN\nFAIL secret=abc123\n');
  execFileSync('git',['init','-q'],{cwd:dir});
  execFileSync('git',['add','docs','src'],{cwd:dir});
  execFileSync('git',['-c','user.email=test@example.invalid','-c','user.name=test','commit','-qm','test'],{cwd:dir});
  return dir;
}

test('context manifest has locations/hashes, no confidential headings',t=>{
  const root=fixture(t),x=contextPack(root,'DAN-276',sha,['docs/notes.md','src/sample.ts'],sha);
  assert.equal(x.files.length,2);
  assert.equal(x.files[0].headings[0].line,1);
  assert.ok(!JSON.stringify(x).includes('PRIVATE_TOKEN'));
  assert.throws(()=>contextPack(root,'DAN-276',sha,[],sha),/FILES/);
  assert.throws(()=>contextPack(root,'DAN-276',sha,['docs/notes.md'],'b'.repeat(40)),/STALE_SHA/);
  for(const p of ['../outside','src/../docs/notes.md','docs/.env.local','docs/secrets/a','/tmp/private'])
    assert.throws(()=>contextPack(root,'DAN-276',sha,[p],sha));
  fs.symlinkSync(path.join(root,'docs','notes.md'),path.join(root,'docs','link.md'));
  assert.throws(()=>contextPack(root,'DAN-276',sha,['docs/link.md'],sha),/PATH/);
});

test('symbol lookup only returns tracked paths and line numbers', t=>{
  const root=fixture(t),x=locate(root,'exampleSymbol');
  assert.ok(x.locations.some(z=>z==='src/sample.ts:1'));
  assert.ok(!JSON.stringify(x).includes('return true'));
  assert.throws(()=>locate(root,'--help'),/SYMBOL/);
  assert.throws(()=>locate(root,'$(cat .env)'),/SYMBOL/);
});

test('log digest does not reveal messages or private values',t=>{
  const root=fixture(t),x=digestLog(root,'src/test.log');
  assert.deepEqual(x.findings.map(f=>f.kind),['EXCEPTION','FAILED']);
  assert.ok(!JSON.stringify(x).includes('TOKEN'));
  assert.ok(!JSON.stringify(x).includes('secret=abc123'));
});

test('handoff shows presence only and treats missing proof as incomplete',t=>{
  const root=fixture(t);
  fs.writeFileSync(path.join(root,'docs','report.md'),`PR: #1\nAgent: slot\nTestovi: secret KEY\nReview: PASS\nQA: PASS\n${sha}\n`);
  const x=compactHandoff(root,'docs/report.md');
  assert.equal(x.complete,true);
  assert.ok(!JSON.stringify(x).includes('KEY'));
  fs.writeFileSync(path.join(root,'docs','report.md'),'PR: #1\nReview: PASS\n');
  assert.equal(compactHandoff(root,'docs/report.md').complete,false);
});

test('preflight strictly preserves existing exit code including tool errors',t=>{
  const root=fixture(t),run=(cmd,args)=>({status:2,stdout:'PREFLIGHT FAIL: inaccessible',stderr:''});
  assert.equal(checkedPreflight(root,75,sha,run).exitCode,2);
  assert.equal(checkedPreflight(root,75,sha,()=>({status:1,stdout:'PREFLIGHT FAIL'})).exitCode,1);
  assert.equal(checkedPreflight(root,75,sha,()=>({status:0,stdout:'PREFLIGHT PASS'})).exitCode,0);
  assert.equal(checkedPreflight(root,75,sha,()=>({status:null,error:new Error('x')})).exitCode,2);
  assert.throws(()=>checkedPreflight(root,-1,sha,run),/PR_SHA/);
});

test('parse mode and option contract',()=>{
  assert.deepEqual(parseOptions(['context','--task','DAN-276','--sha',sha,'--file','docs/notes.md']).files,['docs/notes.md']);
  for(const x of [['context','--sha'],['foo'],['locate','--symbol','A','--symbol','B']])
    assert.throws(()=>parseOptions(x),/USAGE/);
});
