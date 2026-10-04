import { field } from "./metadata-parser.mjs";

const RISK_RANK = { low: 0, standard: 1, critical: 2 };
const AGENT_RE =
  /^(claude|codex|chatgpt):[A-Za-z0-9_-]+:(orchestrator|platforma|backend|frontend|reviewer|qa|bug-hunter|product-ux|short)$/;

function criticalReason(filename) {
  if (
    filename === "CLAUDE.md" ||
    filename === "AGENTS.md" ||
    filename === "docs/PRODUCT.md" ||
    filename === "docs/ENGINEERING_SYSTEM.md" ||
    filename === ".github/CODEOWNERS" ||
    filename.startsWith(".github/workflows/") ||
    filename.startsWith("scripts/engineering/") ||
    filename.startsWith("scripts/forbidden-terms/") ||
    filename.startsWith("db/tests/")
  ) {
    return "governance/trust-critical path";
  }

  if (
    /^db\/migrations\/.*(?:role|session|identity|evidence|submission|retention|auth|rls|policy|grant)/i.test(
      filename,
    )
  ) {
    return "security-sensitive migration";
  }

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
  if (
    /^(src|app|db|infra|e2e)\//.test(filename) ||
    /^\.github\/workflows\//.test(filename) ||
    /^scripts\//.test(filename) ||
    /^(package\.json|pnpm-lock\.yaml|compose\.yaml|eslint\.config\.mjs|next\.config\.ts|playwright\.config\.ts|vitest\.config\.ts|tsconfig\.json|lefthook\.yml)$/.test(
      filename,
    )
  ) {
    return "executable/runtime/config path";
  }
  return null;
}

export function minimumRisk(files) {
  let rank = 0;
  const reasons = [];

  for (const filename of files) {
    const critical = criticalReason(filename);
    if (critical) {
      rank = Math.max(rank, 2);
      reasons.push(`${filename}: ${critical}`);
      continue;
    }

    const standard = standardReason(filename);
    if (standard) {
      rank = Math.max(rank, 1);
      reasons.push(`${filename}: ${standard}`);
    }
  }

  const risk = Object.entries(RISK_RANK).find(([, value]) => value === rank)?.[0] ?? "low";
  return { risk, reasons };
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
    return {
      ok: false,
      message: `Declared Risk ${risk} is below minimum ${minimum.risk}: ${minimum.reasons.join("; ")}`,
    };
  }

  return { ok: true, agent, risk, task, minimumRisk: minimum.risk };
}
