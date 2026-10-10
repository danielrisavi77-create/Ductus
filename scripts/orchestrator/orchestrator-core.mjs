// Pure logic for the orchestrator helper scripts. No gh/git calls here.
import { canonicalBlock, field } from "../engineering/metadata-parser.mjs";

export const GATE_CONTEXT = "Engineering review gate";
const SHA_RE = /^[0-9a-f]{40}$/i;
const TRUSTED = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

const KINDS = {
  review: { agent: "Agent-Review", head: "Review-Head", verdict: "Review-Verdict" },
  qa: { agent: "QA-Agent", head: "QA-Head", verdict: "QA-Verdict" },
};

// Paths from docs/DECISIONS.md D-97 (2): a PR touching them merges only on
// Daniel's explicit command. Entries ending with "/" are directories.
export const D97_PATHS = [
  "CLAUDE.md",
  "AGENTS.md",
  "docs/ENGINEERING_SYSTEM.md",
  "docs/ORKESTRATOR.md",
  "docs/SESSIONS.md",
  "docs/MULTI-ACCOUNT.md",
  "docs/AGENT_SYSTEM_V2.md",
  "lefthook.yml",
  ".github/",
  "scripts/engineering/",
  "scripts/hooks/",
  ".claude/",
  ".agents/",
];
// D-97 also covers DECISIONS entries about who may merge/review; not decidable by path alone.
export const D97_MANUAL_PATHS = ["docs/DECISIONS.md"];

