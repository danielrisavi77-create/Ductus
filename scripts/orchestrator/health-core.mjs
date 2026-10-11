// Pure logic of `pnpm orch:health` (DAN-139): no gh, git or fs calls here.
// Inputs are already-read data; outputs are findings {level, check, text}.
import { canonicalBlock, field, metadataLines } from "../engineering/metadata-parser.mjs";
import { verifiedCommentIdentity } from "../engineering/review-gate-core.mjs";

/** One heartbeat of the orchestrator loop, in minutes (docs/ORKESTRATOR.md §10). */
export const HEARTBEAT_MIN = 30;
export const FAIL_STALL_MIN = HEARTBEAT_MIN; // FAIL on the current head, no push for longer
export const QUEUE_STALL_MIN = 2 * HEARTBEAT_MIN; // queued head with no verdict for longer
export const SUBAGENT_SILENT_MIN = 45; // manual: the script cannot see local subagents
export const CLOUD_QA_MIN = 20; // manual: the script cannot see cloud sessions

export const LEVELS = ["FAIL", "NEPROVJERENO", "WARN", "PASS", "RUČNO"];
const SHA_RE = /^[0-9a-f]{40}$/i;
const TRUSTED = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const ORCH_RE = /\((?:claude|codex|chatgpt|grok):[A-Za-z0-9_-]+:orchestrator\)/;
const RED = new Set(["failure", "cancelled", "timed_out", "action_required", "startup_failure", "error"]);
const SAFE_NAME = /^[\w .,()/:-]{1,80}$/;
const GREEN = new Set(["success", "neutral", "skipped"]);
const KINDS = [
  { kind: "review", agent: "Agent-Review", head: "Review-Head", verdict: "Review-Verdict", role: "reviewer" },
  { kind: "qa", agent: "QA-Agent", head: "QA-Head", verdict: "QA-Verdict", role: "qa" },
];

const f = (level, check, text) => ({ level, check, text });
const short = (sha) => String(sha).slice(0, 7);
const minutes = (now, at) => Math.max(0, Math.floor((now - at) / 60000));
const longer = (now, at, limitMin) => now - at > limitMin * 60000;
/** Local, repo-owned strings (paths, check names) printed without control characters. */
export const printable = (s) => String(s).replace(/[\u0000-\u001f\u007f-\u009f]/g, "?");

/**
 * Canonical verdicts only: trusted association, first non-empty line outside
 * code, full head SHA, and an App identity the gate accepts (review-gate-core).
 */
export function canonicalVerdicts(comments) {
  const out = [];
  for (const [index, c] of (comments ?? []).entries()) {
    if (!TRUSTED.has(c?.author_association)) continue;
    const body = c?.body ?? "";
    for (const k of KINDS) {
      if (!canonicalBlock(body, k.agent)) continue;
      const agent = field(body, k.agent);
      const head = field(body, k.head);
      const verdict = field(body, k.verdict)?.toUpperCase();
      const identity = verifiedCommentIdentity({ appSlug: c?.performed_via_github_app?.slug ?? null }, agent);
      if (!identity || !agent.endsWith(`:${k.role}`) || !SHA_RE.test(head ?? "")) continue;
      if (!["PASS", "FAIL", "BLOCK"].includes(verdict)) continue;
      out.push({ kind: k.kind, agent, principal: identity.principal, head: head.toLowerCase(), verdict, index,
        key: `${k.kind}|${identity.appSlug}|${identity.principal}`, at: Date.parse(c?.created_at ?? "") });
    }
  }
  return out;
}

/** Latest canonical verdict per identity and kind, on `head` only. */
export function latestOnHead(verdicts, head) {
  const latest = new Map();
  for (const v of verdicts) {
    if (v.head !== String(head).toLowerCase()) continue;
    const p = latest.get(v.key);
    if (!p || v.at > p.at || (v.at === p.at && v.index > p.index)) latest.set(v.key, v);
  }
  return [...latest.values()];
}

