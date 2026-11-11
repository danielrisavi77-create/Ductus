// DAN-695 step 4: pure logic of the model check in `pnpm orch:metrics`. It
// compares the model a canonical PASS declares (Review-Model, QA-Model) with
// the "Model po poslu" table of docs/ORKESTRATOR.md §7. A report, not a gate.
import { field } from "../engineering/metadata-parser.mjs";
import { matchesPath, qaExemption } from "../engineering/protected-paths.mjs";
import { parseVerdicts } from "./orchestrator-core.mjs";

export const OUTCOMES = ["ok", "below", "undeclared", "other", "n/a"];
const RANK = { haiku: 1, sonnet: 2, opus: 3 };
const FULL_SHA = /^[0-9a-f]{40}$/i;

// Evidence, authorization, login and sync (.claude/rules/evidencija-i-prijava.md
// and sinkronizacija.md) plus migrations and the server database access.
export const SENSITIVE_PATHS = [
  "src/domain/evidence/", "src/domain/forensics/", "src/adapters/", "src/server/auth/",
  "src/server/http/", "app/api/", "infra/fake-oidc/",
  "src/domain/sync/", "src/domain/serverSync/", "src/editor/", "src/lib/journal/",
  "db/migrations/", "src/server/db/",
];
// Documents that decide the gate or the rules of work: always Opus (§7).
export const RULE_DOC_PATHS = [
  "docs/ENGINEERING_SYSTEM.md", "docs/ORKESTRATOR.md", "docs/SESSIONS.md", "CLAUDE.md",
  ".claude/uloge/", ".claude/skills/", ".agents/skills/",
];

/** "opus" | "sonnet" | "haiku" from an id or a name; "other" for anything else; null when empty. */
export function modelTier(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return null;
  const tiers = new Set([...text.matchAll(/\b(opus|sonnet|haiku)\b/g)].map((m) => m[1]));
  return tiers.size === 1 ? [...tiers][0] : "other";
}

/**
 * Lowest tier the table allows for `role` ("review" | "qa") at `risk` over the
 * changed `paths`; null when the table has no row (QA below critical, other roles).
 * Unknown risk or an empty path list falls to Opus (the rule of doubt).
 */
export function expectedTier(role, risk, paths) {
  const r = String(risk ?? "").toLowerCase();
  const known = ["low", "standard", "critical"].includes(r);
  if (role === "qa" && known && r !== "critical") return null;
  if (role !== "review" && role !== "qa") return null;
  const files = paths ?? [];
  if (!known || files.length === 0 || files.some((f) => matchesPath(f, RULE_DOC_PATHS))) return "opus";
  if (r === "low") return "sonnet";
  if (r === "standard") return files.some((f) => matchesPath(f, SENSITIVE_PATHS)) ? "opus" : "sonnet";
  return qaExemption(files) ? "sonnet" : "opus";
}

/** One of OUTCOMES; a higher model than required is never a deviation. */
export function modelOutcome(declared, expected) {
  if (!expected) return "n/a";
  const tier = modelTier(declared);
  if (tier === null) return "undeclared";
  if (tier === "other") return "other";
  return RANK[tier] < RANK[expected] ? "below" : "ok";
}

/** Model line of the newest trusted canonical PASS of `kind` on the merged head. */
export function declaredModel(comments, kind, mergedHead) {
  const head = FULL_SHA.test(mergedHead ?? "") ? mergedHead.toLowerCase() : null;
  const pass = parseVerdicts(comments, kind)
    .filter((e) => head && e.verdict === "PASS" && e.head?.toLowerCase() === head)
    .at(-1);
  if (!pass) return { found: false, model: null };
  return { found: true, model: field(comments[pass.index].body, kind === "review" ? "Review-Model" : "QA-Model") };
}

/** {declared, expected, outcome} of one role; n/a without a PASS on the merged head. */
export function checkRole(comments, kind, pr, risk, paths) {
  const { found, model } = declaredModel(comments, kind, pr.headRefOid);
  const expected = expectedTier(kind, risk, paths);
  return { declared: model, expected, outcome: found ? modelOutcome(model, expected) : "n/a" };
}
