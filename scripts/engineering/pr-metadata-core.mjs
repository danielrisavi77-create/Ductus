const RISK_RANK = { low: 0, standard: 1, critical: 2 };
const AGENT_RE =
  /^(claude|codex|chatgpt):[A-Za-z0-9_-]+:(orchestrator|platforma|backend|frontend|reviewer|qa|bug-hunter|product-ux|short)$/;

export function field(body, name) {
  if (!body) return null;
  const escaped = name.replace(/[.*+?^\$\{\}()|[\]\\]/g, "\\$&");
  const match = body.match(new RegExp(`^${escaped}:\\s*(.+?)\\s*$`, "mi"));
  return match?.[1]?.trim() ?? null;
}

export function minimumRisk(files) {
  let rank = 0;
  const reasons = [];

  for (const filename of files) {
    const critical =
      /^src\/.*\/(identity|authz|evidence|submission|retention|crypto|signing)(\/|$)/.test(filename) ||
      /^db\/migrations\/.*(role|session|identity|evidence|submission|retention|auth)/i.test(filename) ||
      /^scripts\/forbidden-terms\//.test(filename);

    if (critical) {
      rank = Math.max(rank, 2);
      reasons.push(`${filename}: trust-critical path`);
      continue;
    }

    const standard =
      /^(src|app|db|infra|e2e)\//.test(filename) ||
      /^\.github\/workflows\//.test(filename) ||
      /^scripts\//.test(filename) ||
      /^(package\.json|pnpm-lock\.yaml|compose\.yaml|eslint\.config\.mjs|next\.config\.ts|playwright\.config\.ts|vitest\.config\.ts|tsconfig\.json|lefthook\.yml)$/.test(
        filename,
      );

    if (standard) {
      rank = Math.max(rank, 1);
      reasons.push(`${filename}: executable/runtime/config path`);
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