/** PRs the stall checks look at: open, not draft, not a Dependabot branch. */
export const watched = (pr) =>
  pr.state === "OPEN" && !pr.isDraft && !String(pr.headRefName ?? "").startsWith("dependabot/");

/** (c) review or QA FAIL on the current head with no push for longer than FAIL_STALL_MIN. */
export function checkFailStalls({ prs, comments, now }) {
  const out = [];
  let looked = 0;
  for (const pr of prs.filter(watched)) {
    const list = comments.get(pr.number);
    if (!Array.isArray(list)) {
      out.push(f("NEPROVJERENO", "fail-bez-pusha", `#${pr.number}: komentari nisu pročitani`));
      continue;
    }
    looked += 1;
    const standing = latestOnHead(canonicalVerdicts(list), pr.headRefOid).filter((v) => v.verdict !== "PASS");
    if (!standing.length) continue;
    if (standing.some((v) => Number.isNaN(v.at))) {
      out.push(f("NEPROVJERENO", "fail-bez-pusha", `#${pr.number}: vrijeme verdikta nije čitljivo`));
      continue;
    }
    const oldest = standing.reduce((a, b) => (b.at < a.at ? b : a));
    const age = minutes(now, oldest.at);
    const who = standing.map((v) => `${v.kind} ${v.verdict} ${v.agent}`).join(", ");
    const text = `#${pr.number} head ${short(pr.headRefOid)}: ${who}; bez novog pusha ${age} min (prag ${FAIL_STALL_MIN})`;
    out.push(f(longer(now, oldest.at, FAIL_STALL_MIN) ? "FAIL" : "WARN", "fail-bez-pusha", text));
  }
  if (!out.some((x) => x.level !== "WARN")) out.push(f("PASS", "fail-bez-pusha", `${looked} PR-ova pročitano, nijedan FAIL dulje od praga`));
  return out;
}

