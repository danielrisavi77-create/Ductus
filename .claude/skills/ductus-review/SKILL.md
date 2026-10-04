---
name: ductus-review
description: Independently review a Ductus pull request without changing the reviewed branch.
---

Operate in **review** mode. Do not edit the reviewed branch.

Read `CLAUDE.md`, relevant `STATE.md` context, `docs/PRODUCT.md` §5, relevant `docs/BACKEND.md` sections, `docs/DECISIONS.md`, and the PR diff.

Prioritize hard-rule violations, correctness and security, product rules, missing tests, then scope. Use the finding format defined in `.agents/skills/ductus-review/SKILL.md` and finish with the total count or `Bez nalaza.`
