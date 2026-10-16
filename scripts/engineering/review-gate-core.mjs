import { canonicalBlock, field } from "./metadata-parser.mjs";
import { evaluateMetadata } from "./pr-metadata-core.mjs";
import { changedPaths, ownerCommandPaths, qaExemption } from "./protected-paths.mjs";

const RISK_VALUES = new Set(["low", "standard", "critical"]);
const AGENT_RE =
  /^(claude|codex|chatgpt|grok):[A-Za-z0-9_-]+:(orchestrator|platforma|backend|frontend|reviewer|qa|bug-hunter|product-ux|short)$/;
const SHA_RE = /^[0-9a-f]{40}$/i;
const LISTED_ASSOCIATIONS = new Set(["MEMBER", "COLLABORATOR"]);

// Write access alone does not make an account a verdict author: the owner
// always is, a member or collaborator only when its login is listed here.
// Adding a login is a D-97 change; never list a bot or triage account.
export const TRUSTED_VERDICT_LOGINS = Object.freeze([]);
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
// The message must open the comment (#128): every observed one does, and a
// review, code block or reply that quotes the phrase is no evidence.
export const QUOTA_EXHAUSTED_PATTERNS = new Map([
  ["chatgpt-codex-connector", /^\s*You have reached your Codex usage limits/i],
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

// A slot names one principal whatever its letter case (#130): `claude:B` is
// `claude:b`, so the author or a reviewer cannot pass as another party.
function declaredPrincipal(agent) {
  if (!agent || !AGENT_RE.test(agent)) return null;
  const [runtime, slot] = agent.split(":");
  return `${principalRuntime(runtime)}:${slot.toLowerCase()}`;
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

/**
 * True when a comment's author may record a verdict or override: never a bot
 * account, whatever association GitHub reports; the owner; or a listed login.
 * Shared with the orchestrator scripts so they count what the gate counts.
 */
export function trustedAuthor(item, logins = TRUSTED_VERDICT_LOGINS) {
  if (item?.user?.type === "Bot") return false;
  if (item?.author_association === "OWNER") return true;
  const login = item?.user?.login;
  return LISTED_ASSOCIATIONS.has(item?.author_association) && typeof login === "string" && logins.includes(login);
}

// A verdict is a person's comment posted through an App.
function trustedComments(items, logins) {
  return (items ?? [])
    .filter((item) => trustedAuthor(item, logins))
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

// Evidence holds only while the exhausted App shows nothing else (#128): a
// later comment of the same App that is not a quota message, a later edit of
// one (Codex edits one review summary in place), or a later PR review of the
// App proves it works again, whether that came before or after the QA comment.
// GitHub times have one-second resolution, so activity in the same second as
// the quota message also counts as later: the order is unknown, fail closed.
const lastActivity = (item) => {
  const created = Date.parse(item?.created_at ?? "");
  const updated = Date.parse(item?.updated_at ?? "");
  return Number.isNaN(updated) ? created : Math.max(created || 0, updated);
};

function quotaEvidence(items, reviews = []) {
  const appComments = (items ?? [])
    .map((item, index) => {
      const slug = item?.performed_via_github_app?.slug ?? null;
      const pattern = slug ? QUOTA_EXHAUSTED_PATTERNS.get(slug) : null;
      if (!pattern || item?.user?.type !== "Bot" || item?.user?.login !== `${slug}[bot]`) return null;
      const exhausted = pattern.test(item?.body ?? "");
      return {
        appSlug: slug,
        // An unreadable time of other App activity counts as latest: fail closed.
        createdAt: exhausted ? Date.parse(item?.created_at ?? "") || index : lastActivity(item) || Infinity,
        exhausted,
      };
    })
    .filter(Boolean);
  // A PR review carries no App slug, only the App's bot account.
  const appReviews = (reviews ?? [])
    .map((review) => {
      const slug = [...QUOTA_EXHAUSTED_PATTERNS.keys()].find((name) => review?.user?.login === `${name}[bot]`);
      if (!slug || review?.user?.type !== "Bot") return null;
      return { appSlug: slug, createdAt: Date.parse(review?.submitted_at ?? "") || Infinity, exhausted: false };
    })
    .filter(Boolean);
  const activity = [...appComments, ...appReviews];
  return appComments.filter(
    (item) =>
      item.exhausted &&
      !activity.some(
        (other) => other.appSlug === item.appSlug && !other.exhausted && other.createdAt >= item.createdAt,
      ),
  );
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

function compareOrder(a, b) {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] > b[i]) return 1;
    if (a[i] < b[i]) return -1;
  }
  return 0;
}

const NEGATIVE = new Set(["FAIL", "BLOCK"]);

// #231, question 4 (owner delegated 12 Oct 2026; tightened by the owner on
// 16 Oct 2026 after review 6217017710): within one principal, a verdict on the
// current head beats a carried one, so a later PASS on an older head never
// lifts a FAIL or BLOCK on the current head. The one exception is a FAIL or
// BLOCK on a carried head posted later than the current-head verdict: it still
// blocks, so an older PASS never outlives the principal's later objection.
function prevailing({ current, carried }) {
  if (!current) return carried;
  if (!carried) return current;
  const carriedLater = compareOrder(carried.order, current.order) > 0;
  return carriedLater && NEGATIVE.has(carried.verdict) ? carried : current;
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
    const candidate = { agent, head: head.toLowerCase(), verdict, extra, fallback, identity,
      order: [entry.createdAt, entry.index], current: sameHead(head, headSha) };
    // Keep the latest current and the latest carried verdict apart, so a
    // later carried verdict never makes the current one disappear.
    const slots = latest.get(key) ?? { current: null, carried: null };
    const slot = candidate.current ? "current" : "carried";
    if (!slots[slot] || compareOrder(candidate.order, slots[slot].order) > 0) slots[slot] = candidate;
    latest.set(key, slots);
  }

  return new Map([...latest].map(([key, slots]) => [key, prevailing(slots)]));
}

// Names the earlier heads behind a success that counts carried verdicts, so the
// status shows when D-101 decided it.
function carriedNote(counted, headSha) {
  const heads = [...new Set(
    counted
      .map((result) => result.head)
      .filter((head) => !sameHead(head, headSha)),
  )];
  return heads.length === 0 ? "" : ` Carried from ${heads.map((head) => head.slice(0, 7)).join(", ")}.`;
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
  prReviews = [],
  carriedHeads = new Set(),
  trustedLogins = TRUSTED_VERDICT_LOGINS,
  qaExempt = null,
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

  const trusted = trustedComments(comments, trustedLogins);

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

  const qaPasses = [...qa.values()].filter(
    (result) =>
      result.identity.principal !== authorPrincipal &&
      result.verdict === "PASS",
  );

  // ENGINEERING_SYSTEM §5: a critical PR changing only tests or only
  // documents needs no QA PASS. `qaExempt` comes from the changed file list,
  // never from the body; a current QA FAIL or BLOCK above still holds.
  if (risk === "critical" && qaExempt) {
    return {
      state: "success",
      description: `Independently authenticated review is valid for current head (critical, ${qaExempt} only: QA not required).${carriedNote(passingReviews, headSha)}`,
    };
  }

  if (risk === "critical") {
    const separateAppPass = qaPasses.some(
      (result) => !passingReviewerApps.has(result.identity.appSlug),
    );

    // Quota fallback: while another registered App proves on this PR that its
    // quota is exhausted, QA may come from the reviewer's App, but only from a
    // principal that is neither the author nor any passing reviewer.
    const evidence = quotaEvidence(comments, prReviews);
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
        description: `Independent review and same-App QA valid for current head (quota fallback: ${fallbackPass.fallback}).${carriedNote([...passingReviews, fallbackPass], headSha)}`,
      };
    }

    if (!separateAppPass) {
      return {
        state: "pending",
        description: "Critical PR: waiting for separately authenticated QA PASS.",
      };
    }
  }

  const counted = risk === "critical" ? [...passingReviews, ...qaPasses] : passingReviews;
  return {
    state: "success",
    description: (risk === "critical"
      ? "Independently authenticated review and QA are valid for current head."
      : "Independently authenticated review is valid for current head.") + carriedNote(counted, headSha),
  };
}

