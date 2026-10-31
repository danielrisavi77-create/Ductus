// Pure logic for the orchestrator helper scripts. No gh/git calls here.
import { canonicalBlock, field, metadataLines } from "../engineering/metadata-parser.mjs";
import { evaluateMetadata } from "../engineering/pr-metadata-core.mjs";
import { commentTime, trustedAuthor, verifiedCommentIdentity } from "../engineering/review-gate-core.mjs";
import {
  changedPaths, D97_MANUAL_PATHS, D97_PATHS, isD97Path, matchesPath, normalizePath,
} from "../engineering/protected-paths.mjs";

export const GATE_CONTEXT = "Engineering review gate";
const SHA_RE = /^[0-9a-f]{40}$/i;

const KINDS = {
  review: { agent: "Agent-Review", head: "Review-Head", verdict: "Review-Verdict", role: "reviewer" },
  qa: { agent: "QA-Agent", head: "QA-Head", verdict: "QA-Verdict", role: "qa" },
};

// The D-97 lists live with the gate (scripts/engineering/protected-paths.mjs)
// so the risk floor and this report read the same paths.
export { changedPaths, D97_MANUAL_PATHS, D97_PATHS };

const norm = normalizePath;

export function d97Matches(files) {
  return (files ?? []).map(norm).filter((f) => isD97Path(f));
}

export function d97ManualMatches(files) {
  return (files ?? []).map(norm).filter((f) => matchesPath(f, D97_MANUAL_PATHS));
}

export function intersectFiles(mainFiles, prFiles) {
  const main = new Set((mainFiles ?? []).map(norm));
  return [...new Set((prFiles ?? []).map(norm))].filter((f) => main.has(f)).sort();
}

// Directories where different files of two PRs still collide (ordering, shared plan).
export const COLLISION_DIRS = ["db/migrations", "db/tests"];

/**
 * Pairs of PRs that touch the same file or the same collision directory.
 * prs: [{number, paths: string[] | null}]; null paths (failed read) pair with
 * nothing. Each pair appears once, lower number first.
 */
export function overlapPairs(prs) {
  const byNumber = new Map((prs ?? []).filter((p) => Array.isArray(p.paths)).map((p) => [p.number, p]));
  const known = [...byNumber.values()].sort((a, b) => a.number - b.number);
  const dirsOf = (p) => COLLISION_DIRS.filter((d) => p.paths.some((f) => norm(f).startsWith(`${d}/`)));
  const pairs = [];
  for (let i = 0; i < known.length; i += 1) {
    for (let j = i + 1; j < known.length; j += 1) {
      const files = intersectFiles(known[i].paths, known[j].paths);
      const other = dirsOf(known[j]);
      const dirs = dirsOf(known[i]).filter((d) => other.includes(d));
      if (files.length || dirs.length) {
        pairs.push({ a: known[i].number, b: known[j].number, count: files.length, files, dirs });
      }
    }
  }
  return pairs;
}

/** Text lines of the overlap map; at most `max` shared files are listed per pair. */
export function renderOverlap(prs, pairs, max = 10) {
  const tag = (n) => `#${n}${prs.find((p) => p.number === n)?.isDraft ? " DRAFT" : ""}`;
  const lines = [];
  for (const p of pairs) {
    const dirs = p.dirs.length ? `; same directory: ${p.dirs.join(", ")}` : "";
    lines.push(`${tag(p.a)} x ${tag(p.b)}: ${p.count} shared file${p.count === 1 ? "" : "s"}${dirs}`);
    for (const f of p.files.slice(0, max)) lines.push(`  ${f}`);
    if (p.count > max) lines.push(`  ... and ${p.count - max} more`);
  }
  const unread = prs.filter((p) => !Array.isArray(p.paths)).map((p) => `#${p.number}`);
  if (unread.length) lines.push(`UNKNOWN: files could not be read for ${unread.join(", ")}; their overlaps are not shown`);
  lines.push(`${prs.length} open PRs, ${pairs.length} overlapping pair${pairs.length === 1 ? "" : "s"}`);
  return lines;
}

/** PR numbers that `number` overlaps with, ascending; null when its files are unknown. */
export function overlapsOf(number, prs, pairs) {
  if (!Array.isArray((prs ?? []).find((p) => p.number === number)?.paths)) return null;
  return (pairs ?? []).filter((p) => p.a === number || p.b === number).map((p) => (p.a === number ? p.b : p.a));
}

/** pr-status cell: "#151, #160", "-" (none) or "?" (files could not be read). */
export function formatOverlaps(list) {
  if (!list) return "?";
  return list.length ? list.map((n) => `#${n}`).join(", ") : "-";
}

