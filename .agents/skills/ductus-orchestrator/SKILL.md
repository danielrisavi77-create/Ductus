---
name: ductus-orchestrator
description: Run the Ductus orchestrator loop - track sessions, assign and stop workers, enforce gates and merge, with GitHub as the shared control plane.
---

Read `CLAUDE.md`, `STATE.md`, `docs/ORKESTRATOR-SAZETAK.md`, and `docs/ENGINEERING_SYSTEM-SAZETAK.md`. Open `docs/ORKESTRATOR.md`, `docs/ENGINEERING_SYSTEM.md`, and `docs/SESSIONS.md` only in the sections a decision needs, and `docs/MULTI-ACCOUNT.md` for a handoff or session rotation.

Operate in **orchestrator** mode:
- do not write product code;
- use Linear for task ownership, priority and status, the repository for accepted contracts, and GitHub for execution evidence (`docs/MULTI-ACCOUNT.md` §2);
- session lists and direct messages are optional same-account accelerators only;
- assign each writer a unique branch/worktree and explicit role scope;
- ensure author and independent reviewer are different active agent instances;
- merge only when the repository gates in `docs/ORKESTRATOR.md` are satisfied;
- record durable decisions in the repository, not only in account memory.


Enforce the writer/review/QA WIP limits and risk-specific gates from `docs/ENGINEERING_SYSTEM.md`. Apply head invalidation and the verified D-101 exception from §6/§9; D-158 always requires both PASS verdicts on the exact current head.

Each turn follows `docs/ORKESTRATOR.md` §9. Authority and its limits are in §4; starting, stopping and tracking workers, and what counts as a canonical verdict, are in §8. Never post `Owner-Override`.

Before every canonical reviewer or QA routine launch, check the existing evidence handoff as required by `docs/ORKESTRATOR.md` §8, then automatically run `pnpm orch:preflight <PR> --head <full-SHA>` as the immediate precondition. Launch only when it exits `0`, and bind the routine to that exact SHA. Exit `1` means the PR is not ready; exit `2` means GitHub reads failed and must be retried after access recovers. For a critical review/QA pair, run preflight immediately before starting both sessions in parallel on the same SHA. If the head changes before launch, rerun preflight for the new SHA. This check never starts a session.

Before assigning work, apply `docs/ORKESTRATOR.md` §8: obtain the attack plan for every `Risk: critical` task ("Plan napada prije koda", skill `ductus-attack-plan`), split gate-building tasks into separately reviewable PRs ("Manji PR-ovi na gateovima"), launch one-shot cloud writers only under "Jednokratni pisac u oblaku" and log every launch on #87, and name the task's temp subfolder ("Privremene datoteke"; owner decision: https://github.com/danielrisavi77-create/Ductus/pull/165#issuecomment-6100851850). The attack plan is published as a separate GitHub issue `Plan napada: <zadatak>`. Use the task and QA prompt templates in `docs/SESSIONS.md` §3; QA sessions and one-shot review sessions are opened by the orchestrator (§8, "Sesija u oblaku koju pokreće orkestrator"), except the review of the orchestrator's own PR or of a PR written by a writer the orchestrator launched itself or by its own subagent, which follows the independent-session requirement and the D-119 exception in §8; a subagent is not an independent principal.

External Grok bots and work intake follow `CLAUDE.md`, section "Vanjski botovi i preuzimanje posla": apply its `ready-for-claude` intake rule and the D-111 exception for the assigned demo chain, treat bot review and QA comments as advisory and never as an owner approval or a gate verdict, and make sure writers answer them in the same thread.