/**
 * Earlier heads that the runner may test for a carry-over: heads named by
 * trusted canonical review or QA blocks that lie on `path`, the first-parent
 * walk from the current head (newest first, GET commits/{sha} objects), behind
 * merge commits only. A head the walk cannot see would be dropped silently,
 * and with it a FAIL or BLOCK, so an unfinished walk or more than
 * MAX_CARRIED_HEADS such heads carries nothing. The Owner Override never
 * carries.
 */
export function carriedHeadCandidates(comments, headSha, path) {
  const named = new Set();
  for (const entry of trustedComments(comments)) {
    for (const [block, headField] of [["Agent-Review", "Review-Head"], ["QA-Agent", "QA-Head"]]) {
      if (!canonicalBlock(entry.body, block)) continue;
      const head = field(entry.body, headField)?.toLowerCase();
      if (head && SHA_RE.test(head) && head !== headSha.toLowerCase()) named.add(head);
    }
  }
  if (named.size === 0) return { heads: [], reason: null };
  const steps = path ?? [];
  if (!steps.some((commit) => (commit?.parents?.length ?? 0) < 2)) {
    return { heads: [], reason: "first-parent walk did not reach a non-merge commit" };
  }
  const heads = steps
    .map((commit) => commit?.sha?.toLowerCase())
    .filter((sha) => named.has(sha) && onlyBaseMerges(steps, sha));
  if (heads.length > MAX_CARRIED_HEADS) {
    return { heads: [], reason: `more than ${MAX_CARRIED_HEADS} verdict heads behind base merges` };
  }
  return { heads, reason: null };
}

