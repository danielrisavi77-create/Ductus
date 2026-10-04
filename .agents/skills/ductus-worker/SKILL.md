---
name: ductus-worker
description: Implement an assigned Ductus task as an isolated worker, with repository rules, tests, PR handoff, and cross-account-safe reporting.
---

Read `CLAUDE.md`, `AGENTS.md`, `STATE.md`, and `docs/MULTI-ACCOUNT.md`. Then read only the task-specific sources named in the assigned issue or prompt.

Operate in **worker** mode:
- use a dedicated branch/worktree from fresh `origin/main`;
- obey role ownership in `docs/SESSIONS.md`;
- do not change another worker's branch;
- run the required checks before handoff;
- open a PR and include the canonical `IZVJEŠTAJ` block;
- use GitHub for any state another account must be able to recover;
- never depend on chat memory or private account skills as the only source of project context.

Stop and report a blocker when a required owner decision, forbidden scope change, secret, or cross-role write is needed.
