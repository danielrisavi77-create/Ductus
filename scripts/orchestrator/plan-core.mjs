// Advice for the orchestrator (DAN-264): which open PRs could run in the gate
// side by side. Pure logic, read-only: it changes no Linear issue, branch,
// label or verdict and starts no session. Anything it cannot read or prove
// ends as NEPROVJERENO, never as PARALELNO.
import { field } from "../engineering/metadata-parser.mjs";
import { matchesPath, normalizePath } from "../engineering/protected-paths.mjs";
import { contractState } from "./work-guard-core.mjs";

export const VERDICTS = ["NEPROVJERENO", "PREKLAPANJE", "ČEKA OVISNOST", "PARALELNO"];
export const GATE_SLOTS = 3; // D-161 (a)
// D-107: until the demo on 2 November 2026 a tooling PR enters the gate only
// when no demo PR waits in the queue.
export const DEMO_FIRST_UNTIL = Date.parse("2026-11-03T00:00:00+01:00");

const LANE_RE = /^[a-z]+:[a-z0-9][a-z0-9_-]*:(backend|frontend|platforma)$/i;
const TASK_RE = /\bDAN-[1-9]\d*\b/;
// \b is ASCII-only in JavaScript and never matches before "č"; look for any letter instead.
const DEPENDS_RE = /(?<![\p{L}\p{N}_])(?:ovisi o|depends on|stacked on|čeka)\s+#(\d+)/giu;

// Paths whose change alone makes a PR tooling, not demo work (D-107).
export const TOOLING_PATHS = [
  ".github/", "scripts/", ".claude/", ".agents/", "plugins/", "docs/", "lefthook.yml",
  "CLAUDE.md", "AGENTS.md", "STATE.md", "playwright.config.ts", "playwright.login.config.ts", "vitest.config.ts",
];
// A backend contract another writer's screen may call without sharing a file
// (e.g. an API route and the page that posts to it).
export const CONTRACT_PATHS = ["app/api/", "src/server/", "src/adapters/", "src/application/", "src/domain/", "db/migrations/"];
// src/lib holds client code that calls the API (journal, sync drainRunner).
const UI_PATHS = ["app/", "src/components/", "src/client/", "src/editor/", "src/lib/"];

const touches = (paths, list) => paths.some((p) => matchesPath(p, list));
const touchesUi = (paths) => paths.some((p) => matchesPath(p, UI_PATHS) && !matchesPath(p, ["app/api/"]));

export function laneOf(body) {
  return LANE_RE.exec(field(body ?? "", "Agent") ?? "")?.[1].toLowerCase() ?? null;
}

/** The writer behind the Agent line (runtime and slot), or null. */
export function writerOf(body) {
  const agent = field(body ?? "", "Agent") ?? "";
  return LANE_RE.test(agent) ? agent.toLowerCase().split(":").slice(0, 2).join(":") : null;
}

export function taskOf(body) {
  return TASK_RE.exec(field(body ?? "", "Task") ?? "")?.[0] ?? null;
}

export function isTooling(paths) {
  return paths.length > 0 && paths.every((p) => matchesPath(normalizePath(p), TOOLING_PATHS));
}

