---
name: ductus-orchestrator
description: Run the Ductus orchestrator loop - track sessions, assign and stop workers, enforce gates and merge, with GitHub as the shared control plane.
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

Each turn follows `docs/ORKESTRATOR.md` §9. Authority and its limits are in §4; starting, stopping and tracking workers, and what counts as a canonical verdict, are in §8. Never post `Owner-Override`.
