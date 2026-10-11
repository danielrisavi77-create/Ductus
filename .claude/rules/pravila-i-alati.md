---
paths:
  - "CLAUDE.md"
  - "AGENTS.md"
  - "docs/ENGINEERING_SYSTEM.md"
  - "docs/ORKESTRATOR.md"
  - "docs/SESSIONS.md"
  - "docs/MULTI-ACCOUNT.md"
  - "docs/AGENT_SYSTEM_V2.md"
  - "lefthook.yml"
  - ".github/**"
  - "scripts/engineering/**"
  - "scripts/hooks/**"
  - "scripts/orchestrator/**"
  - ".claude/**"
  - ".agents/**"
  - "plugins/ductura-engineering/**"
---

# Područje: pravila rada, gate i alati (D-97)

Podsjetnik, ne pravilo. Pravila su u `docs/ENGINEERING_SYSTEM.md` §5 ("Automatski risk floor") i §10.

- Svaka od ovih putanja znači `Risk: critical` i spajanje samo na vlasnikovu naredbu za točan head.
- Prije predaje prođi skill `ductus-rules-change`; za CI, workflowe i ovisnosti `ductus-ci-change`.
- Skill u `.claude/skills/` ima kopiju u `.agents/skills/` (`docs/MULTI-ACCOUNT.md` §5); kartice u `.claude/uloge/` i ova pravila ostaju tanki adapteri bez novih pravila.
- Nova putanja u `D97_PATHS` traži redak u `.github/CODEOWNERS` i ovdje; to provjeravaju `tests/unit/codeowners.test.ts` i `scripts/engineering/role-cards.test.mjs`.
