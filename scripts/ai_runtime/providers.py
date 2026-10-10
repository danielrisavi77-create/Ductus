"""Read-only native CLI adapters; no API keys, shell strings, write modes or paid fallbacks."""
import hashlib
import os
import re
import shutil
import tempfile
import time
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

SECRET_KEY=r'(?:api[_-]?key|token(?!s)|secret|passw(?:or)?d|credentials?|private[_-]?key)'
REDACTIONS=(
    # Whole PEM private key blocks.
    (r'-----BEGIN [A-Z ]*PRIVATE KEY-----.*?(?:-----END [A-Z ]*PRIVATE KEY-----|\Z)','[REDACTED]',re.S),
    # Authorization headers of any scheme, and bare Bearer tokens.
    (r'''(?i)(authorization["'\s]*[:=]["'\s]*(?:bearer|token|basic)\s+)[^\s"',}]+''',r'\1[REDACTED]',0),
    (r'(?i)(bearer\s+)[A-Za-z0-9._~+/=-]+',r'\1[REDACTED]',0),
    # key: value and KEY=value where the key name ends in a secret word
    # (oauth_token, refresh_token, MISTRAL_API_KEY, client_secret, password ...).
    (r'''(?i)('''+SECRET_KEY+r'''["'\s]*[:=]["'\s]*)[^\s,"'}]+''',r'\1[REDACTED]',0),
    # user:password@ inside URLs.
    (r'(?i)(://[^\s/:@]{1,256}:)[^\s/@]{1,1024}@',r'\1[REDACTED]@',0),
    # Provider token shapes that are recognisable without a key name.
    (r'\bgithub_pat_[A-Za-z0-9_]{20,}','[REDACTED]',0),
    (r'\bgh[pousr]_[A-Za-z0-9]{16,}','[REDACTED]',0),
    (r'\b(?:sk|xai|glpat|rk)-[A-Za-z0-9_-]{12,}','[REDACTED]',0),
    (r'\b(?:npm|lin_api|sbp|sb_secret)_[A-Za-z0-9_]{16,}','[REDACTED]',0),
    (r'\bxox[abeprs]-[A-Za-z0-9-]{10,}','[REDACTED]',0),
    (r'\b(?:AKIA|ASIA)[0-9A-Z]{16}\b','[REDACTED]',0),
    (r'\bAIza[0-9A-Za-z_-]{30,}','[REDACTED]',0),
    (r'(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}','[REDACTED]',0),
)
# Every pattern above must stay linear on hostile output: a rule either starts
# at a fixed literal or consumes its whole run, so a 1 MiB reply cannot stall the run.

def redact(text):
    """Best-effort masking of common token shapes; not a guarantee against leaks."""
    for pattern,replacement,flags in REDACTIONS:text=re.sub(pattern,replacement,text,flags=flags)
    return text

def redact_tree(value):
    """Redact every string inside a JSON-like value before it is written to runs/."""
    if isinstance(value,str):return redact(value)
    if isinstance(value,dict):return {key:redact_tree(item) for key,item in value.items()}
    if isinstance(value,(list,tuple)):return [redact_tree(item) for item in value]
    return value

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

PROMPT_FILE='{prompt_file}'

def build_command(task, executable, prompt_file=PROMPT_FILE):
    """Every adapter is read-only; there is no write mode to select.

    The prompt never travels on the command line: Codex and Mistral read it from
    stdin, Grok from a file inside the temporary profile.
    """
    provider=validate_task(task)['provider']
    if provider=='codex':
        return executable+['exec','--ephemeral','--json','--sandbox','read-only',
            '--disable','multi_agent','-c','forced_login_method="chatgpt"',
            '-c','model_provider="openai"','-c','approval_policy="never"',
            '-c','web_search="disabled"','-']
    if provider=='grok':
        return executable+['--no-subagents','--disable-web-search','--tools','Read,Grep,Glob',
            '--deny','Bash(*)','--deny','MCPTool(*)','--permission-mode','plan',
            '--max-turns','6','--output-format','json','--prompt-file',prompt_file]
    return executable+['--agent','plan','--disabled-tools','*','--max-turns','4',
                       '--max-tokens','16000','--output','json','--prompt']