/**
 * `path` is the first-parent walk from the current head, newest first, as
 * GET commits/{sha} objects. It must reach `earlier` through merges of the
 * base branch only: every step before it has exactly two parents (no octopus)
 * and `mergesBase === true`, which the runner sets only after GitHub confirmed
 * that the second parent is contained in the base branch (#231, question 1;
 * D-101 "spajanje osnovne grane"). The merged-in change is judged by
 * `sameChange`.
 */
export function onlyBaseMerges(path, earlier) {
  const target = earlier?.toLowerCase();
  const steps = path ?? [];
  const end = steps.findIndex((commit) => commit?.sha?.toLowerCase() === target);
  return (
    end > 0 &&
    end <= MAX_MERGE_STEPS &&
    steps.slice(0, end).every((commit) => commit?.parents?.length === 2 && commit?.mergesBase === true)
  );
}

function changeKey(file) {
  return JSON.stringify([
    file?.filename ?? null,
    file?.previous_filename ?? null,
    file?.status ?? null,
    file?.patch,
  ]);
}

/**
 * `current` and `earlier` are GET compare/{base}...{head} for the current and
 * the earlier head: the PR's own diff must be identical, file by file. A
 * file without a patch (binary, too large) shows only its head side, so the
 * PR's effect on the base cannot be compared and nothing carries.
 */
export function sameChange(current, earlier) {
  const a = current?.files ?? [];
  const b = earlier?.files ?? [];
  if (a.length === 0 || a.length !== b.length || a.length >= COMPARE_FILE_CAP) return false;
  if ([...a, ...b].some((file) => typeof file?.patch !== "string")) return false;
  const keys = (files) => files.map(changeKey).sort();
  const left = keys(a);
  const right = keys(b);
  return left.every((key, index) => key === right[index]);
}

/**
 * Heads among `candidates` whose PR diff equals `current`. `compareHead(sha)`
 * returns GET compare/{base}...{sha}. All or nothing: if any compare fails,
 * no head carries, so a carryable FAIL is never dropped while a PASS carries.
 */
export async function carriedByCompare(candidates, current, compareHead, log = () => {}) {
  const carried = new Set();
  for (const sha of candidates) {
    let same;
    try {
      same = sameChange(current, await compareHead(sha));
    } catch (error) {
      log(`Carry-over check for ${sha} failed closed, nothing carries: ${error.message}`);
      return new Set();
    }
    log(`Carry-over ${same ? "accepted" : "rejected"}: head ${sha}.`);
    if (same) carried.add(sha);
  }
  return carried;
}

/**
 * Whole decision for one PR from REST data: `pr` (GET pulls/{n}), `files` (its
 * files list), the issue comments and the PR reviews (quota evidence only).
 * Every description is a fixed text.
 */
// The PR an event is about. A workflow_run comes from the unprivileged
// review relay (#128): GitHub lists the PR only for same-repository heads.
export function prNumberFromEvent(event) {
  if (event?.pull_request?.number) return event.pull_request.number;
  if (event?.issue?.pull_request && event.issue.number) return event.issue.number;
  const runPrs = event?.workflow_run?.pull_requests;
  if (Array.isArray(runPrs) && runPrs.length === 1 && Number.isSafeInteger(runPrs[0]?.number)) return runPrs[0].number;
  return null;
}

export function evaluatePullRequest({ pr, files, comments, prReviews, ownerLogin, carriedHeads }) {
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
    result: evaluateGate({
      body: pr.body ?? "",
      headSha: pr.head.sha,
      ownerLogin,
      comments,
      prReviews,
      carriedHeads,
      qaExempt: qaExemption(paths),
    }),
  };
}

export { field } from "./metadata-parser.mjs";
