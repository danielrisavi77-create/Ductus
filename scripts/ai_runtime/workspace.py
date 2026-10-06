"""Git identity and non-destructive worktree validation."""
import os
import re
import subprocess
from pathlib import Path
from .policy import Blocked, scope_path, validate_task

ORIGINS={'https://github.com/danielrisavi77-create/Ductus.git',
         'https://github.com/danielrisavi77-create/Ductus',
         'git@github.com:danielrisavi77-create/Ductus.git'}

def git(root, *args, timeout=30):
    env=dict(os.environ)
    for key in list(env):
        if key.startswith('GIT_'): del env[key]
    env['GIT_TERMINAL_PROMPT']='0'
    try:
        p=subprocess.run(['git','-C',str(root),*args],capture_output=True,
                         encoding='utf-8',errors='replace',timeout=timeout,env=env)
    except (OSError,subprocess.TimeoutExpired) as exc:
        raise Blocked('blocked_git: command unavailable or timed out') from exc
    if p.returncode: raise Blocked('blocked_git: '+args[0]+' failed')
    return p.stdout

def canonical_repo(root):
    common=Path(git(root,'rev-parse','--path-format=absolute','--git-common-dir').strip()).resolve()
    if common.name!='.git': raise Blocked('blocked_repository: unsupported common directory')
    return common.parent

def inspect_workspace(task, repo):
    t=validate_task(task); root=Path(t['worktree']).resolve(); repo=Path(repo).resolve()
    if git(root,'remote','get-url','origin').strip() not in ORIGINS:
        raise Blocked('blocked_repository: unexpected origin')
    if canonical_repo(root)!=repo: raise Blocked('blocked_repository: different common repository')
    if Path(git(root,'rev-parse','--show-toplevel').strip()).resolve()!=root:
        raise Blocked('blocked_worktree: not the worktree root')
    gd=Path(git(root,'rev-parse','--absolute-git-dir').strip()).resolve()
    if gd==repo/'.git' or git(root,'rev-parse','--show-superproject-working-tree').strip():
        raise Blocked('blocked_worktree: primary checkout or submodule')
    branch=git(root,'branch','--show-current').strip()
    if not branch or branch in ('main','master'): raise Blocked('blocked_worktree: non-main branch required')
    if git(root,'rev-parse','HEAD').strip()!=t['base_sha']: raise Blocked('blocked_sha: unexpected HEAD')
    if git(root,'status','--porcelain=v1','--untracked-files=all').strip():
        raise Blocked('blocked_worktree: existing changes must be preserved')
    for file in root.glob('.env*'):
        if file.name!='.env.example':raise Blocked('blocked_worktree: environment file present')
    for record in git(root,'ls-files','--stage','-z').split('\0'):
        if record.startswith(('120000 ','160000 ')):
            raise Blocked('blocked_worktree: symlink or submodule needs separate review')
    for scope in t['scopes']:
        if not (root/scope).resolve().is_relative_to(root): raise Blocked('blocked_scope: symlink escape')
    return root

def audit_scope(task):
    t=validate_task(task);root=Path(t['worktree'])
    paths=set(git(root,'diff','--name-only','--no-renames','-z',t['base_sha'],'--').split('\0'))
    paths.update(git(root,'ls-files','--others','--exclude-standard','-z').split('\0'))
    allowed=[scope_path(p) for p in t['scopes']];violations=[]
    for path in sorted(paths-{''}):
        try:
            p=scope_path(path)
            ok=any(p==a or p.startswith(a+'/') for a in allowed)
            if not (root/path).resolve().is_relative_to(root.resolve()): ok=False
        except Blocked: ok=False
        if not ok:violations.append(path)
    return violations

def prepare_worktree(repo, task_id, role):
    repo=canonical_repo(repo)
    if git(repo,'remote','get-url','origin').strip() not in ORIGINS: raise Blocked('blocked_repository')
    slug=re.sub('[^a-z0-9-]','-',task_id.lower()).strip('-')
    if not slug or len(slug)>80: raise Blocked('blocked_task: bad worktree identifier')
    branch=f'{role}/{slug}';target=repo.parent/'Ductus-worktrees'/f'managed-{slug}'
    if target.exists() or git(repo,'branch','--list',branch).strip(): raise Blocked('blocked_worktree: already exists')
    git(repo,'fetch','origin','main','--quiet',timeout=90)
    sha=git(repo,'rev-parse','origin/main').strip()
    target.parent.mkdir(exist_ok=True)
    git(repo,'worktree','add','-b',branch,str(target),sha)
    return dict(worktree=str(target),base_sha=sha,branch=branch)
