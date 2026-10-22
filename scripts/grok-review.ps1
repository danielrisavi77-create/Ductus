# Independent Grok review of the current branch against origin/main, run through
# the Grok Build CLI (SuperGrok subscription, no API key).
# One-time setup: install the CLI (`npm install -g @xai-official/grok` or
# `irm https://x.ai/cli/install.ps1 | iex`) and sign in once with `grok login`
# (`grok login --device-auth` on a remote shell). The CLI keeps the token in
# ~/.grok/auth.json. If XAI_API_KEY is set it would take precedence over the
# subscription, so this script refuses to run with it set.
# Usage: powershell -File scripts/grok-review.ps1 -Level <light|standard|critical> [-Pr <number>] [-Model <id>] [-Post]
# By default the review is only printed. -Post adds it as a PR comment from the
# signed-in GitHub account. That comment is advisory evidence: the engineering
# gate counts a review only from the GitHub App `grok-by-xai`
# (docs/ENGINEERING_SYSTEM.md section 6), never from a CLI comment.
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('light', 'standard', 'critical')]
    [string]$Level,
    [int]$Pr = 0,
    [string]$Model = '',
    [switch]$Post
)
$ErrorActionPreference = 'Stop'

if ($env:XAI_API_KEY) { throw "XAI_API_KEY is set and would bypass the subscription login; unset it or run 'grok logout' first" }
if (-not (Get-Command grok -ErrorAction SilentlyContinue)) { throw "grok CLI not found; install it first (see the header of this script)" }

git fetch origin main --quiet
if ($LASTEXITCODE -ne 0) { throw "git fetch failed; refusing to review against a stale origin/main" }

$prompt = @"
You are an independent reviewer of this branch. Review ONLY the diff from `git diff origin/main...HEAD`. Do not edit any file.
Follow the review rules in AGENTS.md and CLAUDE.md. Review level: $Level.
Report only real defects. Each finding needs the file and line, a concrete scenario that breaks, and a line "Dohvatljivo kroz:" naming the real caller that reaches it. If there are no findings, say exactly that.
Write the review in Croatian.
"@

$args = @('-p', $prompt)
if ($Model) { $args += @('-m', $Model) }

$out = Join-Path ([IO.Path]::GetTempPath()) ("grok-review-{0}.md" -f [guid]::NewGuid())
$review = & grok @args
if ($LASTEXITCODE -ne 0) { throw "grok review failed with exit code $LASTEXITCODE" }

$header = "## Neovisni pregled (Grok CLI)`n`nRazina: $Level`n`n"
$body = $header + ($review -join "`n")
Set-Content -Path $out -Value $body -Encoding utf8
Write-Output $body

if ($Post) {
    if ($Pr -eq 0) { $Pr = [int](gh pr view --json number --jq .number) }
    gh pr comment $Pr --body-file $out
    if ($LASTEXITCODE -ne 0) { throw "gh pr comment failed; review kept at $out" }
}
Remove-Item $out
