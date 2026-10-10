"""Ductus read-only second-provider runner. Funding must be observed, never inferred.

The controller starts one bounded, read-only CLI run of a non-Claude provider and
stores a local advisory report. It never writes to the repository or to GitHub.
"""
import argparse
import json
import os
import re
import shutil
import sqlite3
import subprocess
import time
from pathlib import Path
from .policy import Blocked, CHANNELS, ROLES, validate_task, validate_funding
from .registry import MAX_RUNS, Registry
from .workspace import canonical_repo, inspect_workspace, audit_unchanged, snapshot
from .providers import (build_command, clean_environment, config_fingerprint, fingerprint,
                        neutralize_verdicts, prompt_for, redact, resolve_command)
from .process import bounded_process

REGISTRY='review-registry.sqlite3'
NOT_CANONICAL=('This is a local advisory record of a read-only run. It is not an '
               'App-authenticated review or QA verdict and satisfies no gate.')

def runtime_home():
    base=Path(os.environ.get('LOCALAPPDATA') or (Path.home()/'.local/share'))
    return base/'DucturaRuntime'

def read_json(path):
    def pairs(items):
        result={}
        for key,value in items:
            if key in result:raise Blocked('blocked_json: duplicate key')
            result[key]=value
        return result
    def invalid(_):raise Blocked('blocked_json: non-finite number')
    try:
        file=Path(path)
        if file.stat().st_size>128*1024:raise Blocked('blocked_json: oversized input')
        return json.loads(file.read_text(encoding='utf-8-sig'),object_pairs_hook=pairs,parse_constant=invalid)
    except (OSError,UnicodeError,json.JSONDecodeError) as exc:
        raise Blocked('blocked_json: missing or invalid file') from exc

def write_json(path,data):
    file=Path(path);file.parent.mkdir(parents=True,exist_ok=True)
    temporary=file.with_name(file.name+'.tmp')
    with temporary.open('w',encoding='utf-8') as stream:
        json.dump(data,stream,ensure_ascii=False,indent=2);stream.write('\n')
    temporary.replace(file)

def check_ready(task, repo, state):
    t=validate_task(task);provider=t['provider']
    evidence_file=state/'evidence'/f'{provider}.json'
    if not evidence_file.exists():raise Blocked('blocked_funding: no verified account evidence')
    evidence=read_json(evidence_file);executable=resolve_command(provider)
    validate_funding(provider,evidence,time.time(),fingerprint(executable))
    root=inspect_workspace(t,canonical_repo(repo))
    if evidence.get('configuration_reviewed') is not True or evidence.get('config_sha256')!=config_fingerprint(provider,root):
        raise Blocked('blocked_configuration: current native configuration not reviewed')
    if evidence.get('native_controls_verified') is not True:
        raise Blocked('blocked_runtime: version-specific native controls not verified')
    if shutil.disk_usage(root).free<15*1024**3:raise Blocked('blocked_disk: less than 15 GiB available')
    command=build_command(t,executable,prompt_for(t))
    return root,command,evidence

def doctor(state, worktree=None):
    result={}
    for provider in CHANNELS:
        entry={'model_calls':0,'dispatch_ready':False}
        try:
            command=resolve_command(provider)
            entry.update(installed=True,command=command,executable_sha256=fingerprint(command))
            if worktree is not None:entry['config_sha256']=config_fingerprint(provider,worktree)
            if provider=='codex':
                p=subprocess.run(command+['login','status'],capture_output=True,encoding='utf-8',
                                 errors='replace',timeout=20,env=clean_environment())
                entry['native_subscription_login_verified']=p.returncode==0 and 'Logged in using ChatGPT' in (p.stdout+p.stderr)
            else:entry['native_subscription_login_verified']=None
            file=state/'evidence'/f'{provider}.json'
            entry['evidence_file_exists']=file.exists()
            entry['note']='Installed does not prove funding, quota, permissions or model execution.'
        except (Blocked,OSError,subprocess.TimeoutExpired) as exc:
            entry['status']=str(exc) if isinstance(exc,Blocked) else 'blocked_probe'
        result[provider]=entry
    return {'providers':result,'state_directory':str(state),'model_calls':0,
            'boundary':'No account setting changed. No authentication tokens read or exported.'}