// F-015: a verdict counts here only as the gate reads it: trusted author, canonical
// first line, an App that may carry the declared runtime, the kind's role and a full head.
// The owner's Grok or Codex CLI posts from the owner's own account with one
// `Review-Channel:` line, and the gate counts it as that App (D-162, D-193;
// review-gate-core cliChannel). OWNER association stands in for the gate's
// owner-login check: on this user-owned repository only the owner has it.
const CLI_APPS = new Map([["grok-cli", "grok-by-xai"], ["codex-cli", "chatgpt-codex-connector"]]);
const CLI_LINE_RE = /^Review-Channel:[ \t]*(grok-cli|codex-cli)$/i;
function reportAppSlug(c) {
  const slug = c?.performed_via_github_app?.slug ?? null;
  if (slug) return slug;
  if (c?.author_association !== "OWNER") return null;
  const named = new Set(metadataLines(c?.body ?? "").map((l) => CLI_LINE_RE.exec(l)?.[1]?.toLowerCase()).filter(Boolean));
  return named.size === 1 ? CLI_APPS.get([...named][0]) : null;
}

function gateReadable(c, k) {
  if (!trustedAuthor(c) || !canonicalBlock(c?.body, k.agent)) return false;
  const agent = field(c.body, k.agent);
  if (!verifiedCommentIdentity({ appSlug: reportAppSlug(c) }, agent)) return false;
  return agent.endsWith(`:${k.role}`) && SHA_RE.test(field(c.body, k.head) ?? "");
}

