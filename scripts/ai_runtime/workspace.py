"""Git identity, non-destructive worktree validation and the no-change audit."""
import os
import subprocess
from pathlib import Path
from .policy import Blocked, validate_task

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
    # A detached HEAD at the reviewed commit is the expected shape of a review worktree.
    if git(root,'branch','--show-current').strip() in ('main','master'):
        raise Blocked('blocked_worktree: main branch is never a review worktree')
    if git(root,'rev-parse','HEAD').strip()!=t['base_sha']: raise Blocked('blocked_sha: unexpected HEAD')
    if git(root,'status','--porcelain=v1','--untracked-files=all').strip():
        raise Blocked('blocked_worktree: existing changes must be preserved')
    for file in root.glob('.env*'):
        if file.name!='.env.example':raise Blocked('blocked_worktree: environment file present')
    for record in git(root,'ls-files','--stage','-z').split('\0'):
        if record.startswith(('120000 ','160000 ')):
            raise Blocked('blocked_worktree: symlink or submodule needs separate review')
    return root

def snapshot(root):
    """HEAD, branch and size/mtime of every untracked file, ignored ones included."""
    root=Path(root);files={}
    for path in git(root,'ls-files','--others','-z').split('\0'):
        if not path:continue
        try:
            stat=(root/path).lstat();files[path]=(stat.st_size,stat.st_mtime_ns)
        except OSError:files[path]=None
    return {'head':git(root,'rev-parse','HEAD').strip(),
            'branch':git(root,'branch','--show-current').strip(),'files':files}

def audit_unchanged(task, before):
    """Every difference from the pre-run state is a violation; nothing is reverted."""
    t=validate_task(task);root=Path(t['worktree'])
    changed=set(git(root,'diff','--name-only','--no-renames','-z',t['base_sha'],'--').split('\0'))
    after=snapshot(root);missing=object()
    changed.update(path for path in before['files'].keys()|after['files'].keys()
                   if before['files'].get(path,missing)!=after['files'].get(path,missing))
    violations=sorted(changed-{''})
    if (after['head'],after['branch'])!=(before['head'],before['branch']):violations.insert(0,'HEAD')
    return violations
