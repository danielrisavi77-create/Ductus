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


Before opening or updating the PR, include the Engineering System metadata:

```
Agent: <runtime>:<slot>:<role>
Risk: <low|standard|critical>
Task: <task id>
```

Use the risk classification in `docs/ENGINEERING_SYSTEM.md`; do not downgrade trust-boundary changes to reduce review work.

Before handoff, run the checklist skill that matches the diff: `ductus-new-table`, `ductus-ui-copy`, `ductus-ci-change`, `ductus-sync-states`, `ductus-rules-change`, `ductus-synthetic-data`, `ductus-local-storage-logout`, `ductus-offline-recovery`. They add no rules; the cited documents govern.

When fixing review or QA findings on an open PR:
- for an accepted finding that changes behavior, add or adjust a test that fails without the fix (`AGENTS.md` review item 4); never delete, skip or quarantine a test to get green (`CLAUDE.md`);
- do not force a fix for a finding you disagree with: reject it with a reason in the `Review:` field (`docs/SESSIONS.md` §2 step 5 and §3);
- refetch `main`, check real overlap and refresh the branch if `main` changed a file the PR touches; a stacked PR states its dependency (`docs/ENGINEERING_SYSTEM.md` §9);
- stage with `git add <paths>` and rerun `pnpm lint`, `pnpm typecheck`, `pnpm test` (`CLAUDE.md`; `docs/SESSIONS.md` §2 step 3);
- after the push, confirm the head on origin equals the local head (`pnpm orch:push`, i.e. `scripts/orchestrator/push-verify.mjs`); every push invalidates earlier review and QA (`docs/ENGINEERING_SYSTEM.md` §6 and §9);
- update the `IZVJEŠTAJ` in the PR description with the new head and an answer to every finding (`docs/SESSIONS.md` §3);
- never publish `Agent-Review`, `QA-Agent` or `Owner-Override`, and never merge (`docs/ENGINEERING_SYSTEM.md` §3 and §7; `docs/SESSIONS.md` §2 step 7).
