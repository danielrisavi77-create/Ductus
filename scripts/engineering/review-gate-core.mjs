const RISK_VALUES = new Set(["low", "standard", "critical"]);
const AGENT_RE = /^(claude|codex|chatgpt):[A-Za-z0-9_-]+:(orchestrator|platforma|backend|frontend|reviewer|qa|bug-hunter|product-ux|short)$/;
const SHA_RE = /^[0-9a-f]{40}$/i;
const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^\$\{\}()|[\]\\]/g, "\\$&");
}

export function field(body, name) {
  if (!body) return null;
  const re = new RegExp(`^${escapeRegExp(name)}:\\s*(.+?)\\s*$`, "mi");
  const match = body.match(re);
  return match?.[1]?.trim() ?? null;
}

function isAgent(value, role) {
  if (!value || !AGENT_RE.test(value)) return false;
  if (!role) return true;
  return value.endsWith(`:${role}`);
}

function sameHead(value, headSha) {
  return Boolean(value && SHA_RE.test(value) && value.toLowerCase() === headSha.toLowerCase());
}

function trustedEntries(items) {
  return (items ?? [])
    .filter((item) => TRUSTED_ASSOCIATIONS.has(item?.author_association))
    .map((item) => ({
      body: item?.body ?? "",
      login: item?.user?.login ?? null,
      association: item?.author_association ?? null,
    }))
    .filter((entry) => entry.body);
}

function findOwnerOverride(entries, headSha, ownerLogin) {
  return entries.some(({ body, login, association }) =>
    association === "OWNER" &&
    login === ownerLogin &&
    field(body, "Owner-Override")?.toUpperCase() === "PASS" &&
    sameHead(field(body, "Override-Head"), headSha) &&
    Boolean(field(body, "Override-Reason")),
  );
}

function validReviews(entries, authorAgent, headSha) {
  return entries
    .map(({ body }) => ({
      body,
      agent: field(body, "Agent-Review"),
      head: field(body, "Review-Head"),
      verdict: field(body, "Review-Verdict"),
    }))
    .filter(
      ({ agent, head, verdict }) =>
        isAgent(agent, "reviewer") &&
        agent !== authorAgent &&
        sameHead(head, headSha) &&
        verdict?.toUpperCase() === "PASS",
    );
}

function validQa(entries, authorAgent, reviewerAgents, headSha) {
  return entries
    .map(({ body }) => ({
      body,
      agent: field(body, "QA-Agent"),
      head: field(body, "QA-Head"),
      verdict: field(body, "QA-Verdict"),
      scope: field(body, "QA-Scope"),
    }))
    .filter(
      ({ agent, head, verdict, scope }) =>
        isAgent(agent, "qa") &&
        agent !== authorAgent &&
        !reviewerAgents.has(agent) &&
        sameHead(head, headSha) &&
        verdict?.toUpperCase() === "PASS" &&
        Boolean(scope),
    );
}

export function evaluateGate({ body, headSha, ownerLogin, comments = [], reviews = [] }) {
  const authorAgent = field(body, "Agent");
  const risk = field(body, "Risk")?.toLowerCase() ?? null;
  const task = field(body, "Task");

  if (!isAgent(authorAgent)) {
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

  const trusted = [...trustedEntries(comments), ...trustedEntries(reviews)];

  if (findOwnerOverride(trusted, headSha, ownerLogin)) {
    return { state: "success", description: `Owner override recorded for ${risk} risk.` };
  }

  const reviewPasses = validReviews(trusted, authorAgent, headSha);
  if (reviewPasses.length === 0) {
    return { state: "pending", description: "Waiting for independent review on current head." };
  }

  if (risk === "critical") {
    const reviewerAgents = new Set(reviewPasses.map((entry) => entry.agent));
    const qaPasses = validQa(trusted, authorAgent, reviewerAgents, headSha);
    if (qaPasses.length === 0) {
      return { state: "pending", description: "Critical PR: waiting for independent QA PASS." };
    }
  }

  return {
    state: "success",
    description: risk === "critical"
      ? "Independent review and QA are valid for current head."
      : "Independent review is valid for current head.",
  };
}
