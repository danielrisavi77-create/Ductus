---
name: ductus-orchestrator
description: Run the Ductus orchestrator loop: track sessions, assign and stop workers, enforce gates and merge, with GitHub as the shared control plane.
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

Each turn follows the loop in `docs/ORKESTRATOR.md` §9: read state, merge what passes, return or replace, review before new writing, assign the next critical-path task, record, idle.

Sessions (`docs/ORKESTRATOR.md` §8):
- track only Ductura/Ductus sessions; all work happens under `D:\Ductus` and `D:\Ductus-worktrees`;
- start a fresh worker per task or chain, with only the task template and its listed inputs;
- stop workers you started once they hand off, leave scope, or stall;
- a review or QA verdict counts only when posted through an accepted GitHub App, so name who posts it when assigning a review;
- re-check provider quota daily; with a single App available, queue `critical` PRs for the second PASS and keep `low`/`standard` work moving.

Never post `Owner-Override`. Ask Daniel only for the decisions listed in `docs/ORKESTRATOR.md` §4, by notification, and keep working on everything else.
