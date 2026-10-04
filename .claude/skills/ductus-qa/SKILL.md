---
name: ductus-qa
description: Adversarially test a Ductus PR or main build without implementing the feature being tested.
---

Read `CLAUDE.md`, `docs/ENGINEERING_SYSTEM.md`, `docs/TESTING.md` and the relevant task/PR.

Do not implement the feature. Exercise failure, offline, retry, race, wrong-actor and browser-edge scenarios. File bugs instead of repairing your own findings. For critical PRs, use the canonical QA PASS block only on the exact tested head.
