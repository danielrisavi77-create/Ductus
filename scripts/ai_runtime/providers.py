"""Read-only native CLI adapters; no API keys, shell strings, write modes or paid fallbacks."""
import hashlib
import os
import re
import shutil
from pathlib import Path
from .policy import Blocked, CHANNELS, validate_task

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
        if provider=='mistral': candidates=[Path.home()/'.local/bin/vibe.exe']
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
    if provider not in CHANNELS:raise Blocked('blocked_channel: native CLI not approved')
    directory={'codex':'.codex','grok':'.grok','mistral':'.vibe'}[provider]
    paths=[home/directory/'config.toml']
    for parent in [root,*root.parents]: paths.append(parent/directory/'config.toml')
    h=hashlib.sha256()
    for file in sorted(set(paths),key=str):
        if file.is_file():
            h.update(str(file).encode());h.update(file.read_bytes())
    return h.hexdigest()

def neutralize_verdicts(text):
    """Model output is advisory: no gate marker may start a line after a copy-paste.

    Position-independent on purpose, because adapters emit JSON with escaped newlines.
    """
    return re.sub(r'(?i)(Agent-Review|QA-Agent|Owner-Override)(\s*:)',
                  r'[advisory, not canonical] \1\2',text)

def build_command(task, executable, prompt):
    """Every adapter is read-only; there is no write mode to select."""
    provider=validate_task(task)['provider']
    if provider=='codex':
        return executable+['exec','--ephemeral','--json','--sandbox','read-only',
            '--disable','multi_agent','-c','forced_login_method="chatgpt"',
            '-c','model_provider="openai"','-c','approval_policy="never"',
            '-c','web_search="disabled"','-']
    if provider=='grok':
        return executable+['--no-subagents','--disable-web-search','--tools','Read,Grep,Glob',
            '--deny','Bash(*)','--deny','MCPTool(*)','--permission-mode','plan',
            '--max-turns','6','--output-format','json','--single',prompt]
    return executable+['--agent','plan','--disabled-tools','*','--max-turns','4',
                       '--max-tokens','16000','--output','json','--prompt',prompt]

def prompt_for(task):
    return ('ZADATAK '+task['id']+'\nAgent: '+task['owner']+'\nRole: '+task['role']+'\n'
            'Read AGENTS.md, CLAUDE.md and STATE.md. Follow the assigned role and canonical governance.\n'
            'This run is READ-ONLY: do not create, modify, delete, stage or commit any file.\n'
            'No subagents, no additional model calls, no credential/billing changes, no production resources.\n'
            'Never push, merge, comment on GitHub or write a review, QA or owner-override verdict block.\n'
            'Your answer is a local advisory report for a human; it is not a review or QA verdict.\n'
            'Goal: '+task['goal']+'\nAcceptance: '+task['acceptance']+'\n'
            'Stop if authentication, quota or permissions are unavailable.\n')
