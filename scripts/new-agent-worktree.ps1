# Create an isolated Ductus worktree for a Claude or Codex worker.
# Does not copy .env.local, credentials, tokens, or runtime auth state.
# Usage:
#   powershell -File scripts/new-agent-worktree.ps1 -Runtime codex -Slot b -Role backend -Task B-8
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('claude', 'codex')]
    [string]$Runtime,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9_-]+$')]
    [string]$Slot,

    [Parameter(Mandatory = $true)]
    [ValidateSet('platforma', 'backend', 'frontend', 'short', 'review')]
    [string]$Role,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9._-]+$')]
    [string]$Task
)

$ErrorActionPreference = 'Stop'

$root = (git rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0 -or -not $root) { throw 'Not inside a Git repository.' }

$remote = (git -C $root remote get-url origin).Trim()
if ($remote -notmatch 'danielrisavi77-create/Ductus') {
    throw "Refusing to create a Ductus worker from unexpected origin: $remote"
}

git -C $root fetch origin main --quiet
if ($LASTEXITCODE -ne 0) { throw 'git fetch origin main failed.' }

$taskSlug = $Task.ToLowerInvariant()
$roleSlug = $Role.ToLowerInvariant()
$branch = "$roleSlug/$taskSlug"

$parent = Split-Path -Parent $root
if ((Split-Path -Leaf $root) -eq 'Ductus') {
    $worktreeRoot = Join-Path $parent 'Ductus-worktrees'
} else {
    $worktreeRoot = Join-Path $parent 'Ductus-worktrees'
}

New-Item -ItemType Directory -Force -Path $worktreeRoot | Out-Null
$folder = "$Runtime-$Slot-$roleSlug-$taskSlug"
$path = Join-Path $worktreeRoot $folder

if (Test-Path -LiteralPath $path) { throw "Worktree path already exists: $path" }
if (git -C $root branch --list $branch) { throw "Branch already exists: $branch" }

git -C $root worktree add -b $branch $path origin/main
if ($LASTEXITCODE -ne 0) { throw 'git worktree add failed.' }

Write-Output "Created Ductus worker worktree:"
Write-Output "  runtime: $Runtime"
Write-Output "  slot:    $Slot"
Write-Output "  role:    $Role"
Write-Output "  task:    $Task"
Write-Output "  branch:  $branch"
Write-Output "  path:    $path"
Write-Output ''
Write-Output 'No secrets or runtime credentials were copied. Configure account auth outside the repository.'
