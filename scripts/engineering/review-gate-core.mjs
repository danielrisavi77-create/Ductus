import { canonicalBlock, field, metadataLines } from "./metadata-parser.mjs";
import { evaluateMetadata } from "./pr-metadata-core.mjs";
import { changedPaths, isNewTestExempt, lowReviewExempt, ownerCommandPaths, ownerFreeCritical, qaExemption } from "./protected-paths.mjs";

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

// D-139: a critical QA PASS may come from a second Claude session when Codex
// reviewed the current head, answered every thread and the QA names that head.
const CODEX_BOT_LOGIN = "chatgpt-codex-connector[bot]";
const SECOND_SESSION_RE = /^claude-second-session \u2014 Codex review na headu ([0-9a-fA-F]{40})$/;
const CODEX_REVIEW_STATES = new Set(["COMMENTED", "APPROVED", "CHANGES_REQUESTED"]);

export const QUOTA_FALLBACK_WINDOW_MS = 24 * 60 * 60 * 1000;

// D-101: a verdict on an earlier head carries to the current head only when
// every later commit merges the base in and the PR's own diff is unchanged.
// D-176 (owner, 26 Oct 2026): 20, up from 5 heads and 10 merge
// steps, because main moves faster than a critical PR reaches its merge.
export const MAX_CARRIED_HEADS = 20;
export const MAX_MERGE_STEPS = 20;
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

/**
 * When a comment last said what it says now: its last edit, else its creation
 * (#129). An edit keeps `created_at`, so a comment written early and rewritten
 * later must not count from the early time. NaN when neither time is readable.
 * Shared with the orchestrator scripts so they order what the gate orders.
 */
export function commentTime(item) {
  const created = Date.parse(item?.created_at ?? "");
  const updated = Date.parse(item?.updated_at ?? "");
  if (Number.isNaN(updated)) return created;
  return Number.isNaN(created) ? updated : Math.max(created, updated);
}

// A Grok review run from the owner's Grok CLI (scripts/grok-review.ps1) is
// posted by the owner's own account, not by the App. It counts as the Grok
// provider only when the account is the owner's and the owner writes the line
// `Review-Channel: grok-cli` outside any code block. Sessions that act with the
// owner's token can write that line too, so the gate status says when it was
// used (D-162); the owner can already override the gate, so this adds no
// authority. A Codex review run from the owner's Codex CLI is the same path
// with `Review-Channel: codex-cli` and counts as the Codex App (D-193). A
// comment naming both channels is ambiguous and counts as neither.
const CLI_CHANNELS = new Map([
  ["grok-cli", { app: "grok-by-xai", note: "Grok CLI review (D-162, owner account)." }],
  ["codex-cli", { app: "chatgpt-codex-connector", note: "Codex CLI review (D-193, owner account)." }],
]);
const CLI_LINE_RE = /^Review-Channel:[ \t]*(grok-cli|codex-cli)$/i;

function cliChannel(item, ownerLogin) {
  if (
    !ownerLogin ||
    item?.performed_via_github_app?.slug ||
    item?.author_association !== "OWNER" ||
    item?.user?.login !== ownerLogin ||
    !(canonicalBlock(item?.body, "Agent-Review") || canonicalBlock(item?.body, "QA-Agent"))
  ) {
    return null;
  }
  const named = new Set(
    metadataLines(item?.body ?? "")
      .map((line) => CLI_LINE_RE.exec(line)?.[1]?.toLowerCase())
      .filter(Boolean),
  );
  return named.size === 1 ? [...named][0] : null;
}

function commentAppSlug(item, ownerLogin) {
  const slug = item?.performed_via_github_app?.slug ?? null;
  if (slug) return slug;
  return CLI_CHANNELS.get(cliChannel(item, ownerLogin))?.app ?? null;
}

