# Independent Codex review of the current branch against origin/main.
# Codex reads the review instructions from AGENTS.md automatically.
# Usage (F-176, docs/SESSIONS.md 5): always main's copy, saved outside the
# checkout of the branch under review, run from that checkout:
#   git fetch origin main
#   git show origin/main:scripts/codex-review.ps1 | Out-File -Encoding utf8 "$env:TEMP\codex-review.ps1"
#   powershell -File "$env:TEMP\codex-review.ps1" -Level <light|standard|critical> [-Pr <number>] [-NoComment] [-Escalate]
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

# F-176: the branch under review is untrusted input (docs/SESSIONS.md 5).
# 1. Only main's copy of this script runs: a branch could edit the copy in its
#    own checkout. The trusted step is the usage above (main's copy saved
#    outside the checkout); this check only catches a wrong invocation, since
#    a branch's copy can drop it.
$mainCopy = (git show origin/main:scripts/codex-review.ps1 2>$null) -join "`n"
if ($LASTEXITCODE -ne 0 -or -not $mainCopy) { throw "origin/main:scripts/codex-review.ps1 could not be read; refusing to run" }
$selfCopy = (Get-Content -LiteralPath $PSCommandPath -Encoding utf8) -join "`n"
if ($selfCopy.TrimEnd() -ne $mainCopy.TrimEnd()) {
    throw "this copy of codex-review.ps1 differs from origin/main; run main's copy (docs/SESSIONS.md 5)"
}
# 2. Codex reads agent instructions from the checkout, and AGENTS.md sends it
#    on to role cards and skills, so a branch that changes any agent
#    instruction or configuration file is not reviewed this way (it is a D-97
#    PR and needs another reviewer). Same classes as isAgentControlPath in
#    scripts/engineering/protected-paths.mjs: an instruction file name,
#    .mcp.json, or a .claude, .agents or .codex segment at any depth.
#    Names come NUL-separated and unquoted (-z, core.quotePath=false): git
#    otherwise quotes a path with special or non-ASCII characters, and the
#    quote would hide the segment from the patterns. A name that still starts
#    with a quote is refused.
$changed = @(((git -c core.quotePath=false diff --name-only -z origin/main...HEAD) -join "`0") -split "`0" | Where-Object { $_ })
if ($LASTEXITCODE -ne 0) { throw "git diff against origin/main failed; refusing to run" }
$instructions = @($changed | Where-Object {
    $_ -match '(?i)(^|/)((claude|agents|gemini)[^/]*|copilot-instructions|[^/]*\.instructions)\.md$' -or $_ -match '(?i)(^|/)(\.claude|\.agents|\.codex)(/|$)|(^|/)\.mcp\.json$' -or $_.StartsWith('"')
})
if ($instructions.Count -gt 0) {
    throw "the branch changes agent instructions ($($instructions -join ', ')); Codex would follow them, review it another way"
}

$out = Join-Path ([IO.Path]::GetTempPath()) ("codex-review-{0}.md" -f [guid]::NewGuid())

# 3. Read-only sandbox (no writes, no network) and no approval prompts,
#    whatever ~/.codex/config.toml says, and no GitHub token in the
#    environment of the Codex process. The comment is posted by this script
#    after Codex has exited.
$tokenNames = @('GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'OWNER_COMMAND_TOKEN')
$savedTokens = @{}
foreach ($name in $tokenNames) {
    $value = [Environment]::GetEnvironmentVariable($name, 'Process')
    if ($null -ne $value) { $savedTokens[$name] = $value; [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
}
try {
    codex exec review --base origin/main --ephemeral -m $tier.Model -c "model_reasoning_effort=`"$($tier.Effort)`"" -c 'sandbox_mode="read-only"' -c 'approval_policy="never"' -o $out
    $codexExit = $LASTEXITCODE
} finally {
    foreach ($name in $savedTokens.Keys) { [Environment]::SetEnvironmentVariable($name, $savedTokens[$name], 'Process') }
}
if ($codexExit -ne 0) { throw "codex exec review failed with exit code $codexExit" }

# 4. A read-only sandbox can still read local credentials and print them, so
#    a review that looks like it carries a credential is never posted.
$review = Get-Content $out -Raw -Encoding utf8
$secretRe = '(?i)(gh[opsu]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|"?(access|refresh|id)_token"?\s*[:=])'
if ($review -match $secretRe) {
    throw "the review looks like it contains a credential; not posted, kept at $out for the owner to inspect"
}

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
