---
name: ductus-handoff
description: Write the handoff for a Ductus session that is being rotated or has passed its context budget, so a fresh session or another account can continue from GitHub and the repo alone.
---

Use when the context-budget notice appears, when a logical unit of work is done, or when the user asks to rotate. Rules: `docs/SESSIONS.md` §4 and §4a, `docs/ORKESTRATOR.md` §7, `docs/MULTI-ACCOUNT.md` §9–§10.

1. Finish or cleanly stop the step in progress. Commit work that passes the checks; never leave uncommitted changes as the only copy.
2. Write the handoff where the next session of your role will look, not in chat:
   - Worker (Backend, Frontend, Platform, short-lived) → the `IZVJEŠTAJ` block in the body of your own PR; with no PR yet, a comment on your Linear issue (or a GitHub `IZVJEŠTAJ <id>` issue). The `Trag rada` comment after each push (`docs/SESSIONS.md` §3) does not replace it; for a one-shot cloud writer, which cannot send messages, it is the only signal.
   - Reviewer, QA, Bug Hunter and other control roles → your own comment on the PR or issue you are checking; never edit the PR body or the `IZVJEŠTAJ` block of another author, and never post a verdict as a handoff.
   - Orchestrator → not rotated: the board and a comment on the coordination issue (`docs/ORKESTRATOR.md` §7 and §8); `STATE.md` only through its own PR.
3. The handoff contains only what cannot be read from the diff:
   - branch, worktree path and head SHA;
   - what is done, what is in progress, the exact next action;
   - checks run and their result on that SHA;
   - open questions, and anything waiting on Daniel.
4. Worker and control roles: tell the user in two lines where the handoff is and the one-line prompt for the fresh session (`ZADATAK <id>` plus the PR or issue link), then stop. Do not start new work in the old session.
5. Orchestrator: do not stop and do not ask for a fresh session. After the handoff, compact the context (yourself if the runtime allows it, otherwise ask Daniel) and continue the loop.

If you cannot tell which role this session has, ask the user before writing anywhere.

Do not summarise the conversation, restate canonical documents, or paste logs.