// A verdict is a person's comment posted through an App.
function trustedComments(items, logins, ownerLogin = null) {
  return (items ?? [])
    .filter((item) => trustedAuthor(item, logins))
    .map((item, index) => ({
      body: item?.body ?? "",
      login: item?.user?.login ?? null,
      association: item?.author_association ?? null,
      appSlug: commentAppSlug(item, ownerLogin),
      cliChannel: cliChannel(item, ownerLogin),
      createdAt: commentTime(item) || index,
      edited: wasEdited(item),
      index,
    }))
    .filter((entry) => entry.body);
}

// F-012: the App a comment was posted through is fixed at creation, while its
// text can be changed later by any session holding the author's token. A
// comment whose last edit is later than its creation therefore never gives a
// PASS; a FAIL or BLOCK still holds, so an edit can only keep a PR waiting.
function wasEdited(item) {
  const created = Date.parse(item?.created_at ?? "");
  const updated = Date.parse(item?.updated_at ?? "");
  // Fails closed: an edit time without a readable creation time is an edit.
  if (Number.isNaN(updated)) return false;
  return Number.isNaN(created) || updated > created;
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

const isCodexBot = (user) => user?.type === "Bot" && user?.login === CODEX_BOT_LOGIN;

function codexReviewedHead(prReviews, headSha) {
  return (prReviews ?? []).some(
    (review) => isCodexBot(review?.user) && sameHead(review?.commit_id, headSha) && CODEX_REVIEW_STATES.has(review?.state),
  );
}

const CODEX_APP_SLUG = "chatgpt-codex-connector";
const CODEX_SUMMARY_MARKER = "<!-- codex-pull-request-review-summary -->";
const CODEX_STATE_RE = /^<!-- codex-pull-request-review-summary -->\s*<!-- codex-review-state:v1 (\{[^\r\n]*?\}) -->/;

// A clean Codex review leaves no pull request review. The Codex App then
// proves it in its edited-in-place summary comment, whose machine state names
// the full reviewed commit. Only the App's own comment counts (bot account and
// App slug, never a human or another App), the commit must be the current head
// in full, and the review must be completed with no unresolved findings. Several
// summaries naming this head must all be clean; one unreadable summary voids
// the whole proof: fail closed. The receipt comment (short sha) is never evidence.
// has_any_findings also counts findings resolved on older heads, so it is not
// required to be false; only unresolved findings on this head void the proof (D-139, 23. 10. 2026).
function codexCleanSummaryOnHead(comments, headSha) {
  const onHead = [];
  for (const item of comments ?? []) {
    if (!isCodexBot(item?.user) || item?.performed_via_github_app?.slug !== CODEX_APP_SLUG) continue;
    const body = typeof item?.body === "string" ? item.body : "";
    if (!body.startsWith(CODEX_SUMMARY_MARKER)) continue;
    let state;
    try {
      state = JSON.parse(CODEX_STATE_RE.exec(body)?.[1] ?? "null");
    } catch {
      return false; // an unreadable Codex summary poisons the whole proof
    }
    const review = state?.code_review;
    // No usable code review commit, or an open security finding, voids the proof too.
    if (!review || typeof review !== "object" || !SHA_RE.test(review.commit_sha ?? "")) return false;
    if (state.security_review?.has_unresolved_findings === true) return false;
    if (sameHead(review.commit_sha, headSha)) onHead.push(review);
  }
  return (
    onHead.length > 0 &&
    onHead.every(
      (review) =>
        review.status === "completed" && review.has_unresolved_findings === false,
    )
  );
}
// A Codex thread is answered once its author replied under the root comment:
// a non-bot account that is the owner or the PR author's login. A list that
// was not read answers nothing: fail closed.
function codexThreadsAnswered(reviewComments, authorLogin) {
  if (!Array.isArray(reviewComments)) return false;
  const byAuthor = (item) =>
    item?.user?.type !== "Bot" &&
    (item?.author_association === "OWNER" || (Boolean(authorLogin) && item?.user?.login === authorLogin));
  const answered = new Set(
    reviewComments.filter((item) => item?.in_reply_to_id && byAuthor(item)).map((item) => item.in_reply_to_id),
  );
  return reviewComments
    .filter((item) => isCodexBot(item?.user) && !item?.in_reply_to_id)
    .every((root) => answered.has(root.id));
}

// Principals that posted any canonical review block on this PR, whatever the
// head or verdict (D-139: the QA session is not a reviewer of the PR).
function reviewerPrincipals(entries) {
  const found = new Set();
  for (const entry of entries) {
    if (!canonicalBlock(entry.body, "Agent-Review")) continue;
    const principal = declaredPrincipal(field(entry.body, "Agent-Review"));
    if (principal) found.add(principal);
  }
  return found;
}

function fallbackSlug(value) {
  return value?.split(/\s+/)[0]?.toLowerCase() ?? null;
}

// The override counts for the current head, or for an earlier head the runner
// confirmed as carried (clean base merges, unchanged PR diff; owner decision
// #87 issuecomment-6242103643). Author checks do not depend on the head.
const validOverrideShape = ({ body, association, appSlug }) =>
  association === "OWNER" &&
  appSlug === null &&
  field(body, "Owner-Override")?.toUpperCase() === "PASS" &&
  Boolean(field(body, "Override-Reason"));

const validCommandShape = ({ body, association, appSlug }) =>
  association === "OWNER" && appSlug === null && field(body, "Owner-Command")?.toLowerCase() === "merge";

function ownerOverrides(entries, headSha, ownerLogin, carriedHeads = new Set()) {
  return entries.filter(({ body, login, association, appSlug }) =>
    canonicalBlock(body, "Owner-Override") &&
    association === "OWNER" &&
    login === ownerLogin &&
    appSlug === null &&
    field(body, "Owner-Override")?.toUpperCase() === "PASS" &&
    (sameHead(field(body, "Override-Head"), headSha) || carriedHeads.has(field(body, "Override-Head")?.toLowerCase())) &&
    Boolean(field(body, "Override-Reason")),
  );
}

function findOwnerOverride(entries, headSha, ownerLogin, carriedHeads) {
  return ownerOverrides(entries, headSha, ownerLogin, carriedHeads).length > 0;
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
    const fallbackLine = field(entry.body, "Provider-Fallback");
    const fallback = fallbackSlug(fallbackLine);
    const identity = verifiedCommentIdentity(entry, agent);

    if (!isAgent(agent, role) || !identity || !identity.principal) continue;

    // F-012: an edited comment of a known principal is that principal's latest
    // word (its time is the edit time, #129), even when the edit left nothing
    // countable: a PASS, an unreadable verdict, a missing field or another
    // head. It then holds the principal on the current head as EDITED, which
    // is neither a PASS nor a FAIL, so an edit never brings back the
    // principal's earlier PASS. An edited FAIL or BLOCK on a counted head
    // keeps its verdict.
    const counted = sameHead(head, headSha) || carriedHeads.has(head?.toLowerCase());
    const readable = counted && Boolean(verdict) && VERDICTS.has(verdict) && !(extraField && !extra);
    const held = entry.edited && !(readable && NEGATIVE.has(verdict));
    if (!readable && !held) continue;

    const key = `${identity.appSlug}|${identity.principal}`;
    const candidate = { agent, head: held ? headSha.toLowerCase() : head.toLowerCase(), verdict: held ? "EDITED" : verdict,
      extra, fallback, fallbackLine, identity, cli: entry.cliChannel != null, order: [entry.createdAt, entry.index],
      current: held || sameHead(head, headSha) };
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

/**
 * Whether the head branch lives in this repository (#971 review). Only an
 * account with write access can push there; a fork, or a head whose repository
 * was deleted (`head.repo` null), never gets a D-189 exemption.
 */
export function sameRepositoryHead(pr) {
  const head = pr?.head?.repo?.full_name;
  return typeof head === "string" && head !== "" && head === pr?.base?.repo?.full_name;
}

/**
 * D-189: which PR skips independent review, for the gate and for "Auto-merge
 * eligible" alike, so the two cannot disagree. "low": Risk low with documents
 * only (lowReviewExempt). "tests": Risk standard or critical that only adds new
 * test files (onlyAddedTests); a low PR with new tests keeps its review, as
 * D-189 (2) names only standard and critical. Never for a head outside this
 * repository. The callers exclude D-97 paths from both.
 */
function reviewExemption({ risk, sameRepository, lowDocsOnly, qaExempt, testsAddedOnly }) {
  if (sameRepository !== true) return null;
  if (risk === "low" && lowDocsOnly === true) return "low";
  if ((risk === "standard" || risk === "critical") && qaExempt === "tests" && testsAddedOnly === true) return "tests";
  return null;
}

function evaluateGateCore({
  body,
  headSha,
  ownerLogin,
  comments = [],
  prReviews = [],
  reviewComments = null,
  authorLogin = null,
  carriedHeads = new Set(),
  trustedLogins = TRUSTED_VERDICT_LOGINS,
  qaExempt = null,
  testsAddedOnly = false,
  lowDocsOnly = false,
  sameRepository = false,
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

  const trusted = trustedComments(comments, trustedLogins, ownerLogin);

  if (findOwnerOverride(trusted, headSha, ownerLogin)) {
    return { state: "success", description: `Owner override recorded for ${risk} risk.` };
  }

  // A carried override (owner decision, #87 issuecomment-6242103643) holds only
  // while the current head itself has no FAIL or BLOCK from review or QA; a
  // negative verdict on an earlier head never voids it.
  const carriedOverrides = ownerOverrides(trusted, headSha, ownerLogin, carriedHeads);
  if (carriedOverrides.length > 0) {
    // Voided by any FAIL or BLOCK on the current head, or on a carried head
    // when it was posted after the newest override (the `prevailing` order).
    const overrideOrder = carriedOverrides
      .map((entry) => [entry.createdAt, entry.index])
      .reduce((a, b) => (compareOrder(a, b) >= 0 ? a : b));
    const voids = (agentField, headField, verdictField, role, extraField) =>
      [...latestVerdicts(trusted, { agentField, headField, verdictField, role, headSha, extraField, carriedHeads }).values()]
        .some((result) => NEGATIVE.has(result.verdict) && (result.current || compareOrder(result.order, overrideOrder) > 0));
    const negative =
      voids("Agent-Review", "Review-Head", "Review-Verdict", "reviewer") ||
      voids("QA-Agent", "QA-Head", "QA-Verdict", "qa", "QA-Scope");
    if (!negative) {
      return { state: "success", description: `Owner override carried for ${risk} risk.` };
    }
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

  // D-189: negative verdicts above still hold; see reviewExemption.
  const exemption = reviewExemption({ risk, sameRepository, lowDocsOnly, qaExempt, testsAddedOnly });
  if (passingReviews.length === 0 && !exemption) {
    return { state: "pending", description: "Waiting for independently authenticated review." };
  }
  if (passingReviews.length === 0) {
    const kind = exemption === "low" ? "low" : `${risk}, tests only`;
    return {
      state: "success",
      description: `No independent review required (${kind}).`,
    };
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
      // D-196 (c.6549357009 t. 2): a review PASS without QA, because QA is not
      // required for this file list; Merge authorization reads it like qaPass.
      // F-173: only a review posted through an App counts, never an
      // owner-account CLI comment (D-162, D-193).
      ...(passingReviews.some((review) => !review.cli) ? { qaExemptPass: true } : {}),
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

    // D-139: second Claude session. Needs its own slot (not author, not a
    // passing reviewer), the declaration naming the head the QA tested, a
    // Codex review on that head or the current one and every Codex thread
    // answered. The QA head is the current head or one carried through clean
    // base merges (D-101; Daniel 23. 10. 2026.), so the queue's base merge
    // does not void it.
    const everReviewers = reviewerPrincipals(trusted);
    const codexOn = (sha) => codexReviewedHead(prReviews, sha) || codexCleanSummaryOnHead(comments, sha);
    const secondSession = separateAppPass || fallbackPass
      ? null
      : qaPasses.find(
          (result) =>
            result.identity.appSlug === "claude" &&
            !passingReviewerPrincipals.has(result.identity.principal) &&
            !everReviewers.has(result.identity.principal) &&
            sameHead(SECOND_SESSION_RE.exec(result.fallbackLine ?? "")?.[1], result.head) &&
            (codexOn(result.head) || codexOn(headSha)),
        );
    if (secondSession && codexThreadsAnswered(reviewComments, authorLogin)) {
      return {
        state: "success",
        description: `Independent review and second Claude session QA valid for current head (D-139: Codex review on head, threads answered).${carriedNote([...passingReviews, secondSession], headSha)}`,
      };
    }

    if (!separateAppPass) {
      // D-161: the Codex pair carries through a clean base merge (D-101) like
      // any other verdict; `carriedHeads` already holds only heads behind base
      // merges with an identical PR diff. PASS filtering and negative
      // dominance above still apply. Declared slots are not cryptographic
      // proof of independent sessions.
      const codexReview = passingReviews.find(
        (review) => review.identity.appSlug === "chatgpt-codex-connector",
      );
      const codexQa = qaPasses.find(
        (result) =>
          result.identity.appSlug === "chatgpt-codex-connector" &&
          !passingReviewerPrincipals.has(result.identity.principal),
      );
      if (codexReview && codexQa) {
        const note = carriedNote([codexReview, codexQa], headSha);
        return {
          state: "success",
          description: note
            ? `Independent Codex review and QA pair valid for current head through D-101 carry.${note}`
            : "Independent Codex review and QA pair valid on exact current head.",
        };
      }
      return {
        state: "pending",
        description: "Critical PR: waiting for separately authenticated QA PASS.",
      };
    }
  }

  const counted = risk === "critical" ? [...passingReviews, ...qaPasses] : passingReviews;
  return {
    state: "success",
    // D-196, F-173: Merge authorization reads this flag. Only a QA PASS from
    // another App than every passing review sets it, with those reviews and that
    // QA posted through an App, never an owner-account CLI comment. The same-App
    // fallback, the D-139 second session, the Codex pair, an override and an
    // exemption never set it.
    ...(risk === "critical" &&
    passingReviews.every((review) => !review.cli) &&
    qaPasses.some((result) => !result.cli && !passingReviewerApps.has(result.identity.appSlug))
      ? { qaPass: true }
      : {}),
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
 * MAX_CARRIED_HEADS such heads carries nothing. An Owner Override head is
 * named like a verdict head and judged by the same walk and diff checks.
 */
export function carriedHeadCandidates(comments, headSha, path) {
  const named = namedCarryHeads(comments, headSha);
  if (named.size === 0) return { heads: [], reason: null };
  const steps = path ?? [];
  // The walk may stop once it has seen every named head (F-148): no verdict
  // head is then beyond it, so none can be dropped silently.
  const seen = new Set(steps.map((commit) => commit?.sha?.toLowerCase()));
  const allSeen = [...named].every((sha) => seen.has(sha));
  if (!allSeen && !steps.some((commit) => (commit?.parents?.length ?? 0) < 2)) {
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
 * Earlier heads named by trusted canonical review, QA, Owner Override or
 * Owner-Command blocks, lower case, without the current head. The runner reads
 * them before it walks, so a PR without such a head costs no walk (F-148).
 */
export function namedCarryHeads(comments, headSha) {
  const named = new Set();
  for (const entry of trustedComments(comments)) {
    for (const [block, headField] of [["Agent-Review", "Review-Head"], ["QA-Agent", "QA-Head"], ["Owner-Override", "Override-Head"], ["Owner-Command", "Command-Head"]]) {
      if (!canonicalBlock(entry.body, block)) continue;
      // An override that could never count must not use up the head limit.
      if (block === "Owner-Override" && !validOverrideShape(entry)) continue;
      if (block === "Owner-Command" && !validCommandShape(entry)) continue;
      const head = field(entry.body, headField)?.toLowerCase();
      if (head && SHA_RE.test(head) && head !== headSha.toLowerCase()) named.add(head);
    }
  }
  return named;
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

// D-162, D-193: say in the status when a CLI comment of the owner's account was
// counted, so the quiet path stays visible. The note leads the description:
// the posted status is cut at 140 characters (review-gate.mjs).
export function evaluateGate(input) {
  const result = evaluateGateCore(input);
  if (result.state !== "success") return result;
  const used = new Set(
    trustedComments(input.comments, input.trustedLogins ?? TRUSTED_VERDICT_LOGINS, input.ownerLogin).map(
      (entry) => entry.cliChannel,
    ),
  );
  const notes = [...CLI_CHANNELS].filter(([channel]) => used.has(channel)).map(([, { note }]) => note);
  return notes.length ? { ...result, description: `${notes.join(" ")} ${result.description}` } : result;
}

// True only when every listed file is a newly added test file (isNewTestExempt).
export function onlyAddedTests(files) {
  const listed = files ?? [];
  return listed.length > 0 && listed.every((f) => f?.status === "added" && !f.previous_filename && isNewTestExempt(f.filename));
}

// The same reviewExemption as the gate, so a PR that waits for review is never
// eligible (#971: a low PR with only new tests was).
export function evaluateAutoMergeEligible({ metadata, paths, qaExempt, testsAddedOnly = false, sameRepository = false }) {
  if (sameRepository !== true) {
    return { state: "pending", description: "Not eligible for auto-merge: the head branch is not in this repository." };
  }
  const exemption =
    metadata?.ok === true &&
    reviewExemption({
      risk: metadata.risk,
      sameRepository,
      lowDocsOnly: metadata.minimumRisk !== "critical" && lowReviewExempt(paths),
      qaExempt,
      testsAddedOnly,
    });
  if (exemption && ownerCommandPaths(paths).length === 0) {
    return { state: "success", description: "Auto-merge eligible (low or test-only, no D-97)." };
  }
  return { state: "pending", description: "Not eligible for auto-merge." };
}

// F-165: a commit status belongs to the head, not to the PR. The gate grants a
// green status only for a PR whose base is the repository's default branch
// (from the GitHub API PR, never the event); missing fields fail closed.
export const NOT_DEFAULT_BASE = {
  state: "pending",
  description: "The gate grants success only for PRs that target the default branch.",
};
export function targetsDefaultBranch(pr) {
  const ref = pr?.base?.ref;
  return typeof ref === "string" && ref.length > 0 && ref === pr?.base?.repo?.default_branch;
}

// F-165: Auto-merge eligible is refused while another open PR shares the head;
// a list that was not read counts as shared.
export const SHARED_HEAD = { state: "pending", description: "Not eligible for auto-merge: another open PR shares this head." };
export function sharesHeadWithOpenPr(pr, openPulls) {
  if (!Array.isArray(openPulls)) return true;
  const head = String(pr?.head?.sha ?? "").toLowerCase();
  return openPulls.some((other) => other?.number !== pr?.number && String(other?.head?.sha ?? "").toLowerCase() === head);
}

/**
 * Whether the merge queue may take the PR (D-161 (h)). Mergify reads only this
 * status, never the description or a label: the same parser that decides the
 * risk for the gate decides it here. Green when the gate is green and either
 * the owner's `Owner-Command: merge` comment names this head (or a head that
 * carries to it through a clean base merge, D-101), or the PR touches no D-97
 * path and declares Risk low or standard, or Risk critical with a gate passed
 * by verdicts rather than an Owner Override (D-196), or only adds new tests
 * (D-189). Every description is fixed text.
 */
export function evaluateMergeAuthorization({
  gate,
  metadata,
  paths,
  comments,
  headSha,
  ownerLogin,
  carriedHeads,
  testsAddedOnly = false,
  sameRepository = false,
}) {
  if (gate?.state !== "success") return { state: "pending", description: "Waiting for the Engineering review gate." };
  const heads = carriedHeads ?? new Set();
  const commanded = trustedComments(comments).some(
    (entry) =>
      canonicalBlock(entry.body, "Owner-Command") &&
      validCommandShape(entry) &&
      entry.login === ownerLogin &&
      (sameHead(field(entry.body, "Command-Head"), headSha) || heads.has(field(entry.body, "Command-Head")?.toLowerCase())),
  );
  if (commanded) return { state: "success", description: "Owner merge command names this head." };
  const automatic =
    metadata?.ok === true &&
    (metadata.risk === "low" || metadata.risk === "standard") &&
    metadata.minimumRisk !== "critical" &&
    ownerCommandPaths(paths).length === 0;
  if (automatic) return { state: "success", description: "Risk low or standard, no D-97 path: no owner command needed." };
  // D-196 (trial to 14 Nov 2026): a critical PR with no D-97 path needs no owner
  // command when the gate passed by counting verdicts: a separate QA PASS
  // (`qaPass`), or a review PASS on a PR that is QA-exempt by its file list (only
  // tests or only documents, `qaExemptPass`; owner, #87 c.6549357009 t. 2). A gate
  // that passed by an Owner Override keeps the command. F-173: every file must be
  // on the D-196 allowlist (ownerFreeCritical: application code, migrations,
  // tests, low-doc documents); any other file keeps the command, D-97 or not.
  const verdictPass =
    (gate.qaPass === true && qaExemption(paths) === null) ||
    (gate.qaExemptPass === true && qaExemption(paths) !== null);
  // A head outside this repository keeps the command (ENGINEERING_SYSTEM §5, #971).
  const criticalByVerdicts =
    verdictPass &&
    sameRepository === true &&
    metadata?.ok === true &&
    metadata.risk === "critical" &&
    ownerFreeCritical(paths);
  if (criticalByVerdicts) {
    return { state: "success", description: "Risk critical, app code only, review and QA through Apps (or QA-exempt): no owner command needed (D-196)." };
  }
  // D-189: a PR that only adds new test files is auto-merge eligible, so it needs
  // no owner command either; a head outside this repository still does.
  const addedTestsOnly =
    metadata?.ok === true &&
    sameRepository === true &&
    testsAddedOnly === true &&
    qaExemption(paths) === "tests" &&
    ownerCommandPaths(paths).length === 0;
  if (addedTestsOnly) return { state: "success", description: "Only new test files, no D-97 path: no owner command needed." };
  return { state: "pending", description: "Needs the owner's merge command for this head (D-97 or critical)." };
}

export function evaluatePullRequest({ pr, files, comments, prReviews, reviewComments, ownerLogin, carriedHeads }) {
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
  const sameRepository = sameRepositoryHead(pr);
  const testsAddedOnly = onlyAddedTests(listed);
  const result = evaluateGate({
    body: pr.body ?? "",
    headSha: pr.head.sha,
    ownerLogin,
    comments,
    prReviews,
    reviewComments,
    authorLogin: pr.user?.login ?? null,
    carriedHeads,
    qaExempt: qaExemption(paths),
    testsAddedOnly,
    lowDocsOnly: lowReviewExempt(paths),
    sameRepository,
  });
  return {
    metadata,
    result,
    mergeAuthorization: evaluateMergeAuthorization({
      gate: result,
      metadata,
      paths,
      comments,
      headSha: pr.head.sha,
      ownerLogin,
      carriedHeads,
      testsAddedOnly,
      sameRepository,
    }),
    autoMergeEligible: evaluateAutoMergeEligible({
      metadata,
      paths,
      qaExempt: qaExemption(paths),
      testsAddedOnly,
      sameRepository,
    }),
  };
}

export { field } from "./metadata-parser.mjs";
