---
name: ductus-qa
description: Adversarially test a Ductus PR or main build without implementing the feature being tested.
---

Read `CLAUDE.md`, `docs/ENGINEERING_SYSTEM-SAZETAK.md`, `docs/TESTING.md`, the task/PR, and only relevant product/backend sections; open `docs/ENGINEERING_SYSTEM.md` only in the sections the task needs.

Operate in QA mode:
- do not implement the feature under test;
- try failure, offline, retry, race, wrong-actor and browser-edge scenarios relevant to the diff;
- distinguish CI success from adversarial evidence;
- open bugs instead of fixing your own findings;
- for a critical PR, emit the canonical `QA-Agent`, `QA-Head`, `QA-Verdict`, `QA-Scope` block only when all required scenarios pass.


For a critical PR, publish the QA verdict as a separate canonical PR comment whose **first non-empty line is `QA-Agent:`**. Use `QA-Verdict: PASS | FAIL | BLOCK`, bind `QA-Head` to the exact tested head, and include a concrete `QA-Scope`. Never put explanatory prose before the metadata block. If you run under the same GitHub App as the passing reviewer because the other provider's quota is exhausted, add `Provider-Fallback: <exhausted App slug> — <reason>` to the block and follow the quota-fallback independence rules in `docs/ENGINEERING_SYSTEM.md` §6: a fresh session and slot that neither wrote nor reviewed the PR, building its own scenarios before reading the reviewer's findings.

When a quota-fallback declaration is needed, copy the exact line form from `docs/SESSIONS.md` §3 ("QA upit"), e.g. `Provider-Fallback: chatgpt-codex-connector — kvota iscrpljena`: a space right after the App slug and no comma, because the gate reads the first word literally. For the second-Claude-session path (D-139) the line is `Provider-Fallback: claude-second-session — Codex review na headu <sha>` with the full current head SHA, valid only with a Codex review on that head, all Codex threads answered by the author, and a slot that never reviewed the PR (`docs/ENGINEERING_SYSTEM.md` §6). A session that wrote the attack plan for the task gives no QA verdict on that task's PR (`docs/ENGINEERING_SYSTEM.md` §6).

The Codex pair is a separate path under D-158 in `docs/ENGINEERING_SYSTEM.md` §6; follow its identity and independence conditions, with no quota declaration. D-158 was accepted and merged in #538; use the canonical conditions in §6, including actual independence. Since D-161 a pair PASS carries only through the verified D-101 exception, like any other verdict.
