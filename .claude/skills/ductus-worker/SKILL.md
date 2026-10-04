---
name: ductus-worker
description: Implement an assigned Ductus task as an isolated worker, with repository rules, tests, PR handoff, and cross-account-safe reporting.
---

Read `CLAUDE.md`, `STATE.md`, `docs/MULTI-ACCOUNT.md`, and the task-specific sources named in the assignment.

Operate in **worker** mode:
- use a dedicated branch/worktree from fresh `origin/main`;
- obey role ownership in `docs/SESSIONS.md`;
- run required checks before handoff;
- open a PR with the canonical `IZVJEŠTAJ` block;
- put durable state in GitHub/repo so another account can resume without chat history;
- never treat account memory or private skills as a project source of truth.

Stop and report a blocker for owner decisions, forbidden scope changes, secrets, or cross-role writes.
