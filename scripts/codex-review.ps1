# Independent Codex review of the current branch against origin/main.
# Codex reads the review instructions from AGENTS.md automatically.
# Usage: powershell -File scripts/codex-review.ps1 -Level <light|standard|critical> [-Pr <number>] [-NoComment] [-Escalate]
# Levels (docs/SESSIONS.md 5) follow the PR risk: light = Risk low (docs, config,
# packages); standard = Risk standard (ports and features); critical = Risk
# critical (evidence, crypto, auth, RLS, submission).
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('light', 'standard', 'critical')]
    [string]$Level,
    [int]$Pr = 0,
    [switch]$NoComment,
    [switch]$Escalate
)
$ErrorActionPreference = 'Stop'

# D-192: Terra high for light, Sol high for standard, Sol ultra for critical;
# -Escalate (any level) reruns once with Astra high after a first review that
# got stuck (docs/SESSIONS.md 5). "ultra" is a reasoning level the Codex CLI
# lists for gpt-6.1-sol (models cache, codex-cli 0.166.0).
$tiers = @{
    light    = @{ Model = 'gpt-6.1-terra'; Effort = 'high' }
    standard = @{ Model = 'gpt-6.1-sol';   Effort = 'high' }
    critical = @{ Model = 'gpt-6.1-sol';   Effort = 'ultra' }
}
$tier = if ($Escalate) { @{ Model = 'gpt-6-astra'; Effort = 'high' } } else { $tiers[$Level] }

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