# What each CLI needs from the real user directory to stay logged in, and the
# variable that relocates its state. Nothing else is copied into the temporary
# profile. An adapter is enabled only when an instruction planted in the reviewed
# content cannot make the tool read the real user's files; see docs/AI_RUNTIME.md.
ISOLATION={
    'codex':{'enabled':False,'home_env':'CODEX_HOME','directory':'.codex',
             'login':('auth.json',),'config':('config.toml',),
             'reason':'its read-only sandbox reads the whole disk by absolute path, so the real '
                      'user directory stays reachable, and a refreshed login would be lost'},
    'grok':{'enabled':False,'home_env':'GROK_HOME','directory':'.grok',
            'login':('auth.json',),'config':('config.toml',),
            'reason':'Read, Grep and Glob are not confined to the worktree (no OS sandbox on '
                     'Windows, unenforced fallback elsewhere), and a refreshed login would be lost'},
    'mistral':{'enabled':True,'home_env':'VIBE_HOME','directory':'.vibe',
               'login':('.env',),'config':('config.toml',),'reason':''},
}

def user_home():
    return Path.home()

def require_isolation(provider):
    spec=ISOLATION.get(provider)
    if spec is None:raise Blocked('blocked_channel: native CLI not approved')
    if not spec['enabled']:
        raise Blocked('blocked_isolation: '+provider+' adapter is disabled: '+spec['reason'])
    return spec

class IsolatedProfile:
    """Throwaway user directories that hold only the provider login for one run."""
    def __init__(self,provider):
        spec=require_isolation(provider);source=user_home()/spec['directory']
        missing=[name for name in spec['login'] if not (source/name).is_file()]
        if missing:
            raise Blocked('blocked_isolation: login file not found in '+spec['directory']+
                          ' ('+', '.join(missing)+'); log in with the provider CLI first')
        self.root=Path(tempfile.mkdtemp(prefix='ductus-run-')).resolve()
        try:
            home=self.root/'home';state=home/spec['directory'];temp=self.root/'tmp'
            roaming=home/'AppData'/'Roaming';local=home/'AppData'/'Local'
            for folder in (state,temp,roaming,local,home/'.config',home/'.cache',
                           home/'.local'/'share',home/'.local'/'state'):folder.mkdir(parents=True)
            for name in spec['login']+spec['config']:
                if (source/name).is_file():shutil.copyfile(source/name,state/name)
            drive,tail=os.path.splitdrive(str(home))
            self.env={'HOME':str(home),'USERPROFILE':str(home),'HOMEDRIVE':drive,'HOMEPATH':tail,
                      'APPDATA':str(roaming),'LOCALAPPDATA':str(local),
                      'XDG_CONFIG_HOME':str(home/'.config'),'XDG_CACHE_HOME':str(home/'.cache'),
                      'XDG_DATA_HOME':str(home/'.local'/'share'),'XDG_STATE_HOME':str(home/'.local'/'state'),
                      'TEMP':str(temp),'TMP':str(temp),'TMPDIR':str(temp),spec['home_env']:str(state)}
            self.prompt_file=self.root/'prompt.txt'
        except BaseException:
            self.remove();raise
    def command(self,command,prompt):
        """Store the prompt beside the profile and point a file-reading adapter at it."""
        self.prompt_file.write_text(prompt,encoding='utf-8')
        return [str(self.prompt_file) if arg==PROMPT_FILE else arg for arg in command]
    def remove(self):
        for _ in range(20):
            shutil.rmtree(self.root,ignore_errors=True)
            if not self.root.exists():return True
            time.sleep(.1)
        return False

def prompt_for(task):
    return ('ZADATAK '+task['id']+'\nAgent: '+task['owner']+'\nRole: '+task['role']+'\n'
            'Read AGENTS.md, CLAUDE.md and STATE.md. Follow the assigned role and canonical governance.\n'
            'This run is READ-ONLY: do not create, modify, delete, stage or commit any file.\n'
            'No subagents, no additional model calls, no credential/billing changes, no production resources.\n'
            'Never push, merge, comment on GitHub or write a review, QA or owner-override verdict block.\n'
            'Your answer is a local advisory report for a human; it is not a review or QA verdict.\n'
            'Goal: '+task['goal']+'\nAcceptance: '+task['acceptance']+'\n'
            'Stop if authentication, quota or permissions are unavailable.\n')
