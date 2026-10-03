# Remove session worktrees whose branch is merged into origin/main (or whose
# PR is merged or closed), then prune stale worktree entries. Worktrees with
# uncommitted changes are skipped, never forced.
# Usage: powershell -File scripts/cleanup-worktrees.ps1 [-DryRun]
param([switch]$DryRun)
$ErrorActionPreference = 'Stop'

$root = git rev-parse --show-toplevel
git -C $root fetch origin --prune --quiet

$merged = git -C $root branch --merged origin/main --format '%(refname:short)'
$worktrees = @()
$current = @{}
foreach ($line in (git -C $root worktree list --porcelain)) {
    if ($line -like 'worktree *') { $current = @{ Path = $line.Substring(9) } }
    elseif ($line -like 'branch *') { $current.Branch = $line.Substring(7) -replace '^refs/heads/', '' }
    elseif ($line -eq '') { if ($current.Path) { $worktrees += [pscustomobject]$current }; $current = @{} }
}
if ($current.Path) { $worktrees += [pscustomobject]$current }

foreach ($wt in $worktrees) {
    if (-not $wt.Branch -or $wt.Branch -eq 'main') { continue }
    if ((Resolve-Path $wt.Path).Path -eq (Resolve-Path $root).Path) { continue }

    $isMerged = $merged -contains $wt.Branch
    $state = ''
    if (-not $isMerged) {
        $state = gh pr list --head $wt.Branch --state all --json state --jq '.[0].state' 2>$null
        $isMerged = $state -eq 'MERGED'
    }
    if (-not $isMerged -and $state -ne 'CLOSED') { continue }

    if (git -C $wt.Path status --porcelain) {
        Write-Output "skip (uncommitted changes): $($wt.Path)"
        continue
    }
    Write-Output "remove: $($wt.Path) [$($wt.Branch)]"
    if (-not $DryRun) {
        git -C $root worktree remove $wt.Path
        # Squash merges are not ancestors of main, so -D is needed; a closed,
        # unmerged branch is kept so its work can still be recovered.
        if ($isMerged) { git -C $root branch -D $wt.Branch }
    }
}
if (-not $DryRun) { git -C $root worktree prune }
