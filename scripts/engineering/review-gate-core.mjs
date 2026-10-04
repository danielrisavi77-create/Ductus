const RISK_VALUES = new Set(["low", "standard", "critical"]);
const AGENT_RE =
  /^(claude|codex|chatgpt):[A-Za-z0-9_-]+:(orchestrator|platforma|backend|frontend|reviewer|qa|bug-hunter|product-ux|short)$/;
const SHA_RE = /^[0-9a-f]{40}$/i;
const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const VERDICTS = new Set(["PASS", "FAIL", "BLOCK"]);

const APP_RUNTIMES = new Map([
  ["claude", new Set(["claude"])],
  ["chatgpt-codex-connector", new Set(["chatgpt", "codex"])],
]);

export function field(body, name) {
  if (!body) return null;
  const prefix = `${name.toLowerCase()}:`;
  let fence = null;

  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (fence) {
      if (trimmed.startsWith(fence)) fence = null;
      continue;
    }

    if (trimmed.startsWith("```")) {
      fence = "```";
      continue;
    }
    if (trimmed.startsWith("~~~")) {
      fence = "~~~";
      continue;
    }

    if (!trimmed.toLowerCase().startsWith(prefix)) continue;
    return trimmed.slice(prefix.length).trim() || null;
  }
  return null;
}

function firstNonEmptyLine(body) {
  return body
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? "";
}

function canonicalBlock(body, firstField) {
  const first = firstNonEmptyLine(body);
  return first.toLowerCase().startsWith(`${firstField.toLowerCase()}:`);
}

function isAgent(value, role) {
  if (!value || !AGENT_RE.test(value)) return false;
  if (!role) return true;
  return value.endsWith(`:${role}`);
}

function declaredRuntime(agent) {
  if (!agent || !AGENT_RE.test(agent)) return null;
  return agent.split(":")[0];
}

function verifiedCommentIdentity(entry, declaredAgent) {
  const slug = entry?.appSlug ?? null;
  const runtime = declaredRuntime(declaredAgent);
  if (!slug || !runtime) return null;
  const allowedRuntimes = APP_RUNTIMES.get(slug);
  if (!allowedRuntimes?.has(runtime)) return null;
  return { appSlug: slug, runtime };
}

function sameHead(value, headSha) {
  return Boolean(value && SHA_RE.test(value) && value.toLowerCase() === headSha.toLowerCase());
}

function trustedComments(items) {
  return (items ?? [])
    .filter((item) => TRUSTED_ASSOCIATIONS.has(item?.author_association))
    .map((item, index) => ({
      body: item?.body ?? "",
      login: item?.user?.login ?? null,
      association: item?.author_association ?? null,
      appSlug: item?.performed_via_github_app?.slug ?? null,
      createdAt: Date.parse(item?.created_at ?? "") || index,
      index,
    }))
    .filter((entry) => entry.body);
}

function findOwnerOverride(entries, headSha, ownerLogin) {
  return entries.some(({ body, login, association, appSlug }) =>
    canonicalBlock(body, "Owner-Override") &&
    association === "OWNER" &&
    login === ownerLogin &&
    appSlug === null &&
    field(body, "Owner-Override")?.toUpperCase() === "PASS" &&
    sameHead(field(body, "Override-Head"), headSha) &&
    Boolean(field(body, "Override-Reason")),
  );
}

function latestVerdicts(entries, {
  agentField,
  headField,
  verdictField,
  role,
  headSha,
  extraField,
}) {
  const latest = new Map();

  for (const entry of entries) {
    if (!canonicalBlock(entry.body, agentField)) continue;

    const agent = field(entry.body, agentField);
    const head = field(entry.body, headField);
    const verdict = field(entry.body, verdictField)?.toUpperCase() ?? null;
    const extra = extraField ? field(entry.body, extraField) : null;
    const identity = verifiedCommentIdentity(entry, agent);

    if (
      !isAgent(agent, role) ||
      !identity ||
      !sameHead(head, headSha) ||
      !verdict ||
      !VERDICTS.has(verdict) ||
      (extraField && !extra)
    ) {
      continue;
    }

    const key = identity.appSlug;
    const previous = latest.get(key);
    const order = [entry.createdAt, entry.index];
    if (
      !previous ||
      order[0] > previous.order[0] ||
      (order[0] === previous.order[0] && order[1] > previous.order[1])
    ) {
      latest.set(key, { agent, verdict, extra, identity, order });
    }
  }

  return latest;
}

export function evaluateGate({
  body,
  headSha,
  ownerLogin,
  comments = [],
}) {
  const authorAgent = field(body, "Agent");
  const authorRuntime = declaredRuntime(authorAgent);
  const risk = field(body, "Risk")?.toLowerCase() ?? null;
  const task = field(body, "Task");

  if (!authorRuntime) {
    return { state: "failure", description: "Missing or invalid Agent metadata." };
  }
  if (!risk || !RISK_VALUES.has(risk)) {
    return { state: "failure", description: "Risk must be low, standard, or critical." };
  }
  if (!task) {
    return { state: "failure", description: "Missing Task metadata." };
  }
  if (!SHA_RE.test(headSha)) {
    return { state: "failure", description: "Invalid PR head SHA." };
  }
  if (!ownerLogin) {
    return { state: "failure", description: "Missing repository owner identity." };
  }

  const trusted = trustedComments(comments);

  if (findOwnerOverride(trusted, headSha, ownerLogin)) {
    return { state: "success", description: `Owner override recorded for ${risk} risk.` };
  }

  const reviews = latestVerdicts(trusted, {
    agentField: "Agent-Review",
    headField: "Review-Head",
    verdictField: "Review-Verdict",
    role: "reviewer",
    headSha,
  });

  for (const [, review] of reviews) {
    if (review.verdict === "FAIL" || review.verdict === "BLOCK") {
      return {
        state: "pending",
        description: `Independent review ${review.verdict.toLowerCase()} on current head.`,
      };
    }
  }

  const passingReviewerApps = new Set(
    [...reviews.entries()]
      .filter(([, review]) => review.verdict === "PASS")
      .map(([reviewApp]) => reviewApp),
  );

  if (passingReviewerApps.size === 0) {
    return { state: "pending", description: "Waiting for independently authenticated review." };
  }

  if (risk === "critical") {
    const qa = latestVerdicts(trusted, {
      agentField: "QA-Agent",
      headField: "QA-Head",
      verdictField: "QA-Verdict",
      role: "qa",
      headSha,
      extraField: "QA-Scope",
    });

    for (const [qaApp, result] of qa) {
      if (passingReviewerApps.has(qaApp)) {
        continue;
      }
      if (result.verdict === "FAIL" || result.verdict === "BLOCK") {
        return {
          state: "pending",
          description: `Independent QA ${result.verdict.toLowerCase()} on current head.`,
        };
      }
    }

    const qaPass = [...qa.entries()].some(
      ([qaApp, result]) =>
        !passingReviewerApps.has(qaApp) &&
        result.verdict === "PASS",
    );

    if (!qaPass) {
      return { state: "pending", description: "Critical PR: waiting for separately authenticated QA PASS." };
    }
  }

  return {
    state: "success",
    description: risk === "critical"
      ? "Independently authenticated review and QA are valid for current head."
      : "Independently authenticated review is valid for current head.",
  };
}
