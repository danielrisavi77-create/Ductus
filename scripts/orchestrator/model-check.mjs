// DAN-695 step 4: pure logic of the model check in `pnpm orch:metrics`. It
// compares the model a canonical PASS declares (Review-Model, QA-Model) with
// the "Model po poslu" table of docs/ORKESTRATOR.md §7. A report, not a gate.
import { field } from "../engineering/metadata-parser.mjs";
import { matchesPath, qaExemption } from "../engineering/protected-paths.mjs";
import { countedVerdicts } from "../engineering/review-gate-core.mjs";

export const OUTCOMES = ["ok", "below", "undeclared", "other", "n/a"];
const RANK = { haiku: 1, sonnet: 2, opus: 3 };
const FULL_SHA = /^[0-9a-f]{40}$/i;
// A line that names no model: counts as undeclared, not as a model outside the table.
const PLACEHOLDER = /^(n\/?a|none|unknown|nepoznat[a-z]*|[-\u2013\u2014?]+)$/;
// The only forms that name one Claude tier: an id (claude-opus-5-5,
// claude-sonnet-5-5[1m], claude-sonnet-4-5-20250929), the old id form
// (claude-3-5-sonnet-20241022) or a name (Opus 5.5, Claude Sonnet). Anything
// else, a tier next to any other word included, is "other" (cxcr1946 (2)).
const ALLOWED_FORMS = [
  /^claude-(opus|sonnet|haiku)(-\d+)+(\[1m\])?$/,
  /^claude(-\d+)+-(opus|sonnet|haiku)(-\d+)*(\[1m\])?$/,
  /^(?:claude )?(opus|sonnet|haiku)(?: \d+(?:\.\d+)*)?$/,
];

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

/**
 * "opus" | "sonnet" | "haiku" from an allowed id or name; "other" for anything
 * else, including two tiers or a tier next to any other word; null when empty
 * or a placeholder such as "n/a" or "-".
 */
export function modelTier(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text || PLACEHOLDER.test(text)) return null;
  for (const form of ALLOWED_FORMS) {
    const match = form.exec(text);
    if (match) return match.slice(1).find((group) => RANK[group]);
  }
  return "other";
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

/**
 * Model line of the newest PASS of `kind` the gate counts on the merged head
 * (review-gate-core countedVerdicts): App or owner CLI channel, never an
 * edited comment, never the author's own principal. While any principal holds
 * a FAIL or BLOCK there, the gate counts no PASS and nothing is read.
 */
export function declaredModel(comments, kind, mergedHead, { ownerLogin = null, authorAgent = null } = {}) {
  const none = { found: false, model: null };
  if (!FULL_SHA.test(mergedHead ?? "")) return none;
  const { negative, passes } = countedVerdicts({ comments, kind, headSha: mergedHead, ownerLogin, authorAgent });
  if (negative || passes.length === 0) return none;
  const newest = passes.reduce((a, b) => (newer(b.order, a.order) ? b : a));
  return { found: true, model: field(newest.body, kind === "review" ? "Review-Model" : "QA-Model") };
}

const newer = (a, b) => a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);

/** {declared, expected, outcome} of one role; n/a without a counted PASS on the merged head. */
export function checkRole(comments, kind, pr, risk, paths, { ownerLogin = null } = {}) {
  const { found, model } = declaredModel(comments, kind, pr.headRefOid, { ownerLogin, authorAgent: field(pr.body, "Agent") });
  const expected = expectedTier(kind, risk, paths);
  return { declared: model, expected, outcome: found ? modelOutcome(model, expected) : "n/a" };
}
