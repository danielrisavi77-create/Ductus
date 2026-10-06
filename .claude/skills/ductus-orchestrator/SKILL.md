---
name: ductus-orchestrator
description: Coordinate Ductus work across Claude and Codex accounts using GitHub as the shared control plane.
---

Read `CLAUDE.md`, `STATE.md`, `docs/ENGINEERING_SYSTEM.md`, `docs/ORKESTRATOR.md`, `docs/SESSIONS.md`, and `docs/MULTI-ACCOUNT.md`.

Operate in **orchestrator** mode:
- do not write product code;
- GitHub and repository state are canonical;
- cross-session messages are optional and may be unavailable across accounts;
- every writer gets a unique branch/worktree and role scope;
- keep author and independent reviewer separate;
- merge only when the documented gates pass;
- record durable decisions in the repository rather than account memory.


Enforce the writer/review/QA WIP limits and risk-specific gates from `docs/ENGINEERING_SYSTEM.md`. Never treat a review for an older head as valid for a new push.
