"""Pure task, funding and scope validation. No provider calls."""
import math
import re
from pathlib import PurePosixPath

ROLES = {
    'orchestrator': ('O1', False), 'backend': ('B1', True),
    'frontend': ('F1', True), 'platforma': ('P1', True),
    'reviewer': ('R1', False), 'qa': ('Q1', False),
    'bug-hunter': ('H1', False), 'product-ux': ('U1', False),
    'security': ('S1', False), 'accessibility': ('A1', False),
    'privacy-pilot': ('L1', False), 'architecture': ('X1', False),
}
CHANNELS = {'codex': 'chatgpt_subscription', 'claude': 'claude_subscription',
            'grok': 'supergrok_subscription', 'mistral': 'mistral_free'}
PROVIDERS = set(CHANNELS) | {'meta', 'deepseek'}
ACTIVE = ('reserved', 'running', 'orphaned')

class Blocked(ValueError):
    """A named policy refusal, not a successful execution."""

def scope_path(path: str) -> str:
    if not isinstance(path,str) or not path or '\\' in path or ':' in path:
        raise Blocked('blocked_scope: invalid relative path')
    if any(x in path for x in ('\x00','\n','\r','*','?','[')):
        raise Blocked('blocked_scope: path patterns are not allowed')
    p=PurePosixPath(path)
    if p.is_absolute() or any(x in ('..','.') for x in path.strip('/').split('/')):
        raise Blocked('blocked_scope: path traversal')
    if any(x.casefold()=='.git' or x.casefold().startswith('.env') or x.casefold() in ('auth.json','credentials.json') for x in p.parts):
        raise Blocked('blocked_scope: git metadata or credentials')
    return str(p).casefold().rstrip('/')

def scopes_overlap(a: list[str], b: list[str]) -> bool:
    return any(x==y or x.startswith(y+'/') or y.startswith(x+'/')
               for x in map(scope_path,a) for y in map(scope_path,b))

def validate_task(data: dict) -> dict:
    required={'id','owner','role','provider','base_sha','worktree','scopes','goal','acceptance','risk','heavy'}
    if not isinstance(data,dict) or not required <= data.keys() or data.keys()-required-{'timeout'}:
        raise Blocked('blocked_task: missing or unknown fields')
    for key in ('id','owner'):
        if not isinstance(data[key],str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}',data[key]):
            raise Blocked('blocked_task: invalid identifier')
    if not isinstance(data['role'],str) or not isinstance(data['provider'],str) or data['role'] not in ROLES or data['provider'] not in PROVIDERS:
        raise Blocked('blocked_task: unknown role/provider')
    if not isinstance(data['base_sha'],str) or not re.fullmatch('[a-f0-9]{40}',data['base_sha']):
        raise Blocked('blocked_task: full lowercase commit SHA required')
    if data['risk'] not in ('low','standard','critical') or type(data['heavy']) is not bool:
        raise Blocked('blocked_task: risk/heavy type')
    if type(data.get('timeout',600)) is not int or not 1 <= data.get('timeout',600) <= 1200:
        raise Blocked('blocked_task: timeout must be 1..1200 seconds')
    for key in ('goal','acceptance','worktree'):
        if not isinstance(data[key],str) or not data[key].strip() or len(data[key])>8000 or '\x00' in data[key]:
            raise Blocked('blocked_task: invalid '+key)
    if not isinstance(data['scopes'],list): raise Blocked('blocked_scope: list required')
    for path in data['scopes']: scope_path(path)
    writer=ROLES[data['role']][1]
    if writer != bool(data['scopes']):
        raise Blocked('blocked_scope: only writer roles may have nonempty write scopes')
    if data['provider']=='mistral' and writer:
        raise Blocked('blocked_provider_role: Mistral Free is advisory only')
    return dict(data)

def validate_funding(provider: str, evidence: dict|None, now: float, executable_sha: str) -> None:
    if provider not in CHANNELS:
        raise Blocked('blocked_channel: no approved native CLI entitlement')
    if not isinstance(evidence,dict): raise Blocked('blocked_funding: no evidence')
    if evidence.get('provider')!=provider or evidence.get('channel')!=CHANNELS[provider]:
        raise Blocked('blocked_funding: wrong provider/channel')
    if any(evidence.get(k) is not True for k in ('login_verified','extra_spend_disabled','included_quota_available')):
        raise Blocked('blocked_funding: login, included quota and no-extra-spend must be verified')
    start,end=evidence.get('observed_at'),evidence.get('expires_at')
    if any(type(v) not in (int,float) or not math.isfinite(v) for v in (start,end,now)):
        raise Blocked('blocked_funding: invalid observation time')
    if not (start <= now < end <= start+86400):
        raise Blocked('blocked_funding: stale, future or overlong evidence')
    if not evidence.get('source') or not isinstance(evidence.get('source'),str):
        raise Blocked('blocked_funding: source required')
    if not re.fullmatch('[a-f0-9]{64}',executable_sha) or evidence.get('executable_sha256')!=executable_sha:
        raise Blocked('blocked_funding: executable changed since evidence')
