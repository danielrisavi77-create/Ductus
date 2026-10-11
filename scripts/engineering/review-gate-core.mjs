import { canonicalBlock, field } from "./metadata-parser.mjs";
import { evaluateMetadata } from "./pr-metadata-core.mjs";
import { changedPaths, ownerCommandPaths } from "./protected-paths.mjs";

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

// D-101: a verdict on an earlier head carries to the current head only when
// every later commit merges the base in and the PR's own diff is unchanged.
export const MAX_CARRIED_HEADS = 5;
export const MAX_MERGE_STEPS = 10;
const COMPARE_FILE_CAP = 300;

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

// A verdict is a person's comment posted through an App; a bot account's own
// comment never counts, whatever association GitHub reports for it.
function trustedComments(items) {
  return (items ?? [])
    .filter((item) => TRUSTED_ASSOCIATIONS.has(item?.author_association) && item?.user?.type !== "Bot")
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
  carriedHeads,
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
      !(sameHead(head, headSha) || carriedHeads.has(head?.toLowerCase())) ||
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

function currentNegative(verdicts) {
  for (const result of verdicts.values()) {
    if (result.verdict === "FAIL" || result.verdict === "BLOCK") return result;
  }
  return null;
}

export function evaluateGate({
  body,
  headSha,
  ownerLogin,
  comments = [],
  carriedHeads = new Set(),
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
    carriedHeads,
  });

  const qa = latestVerdicts(trusted, {
    agentField: "QA-Agent",
    headField: "QA-Head",
    verdictField: "QA-Verdict",
    role: "qa",
    headSha,
    extraField: "QA-Scope",
    carriedHeads,
  });

  // A current FAIL or BLOCK holds the gate whatever the PR body declares. The
  // body is written by the party under review, so the declared author and the
  // declared risk only ever discount a PASS; they never discount a negative
  // verdict, for review and QA alike.
  const negativeReview = currentNegative(reviews);
  if (negativeReview) {
    return {
      state: "pending",
      description: `Independent review ${negativeReview.verdict.toLowerCase()} on current head.`,
    };
  }
  const negativeQa = currentNegative(qa);
  if (negativeQa) {
    return {
      state: "pending",
      description: `Independent QA ${negativeQa.verdict.toLowerCase()} on current head.`,
    };
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

/**
 * Earlier heads named by trusted canonical review or QA blocks, newest first,
 * that the runner may test for a carry-over. The Owner Override never carries.
 */
export function carriedHeadCandidates(comments, headSha) {
  const heads = [];
  for (const entry of trustedComments(comments).sort(
    (a, b) => b.createdAt - a.createdAt || b.index - a.index,
  )) {
    for (const [block, headField] of [["Agent-Review", "Review-Head"], ["QA-Agent", "QA-Head"]]) {
      if (!canonicalBlock(entry.body, block)) continue;
      const head = field(entry.body, headField)?.toLowerCase();
      if (head && SHA_RE.test(head) && head !== headSha.toLowerCase() && !heads.includes(head)) {
        heads.push(head);
      }
    }
    if (heads.length >= MAX_CARRIED_HEADS) break;
  }
  return heads.slice(0, MAX_CARRIED_HEADS);
}

/**
 * `path` is the first-parent walk from the current head, newest first, as
 * GET commits/{sha} objects. It must reach `earlier` through merge commits
 * only; the merged-in side is judged by `sameChange`.
 */
export function onlyBaseMerges(path, earlier) {
  const target = earlier?.toLowerCase();
  const steps = path ?? [];
  const end = steps.findIndex((commit) => commit?.sha?.toLowerCase() === target);
  return (
    end > 0 &&
    end <= MAX_MERGE_STEPS &&
    steps.slice(0, end).every((commit) => (commit?.parents?.length ?? 0) >= 2)
  );
}

function changeKey(file) {
  return JSON.stringify([
    file?.filename ?? null,
    file?.previous_filename ?? null,
    file?.status ?? null,
    file?.patch ?? null,
    typeof file?.patch === "string" ? null : file?.sha ?? null,
  ]);
}

/**
 * `current` and `earlier` are GET compare/{base}...{head} for the current and
 * the earlier head: the PR's own diff must be identical, file by file.
 */
export function sameChange(current, earlier) {
  const a = current?.files ?? [];
  const b = earlier?.files ?? [];
  if (a.length === 0 || a.length !== b.length || a.length >= COMPARE_FILE_CAP) return false;
  const keys = (files) => files.map(changeKey).sort();
  const left = keys(a);
  const right = keys(b);
  return left.every((key, index) => key === right[index]);
}

/**
 * Whole decision for one PR from REST data: `pr` (GET pulls/{n}), `files` (its
 * files list) and the issue comments. Every description is a fixed text.
 */
export function evaluatePullRequest({ pr, files, comments, ownerLogin, carriedHeads }) {
  const listed = files ?? [];
  // The floor is only as good as the list: a cut or unread list fails closed.
  if (!(pr.changed_files <= listed.length)) {
    return { result: { state: "failure", description: "Changed file list is incomplete; the risk floor cannot be computed." } };
  }
  const paths = changedPaths(listed);
  const metadata = evaluateMetadata({ body: pr.body ?? "", files: paths });
  if (!metadata.ok) return { metadata, result: { state: "failure", description: metadata.message } };
  if (pr.auto_merge && ownerCommandPaths(paths).length > 0) {
    return {
      metadata,
      result: {
        state: "pending",
        description: "Auto-merge is enabled on a PR that needs the owner's merge command (D-97); disable auto-merge.",
      },
    };
  }
  return {
    metadata,
    result: evaluateGate({ body: pr.body ?? "", headSha: pr.head.sha, ownerLogin, comments, carriedHeads }),
  };
}

export { field } from "./metadata-parser.mjs";