/** Canonical verdict comments of one kind ("review" | "qa"), oldest first. */
export function parseVerdicts(comments, kind) {
  const k = KINDS[kind];
  return (comments ?? [])
    .map((c, index) => ({ c, index }))
    .filter(({ c }) => gateReadable(c, k))
    .map(({ c, index }) => ({
      agent: field(c.body, k.agent),
      head: field(c.body, k.head),
      verdict: field(c.body, k.verdict)?.toUpperCase() ?? null,
      author: c.user?.login ?? null,
      appSlug: reportAppSlug(c),
      createdAt: commentTime(c) || index,
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
// with codex and chatgpt normalised to openai and the slot without letter case (#130).
function identityKey(entry) {
  const [runtime = "", slot = ""] = (entry.agent ?? "").split(":");
  const rt = runtime === "codex" || runtime === "chatgpt" ? "openai" : runtime;
  return `${entry.appSlug ?? ""}|${rt}:${slot.toLowerCase()}`;
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

const checkState = (c) => String(c.conclusion || c.state || c.status || "UNKNOWN").toUpperCase();
const checkTime = (c) => Date.parse(c.startedAt ?? "") || Date.parse(c.completedAt ?? "") || 0;

/**
 * One entry per check (workflow + name): the most recently started run. A
 * re-run leaves the older run of the same check in statusCheckRollup. When the
 * order cannot be told (equal or missing times), the non-green entry is kept.
 */
export function latestChecks(rollup) {
  const latest = new Map();
  for (const c of rollup ?? []) {
    const key = `${c.workflowName ?? ""}\n${c.name ?? c.context}`;
    const prev = latest.get(key);
    const dt = prev ? checkTime(c) - checkTime(prev) : 1;
    if (dt > 0 || (dt === 0 && OK_CHECK.has(checkState(prev)))) latest.set(key, c);
  }
  return [...latest.values()];
}

/** statusCheckRollup entries -> CI result, excluding the review gate itself. */
export function evaluateChecks(rollup) {
  const items = latestChecks(rollup).filter((c) => (c.name ?? c.context) !== GATE_CONTEXT);
  const bad = items
    .map((c) => ({ name: c.name ?? c.context, state: checkState(c) }))
    .filter((c) => !OK_CHECK.has(c.state));
  return { total: items.length, bad };
}

/**
 * Newest status of the gate context in a commit statuses list (any order).
 * null means the commit really has no gate status.
 */
export function pickGate(statuses) {
  const at = (s) => Date.parse(s.created_at ?? "") || 0;
  const newer = (a, b) => at(a) > at(b) || (at(a) === at(b) && (a.id ?? 0) > (b.id ?? 0));
  return (statuses ?? [])
    .filter((s) => s?.context === GATE_CONTEXT)
    .reduce((best, s) => (!best || newer(s, best) ? s : best), null);
}

/** Returns [{level: PASS|FAIL|INFO, id, text}]. */
export function evaluateReady(d) {
  const out = [];
  const add = (level, id, text) => out.push({ level, id, text });
  const gate = d.gate;
  // {error}: the read failed, which is not evidence that the commit has no status.
  if (gate?.error) add("FAIL", "gate", `gate could not be read on ${d.head.slice(0, 8)} (read error, not a missing status; retry): ${gate.error}`);
  else add(gate?.state === "success" ? "PASS" : "FAIL", "gate",
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
  // An unread file list is not "no D-97 paths".
  if (!Array.isArray(d.files)) add("FAIL", "files", "changed files could not be read; D-97 paths unknown");
  const d97 = d97Matches(d.files);
  add("INFO", "d97", d97.length ? `touches D-97 paths, ask for Daniel's command: ${d97.join(", ")}` : "no D-97 paths");
  const manual = d97ManualMatches(d.files);
  if (manual.length) add("INFO", "d97-manual", `check D-97 by content: ${manual.join(", ")}`);
  const agent = d.agent ?? null;
  add("INFO", "agent", `Agent ${agent ?? "missing or invalid"}${agent?.startsWith("claude:a:") ? " (slot claude:a: orchestrator or subagent PR)" : ""}`);
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

/**
 * Full push-verify command line: `[remote] [refspec] [--to <branch>]`.
 * Without an explicit destination (`--to` or `src:dst`) a HEAD push goes to the
 * upstream branch of the current branch, never to a branch guessed from the
 * local branch name. opts adds `upstream`: {remote, branch} | null.
 */
export function resolvePushTarget(argv, opts = {}) {
  const rest = [...argv];
  let to = null;
  const i = rest.indexOf("--to");
  if (i !== -1) {
    if (i + 1 >= rest.length) throw new Error("--to needs a branch name");
    [, to] = rest.splice(i, 2);
  }
  if (rest.length > 2) throw new Error("usage: push-verify [remote] [refspec] [--to <branch>]");
  const [remote = "origin", spec = "HEAD"] = rest;
  if (to !== null) {
    if (spec.includes(":")) throw new Error("give the destination once: --to or src:dst");
    return parsePushArgs([remote, `${spec}:${to}`], opts);
  }
  if (spec !== "HEAD") return parsePushArgs([remote, spec], opts);
  const up = opts.upstream;
  const here = opts.currentBranch ?? "detached HEAD";
  if (!up?.branch) throw new Error(`no upstream set for ${here}; pass --to <branch>`);
  if (up.remote !== remote) throw new Error(`upstream of ${here} is on remote ${up.remote}, not ${remote}; pass --to <branch>`);
  if (up.branch === "main" || up.branch === (opts.defaultBranch ?? "main")) {
    throw new Error(`upstream of ${here} is ${up.branch}; pass --to <branch>`);
  }
  return parsePushArgs([remote, `HEAD:${up.branch}`], opts);
}

/** SHA of exactly `refs/heads/<branch>` in `git ls-remote` output, else null. */
export function parseLsRemote(out, branch) {
  for (const line of String(out ?? "").split("\n")) {
    const [sha, ref] = line.trim().split(/\s+/);
    if (ref === `refs/heads/${branch}` && SHA_RE.test(sha)) return sha;
  }
  return null;
}

export function pushVerdict(pushOk, localSha, remoteSha) {
  if (!pushOk) return { ok: false, reason: "push failed" };
  if (!localSha || !remoteSha) return { ok: false, reason: "could not resolve local or remote SHA" };
  if (localSha !== remoteSha) return { ok: false, reason: "local and remote SHA differ" };
  return { ok: true, reason: "remote head equals local head" };
}

// F-015: Agent and Risk reach a report only as values the Risk check accepts, so
// PR body text cannot put instructions or control characters into the table.
// Each value is checked alone through the gate's own evaluateMetadata.
const isControl = (ch) => { const c = ch.codePointAt(0); return c < 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029; };
const metadataOk = (agent, risk) =>
  evaluateMetadata({ body: `Agent: ${agent}\nRisk: ${risk}\nTask: -\n`, files: [] }).ok;

export function parseAgentRisk(body) {
  const agent = field(body, "Agent");
  const risk = field(body, "Risk");
  const clean = (v) => typeof v === "string" && ![...v].some(isControl);
  return {
    agent: clean(agent) && metadataOk(agent, "low") ? agent : null,
    risk: clean(risk) && metadataOk("claude:a:orchestrator", risk) ? risk.toLowerCase() : null,
  };
}

/**
 * `orch:override` arguments: PR numbers and a required `--reason`. The reason
 * is one line, since the gate reads `Override-Reason:` as a single field.
 */
export function parseOverrideArgs(args) {
  const nums = [];
  let reason = null;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--reason") reason = args[++i] ?? null;
    else if (/^#?\d+$/.test(args[i]) && Number(args[i].replace("#", "")) > 0) nums.push(Number(args[i].replace("#", "")));
    else throw new Error(`unknown argument: ${args[i]}`);
  }
  reason = reason?.replace(/\s+/g, " ").trim() || null;
  if (!nums.length || !reason) throw new Error('usage: orch:override <pr...> --reason "<concrete reason>"');
  return { nums: [...new Set(nums)], reason };
}

/** The canonical override comment (ENGINEERING_SYSTEM §7) for one head. */
export function overrideBlock(head, reason) {
  if (!/^[0-9a-f]{40}$/.test(head ?? "")) throw new Error(`not a full head SHA: ${head}`);
  return `Owner-Override: PASS\nOverride-Head: ${head}\nOverride-Reason: ${reason}\n`;
}

/**
 * What `orch:override` prints for one PR read from GitHub: stdout is only the
 * block, so pasting all of it is a valid comment (the gate requires
 * `Owner-Override:` as the first non-empty line); the context goes to stderr.
 */
export function overrideOutput(n, pr, reason) {
  if (pr?.state !== "open") throw new Error(`PR is ${pr?.merged_at ? "merged" : pr?.state}`);
  return {
    stdout: overrideBlock(pr.head?.sha, reason),
    stderr: `# PR #${n} (head ${pr.head.sha.slice(0, 8)}); a new push makes this block stale\n`,
  };
}