def execute(task, repo, state):
    t=validate_task(task);root,command,_=check_ready(t,repo,state)
    registry=Registry(state/REGISTRY)
    run,token=registry.acquire(t)
    folder=state/'runs'/run;folder.mkdir(parents=True)
    write_json(folder/'task.json',t)
    result={'run':run,'task':t['id'],'status':'blocked_runtime','canonical_review':False}
    started=False
    try:
        # Re-check immediately after the atomic reservation, before starting inference.
        root,command,_=check_ready(t,repo,state)
        prompt=prompt_for(t);before=snapshot(root)
        started=True
        child=bounded_process(command,str(root),os.environ,timeout=t.get('timeout',600),
                              stdin_text=prompt if t['provider']=='codex' else None,
                              heartbeat=lambda pid:registry.heartbeat(run,token,pid))
        output=neutralize_verdicts(child.pop('output'))
        (folder/'output.txt').write_text(output,encoding='utf-8')
        changed=audit_unchanged(t,before)
        status='blocked_write' if changed else ('completed' if child['exit_code']==0 and not child['stop_reason'] and child['exited'] else 'failed')
        result.update(child,status=status,changed_paths=changed)
        if child['exited']:registry.finish(run,token,status)
        else:result['status']='orphaned'
    except Exception as exc:
        result['reason']=redact(str(exc))[:1000]
        if not started:registry.finish(run,token,'blocked_runtime')
        else:
            result['status']='orphaned'
            result['note']='Capacity retained until process-tree exit is independently established.'
    write_json(folder/'result.json',result)
    (folder/'HANDOFF.md').write_text(
        '# Lokalni izvještaj '+t['id']+'\n\nRun-Owner: '+t['owner']+'\nRole: '+t['role']+
        '\nProvider: '+t['provider']+'\nReviewed-SHA: '+t['base_sha']+'\nStatus: '+result['status']+
        '\nCanonical-Review: false\n\n'+NOT_CANONICAL+'\n',encoding='utf-8')
    result['artifacts']=str(folder)
    return result

def main(argv=None):
    parser=argparse.ArgumentParser(description='Ductus read-only second-provider runner (no paid fallback, no writes)')
    parser.add_argument('--repo',default=os.getcwd())
    sub=parser.add_subparsers(dest='action',required=True)
    for name in ('roster','status','doctor'):sub.add_parser(name)
    for name in ('check','run'):
        p=sub.add_parser(name);p.add_argument('task_file')
    p=sub.add_parser('handoff');p.add_argument('run_id')
    args=parser.parse_args(argv);state=runtime_home()
    try:
        if args.action=='roster':
            data={'roles':[{'role':r,'id':v,'writer':False} for r,v in ROLES.items()],
                  'providers':sorted(CHANNELS),'read_only_runs_max':MAX_RUNS,'auto_start':False,
                  'canonical_review':False}
        elif args.action=='status':
            registry=Registry(state/REGISTRY)
            registry.orphans();data=registry.status()
        elif args.action=='doctor':data=doctor(state,args.repo)
        elif args.action=='handoff':
            if not re.fullmatch('[a-f0-9]{24}',args.run_id):raise Blocked('blocked_run_id')
            data=read_json(state/'runs'/args.run_id/'result.json')
        else:
            task=validate_task(read_json(args.task_file))
            if args.action=='check':
                root,command,_=check_ready(task,args.repo,state)
                data={'status':'ready_for_read_only_run','worktree':str(root),'provider':task['provider'],
                      'model_calls':0,'billing_boundary':'account observation, not a provider-side spend cap'}
            else:data=execute(task,args.repo,state)
        print(json.dumps(data,ensure_ascii=False,indent=2))
        return 0 if data.get('status') not in ('failed','orphaned','blocked_write','blocked_runtime') else 2
    except (Blocked,OSError,sqlite3.Error) as exc:
        print(json.dumps({'status':'blocked','reason':redact(str(exc))[:1000]},ensure_ascii=False))
        return 2
