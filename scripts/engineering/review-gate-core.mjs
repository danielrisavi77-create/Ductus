import { canonicalBlock, field } from "./metadata-parser.mjs";

const RISK_VALUES = new Set(["low", "standard", "critical"]);
const AGENT_RE =
  /^(claude|codex|chatgpt|grok):[A-Za-z0-9_-]+:(orchestrator|platforma|backend|frontend|reviewer|qa|bug-hunter|product-ux|short)$/;
const SHA_RE = /^[0-9a-f]{40}$/i;
const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const VERDICTS = new Set(["PASS", "FAIL", "BLOCK"]);

const CODEX_APP_SLUG = "chatgpt-codex-connector";
const CODEX_BOT_LOGINS = new Set([
  "chatgpt-codex-connector",
  "chatgpt-codex-connector[bot]",
]);
const CODEX_NO_MAJOR_ISSUES = /Codex Review:\s*Didn't find any major issues/i;
const CODEX_REVIEW_MARKER = /(?:Codex Review|💡 Codex Review)/i;
const CODEX_REVIEWED_COMMIT = /Reviewed commit:\s*`([0-9a-f]{7,40})`/i;

export const APP_RUNTIMES = new Map([
  ["claude", new Set(["claude"])],
  ["chatgpt-codex-connector", new Set(["chatgpt", "codex"])],
  ["grok-by-xai", new Set(["grok"])],
]);

// Provider identities are trusted only after their actual GitHub App slug is
// observed and explicitly registered above. Grok was verified as "grok-by-xai".

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

function codexIdentity(entry) {
  const login = entry?.user?.login ?? entry?.login ?? null;
  const appSlug = entry?.performed_via_github_app?.slug ?? entry?.appSlug ?? null;
  return appSlug === CODEX_APP_SLUG || CODEX_BOT_LOGINS.has(login);
}

function codexEntryMatchesHead(entry, headSha) {
  const commitId = entry?.commit_id ?? entry?.commitId ?? null;
  if (commitId && SHA_RE.test(commitId)) return sameHead(commitId, headSha);

  const body = entry?.body ?? "";
  const match = body.match(CODEX_REVIEWED_COMMIT);
  if (!match) return false;
  const reviewed = match[1].toLowerCase();
  return headSha.toLowerCase().startsWith(reviewed);
}

function nativeCodexReviewSignal({
  comments = [],
  reviews = [],
  reviewComments = [],
  headSha,
}) {
  const currentComments = comments.filter(
    (entry) => codexIdentity(entry) && codexEntryMatchesHead(entry, headSha),
  );
  const currentReviews = reviews.filter(
    (entry) => codexIdentity(entry) && codexEntryMatchesHead(entry, headSha),
  );
  const currentInline = reviewComments.filter(
    (entry) => codexIdentity(entry) && codexEntryMatchesHead(entry, headSha),
  );

  const hasFindings =
    currentInline.length > 0 ||
    [...currentComments, ...currentReviews].some(({ body = "" }) =>
      CODEX_REVIEW_MARKER.test(body) && !CODEX_NO_MAJOR_ISSUES.test(body),
    );

  if (hasFindings) return "findings";

  const hasPass = [...currentComments, ...currentReviews].some(({ body = "" }) =>
    CODEX_NO_MAJOR_ISSUES.test(body),
  );
  return hasPass ? "pass" : null;
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
  reviews = [],
  reviewComments = [],
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
  const nativeCodex = nativeCodexReviewSignal({
    comments,
    reviews,
    reviewComments,
    headSha,
  });

  if (findOwnerOverride(trusted, headSha, ownerLogin)) {
    return { state: "success", description: `Owner override recorded for ${risk} risk.` };
  }

  const reviewVerdicts = latestVerdicts(trusted, {
    agentField: "Agent-Review",
    headField: "Review-Head",
    verdictField: "Review-Verdict",
    role: "reviewer",
    headSha,
  });

  for (const [, review] of reviewVerdicts) {
    if (review.identity.principal === authorPrincipal) continue;
    if (review.verdict === "FAIL" || review.verdict === "BLOCK") {
      return {
        state: "pending",
        description: `Independent review ${review.verdict.toLowerCase()} on current head.`,
      };
    }
  }

  const passingReviews = [...reviewVerdicts.values()].filter(
    (review) =>
      review.identity.principal !== authorPrincipal &&
      review.verdict === "PASS",
  );

  if (nativeCodex === "findings") {
    return {
      state: "pending",
      description: "Codex review has current-head findings.",
    };
  }

  if (
    nativeCodex === "pass" &&
    authorRuntime !== "codex" &&
    authorRuntime !== "chatgpt"
  ) {
    passingReviews.push({
      agent: "codex:github-code-review:reviewer",
      verdict: "PASS",
      identity: {
        appSlug: CODEX_APP_SLUG,
        runtime: "codex",
        principal: "openai:github-code-review",
      },
    });
  }

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

    const qaPass = [...qa.values()].some(
      (result) =>
        result.identity.principal !== authorPrincipal &&
        !passingReviewerApps.has(result.identity.appSlug) &&
        result.verdict === "PASS",
    );

    if (!qaPass) {
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
