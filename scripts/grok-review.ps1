#Requires -Version 7.4
# Independent Grok review of the current branch against origin/main, run through
# the Grok Build CLI (SuperGrok subscription, no API key).
# Needs PowerShell 7.4+ (pwsh): Windows PowerShell 5.1 mangles quotes passed to
# native programs and writes a BOM.
# One-time setup: install the CLI (`npm install -g @xai-official/grok` or
# `irm https://x.ai/cli/install.ps1 | iex`) and sign in once with `grok login`
# (`grok login --device-auth` on a remote shell). The CLI keeps the token in
# ~/.grok/auth.json. A session login is used before XAI_API_KEY, but an expired
# login would silently fall back to the key and bill the API, so this script
# refuses to run with XAI_API_KEY set.
# Run it only on your own or an already trusted branch: the branch content
# (diff, AGENTS.md, .claude/) is read by the CLI on your account. Never run it
# in ductus-security, the diff would be sent to xAI.
# Usage: pwsh -File scripts/grok-review.ps1 [-Pr <number>] [-Model <id>] [-Post -Verdict <PASS|FAIL|BLOCK>]
# By default the review is only printed. -Post -Verdict posts it as a canonical
# review comment from the signed-in GitHub account (the owner's). The gate counts
# it as the Grok provider because of the line `Review-Channel: grok-cli`
# (D-162, docs/ENGINEERING_SYSTEM.md section 6). The verdict is the owner's call
# after reading the review, never the model's. The depth is the CLI's default
# model; there is no level switch.
param(
    [int]$Pr = 0,
    [string]$Model = '',
    [switch]$Post,
    [ValidateSet('PASS', 'FAIL', 'BLOCK')]
    [string]$Verdict
)
$ErrorActionPreference = 'Stop'

if ($env:XAI_API_KEY) { throw "XAI_API_KEY is set and could bill the API instead of the subscription; unset it or run 'grok logout' first" }
if (-not (Get-Command grok -ErrorAction SilentlyContinue)) { throw "grok CLI not found; install it first (see the header of this script)" }
if ($Post -and -not $Verdict) { throw "-Post needs -Verdict PASS, FAIL or BLOCK (read the review first)" }

git fetch origin main --quiet
if ($LASTEXITCODE -ne 0) { throw "git fetch failed; refusing to review against a stale origin/main" }

$localHead = (git rev-parse HEAD).Trim()
if ($Post) {
    if ($Pr -eq 0) { $Pr = [int](gh pr view --json number --jq .number) }
    $prHead = (gh pr view $Pr --json headRefOid --jq .headRefOid)
    if ($LASTEXITCODE -ne 0 -or $prHead -notmatch '^[0-9a-f]{40}$') { throw "could not read the head of PR $Pr" }
    if ($prHead -ne $localHead) { throw "local HEAD $localHead is not the head $prHead of PR $Pr; push or checkout first" }
}

$diff = (git diff origin/main...HEAD) -join "`n"
if (-not $diff.Trim()) { throw "no diff against origin/main; nothing to review" }
$limit = 24000
if ($diff.Length -gt $limit) { throw "diff is $($diff.Length) characters, over the $limit limit of one command line; split the PR (docs/ENGINEERING_SYSTEM.md section 14)" }

$prompt = @"
You are an independent reviewer. Review ONLY the diff below. Do not run tools and do not edit any file.
Follow the review rules in AGENTS.md and CLAUDE.md.
Report only real defects. Each finding needs the file and line, a concrete scenario that breaks, and a line "Dohvatljivo kroz:" naming the real caller that reaches it.
Write the review in Croatian. The last line of your answer must be exactly: ZAVRSENO: <N> nalaza

DIFF:
$diff
"@

$grokArgs = @('-p', $prompt)
if ($Model) { $grokArgs += @('-m', $Model) }

$review = & grok @grokArgs
if ($LASTEXITCODE -ne 0) { throw "grok review failed with exit code $LASTEXITCODE" }
$lines = @($review | Where-Object { $_ -and $_.Trim() })
if ($lines.Count -eq 0 -or $lines[-1].Trim() -notmatch '^ZAVRSENO: \d+ nalaza$') {
    throw "grok output is empty or has no closing 'ZAVRSENO: N nalaza' line; not publishing it"
}
# The comment must not carry a command or another agent's metadata line.
$kept = @($review | Where-Object { $_ -notmatch '^\s*(@|Owner-|Agent-|QA-|Review-|Command-)' })
$removed = @($review).Count - $kept.Count
$text = $kept -join "`n"
if ($removed -gt 0) { $text += "`n`n(Uklonjeno $removed redaka koji bi se čitali kao naredba ili metapodatak.)" }

$header = "## Neovisni pregled (Grok CLI)`n`nHead: $localHead`n`n"
$body = $header + $text
Write-Output $body

if ($Post) {
    $canonical = "Agent-Review: grok:cli:reviewer`nReview-Head: $localHead`nReview-Verdict: $Verdict`nReview-Channel: grok-cli`n`n" + $body
    $out = Join-Path ([IO.Path]::GetTempPath()) ("grok-review-{0}.md" -f [guid]::NewGuid())
    Set-Content -Path $out -Value $canonical -Encoding utf8
    gh pr comment $Pr --body-file $out
    if ($LASTEXITCODE -ne 0) { throw "gh pr comment failed; review kept at $out" }
    Remove-Item $out
}
