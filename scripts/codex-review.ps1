# Independent Codex review of the current branch against origin/main.
# Codex reads the review instructions from AGENTS.md automatically.
# Usage (F-176, docs/SESSIONS.md 5): always main's copy, saved outside the
# checkout of the branch under review, run from that checkout:
#   git fetch origin main
#   git show origin/main:scripts/codex-review.ps1 | Out-File -Encoding utf8 "$env:TEMP\codex-review.ps1"
#   powershell -File "$env:TEMP\codex-review.ps1" -Level <light|standard|critical> [-Escalate]
# The script never posts (F-182): it prints the review and the file it saved.
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
#    AGENTS.md and CLAUDE.md also tell the reviewer to read further documents
#    (STATE.md, docs/ENGINEERING_SYSTEM-SAZETAK.md and others), so a document
#    that main's copy of either names in backticks is refused as well.
$entryDocs = @(foreach ($entry in 'AGENTS.md', 'CLAUDE.md') {
    $text = (git show "origin/main:$entry" 2>$null) -join "`n"
    if ($LASTEXITCODE -ne 0 -or -not $text) { throw "origin/main:$entry could not be read; refusing to run" }
    [regex]::Matches($text, '`([A-Za-z0-9_./-]+\.md)`') | ForEach-Object { $_.Groups[1].Value }
})
$instructions += @($changed | Where-Object { $entryDocs -contains $_ })
if ($instructions.Count -gt 0) {
    throw "the branch changes agent instructions ($($instructions -join ', ')); Codex would follow them, review it another way"
}

$out = Join-Path ([IO.Path]::GetTempPath()) ("codex-review-{0}.md" -f [guid]::NewGuid())

# 3. Read-only sandbox (no writes, no network) and no approval prompts, and
#    no GitHub token in the environment of the Codex process. F-182: MCP
#    servers and plugins run outside that sandbox, so Codex runs with its own
#    temporary CODEX_HOME: only auth.json and a minimal config.toml, no MCP
#    servers, plugins, apps or the owner's global AGENTS.md. It is removed
#    after the call. --ignore-user-config also keeps any config.toml out.
$ownerHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
$auth = Join-Path $ownerHome 'auth.json'
if (-not (Test-Path -LiteralPath $auth -PathType Leaf)) { throw "no Codex login file at $auth; refusing to run with the owner's Codex home" }
$reviewHome = Join-Path ([IO.Path]::GetTempPath()) ("codex-review-home-{0}" -f [guid]::NewGuid())
New-Item -ItemType Directory -Path $reviewHome | Out-Null
$tokenNames = @('GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'OWNER_COMMAND_TOKEN')
$savedTokens = @{}
$savedHome = $env:CODEX_HOME
try {
    Copy-Item -LiteralPath $auth -Destination (Join-Path $reviewHome 'auth.json')
    $minimalConfig = "sandbox_mode = `"read-only`"`napproval_policy = `"never`"`n"
    [IO.File]::WriteAllText((Join-Path $reviewHome 'config.toml'), $minimalConfig, (New-Object Text.UTF8Encoding $false))
    foreach ($name in $tokenNames) {
        $value = [Environment]::GetEnvironmentVariable($name, 'Process')
        if ($null -ne $value) { $savedTokens[$name] = $value; Remove-Item -LiteralPath "Env:$name" }
    }
    $env:CODEX_HOME = $reviewHome
    codex exec review --base origin/main --ephemeral --ignore-user-config -m $tier.Model -c "model_reasoning_effort=`"$($tier.Effort)`"" -c 'sandbox_mode="read-only"' -c 'approval_policy="never"' -o $out
    $codexExit = $LASTEXITCODE
} finally {
    $env:CODEX_HOME = $savedHome
    foreach ($name in $savedTokens.Keys) { [Environment]::SetEnvironmentVariable($name, $savedTokens[$name], 'Process') }
    Remove-Item -LiteralPath $reviewHome -Recurse -Force -ErrorAction SilentlyContinue
}
if ($codexExit -ne 0) { throw "codex exec review failed with exit code $codexExit" }

# 4. A read-only sandbox can still read local files and print them, and a
#    pattern catches only known credential shapes. F-182: this script never
#    posts. It saves the review and prints the path; the session posts it
#    (gh pr comment <n> --body-file <path>) only after reading it.
$review = Get-Content $out -Raw -Encoding utf8
$secretRe = '(?i)(gh[opsu]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|"?(access|refresh|id)_token"?\s*[:=])'
if ($review -match $secretRe) {
    throw "the review looks like it contains a credential; do not post it, kept at $out for the owner to inspect"
}

$header = "## Neovisni pregled (Codex)`n`nRazina: $Level ($($tier.Model), $($tier.Effort))`n`n"
Set-Content -Path $out -Value ($header + $review) -Encoding utf8
Write-Output ($header + $review)
if ($Pr -ne 0 -or $NoComment) { Write-Warning "-Pr and -NoComment no longer post anything (F-182); read the review and post it yourself" }
Write-Output "Review saved, not posted: $out"
Write-Output "Read it, then post: gh pr comment <n> --body-file `"$out`""
