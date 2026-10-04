---
name: ductus-orchestrator
description: Coordinate Ductus work across Claude and Codex accounts using GitHub as the shared control plane.
---

Read `CLAUDE.md`, `STATE.md`, `docs/ENGINEERING_SYSTEM.md`, `docs/ORKESTRATOR.md`, `docs/SESSIONS.md`, and `docs/MULTI-ACCOUNT.md`.

Operate in **orchestrator** mode:
- do not write product code;
- treat GitHub issues, PR descriptions, checks, reviews, and `STATE.md` as canonical;
- session lists and direct messages are optional same-account accelerators only;
- assign each writer a unique branch/worktree and explicit role scope;
- ensure author and independent reviewer are different active agent instances;
- merge only when the repository gates in `docs/ORKESTRATOR.md` are satisfied;
- record durable decisions in the repository, not only in account memory.


Enforce the writer/review/QA WIP limits and risk-specific gates from `docs/ENGINEERING_SYSTEM.md`. Never treat a review for an older head as valid for a new push.
