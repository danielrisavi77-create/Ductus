"""Pure task and funding validation for read-only advisory runs. No provider calls."""
import math
import re

# Every role only reads. Writers and the orchestrator are run by the Ductus
# orchestrator through its own subagents, never through this controller.
ROLES = {
    'reviewer': 'R1', 'qa': 'Q1', 'bug-hunter': 'H1', 'product-ux': 'U1',
    'security': 'S1', 'accessibility': 'A1', 'privacy-pilot': 'L1', 'architecture': 'X1',
}
CHANNELS = {'codex': 'chatgpt_subscription', 'grok': 'supergrok_subscription',
            'mistral': 'mistral_free'}
REFUSED = {
    'claude': 'blocked_provider: Claude reviews run in existing authenticated sessions, not here',
    'meta': 'blocked_channel: no approved native CLI entitlement',
    'deepseek': 'blocked_channel: no approved native CLI entitlement',
}
ACTIVE = ('reserved', 'running', 'orphaned')

class Blocked(ValueError):
    """A named policy refusal, not a successful execution."""

def validate_task(data: dict) -> dict:
    required={'id','owner','role','provider','base_sha','worktree','scopes','goal','acceptance','risk','heavy'}
    if not isinstance(data,dict) or not required <= data.keys() or data.keys()-required-{'timeout'}:
        raise Blocked('blocked_task: missing or unknown fields')
    for key in ('id','owner'):
        if not isinstance(data[key],str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}',data[key]):
            raise Blocked('blocked_task: invalid identifier')
    if not isinstance(data['role'],str) or not isinstance(data['provider'],str):
        raise Blocked('blocked_task: unknown role/provider')
    if data['provider'] in REFUSED: raise Blocked(REFUSED[data['provider']])
    if data['role'] not in ROLES or data['provider'] not in CHANNELS:
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
    if data['scopes']:
        raise Blocked('blocked_scope: read-only controller, write paths are never accepted')
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
