# Claude Code Token Optimization V2 — DAN-275

Status: three prepared branches; these are not merged into main and are not activated globally.
Canonical rules remain in CLAUDE.md, docs/ORKESTRATOR.md §7 and docs/SESSIONS.md §4.
All scripts under scripts/engineering/ are D-97 protected and require canonical independent review, QA where applicable, and the owner's exact-head merge command.

## A: usage statistics — DAN-275
- node scripts/engineering/token-report.mjs --days 10 --json
- Separately reports freshInput, cacheRead, cacheWrite, output, per-model usage, model switches and repetitive tool-call hints.
- Input transcript text is not printed. Transcript counters are not the Claude Max quota or an invoice.
- node scripts/engineering/claude-statusline.mjs reads JSON from stdin and prints bounded context/limit/cache data.
- The statusline is opt-in and is NOT automatically wired into .claude/settings.json.

## B: deterministic local helpers — DAN-276
- node scripts/engineering/claude-workflow.mjs context --task DAN-276 --sha <40hex> --file docs/ENGINEERING_SYSTEM-SAZETAK.md
- locate --symbol <symbol>: only tracked symbol locations, not contents.
- log --file <repo-relative-log>: error kind/line numbers only; retains complete original log.
- handoff --file <repo-relative-report>: identifies required IZVJEŠTAJ fields, does not approve their proof.
- preflight --pr <number> --sha <40hex>: delegates to existing orch:preflight without changing exit codes.

## C: advisory audit — DAN-277
- node scripts/engineering/claude-audit.mjs models --role writer --risk standard --area ui --model opus
- ... surface: configured skill/agent descriptions and enabled plugin names, without automatically disabling any plugin.
- ... duplicates: hashed repeated paragraphs only, never automatically removes required rules.
- ... cache --usage <token-report-v2.json>: local counters, not subscription billing.
- ... roi --usage <token-report-v2.json> --mapping <manual-map.json>: GitHub-merged status where available; manual session mapping is not causal proof.

## Boundaries
- No secret or transcript body is uploaded; scripts only print sanitized summaries.
- No CI, GitHub permissions, review/QA gate, risk floor, model policy, or Claude hooks are changed.
- Existing tooling PRs #610 and #613 occupy the tooling queue. Do not open more gate PRs until its slots allow.
- Local synthetic tests ran on Node 22. Ductus requires Node 24; full project CI and independent review/QA remain outstanding.
- Do not claim achieved token savings until comparable per-risk, per-task measurements are available.
