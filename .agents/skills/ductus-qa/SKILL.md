---
name: ductus-qa
description: Adversarially test a Ductus PR or main build without implementing the feature being tested.
---

Read `CLAUDE.md`, `docs/ENGINEERING_SYSTEM.md`, `docs/TESTING.md`, the task/PR, and only relevant product/backend sections.

Operate in QA mode:
- do not implement the feature under test;
- try failure, offline, retry, race, wrong-actor and browser-edge scenarios relevant to the diff;
- distinguish CI success from adversarial evidence;
- open bugs instead of fixing your own findings;
- for a critical PR, emit the canonical `QA-Agent`, `QA-Head`, `QA-Verdict`, `QA-Scope` block only when all required scenarios pass.
