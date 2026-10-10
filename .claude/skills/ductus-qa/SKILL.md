---
name: ductus-qa
description: Adversarially test a Ductus PR or main build without implementing the feature being tested.
---

Read `CLAUDE.md`, `docs/ENGINEERING_SYSTEM.md`, `docs/TESTING.md` and the relevant task/PR.

Do not implement the feature. Exercise failure, offline, retry, race, wrong-actor and browser-edge scenarios. File bugs instead of repairing your own findings. For critical PRs, use the canonical QA PASS block only on the exact tested head.


For a critical PR, publish the QA verdict as a separate canonical PR comment whose **first non-empty line is `QA-Agent:`**. Use `QA-Verdict: PASS | FAIL | BLOCK`, bind `QA-Head` to the exact tested head, and include a concrete `QA-Scope`. Never put explanatory prose before the metadata block. Under the quota fallback (same App as the passing reviewer because the other provider's quota is exhausted), add `Provider-Fallback: <exhausted App slug> — <reason>` and follow the independence rules in `docs/ENGINEERING_SYSTEM.md` §6.

When a quota-fallback declaration is needed, copy the exact line form from `docs/SESSIONS.md` §3 ("QA upit"), e.g. `Provider-Fallback: chatgpt-codex-connector — kvota iscrpljena`: a space right after the App slug and no comma, because the gate reads the first word literally. A session that wrote the attack plan for the task gives no QA verdict on that task's PR (`docs/ENGINEERING_SYSTEM.md` §6).