const QUEUE_FIRST = ["RED ZA REVIEW", "POTEZ ORKESTRATORA"];
const SECTION_RE = /^[*_#\s]*RED ZA REVIEW[*_:\s]*$/; // "**RED ZA REVIEW**" inside a POTEZ comment
const HEADING_RE = /^(?:#{1,6}\s|\*\*[^*]+\*\*:?\s*$)/; // next section ends it
// Only verdict roles may follow the slot (as in Agent-Review); an author identity such as
// `claude:a:platforma` ("vraćeno nositelju") is not an assignment. Backticks are optional
// (6102660048 wrote the slot bare), so the slot must end at a non-name character.
const SLOT_RE = /(?<![\w:-])`?((?:claude|codex|chatgpt|grok):[A-Za-z0-9_-]+)(?::(?:reviewer|qa))?`?(?![\w:-])/g;
const FULL_SHA = /(?<![0-9a-f])[0-9a-f]{40}(?![0-9a-f])/i;
const FULL_SHA_G = new RegExp(FULL_SHA.source, "gi");
const principal = (slot) => slot.replace(/^(?:codex|chatgpt):/, "openai:"); // as review-gate-core
const noParens = (s) => s.replace(/\([^()]*\)/g, "");

const SENTENCE_END = /[.!?](?=\s|$)/;
const CLAUSE_END = /[,;]|[.!?](?=\s|$)/;
// A later sentence with its own head or full SHA may be an assignment, not a mention (review 6103532187).
const OWN_HEAD = (s) => /\bhead[au]?\b/i.test(s) || FULL_SHA.test(s);

/**
 * One queue line. `item`: `#N … head <SHA> → … runtime:slot` with exactly one PR and
 * one full SHA before the arrow and no new SHA after it. `loose`: a line with `#N` and
 * an arrow that is not such an assignment (status line, two PRs, two SHAs, no slot).
 * Loose lines are reported, never dropped silently (QA 6102784825, nalaz 1 i 5).
 * Only the first slot after the arrow is assigned; a later slot is the reason (6103224062).
 * A `#N` after the last arrow in a later sentence is a mention, not a PR of the line (6103210028),
 * unless that sentence carries its own head or full SHA: then it is a PR of the line and WARN.
 */
function classify(line) {
  if (line.startsWith(">")) return null;
  const arrow = line.search(/→|->/);
  if (arrow < 0) return null;
  const before = line.slice(0, arrow);
  const tail = noParens(line.slice(arrow)); // parenthesised slots are context, not assignees
  const pr = (s) => [...new Set([...noParens(s).matchAll(/#(\d+)\b/g)].map((m) => Number(m[1])))];
  if (!pr(before).length) return null;
  // "**#181** → …; **#182** → …" (6101498335): a PR before a later arrow must not vanish.
  const segments = tail.split(/→|->/).slice(1);
  const last = segments.pop() ?? "";
  const end = last.search(SENTENCE_END);
  const later = end < 0 ? [] : last.slice(end + 1).split(new RegExp(SENTENCE_END.source)).filter(OWN_HEAD);
  const prs = [...new Set([...pr(before), ...segments.flatMap(pr), ...pr(end < 0 ? last : last.slice(0, end)), ...later.flatMap(pr)])];
  const mentions = [...line.matchAll(/(?<![0-9a-f])[0-9a-f]{7,40}(?![0-9a-f])/gi)].map((m) => m[0].toLowerCase());
  const loose = (why) => ({ loose: true, numbers: prs, mentions, why });
  const head = before.match(/\bhead[au]?\b\W{0,3}([0-9A-Za-z]*)/i);
  const found = [...tail.matchAll(SLOT_RE)];
  if (prs.length > 1) return loose("više PR-ova u retku");
  if (!head || !found.length) return loose("nije dodjela slotu s headom");
  const shas = new Set([...before.matchAll(FULL_SHA_G)].map((m) => m[0].toLowerCase()));
  if (shas.size > 1 || FULL_SHA.test(tail)) return loose("više punih SHA-ova u retku");
  const [first] = found;
  if (SENTENCE_END.test(tail.slice(0, first.index))) return loose("slot nije u prvoj rečenici iza strelice");
  const rest = tail.slice(first.index + first[0].length);
  const clause = rest.search(CLAUSE_END) < 0 ? rest : rest.slice(0, rest.search(CLAUSE_END));
  const slot = principal(first[1]);
  if ([...clause.matchAll(SLOT_RE)].some((m) => principal(m[1]) !== slot)) return loose("više slotova iza strelice");
  return { number: prs[0], head: SHA_RE.test(head[1]) ? head[1].toLowerCase() : null, slots: [slot] };
}

/**
 * Queue items from #87 (docs/ORKESTRATOR.md §8, §10): OWNER comments whose first
 * line starts with "RED ZA REVIEW" (every line) or "POTEZ ORKESTRATORA" (only its
 * "RED ZA REVIEW" section) and carries the orchestrator identity. Newest valid
 * assignment per PR wins; an item without a full SHA never replaces a valid one.
 * A loose line newer than the PR's assignment is kept on the item (or alone) as `loose`.
 */
export function queueItems(comments) {
  const items = new Map();
  const loose = new Map();
  for (const [index, c] of (comments ?? []).entries()) {
    if (c?.author_association !== "OWNER") continue;
    const lines = metadataLines(c?.body ?? "");
    const first = lines.find(Boolean) ?? "";
    const kind = QUEUE_FIRST.find((k) => first.startsWith(k));
    if (!kind || !ORCH_RE.test(first)) continue;
    const at = Date.parse(c?.created_at ?? "");
    let inSection = kind === "RED ZA REVIEW";
    for (const line of lines) {
      if (kind === "POTEZ ORKESTRATORA") {
        if (SECTION_RE.test(line)) inSection = true;
        else if (HEADING_RE.test(line)) inSection = false;
      }
      const a = inSection ? classify(line) : null;
      if (!a) continue;
      if (a.loose) {
        for (const n of a.numbers) loose.set(n, { at, index, mentions: a.mentions, why: a.why, id: c?.id ?? null });
        continue;
      }
      const item = { ...a, at, index };
      const p = items.get(item.number);
      const newer = !p || at > p.at || (at === p.at && index >= p.index);
      if (item.head ? newer || !p.head : newer && !p?.head) items.set(item.number, item);
    }
  }
  for (const [n, l] of loose) {
    const p = items.get(n);
    if (!p) items.set(n, { number: n, head: null, slots: [], at: l.at, index: l.index, loose: l, onlyLoose: true });
    else if (l.at > p.at || (l.at === p.at && l.index > p.index)) p.loose = l;
  }
  return [...items.values()].sort((a, b) => a.number - b.number);
}

/** (d) newest queue item per PR with no verdict of an assigned slot on that head for longer than QUEUE_STALL_MIN. */
export function checkQueue({ queue, prs, comments, now }) {
  if (!queue.length) return [f("NEPROVJERENO", "red-87", "nijedna stavka u redu #87; trajni red ne može biti prazan")];
  const out = [];
  const byNumber = new Map(prs.map((p) => [p.number, p]));
  let cleared = 0;
  for (const item of queue) {
    const pr = byNumber.get(item.number);
    if (pr && !watched(pr)) continue;
    if (item.onlyLoose && !pr) continue; // issue or plan reference, not a PR
    if (item.loose && pr) {
      const head = pr.headRefOid.toLowerCase();
      const current = item.loose.mentions.some((m) => head.startsWith(m));
      const masked = current && item.head !== head;
      const where = item.loose.id ? ` (komentar ${item.loose.id})` : "";
      out.push(f(masked ? "NEPROVJERENO" : "WARN", "red-87",
        `#${pr.number}: noviji redak u redu nije prepoznat kao dodjela${where}: ${item.loose.why}` +
        (masked ? `; spominje aktualni head ${short(head)}, zastoj nije procijenjen` : "")));
      if (item.onlyLoose) continue;
    }
    if (!pr) {
      out.push(f("NEPROVJERENO", "red-87", `#${item.number}: stavka upućuje na PR kojeg nema na popisu`));
      continue;
    }
    if (!item.head) {
      out.push(f("WARN", "red-87", `#${item.number}: neispravna stavka (SHA nije pun)`));
      continue;
    }
    if (pr.headRefOid.toLowerCase() !== item.head) {
      out.push(f("WARN", "red-87", `#${pr.number}: stavka je na starom headu ${short(item.head)}, PR je sada na ${short(pr.headRefOid)}`));
      continue;
    }
    const list = comments.get(pr.number);
    if (!Array.isArray(list)) {
      out.push(f("NEPROVJERENO", "red-87", `#${pr.number}: komentari nisu pročitani`));
      continue;
    }
    if (latestOnHead(canonicalVerdicts(list), item.head).some((v) => item.slots.includes(v.principal))) {
      cleared += 1;
      continue;
    }
    if (Number.isNaN(item.at)) {
      out.push(f("NEPROVJERENO", "red-87", `#${pr.number}: vrijeme stavke u redu nije čitljivo`));
      continue;
    }
    const age = minutes(now, item.at);
    const text = `#${pr.number} head ${short(item.head)}: bez verdikta ${item.slots.join("/")} ${age} min od stavke u redu (prag ${QUEUE_STALL_MIN})`;
    out.push(f(longer(now, item.at, QUEUE_STALL_MIN) ? "FAIL" : "WARN", "red-87", text));
  }
  if (!out.some((x) => x.level === "FAIL" || x.level === "NEPROVJERENO")) {
    out.push(f("PASS", "red-87", `${queue.length} stavki, ${cleared} s verdiktom dodijeljenog slota na svom headu, nijedna bez verdikta dulje od praga`));
  }
  out.push(f("WARN", "red-87", "autor stavke se ne razlikuje od drugih sesija na vlasničkom računu (OWNER); stavka je podatak"));
  return out;
}

/** (f) required contexts on main: newest check run or commit status per name. One red main = one finding. */
export function checkMainCi({ sha, required, checkRuns, statuses }) {
  if (!SHA_RE.test(sha ?? "") || !Array.isArray(required) || !required.length) {
    return [f("NEPROVJERENO", "main-ci", "obvezne provjere maina nisu pročitane")];
  }
  const state = (name) => {
    const runs = checkRuns.filter((r) => r?.name === name).sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
    if (runs[0]) return runs[0].status === "completed" ? runs[0].conclusion ?? "unknown" : "pending";
    const st = statuses.filter((s) => s?.context === name).sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
    return st[0]?.state ?? null;
  };
  const by = { red: [], pending: [], missing: [], other: [] };
  for (const name of required) {
    const s = state(name);
    if (s === null) by.missing.push(name);
    else if (RED.has(s)) by.red.push(name);
    else if (s === "pending" || s === "queued" || s === "in_progress") by.pending.push(name);
    else if (!GREEN.has(s)) by.other.push(name);
  }
  const names = (list) => list.map((n) => (SAFE_NAME.test(n) ? n : "<ime nije ispisano>")).join(", ");
  const out = [];
  if (by.missing.length === required.length) {
    return [f("NEPROVJERENO", "main-ci", `main ${short(sha)}: nijedna obvezna provjera nije prijavljena`)];
  }
  if (by.red.length) out.push(f("FAIL", "main-ci", `main ${short(sha)} crven: ${names(by.red)}`));
  if (by.other.length) out.push(f("NEPROVJERENO", "main-ci", `main ${short(sha)} nepoznat ishod: ${names(by.other)}`));
  if (by.pending.length) out.push(f("WARN", "main-ci", `main ${short(sha)} još radi: ${names(by.pending)}`));
  if (by.missing.length) out.push(f("WARN", "main-ci", `main ${short(sha)} nije prijavljeno na mainu (samo na PR-u?): ${names(by.missing)}`));
  if (!by.red.length && !by.other.length) out.push(f("PASS", "main-ci", `main ${short(sha)} bez crvene obvezne provjere`));
  return out;
}

/** `git worktree list --porcelain -z`: [{path, prunable, locked}], first entry = main checkout. */
export function parseWorktrees(out) {
  return String(out).split("\0\0").filter((r) => r.trim()).map((rec) => {
    const fields = rec.split("\0").filter(Boolean);
    return {
      path: fields.find((x) => x.startsWith("worktree "))?.slice(9) ?? "",
      prunable: fields.some((x) => x === "prunable" || x.startsWith("prunable ")),
      locked: fields.some((x) => x === "locked" || x.startsWith("locked ")),
    };
  }).filter((w) => w.path);
}

/** Relative files the cc-safety-net hook runs, read from .claude/settings.json (not hard-coded). */
export function hookTargets(settings) {
  const found = new Set();
  const walk = (v) => {
    if (typeof v === "string") {
      const m = v.match(/^\$\{?CLAUDE_PROJECT_DIR\}?[/\\](.*cc-safety-net[^\s"]*)/);
      if (m) found.add(m[1].replace(/\\/g, "/"));
    } else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(settings?.hooks);
  return [...found];
}

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const norm = (p) => p.replace(/\\/g, "/").replace(/\/+$/, "");
/** Joins with "/", which Node accepts on Windows as well. */
export const joinPath = (dir, rel) => `${norm(dir)}/${rel}`;

/**
 * (a) every checkout the hook guards: main plus `.claude/worktrees/*`.
 * fsView: {size(path) -> number|null, read(path) -> string|null}.
 */
export function checkSafetyNet({ worktrees, targets, pinned, fsView }) {
  if (!worktrees.length || !targets.length || !pinned) {
    return [f("NEPROVJERENO", "cc-safety-net", "nema popisa worktreeja, cilja hooka ili verzije u package.json")];
  }
  if (!EXACT_VERSION.test(pinned)) {
    return [f("NEPROVJERENO", "cc-safety-net", `verzija u package.json nije točna (${printable(pinned)}), usporedba nije moguća`)];
  }
  if (targets.some((t) => t.split("/").includes("..") || t.startsWith("/"))) {
    return [f("NEPROVJERENO", "cc-safety-net", "cilj hooka izlazi iz repoa (..), nije čitan")];
  }
  const root = norm(worktrees[0].path);
  const base = `${root}/.claude/worktrees/`.toLowerCase();
  const guarded = [worktrees[0], ...worktrees.slice(1).filter((w) => norm(w.path).toLowerCase().startsWith(base))];
  const out = [];
  for (const w of guarded) {
    const name = printable(norm(w.path));
    if (w.prunable || fsView.size(w.path) === null) {
      out.push(f("WARN", "cc-safety-net", `${name}: worktree nema direktorija${w.prunable ? " (prunable)" : ""}, nije provjeren`));
      continue;
    }
    const problems = [];
    for (const rel of targets) {
      if (!(fsView.size(joinPath(w.path, rel)) > 0)) problems.push(`${printable(rel)} nedostaje ili je prazan`);
      const pkgDir = rel.slice(0, rel.indexOf("cc-safety-net") + "cc-safety-net".length);
      let version = null;
      try {
        version = JSON.parse(fsView.read(joinPath(w.path, `${pkgDir}/package.json`)) ?? "null")?.version ?? null;
      } catch {
        version = null;
      }
      if (version !== pinned) problems.push(`verzija ${printable(version ?? "nepoznata")}, očekivano ${printable(pinned)}`);
    }
    out.push(problems.length ? f("FAIL", "cc-safety-net", `${name}: ${[...new Set(problems)].join("; ")}`)
      : f("PASS", "cc-safety-net", `${name}: hook ${printable(pinned)} prisutan`));
  }
  return out;
}

/** What the script cannot see; always printed, never counted as checked. */
export const MANUAL = [
  `lokalni subagent bez javljanja dulje od ${SUBAGENT_SILENT_MIN} min`,
  `QA u oblaku bez verdikta ${CLOUD_QA_MIN} min nakon pokretanja; stanje sesija u oblaku`,
  "Codex kvota: nepoznato (nema API-ja)",
  "PASS review bez QA na critical PR-u, READY PR koji čeka vlasnika, pr-ready preklapanje, grana bez traga rada: izvan opsega orch:health v1",
].map((t) => f("RUČNO", "ručno", t));

/** 1 when anything stalls, else 2 when anything was not checked, else 0. RUČNO never counts. */
export function exitCode(findings) {
  if (findings.some((x) => x.level === "FAIL")) return 1;
  if (findings.some((x) => x.level === "NEPROVJERENO")) return 2;
  return 0;
}

export function render(findings, nowIso) {
  const order = (x) => LEVELS.indexOf(x.level);
  const lines = [`orch:health ${nowIso} UTC; podaci pročitani sada, bez predmemorije`];
  for (const x of [...findings].sort((a, b) => order(a) - order(b))) {
    lines.push(`${x.level.padEnd(12)} ${x.check.padEnd(14)} ${x.text}`);
  }
  const count = (l) => findings.filter((x) => x.level === l).length;
  lines.push(`Ukupno: FAIL ${count("FAIL")}, NEPROVJERENO ${count("NEPROVJERENO")}, WARN ${count("WARN")}, ` +
    `PASS ${count("PASS")}; RUČNO ${count("RUČNO")} stavke i dalje provjerava orkestrator. Izlaz ${exitCode(findings)}.`);
  return lines;
}
