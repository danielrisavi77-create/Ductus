import { canonicalBlock, field } from "./metadata-parser.mjs";

const RISK_VALUES = new Set(["low", "standard", "critical"]);
const AGENT_RE =
  /^(claude|codex|chatgpt|grok):[A-Za-z0-9_-]+:(orchestrator|platforma|backend|frontend|reviewer|qa|bug-hunter|product-ux|short)$/;
const SHA_RE = /^[0-9a-f]{40}$/i;
const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const VERDICTS = new Set(["PASS", "FAIL", "BLOCK"]);

export const APP_RUNTIMES = new Map([
  ["claude", new Set(["claude"])],
  ["chatgpt-codex-connector", new Set(["chatgpt", "codex"])],
  ["grok-by-xai", new Set(["grok"])],
]);

// Provider identities are trusted only after their actual GitHub App slug is
// observed and explicitly registered above. Grok was verified as "grok-by-xai".

// Quota exhaustion is accepted only from the provider's own App, with a
// message observed on a real PR. Never guess a pattern for other providers.
export const QUOTA_EXHAUSTED_PATTERNS = new Map([
  ["chatgpt-codex-connector", /reached your Codex usage limits/i],
]);

export const QUOTA_FALLBACK_WINDOW_MS = 24 * 60 * 60 * 1000;

function isAgent(value, role) {
  if (!value || !AGENT_RE.test(value)) return false;
  if (!role) return true;
  return value.endsWith(`:${role}`);
}

function declaredRuntime(agent) {
  if (!agent || !AGENT_RE.test(agent)) return null;
  return agent.split(":")[0];
}

function principalRuntime(runtime) {
  return runtime === "codex" || runtime === "chatgpt" ? "openai" : runtime;
}

function declaredPrincipal(agent) {
  if (!agent || !AGENT_RE.test(agent)) return null;
  const [runtime, slot] = agent.split(":");
  return `${principalRuntime(runtime)}:${slot}`;
}

export function verifiedCommentIdentity(entry, declaredAgent) {
  const slug = entry?.appSlug ?? null;
  const runtime = declaredRuntime(declaredAgent);
  if (!slug || !runtime) return null;
  const allowedRuntimes = APP_RUNTIMES.get(slug);
  if (!allowedRuntimes?.has(runtime)) return null;
  return {
    appSlug: slug,
    runtime,
    principal: declaredPrincipal(declaredAgent),
  };
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

function quotaEvidence(items) {
  return (items ?? [])
    .map((item, index) => {
      const slug = item?.performed_via_github_app?.slug ?? null;
      const pattern = slug ? QUOTA_EXHAUSTED_PATTERNS.get(slug) : null;
      if (
        !pattern ||
        item?.user?.type !== "Bot" ||
        item?.user?.login !== `${slug}[bot]` ||
        !pattern.test(item?.body ?? "")
      ) {
        return null;
      }
      return { appSlug: slug, createdAt: Date.parse(item?.created_at ?? "") || index };
    })
    .filter(Boolean);
}

function fallbackSlug(value) {
  return value?.split(/\s+/)[0]?.toLowerCase() ?? null;
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
    const fallback = fallbackSlug(field(entry.body, "Provider-Fallback"));
    const identity = verifiedCommentIdentity(entry, agent);

    if (
      !isAgent(agent, role) ||
      !identity ||
      !identity.principal ||
      !sameHead(head, headSha) ||
      !verdict ||
      !VERDICTS.has(verdict) ||
      (extraField && !extra)
    ) {
      continue;
    }

    const key = `${identity.appSlug}|${identity.principal}`;
    const previous = latest.get(key);
    const order = [entry.createdAt, entry.index];
    if (
      !previous ||
      order[0] > previous.order[0] ||
      (order[0] === previous.order[0] && order[1] > previous.order[1])
    ) {
      latest.set(key, { agent, verdict, extra, fallback, identity, order });
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
  const authorPrincipal = declaredPrincipal(authorAgent);
  const risk = field(body, "Risk")?.toLowerCase() ?? null;
  const task = field(body, "Task");

  if (!authorRuntime || !authorPrincipal) {
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
    if (review.identity.principal === authorPrincipal) continue;
    if (review.verdict === "FAIL" || review.verdict === "BLOCK") {
      return {
        state: "pending",
        description: `Independent review ${review.verdict.toLowerCase()} on current head.`,
      };
    }
  }

  const passingReviews = [...reviews.values()].filter(
    (review) =>
      review.identity.principal !== authorPrincipal &&
      review.verdict === "PASS",
  );

  if (passingReviews.length === 0) {
    return { state: "pending", description: "Waiting for independently authenticated review." };
  }

  const passingReviewerApps = new Set(
    passingReviews.map((review) => review.identity.appSlug),
  );

  if (risk === "critical") {
    const qa = latestVerdicts(trusted, {
      agentField: "QA-Agent",
      headField: "QA-Head",
      verdictField: "QA-Verdict",
      role: "qa",
      headSha,
      extraField: "QA-Scope",
    });

    for (const [, result] of qa) {
      if (result.identity.principal === authorPrincipal) continue;
      if (result.verdict === "FAIL" || result.verdict === "BLOCK") {
        return {
          state: "pending",
          description: `Independent QA ${result.verdict.toLowerCase()} on current head.`,
        };
      }
    }

    const qaPasses = [...qa.values()].filter(
      (result) =>
        result.identity.principal !== authorPrincipal &&
        result.verdict === "PASS",
    );
    const separateAppPass = qaPasses.some(
      (result) => !passingReviewerApps.has(result.identity.appSlug),
    );

    // Quota fallback: while another registered App proves on this PR that its
    // quota is exhausted, QA may come from the reviewer's App, but only from a
    // principal that is neither the author nor any passing reviewer.
    const evidence = quotaEvidence(comments);
    const passingReviewerPrincipals = new Set(
      passingReviews.map((review) => review.identity.principal),
    );
    const fallbackPass = separateAppPass
      ? null
      : qaPasses.find(
          (result) =>
            result.fallback &&
            result.fallback !== result.identity.appSlug &&
            !passingReviewerPrincipals.has(result.identity.principal) &&
            evidence.some(
              (item) =>
                item.appSlug === result.fallback &&
                item.createdAt <= result.order[0] &&
                result.order[0] - item.createdAt <= QUOTA_FALLBACK_WINDOW_MS,
            ),
        );

    if (fallbackPass) {
      return {
        state: "success",
        description: `Independent review and same-App QA valid for current head (quota fallback: ${fallbackPass.fallback}).`,
      };
    }

    if (!separateAppPass) {
      return {
        state: "pending",
        description: "Critical PR: waiting for separately authenticated QA PASS.",
      };
    }
  }

  return {
    state: "success",
    description: risk === "critical"
      ? "Independently authenticated review and QA are valid for current head."
      : "Independently authenticated review is valid for current head.",
  };
}

export { field } from "./metadata-parser.mjs";
