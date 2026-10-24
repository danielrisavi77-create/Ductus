---
name: ductus-token-budget
description: Diagnose Claude Code token/context waste, cache, expensive model routing, logs, and repeated work for a Ductus task. Use when quota is constrained or the user requests token optimization.
---

# Ductus: token budget (diagnostic, no authority)

Use the existing canonical sources: `docs/SESSIONS.md` §4, `docs/ORKESTRATOR.md` §7, and `docs/ENGINEERING_SYSTEM.md` §5 and §16. This skill does not change model/risk, review, QA, merge, hook settings or protected policies.

1. For real local usage, run `pnpm tokens:report --days 10 --json`, which calls the existing `token-report.mjs`. Show fresh input, cache reads/writes, output and the model actually used **separately**. Local transcript counters are not the Max subscription quota, invoice or savings proof. Do not publish transcript bodies or private paths.
2. For a concrete task, use `node scripts/engineering/claude-workflow.mjs context --task DAN-N --sha <40-hex> --file <relevant-path>` to get a verified path/heading index. Read necessary canonical code and rules from the current checkout. For symbol lookup use `locate --symbol <name>`; for a failed local test use `log --file <safe-repo-relative-path>`; for handoff use `handoff --file <report-path>`. Never mistake these summaries for the required executable evidence.
3. `node scripts/engineering/claude-audit.mjs surface`, `duplicates` or `cache --usage <aggregate.json>` identify potentially redundant context. `models --role <role> --risk <risk> --area <area> --model <current>` is an advisory check, not an authorization to downgrade Opus on a critical task. `roi` requires manual session-to-PR mapping and genuine GitHub merge verification; no manufactured attribution.
4. The `statusLine` script is display-only and receives status JSON from Claude Code. It makes no LLM/API calls. The three scripts depend on DAN-275/276/277 being present in the current checkout; if absent, stop and identify the missing dependency instead of fabricating results.
5. Use deterministic local tools first; choose the actual model for the task through the orchestrator's canonical role/risk policy. Preserve all existing independent review/QA checks, and report what was not tested.
