"""Native CLI adapters; no API keys, arbitrary shell strings, or paid fallbacks."""
import hashlib
import json
import os
import re
import shutil
from pathlib import Path
from .policy import Blocked, CHANNELS, ROLES, validate_task

ENV_NAMES={'PATH','HOME','USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP','TMPDIR',
           'SYSTEMROOT','WINDIR','COMSPEC','PATHEXT','HOMEDRIVE','HOMEPATH','LANG','LC_ALL',
           'TERM','PROGRAMFILES','PROGRAMFILES(X86)','SYSTEMDRIVE'}

def clean_environment(source=None):
    source=os.environ if source is None else source
    result={k:v for k,v in source.items() if k.upper() in ENV_NAMES}
    result.update(CI='true',NO_COLOR='1',PYTHONUTF8='1',PYTHONDONTWRITEBYTECODE='1',
                  GIT_TERMINAL_PROMPT='0')
    return result

def redact(text):
    text=re.sub(r'(?i)(bearer\s+)[A-Za-z0-9._~+/=-]+',r'\1[REDACTED]',text)
    text=re.sub(r'(?i)((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password)["\s]*[:=]["\s]*)[^\s,"\}]+',r'\1[REDACTED]',text)
    return re.sub(r'\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{16,})\b','[REDACTED]',text)

def resolve_command(provider):
    if provider not in CHANNELS: raise Blocked('blocked_channel: native CLI not approved')
    if os.name=='nt':
        app=Path(os.environ.get('APPDATA',''))
        if provider=='claude': candidates=[app/'npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe']
        elif provider=='mistral': candidates=[Path.home()/'.local/bin/vibe.exe']
        elif provider=='grok':
            script=app/'npm/node_modules/@xai-official/grok/bin/grok';node=shutil.which('node.exe')
            if script.is_file() and node:return [node,str(script)]
            raise Blocked('blocked_install: official Grok wrapper missing')
        else:candidates=[Path(shutil.which('codex.exe') or '')]
        for file in candidates:
            if file.is_file():return [str(file.resolve())]
        raise Blocked('blocked_install: native executable missing')
    executable=shutil.which({'mistral':'vibe'}.get(provider,provider))
    if not executable:raise Blocked('blocked_install: native executable missing')
    return [executable]

def fingerprint(command):
    digest=hashlib.sha256()
    for arg in command:
        file=Path(arg)
        if not file.is_file():raise Blocked('blocked_install: executable path missing')
        digest.update(str(file.resolve()).encode())
        with file.open('rb') as stream:
            for chunk in iter(lambda:stream.read(1024*1024),b''):digest.update(chunk)
    return digest.hexdigest()

def config_fingerprint(provider, worktree):
    """Hash configuration, never read or publish credential contents."""
    home=Path.home();root=Path(worktree).resolve()
    directory={'codex':'.codex','claude':'.claude','grok':'.grok','mistral':'.vibe'}[provider]
    names={'codex':['config.toml'],'claude':['settings.json','settings.local.json'],
           'grok':['config.toml'],'mistral':['config.toml']}[provider]
    paths=[home/directory/n for n in names]
    for parent in [root,*root.parents]: paths += [parent/directory/n for n in names]
    h=hashlib.sha256()
    for file in sorted(set(paths),key=str):
        if file.is_file():
            h.update(str(file).encode());h.update(file.read_bytes())
    return h.hexdigest()

def build_command(task, executable, prompt):
    t=validate_task(task);provider=t['provider'];writer=ROLES[t['role']][1]
    if provider not in CHANNELS:raise Blocked('blocked_channel')
    if provider=='codex':
        return executable+['exec','--ephemeral','--json','--sandbox',
            'workspace-write' if writer else 'read-only','--disable','multi_agent',
            '-c','forced_login_method="chatgpt"','-c','model_provider="openai"',
            '-c','approval_policy="never"','-c','web_search="disabled"',
            '-c','sandbox_workspace_write.network_access=false','-']
    if provider=='claude':
        return executable+['--restricted','--strict-mcp-config','--mcp-config','{"mcpServers":{}}',
            '--setting-sources','', '--tools','Read,Glob,Grep,Edit,Write' if writer else 'Read,Glob,Grep',
            '--disallowedTools','Agent,Task,Bash','--permission-mode','acceptEdits' if writer else 'plan',
            '--print','--output-format','json',prompt]
    if provider=='grok':
        if writer:raise Blocked('blocked_provider_role: Grok starts in advisory mode')
        return executable+['--no-subagents','--disable-web-search','--tools','Read,Grep,Glob',
            '--deny','Bash(*)','--deny','MCPTool(*)','--permission-mode','plan',
            '--max-turns','6','--output-format','json','--single',prompt]
    return executable+['--agent','plan','--disabled-tools','*','--max-turns','4',
                       '--max-tokens','16000','--output','json','--prompt',prompt]

def prompt_for(task):
    return ('ZADATAK '+task['id']+'\nAgent: '+task['owner']+'\n'
            'Read AGENTS.md, CLAUDE.md and STATE.md. Follow the assigned role and canonical governance.\n'
            'No subagents, no additional model calls, no credential/billing changes, no production resources.\n'
            'Never commit, push, merge or publish a review/QA verdict. Return an advisory handoff.\n'
            'Goal: '+task['goal']+'\nAcceptance: '+task['acceptance']+'\n'
            'Allowed write paths: '+json.dumps(task['scopes'])+'\n'
            'No write scopes means read-only. Stop if authentication, quota or permissions are unavailable.\n')
