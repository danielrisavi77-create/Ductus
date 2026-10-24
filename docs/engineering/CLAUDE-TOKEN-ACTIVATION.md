# Claude Token Optimization V2 — activation and rollback (DAN-278)

**State:** prepared on an isolated branch. Not merged or active until the protected GitHub workflow finishes, and not a replacement for Claude Code's native `/usage` (Max subscription quota).

## Dependencies / merge order

1. DAN-275 / phase A: `token-report.mjs` v2 and `claude-statusline.mjs` in `main`.
2. DAN-276 / phase B: `claude-workflow.mjs` in `main`.
3. DAN-277 / phase C: `claude-audit.mjs` in `main`.
4. DAN-278 / activation: `.claude/settings.json` statusLine plus identical skill copies. Do not open this PR before all three are merged and tests can execute in the PR's isolated checkout. PRs are not stacked.

At each stage obey D-107 demo priority, D-108 process freeze, D-97 exact-head owner authorization, and `docs/ENGINEERING_SYSTEM.md` risk/review/QA gates. Never use an earlier approval for a changed substantive diff.

## What becomes automatic

`statusLine` in project settings runs `node scripts/engineering/claude-statusline.mjs` when Claude Code refreshes its display. It reads a bounded JSON object on stdin, performs no network/API calls and writes nothing to disk. The display can show current context, subscription rate limits when Claude provides them, and prompt-cache hit ratio. Missing runtime fields are `n/a`, not zero.

**Operator:** Platforma. **Trigger:** Claude Code's native statusLine refresh event. **Consumer:** local human operator.

The `ductus-token-budget` skill is the thin, discoverable router for on-demand usage/debugging requests. It does not run an additional hook on every tool call. `pnpm tokens:report` already exists; for local reports the operator may use it on demand, and `claude-audit.mjs` and `claude-workflow.mjs` are routed by the skill only on relevant tasks. All data remains in the user's checkout. Do not upload local Claude transcripts to GitHub.

## Windows and worktree smoke test

The project command is relative to the checkout where Claude Code is started. On Windows Git Bash and PowerShell use forward slashes. In the project root, verify `node scripts/engineering/claude-statusline.mjs` with a synthetic statusLine JSON payload, then launch Claude Code and confirm the status line displays; repeat after entering a worktree/subdirectory. If the actual runtime does not resolve the relative command reliably, **do not claim activation**, use a dedicated tested local override before accepting the PR (no global user settings changes).

Run `node --test scripts/engineering/claude-token-activation.test.mjs` and the existing A/B/C synthetic tests, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and the full PR CI under Node 24. Review and adversarial QA must check no existing safety hooks or permission controls are weakened.

## Rollback

Revert only the small `statusLine` entry and the skill copies in a new reviewed/approved PR. The A/B/C read-only helpers can remain installed and unused. Do not bypass GitHub branch protection or the D-97 owner command.

## Baseline

Measure `freshInput`, `cacheRead`, `cacheWrite`, `output` and actual PR outcomes over comparable task categories; the scripts do not by themselves prove reduced subscription quota or improved productivity.
