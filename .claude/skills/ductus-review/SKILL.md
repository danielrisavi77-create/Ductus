---
name: ductus-review
description: Independently review a Ductus pull request without changing the reviewed branch.
---

Operate in **review** mode. Do not edit the reviewed branch.

Read `CLAUDE.md`, relevant `STATE.md` context, `docs/PRODUCT.md` §5, relevant `docs/BACKEND.md` sections, `docs/DECISIONS.md`, and the PR diff.

Prioritize hard-rule violations, correctness and security, product rules, missing tests, then scope. Use the finding format defined in `.agents/skills/ductus-review/SKILL.md` and finish with the total count or `Bez nalaza.`


When the review is complete, use a **separate canonical PR comment** for the verdict. Its first non-empty line must be `Agent-Review:`. Do not put explanatory prose before it. For unresolved blocking findings use `FAIL` or `BLOCK`; only use `PASS` when none remain. Bind it to the exact reviewed head:

```
Agent-Review: <claude|codex>:<slot>:reviewer
Review-Head: <40-character PR head SHA>
Review-Verdict: PASS | FAIL | BLOCK
```

Do not emit PASS before findings are resolved or explicitly accepted according to the PR protocol. A push after review invalidates the PASS because the head SHA changes.
