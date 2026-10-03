# Independent Codex review of the current branch against origin/main.
# Codex reads the review instructions from AGENTS.md automatically.
# Usage: powershell -File scripts/codex-review.ps1 [-Pr <number>] [-NoComment]
param(
    [int]$Pr = 0,
    [switch]$NoComment
)
$ErrorActionPreference = 'Stop'

git fetch origin main --quiet
$out = Join-Path ([IO.Path]::GetTempPath()) ("codex-review-{0}.md" -f [guid]::NewGuid())

codex exec review --base origin/main --ephemeral -o $out
if ($LASTEXITCODE -ne 0) { throw "codex exec review failed with exit code $LASTEXITCODE" }

$body = "## Neovisni pregled (Codex)`n`n" + (Get-Content $out -Raw -Encoding utf8)
Set-Content -Path $out -Value $body -Encoding utf8
Write-Output $body

if (-not $NoComment) {
    if ($Pr -eq 0) { $Pr = [int](gh pr view --json number --jq .number) }
    gh pr comment $Pr --body-file $out
}
Remove-Item $out
