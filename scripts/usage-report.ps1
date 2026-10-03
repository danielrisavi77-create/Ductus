# Token usage of Claude Code sessions in this repo and its worktrees, read
# from local session logs by ccusage. Costs are API-price estimates, not
# what the subscription charges; tokens include cache reads.
# Usage: powershell -File scripts/usage-report.ps1 [-Since yyyyMMdd] [-Json]
param(
    [string]$Since = (Get-Date).ToString('yyyyMMdd'),
    [switch]$Json
)
$ErrorActionPreference = 'Stop'

$raw = npx -y ccusage@20 claude session --since $Since --json | Out-String
$sessions = (ConvertFrom-Json $raw).sessions |
    Where-Object { $_.projectPath -like '*Ductus*' } |
    ForEach-Object {
        [pscustomobject]@{
            session      = $_.sessionId
            worktree     = ($_.projectPath -replace '^.*Ductus-?-?(claude-worktrees-)?', '')
            totalTokens  = $_.totalTokens
            outputTokens = $_.outputTokens
            costUsd      = [math]::Round($_.totalCost, 2)
            lastActivity = $_.lastActivity
        }
    } | Sort-Object totalTokens -Descending

if ($Json) { $sessions | ConvertTo-Json -Depth 3 } else { $sessions | Format-Table -AutoSize }
