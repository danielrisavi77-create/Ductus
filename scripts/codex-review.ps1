# Independent local Codex review of the current branch against origin/main.
# Codex reads the review instructions from AGENTS.md automatically.
# Subscription-first default is the authenticated Codex GitHub Code Review App.
# A comment posted here through the user's gh token is diagnostic and does not
# by itself satisfy the App-authenticated Engineering review gate.
# Usage: powershell -File scripts/codex-review.ps1 -Level <light|standard|critical> [-Pr <number>] [-NoComment]
# Levels (docs/SESSIONS.md 5): light = docs, config, packages; standard = ports
# and features; critical = evidence, crypto, auth, RLS, submission.
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('light', 'standard', 'critical')]
    [string]$Level,
    [int]$Pr = 0,
    [switch]$NoComment
)
$ErrorActionPreference = 'Stop'

$tiers = @{
    light    = @{ Model = 'gpt-6-luna';  Effort = 'medium' }
    standard = @{ Model = 'gpt-6-sol';   Effort = 'high' }
    critical = @{ Model = 'gpt-6-astra'; Effort = 'xhigh' }
}
$tier = $tiers[$Level]

git fetch origin main --quiet
if ($LASTEXITCODE -ne 0) { throw "git fetch failed; refusing to review against a stale origin/main" }
$out = Join-Path ([IO.Path]::GetTempPath()) ("codex-review-{0}.md" -f [guid]::NewGuid())

codex exec review --base origin/main --ephemeral -m $tier.Model -c "model_reasoning_effort=`"$($tier.Effort)`"" -o $out
if ($LASTEXITCODE -ne 0) { throw "codex exec review failed with exit code $LASTEXITCODE" }

$header = "## Neovisni pregled (Codex)`n`nRazina: $Level ($($tier.Model), $($tier.Effort))`n`n"
$body = $header + (Get-Content $out -Raw -Encoding utf8)
Set-Content -Path $out -Value $body -Encoding utf8
Write-Output $body

if (-not $NoComment) {
    if ($Pr -eq 0) { $Pr = [int](gh pr view --json number --jq .number) }
    gh pr comment $Pr --body-file $out
    if ($LASTEXITCODE -ne 0) { throw "gh pr comment failed; review kept at $out" }
}
Remove-Item $out
