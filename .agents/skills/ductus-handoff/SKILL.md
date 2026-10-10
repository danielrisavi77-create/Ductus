---
name: ductus-handoff
description: Write the handoff for a Ductus session that is being rotated or has passed its context budget, so a fresh session or another account can continue from GitHub and the repo alone.
---

Use when the context-budget notice appears, when a logical unit of work is done, or when the user asks to rotate. Rules: `docs/SESSIONS.md` §4 and `docs/MULTI-ACCOUNT.md` §9–§10.

1. Finish or cleanly stop the step in progress. Commit work that passes the checks; never leave uncommitted changes as the only copy.
2. Write the handoff where the next session will look, not in chat:
   - open PR → update the `IZVJEŠTAJ` block in the PR body;
   - no PR yet → comment on the Linear issue (or a GitHub `IZVJEŠTAJ <id>` issue).
3. The handoff contains only what cannot be read from the diff:
   - branch, worktree path and head SHA;
   - what is done, what is in progress, the exact next action;
   - checks run and their result on that SHA;
   - open questions, and anything waiting on Daniel.
4. Tell the user in two lines: where the handoff is, and the one-line prompt for the fresh session (`ZADATAK <id>` plus the PR or issue link).
5. Stop. Do not start new work in the old session.

Do not summarise the conversation, restate canonical documents, or paste logs.
