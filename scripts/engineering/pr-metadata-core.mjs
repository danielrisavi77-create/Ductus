import { field } from "./metadata-parser.mjs";
import { D97_MANUAL_PATHS, D97_PATHS, matchesPath, normalizePath } from "./protected-paths.mjs";

const RISK_RANK = { low: 0, standard: 1, critical: 2 };
const AGENT_RE =
  /^(claude|codex|chatgpt|grok):[A-Za-z0-9_-]+:(orchestrator|platforma|backend|frontend|reviewer|qa|bug-hunter|product-ux|short)$/;

// Critical floor by path: who may write, review, merge or bypass a check
// (every D-97 path), text loaded into every session, safety rules, scanner
// exceptions, database roles and migrations, the actor boundary, and tests.
// A test under tests/ can be the only enforcement of a guard, so the whole
// directory and its runner configuration carry the floor of the guards.
export const CRITICAL_PATHS = [
  ...D97_PATHS,
  "docs/PRODUCT.md",
  "STATE.md",
  ".worktreeinclude",
  "osv-scanner.toml",
  "vitest.config.ts",
  ".cc-safety-net/",
  "plugins/",
  "scripts/forbidden-terms/",
  "db/migrations/",
  "db/local/",
  "db/tests/",
  "src/server/db/",
  "tests/",
];

function criticalReason(filename) {
  if (matchesPath(filename, CRITICAL_PATHS)) return "governance/trust-critical path";

  if (
    /^(src|app)\//.test(filename) &&
    /(?:^|\/)(?:identity|auth|authz|oidc|login|evidence|ingest|submission|submissions|retention|crypto|signing|forensics|session|jcs|signature|replay)(?:\/|[-_.])/.test(
      filename,
    )
  ) {
    return "trust-critical runtime path";
  }

  if (filename === "middleware.ts" || filename === "src/middleware.ts") {
    return "trust-critical request boundary";
  }

  return null;
}

function standardReason(filename) {
  if (matchesPath(filename, D97_MANUAL_PATHS)) return "decision record, D-97 by content";
  if (
    /^(src|app|db|infra|e2e|scripts)\//.test(filename) ||
    /^(package\.json|pnpm-lock\.yaml|compose\.yaml|eslint\.config\.mjs|next\.config\.ts|playwright\.config\.ts|tsconfig\.json)$/.test(
      filename,
    )
  ) {
    return "executable/runtime/config path";
  }
  return null;
}

/** Floor from the changed paths. Separators, a leading "./" and letter case do not matter. */
export function minimumRisk(files) {
  let rank = 0;
  const reasons = [];
  const labels = new Set();

  for (const original of files) {
    const filename = normalizePath(original).toLowerCase();
    const critical = criticalReason(filename);
    const reason = critical ?? standardReason(filename);
    if (!reason) continue;
    rank = Math.max(rank, critical ? 2 : 1);
    reasons.push(`${original}: ${reason}`);
    labels.add(reason);
  }

  const risk = Object.entries(RISK_RANK).find(([, value]) => value === rank)?.[0] ?? "low";
  return { risk, reasons, labels: [...labels] };
}

export function evaluateMetadata({ body, files }) {
  const agent = field(body, "Agent");
  const risk = field(body, "Risk")?.toLowerCase() ?? null;
  const task = field(body, "Task");

  if (!agent || !AGENT_RE.test(agent)) {
    return { ok: false, message: "Missing or invalid Agent metadata." };
  }
  if (!risk || !(risk in RISK_RANK)) {
    return { ok: false, message: "Risk must be low, standard, or critical." };
  }
  if (!task) {
    return { ok: false, message: "Missing Task metadata." };
  }

  const minimum = minimumRisk(files);
  if (RISK_RANK[risk] < RISK_RANK[minimum.risk]) {
    // Fixed labels only: the message becomes a commit status, so it carries no file name.
    return {
      ok: false,
      message: `Declared Risk ${risk} is below minimum ${minimum.risk} (${minimum.labels.join("; ")}).`,
      reasons: minimum.reasons,
    };
  }

  return { ok: true, agent, risk, task, minimumRisk: minimum.risk };
}
