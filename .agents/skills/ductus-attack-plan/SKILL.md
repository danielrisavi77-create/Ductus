---
name: ductus-attack-plan
description: Write the attack plan for a Ductus critical or gate task before any code exists - attacks, edge cases and negative tests as test requirements, published as one issue comment.
---

Rules: `docs/ORKESTRATOR.md` §8 ("Plan napada prije koda", "Manji PR-ovi na gateovima"), `docs/ENGINEERING_SYSTEM.md` §6, `docs/SESSIONS.md` §3. Read only the task issue and the canonical sections it names, plus `docs/PRODUCT.md` §5 and `docs/TESTING.md` where relevant.

1. List attacks, edge cases and negative tests for the task. For each item give:
   - the scenario, on invented data only (`CLAUDE.md`: no real student work or personal data);
   - the expected outcome;
   - the source in the canonical documents (file and section).
2. Write test requirements, not a solution: no design, no code, no patch.
3. Publish the plan as **one** comment on the task's GitHub issue titled `Plan napada: <zadatak>`. Do not change the repository.
4. An open product question found while planning goes to Daniel before work starts (`docs/ORKESTRATOR.md` §4a); do not answer it yourself.
5. Having written the plan, give no review or QA verdict on that task's PR (`docs/ENGINEERING_SYSTEM.md` §6).