/** Open PR numbers the body says it waits on, ascending. */
export function declaredDependencies(body, openNumbers) {
  const out = new Set();
  for (const m of String(body ?? "").matchAll(DEPENDS_RE)) {
    const n = Number(m[1]);
    if (openNumbers.has(n)) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * One row per open PR: {number, draft, lane, task, kind, verdict, reasons}.
 * prs: [{number, isDraft, baseRefName, body, paths: string[] | null}];
 * pairs: overlapPairs(prs); contract: work-guard contract or null;
 * independent: [[a, b]] pairs the orchestrator has confirmed share no contract.
 */
export function planParallel({ prs, pairs, contract = null, now = Date.now(), slots = GATE_SLOTS, independent = [] }) {
  const list = [...(prs ?? [])].sort((a, b) => a.number - b.number);
  const open = new Set(list.map((p) => p.number));
  const state = contract === null ? "MISSING" : contractState(contract, now);
  const assigned = new Map(state === "VALID"
    ? contract.assignments.filter((a) => a.pr !== null).map((a) => [a.pr, a]) : []);

  const rows = list.map((pr) => {
    const paths = Array.isArray(pr.paths) ? pr.paths.map(normalizePath) : null;
    const lane = laneOf(pr.body);
    const writer = writerOf(pr.body);
    const task = taskOf(pr.body);
    const reasons = { NEPROVJERENO: [], PREKLAPANJE: [], "ČEKA OVISNOST": [] };
    if (!paths) reasons.NEPROVJERENO.push("files could not be read");
    if (!lane) reasons.NEPROVJERENO.push("no writer: Agent line names no backend, frontend or platforma role");
    if (!task) reasons.NEPROVJERENO.push("no DAN task on the Task line");
    if (state === "MISSING") reasons.NEPROVJERENO.push("assignment not checked: no work contract");
    else if (state !== "VALID") reasons.NEPROVJERENO.push(`assignment not checked: ${state}`);
    else {
      const a = assigned.get(pr.number);
      if (!a) reasons.NEPROVJERENO.push("no active assignment in the work contract");
      else {
        if (a.agent.split(":")[2].toLowerCase() !== lane) reasons.NEPROVJERENO.push(`contract assigns ${a.agent}`);
        if (a.task !== task) reasons.NEPROVJERENO.push(`contract task ${a.task} differs`);
        if (a.blockers.length) reasons["ČEKA OVISNOST"].push(`contract blockers: ${a.blockers.join(", ")}`);
      }
    }
    for (const p of pairs ?? []) {
      if (p.a !== pr.number && p.b !== pr.number) continue;
      const other = p.a === pr.number ? p.b : p.a;
      const what = [p.count ? `${p.count} shared file${p.count === 1 ? "" : "s"}` : "", ...p.dirs.map((d) => `order of ${d}`)];
      reasons.PREKLAPANJE.push(`#${other}: ${what.filter(Boolean).join(", ")}`);
    }
    if (pr.baseRefName && pr.baseRefName !== "main") reasons["ČEKA OVISNOST"].push(`based on ${pr.baseRefName}, not main`);
    const deps = declaredDependencies(pr.body, open).filter((n) => n !== pr.number);
    if (deps.length) reasons["ČEKA OVISNOST"].push(`declared dependency on ${deps.map((n) => `#${n}`).join(", ")}`);
    return { number: pr.number, draft: Boolean(pr.isDraft), lane, writer, task, paths,
      kind: paths ? (isTooling(paths) ? "tooling" : "demo") : null, reasons };
  });

  // A PR whose files are unknown may overlap with any other.
  const unread = rows.filter((r) => !r.paths).map((r) => `#${r.number}`);
  for (const r of rows) {
    const others = unread.filter((n) => n !== `#${r.number}`);
    if (others.length) r.reasons.NEPROVJERENO.push(`overlap unknown: files of ${others.join(", ")} could not be read`);
  }

  // A backend contract and another writer's screens cannot be proved independent
  // from paths; only the orchestrator's explicit confirmation clears the pair.
  const confirmed = new Set(independent.map(([a, b]) => `${Math.min(a, b)}:${Math.max(a, b)}`));
  for (const r of rows) {
    if (!r.paths || !r.lane) continue;
    for (const o of rows) {
      // one writer works serially; two writers in the same role are still two writers
      if (o === r || !o.paths || !o.lane || o.writer === r.writer) continue;
      if (confirmed.has(`${Math.min(r.number, o.number)}:${Math.max(r.number, o.number)}`)) continue;
      if ((touches(r.paths, CONTRACT_PATHS) && touchesUi(o.paths)) || (touches(o.paths, CONTRACT_PATHS) && touchesUi(r.paths))) {
        r.reasons.NEPROVJERENO.push(`possible shared contract with #${o.number} (${o.lane}); confirm by hand`);
      }
    }
  }

  const inGate = rows.filter((r) => !r.draft).length;
  let free = Math.max(0, slots - inGate);
  const clean = (r) => VERDICTS.slice(0, 3).every((v) => !r.reasons[v].length);
  const waiting = rows.filter((r) => r.draft && clean(r))
    .sort((a, b) => (a.kind === b.kind ? a.number - b.number : a.kind === "demo" ? -1 : 1));
  const admitted = new Set();
  for (const r of waiting) {
    if (r.kind !== "demo") continue;
    if (free > 0) {
      free -= 1;
      admitted.add(r.number);
    } else r.reasons["ČEKA OVISNOST"].push(`gate full (${slots} slots)`);
  }
  // Any demo draft left outside the gate, ready or blocked, is still in the queue.
  const demoQueued = now < DEMO_FIRST_UNTIL
    ? rows.filter((r) => r.draft && r.kind !== "tooling" && !admitted.has(r.number)).map((r) => `#${r.number}`) : [];
  for (const r of waiting) {
    if (r.kind === "demo") continue;
    if (demoQueued.length) r.reasons["ČEKA OVISNOST"].push(`D-107: demo PR ${demoQueued.join(", ")} waits in the queue`);
    else if (free > 0) free -= 1;
    else r.reasons["ČEKA OVISNOST"].push(`gate full (${slots} slots)`);
  }

  const out = rows.map((r) => {
    const verdict = VERDICTS.find((v) => v === "PARALELNO" || r.reasons[v].length);
    return { number: r.number, draft: r.draft, lane: r.lane, task: r.task, kind: r.kind, verdict,
      reasons: VERDICTS.slice(0, 3).flatMap((v) => r.reasons[v]) };
  });
  return { contract: state, inGate, slots, overfull: inGate > slots, rows: out };
}

/** orch:overlap arguments; the contract file defaults to $DUCTUS_WORK_CONTRACT. */
export function parseArgs(argv, env = {}) {
  const out = { json: false, plan: false, contract: env.DUCTUS_WORK_CONTRACT || null, independent: [] };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--") continue;
    else if (argv[i] === "--json") out.json = true;
    else if (argv[i] === "--plan") out.plan = true;
    else if (argv[i] === "--independent" && /^[1-9]\d*:[1-9]\d*$/.test(argv[i + 1] ?? "")) {
      const [a, b] = argv[(i += 1)].split(":").map(Number);
      if (a === b) throw new Error(`a PR is not a pair: ${argv[i]}`);
      out.independent.push([a, b]);
    } else if (argv[i] === "--contract" && argv[i + 1] && !argv[i + 1].startsWith("--")) out.contract = argv[(i += 1)];
    else throw new Error(`unknown or incomplete argument: ${argv[i]}`);
  }
  return out;
}

/** Text lines of the plan. */
export function renderPlan(plan) {
  const lines = [];
  for (const r of plan.rows) {
    const who = [r.lane ?? "?", r.task ?? "?", r.kind ?? "?", r.draft ? "DRAFT" : "in gate"].join(", ");
    lines.push(`#${r.number} ${r.verdict} (${who})`);
    for (const reason of r.reasons) lines.push(`  ${reason}`);
  }
  if (plan.overfull) lines.push(`WARNING: ${plan.inGate} PRs out of draft, more than the ${plan.slots} gate slots`);
  lines.push(`Contract: ${plan.contract}. Gate: ${plan.inGate}/${plan.slots}. Advice only: the orchestrator decides.`);
  return lines;
}