const norm = (p) => String(p).replaceAll("\\", "/").replace(/^\.\//, "");

export function d97Matches(files) {
  return (files ?? []).map(norm).filter((f) =>
    D97_PATHS.some((p) => (p.endsWith("/") ? f.startsWith(p) : f === p)),
  );
}

export function d97ManualMatches(files) {
  return (files ?? []).map(norm).filter((f) => D97_MANUAL_PATHS.includes(f));
}

export function intersectFiles(mainFiles, prFiles) {
  const main = new Set((mainFiles ?? []).map(norm));
  return [...new Set((prFiles ?? []).map(norm))].filter((f) => main.has(f)).sort();
}

/** Canonical verdict comments of one kind ("review" | "qa"), oldest first. */
export function parseVerdicts(comments, kind) {
  const k = KINDS[kind];
  return (comments ?? [])
    .map((c, index) => ({ c, index }))
    .filter(({ c }) => TRUSTED.has(c?.author_association) && canonicalBlock(c?.body, k.agent))
    .map(({ c, index }) => ({
      agent: field(c.body, k.agent),
      head: field(c.body, k.head),
      verdict: field(c.body, k.verdict)?.toUpperCase() ?? null,
      author: c.user?.login ?? null,
      appSlug: c.performed_via_github_app?.slug ?? null,
      createdAt: Date.parse(c.created_at ?? "") || index,
      index,
    }))
    .sort((a, b) => a.createdAt - b.createdAt || a.index - b.index);
}

export function countCanonical(comments) {
  return parseVerdicts(comments, "review").length + parseVerdicts(comments, "qa").length;
}

/** Latest verdict of a kind; `current` = bound to headSha. null if none. */
const GATE_VERDICTS = new Set(["PASS", "FAIL", "BLOCK"]);

// Identity as the gate keys it (ENGINEERING_SYSTEM §6): App slug + runtime:slot,
// with codex and chatgpt normalised to openai.
function identityKey(entry) {
  const [runtime = "", slot = ""] = (entry.agent ?? "").split(":");
  const rt = runtime === "codex" || runtime === "chatgpt" ? "openai" : runtime;
  return `${entry.appSlug ?? ""}|${rt}:${slot}`;
}

/**
 * Verdict of a kind per gate rules: per identity only the newest verdict on the
 * current head counts; any FAIL/BLOCK wins, else PASS, else null when none are
 * current. Without current verdicts, falls back to the newest one marked stale.
 */
export function latestVerdict(comments, kind, headSha) {
  const isCurrent = (e) => Boolean(
    e.head && SHA_RE.test(e.head) && headSha && e.head.toLowerCase() === headSha.toLowerCase(),
  );
  const all = parseVerdicts(comments, kind).filter((e) => GATE_VERDICTS.has(e.verdict));
  const latest = new Map();
  for (const e of all.filter(isCurrent)) latest.set(identityKey(e), e);
  const cur = [...latest.values()];
  const pick = cur.find((e) => e.verdict !== "PASS") ?? cur[0];
  if (pick) return { verdict: pick.verdict, head: pick.head, agent: pick.agent, current: true };
  const last = all.at(-1);
  return last ? { verdict: last.verdict, head: last.head, agent: last.agent, current: false } : null;
}

export function formatVerdict(v) {
  return v ? `${v.verdict}${v.current ? "" : " (stale)"}` : "-";
}

/** Polling snapshot: head + number of canonical verdicts. */
export function snapshot(headSha, comments) {
  return { head: headSha, verdicts: countCanonical(comments) };
}

/**
 * Compare baseline to current. A null/invalid current means GitHub gave no
 * usable answer and is never a change.
 */
export function compareSnapshots(prev, cur) {
  if (!prev || !cur || !cur.head || !Number.isInteger(cur.verdicts)) {
    return { head: false, verdict: false, details: [] };
  }
  const details = [];
  const head = cur.head !== prev.head;
  const verdict = cur.verdicts > prev.verdicts;
  if (head) details.push(`head ${prev.head.slice(0, 8)} -> ${cur.head.slice(0, 8)}`);
  if (verdict) details.push(`verdicts ${prev.verdicts} -> ${cur.verdicts}`);
  return { head, verdict, details };
}

export function summarizeThreads(nodes) {
  const open = (nodes ?? []).filter((t) => t && t.isResolved === false);
  const authors = [...new Set(open.map((t) => t.comments?.nodes?.[0]?.author?.login ?? "?"))];
  return { count: open.length, authors };
}

const OK_CHECK = new Set(["SUCCESS", "SKIPPED", "NEUTRAL"]);

/** statusCheckRollup entries -> CI result, excluding the review gate itself. */
export function evaluateChecks(rollup) {
  const items = (rollup ?? []).filter((c) => (c.name ?? c.context) !== GATE_CONTEXT);
  const bad = items
    .map((c) => ({
      name: c.name ?? c.context,
      state: String(c.conclusion || c.state || c.status || "UNKNOWN").toUpperCase(),
    }))
    .filter((c) => !OK_CHECK.has(c.state));
  return { total: items.length, bad };
}

/** Returns [{level: PASS|FAIL|INFO, id, text}]. */
export function evaluateReady(d) {
  const out = [];
  const add = (level, id, text) => out.push({ level, id, text });
  const gate = d.gate;
  add(gate?.state === "success" ? "PASS" : "FAIL", "gate",
    `gate ${gate?.state ?? "missing"} on ${d.head.slice(0, 8)}${gate?.description ? `: ${gate.description}` : ""}`);
  const ck = evaluateChecks(d.rollup);
  if (ck.total === 0) add("FAIL", "ci", "no CI checks reported");
  else if (ck.bad.length) add("FAIL", "ci", `CI not green: ${ck.bad.map((b) => `${b.name}=${b.state}`).join(", ")}`);
  else add("PASS", "ci", `CI green (${ck.total} checks)`);
  add(d.base === "main" ? "PASS" : "FAIL", "base", `base ${d.base}`);
  add(d.mergeable === "MERGEABLE" ? "PASS" : "FAIL", "mergeable", `mergeable ${d.mergeable}`);
  if (d.overlap == null) add("FAIL", "overlap", "main-vs-PR file overlap could not be determined");
  else if (d.overlap.length) add("FAIL", "overlap", `main changed files this PR touches: ${d.overlap.join(", ")}`);
  else add("PASS", "overlap", "no overlap with files changed on main since merge base");
  if (d.threads == null) add("FAIL", "threads", "review threads could not be read");
  else if (d.threads.count) add("FAIL", "threads", `${d.threads.count} unresolved threads (${d.threads.authors.join(", ")})`);
  else add("PASS", "threads", "no unresolved threads");
  add(d.autoMerge ? "FAIL" : "PASS", "automerge", d.autoMerge ? "auto-merge enabled" : "auto-merge off");
  const d97 = d97Matches(d.files);
  add("INFO", "d97", d97.length ? `touches D-97 paths, ask for Daniel's command: ${d97.join(", ")}` : "no D-97 paths");
  const manual = d97ManualMatches(d.files);
  if (manual.length) add("INFO", "d97-manual", `check D-97 by content: ${manual.join(", ")}`);
  const agent = d.agent ?? null;
  add("INFO", "agent", `Agent ${agent ?? "missing"}${agent?.startsWith("claude:a:") ? " (slot claude:a: orchestrator or subagent PR)" : ""}`);
  add("INFO", "draft", d.draft ? "draft" : "not draft");
  return out;
}

export function allRequiredPass(checks) {
  return checks.every((c) => c.level !== "FAIL");
}

const BRANCH_RE = /^[A-Za-z0-9_][A-Za-z0-9._/-]*$/;
const validBranch = (b) =>
  BRANCH_RE.test(b) && !b.startsWith("refs/") && !b.includes("..") && !b.includes("//") && !b.includes("/.") &&
  !b.endsWith("/") && !b.endsWith(".") && !b.endsWith(".lock");

/**
 * Allow-list for push-verify. Accepts only `<branch>`, `HEAD`, or
 * `<src>:<dst>` / `<src>:refs/heads/<dst>` with both sides non-empty branch
 * names. Never main or the repo default branch. Returns {remote, src, dst}.
 * opts: {currentBranch, defaultBranch}.
 */
export function parsePushArgs(args, { currentBranch = null, defaultBranch = "main" } = {}) {
  if (args.length > 2) throw new Error("usage: push-verify [remote] [refspec]");
  const [remote = "origin", spec = "HEAD"] = args;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(remote)) throw new Error(`bad remote: ${remote}`);
  const parts = spec.split(":");
  if (parts.length > 2) throw new Error(`refspec not allowed: ${spec}`);
  const src = parts[0];
  let dst = parts.length === 2 ? parts[1].replace(/^refs\/heads\//, "") : null;
  if (src !== "HEAD" && !validBranch(src)) throw new Error(`source not allowed: ${spec}`);
  if (parts.length === 2 && !validBranch(dst)) throw new Error(`destination not allowed: ${spec}`);
  dst ??= src === "HEAD" ? currentBranch : src;
  if (!dst || !validBranch(dst)) throw new Error("cannot determine destination branch (detached HEAD?)");
  if (dst === "main" || dst === defaultBranch) throw new Error(`push to ${dst} refused`);
  return { remote, src, dst };
}

export function pushVerdict(pushOk, localSha, remoteSha) {
  if (!pushOk) return { ok: false, reason: "push failed" };
  if (!localSha || !remoteSha) return { ok: false, reason: "could not resolve local or remote SHA" };
  if (localSha !== remoteSha) return { ok: false, reason: "local and remote SHA differ" };
  return { ok: true, reason: "remote head equals local head" };
}

export function parseAgentRisk(body) {
  return { agent: field(body, "Agent"), risk: field(body, "Risk") };
}
