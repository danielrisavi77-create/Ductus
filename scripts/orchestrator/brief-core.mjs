// Orchestrator task briefs: fill the ZADATAK template of docs/SESSIONS.md §3 from
// the task tables of docs/PLAN-DEMO.md §4 and the ownership table of docs/SESSIONS.md §1.
// Pure logic, deterministic, no model and no network. It writes nothing, starts no
// session and changes no label. Review and QA instructions are NOT produced here:
// they must stay neutral (docs/ORKESTRATOR.md §8) and a generated text would defeat that.
import { DEMO_FIRST_UNTIL } from "./plan-core.mjs";

export const TEMP_DECISION_URL = "https://github.com/danielrisavi77-create/Ductus/pull/165#issuecomment-6100851850";
export const PLAN_ISSUE_RE = /^https:\/\/github\.com\/danielrisavi77-create\/Ductus\/issues\/[1-9]\d*$/;
export const TASK_ID_RE = /^[PBFKD]-[1-9]\d*$/;
const DAN_RE = /^DAN-[1-9]\d*$/;
const RISKS = ["low", "standard", "critical"];
const ROLE_OF = { P: "platforma", B: "backend", F: "frontend", K: "kratkotrajna", D: "daniel" };
const ROLE_CARD = { platforma: "pisac-platforma", backend: "pisac-backend", frontend: "pisac-frontend" };
const SESSIONS_ROW = { platforma: "Platforma", backend: "Backend", frontend: "Frontend" };
// ENGINEERING_SYSTEM §5 floor, by words in the task row. Heuristic: it can only raise the
// risk the orchestrator states, never lower it, and the real floor stays the path-based one.
const CRITICAL_WORDS = /\b(RLS|pgTAP|tablic\w*|identitet\w*|sesij\w*|prijav\w*|OIDC|evidenc\w*|potpis\w*|predaj\w*|rekonstrukcij\w*|migracij\w*|ovlast\w*|retencij\w*|authz|KMS|ingest)\b/i;

const ids = (text, pattern) => [...new Set(String(text ?? "").match(pattern) ?? [])];

/** Rows of every table under "## 4. Zadaci": {id, role, title, dependsRaw, deps, external, doneWhen, tier}. */
export function parsePlanTasks(md) {
  const lines = String(md ?? "").split(/\r?\n/);
  const start = lines.findIndex((l) => /^## 4\./.test(l));
  if (start === -1) throw new Error("PLAN section '## 4.' not found");
  const rows = [];
  for (const line of lines.slice(start + 1)) {
    if (/^## /.test(line)) break;
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length !== 5 || !TASK_ID_RE.test(cells[0])) continue;
    const [id, title, dependsRaw, doneWhen, tier] = cells;
    rows.push({ id, role: ROLE_OF[id[0]], title, dependsRaw, doneWhen, tier, deps: [], external: [] });
  }
  const known = new Set(rows.map((r) => r.id));
  for (const r of rows) {
    // Text in brackets ("B-9 nakon demoa; D-98 dopuna") is commentary, not a dependency.
    const raw = r.dependsRaw.replace(/\([^)]*\)/g, " ");
    r.deps = ids(raw, /\b[PBFKD]-[1-9]\d*\b/g).filter((d) => known.has(d) && d !== r.id);
    r.external = ids(raw, /#[1-9]\d*/g);
  }
  if (new Set(rows.map((r) => r.id)).size !== rows.length) throw new Error("duplicate task id in PLAN section 4");
  return rows;
}

/** role -> "Vlasnik mapa" cell of the table in docs/SESSIONS.md §1. */
export function parseOwnership(md) {
  const out = {};
  for (const line of String(md ?? "").split(/\r?\n/)) {
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length !== 4) continue;
    const name = cells[0].replace(/\*/g, "");
    for (const [role, label] of Object.entries(SESSIONS_ROW)) if (name === label) out[role] = cells[2];
  }
  return out;
}

/** Everything that depends on `id`, directly or not. */
export function dependents(tasks, id) {
  const seen = new Set();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    for (const t of tasks) if (t.deps.includes(cur) && !seen.has(t.id)) { seen.add(t.id); stack.push(t.id); }
  }
  return [...seen].sort();
}

export function riskFloor(task) {
  // Short-lived sessions write documents and fixtures ("sesija Arhitektura" is not a login session).
  if (task.role === "kratkotrajna") return "standard";
  return CRITICAL_WORDS.test(`${task.title} ${task.doneWhen}`) ? "critical" : "standard";
}

const rank = (r) => RISKS.indexOf(r);

/**
 * Brief for one task. opts: {task: "DAN-n", risk?, slot?, orchestrator?, plan?, visual?, izvan?, checks?,
 * mape?, done?: string[]}. Returns {text, problems}; text is null when a problem blocks it.
 */
export function buildBrief({ tasks, ownership, id, opts = {} }) {
  const t = tasks.find((x) => x.id === id);
  const problems = [];
  if (!t) return { text: null, problems: [`${id}: not in PLAN section 4`] };
  if (t.role === "daniel") return { text: null, problems: [`${id}: owner task, never briefed to a session`] };
  if (!DAN_RE.test(opts.task ?? "")) problems.push("--task DAN-<n> is required (Linear identity; a task without one is not a task)");

  const done = new Set(opts.done ?? []);
  const missing = [...t.deps, ...t.external].filter((d) => !done.has(d));
  if (missing.length) problems.push(`unmet dependencies: ${missing.join(", ")} (pass them in --done only when merged)`);

  const floor = riskFloor(t);
  const risk = opts.risk ?? floor;
  if (!RISKS.includes(risk)) problems.push(`--risk must be one of ${RISKS.join(", ")}`);
  else if (rank(risk) < rank(floor)) problems.push(`--risk ${risk} is below the floor ${floor} for this task (ENGINEERING_SYSTEM §5; agents never lower risk)`);

  const needsPlan = risk === "critical";
  if (needsPlan && !PLAN_ISSUE_RE.test(opts.plan ?? "")) problems.push("--plan <GitHub issue URL 'Plan napada: ...'> is required for Risk: critical (ORKESTRATOR §8)");
  if (opts.plan && !PLAN_ISSUE_RE.test(opts.plan)) problems.push("--plan must be an issue URL of this repository");

  const folders = ownership[t.role] ?? opts.mape;
  if (!folders) problems.push(`--mape is required: role '${t.role}' has no owner row in SESSIONS §1`);

  const visible = t.role === "frontend";
  const visual = opts.visual ?? "";
  if (visible && !(/^n\/a\b.{10,}/i.test(visual) || visual.length >= 40)) {
    problems.push("--visual is required for a Frontend task: filled SESSIONS §6.2 contract (approved image, route/states, views, path to real render) or 'n/a <reason>'");
  }
  if (problems.length) return { text: null, problems };

  const decisions = ids(`${t.title} ${t.dependsRaw} ${t.doneWhen}`, /\bD-\d{2,3}\b/g);
  const card = ROLE_CARD[t.role] ? `.claude/uloge/${ROLE_CARD[t.role]}.md` : null;
  const ulaz = [
    card, `docs/PLAN-DEMO.md §4 redak ${t.id}`,
    ...(t.role === "backend" ? ["docs/BACKEND.md §6"] : []),
    ...(visible ? ["docs/SESSIONS.md §6", "docs/design/DESIGN-SYSTEM.md"] : []),
    ...(decisions.length ? [`docs/DECISIONS.md (${decisions.join(", ")})`] : []),
  ].filter(Boolean).join("; ");
  const later = dependents(tasks, t.id);
  const cilj = t.title.length > 220 ? `${t.title.slice(0, t.title.lastIndexOf(" ", 220))} … (cijeli opis: PLAN-DEMO §4, ${t.id})` : t.title;
  const text = [
    `ZADATAK ${opts.task} (${t.id}) · uloga: ${t.role} · korak iz STATE.md: ${t.title.split(/[:;(]/)[0].trim()}`,
    `Orkestrator: ${opts.orchestrator ?? "orkestrator"}`,
    `Runtime slot: ${opts.slot ?? "auto"}`,
    `Cilj: ${cilj}`,
    `Ulaz: ${ulaz}`,
    `Opseg: redak ${t.id} iz PLAN-DEMO §4; Risk: najmanje ${risk} (ENGINEERING_SYSTEM §5); Izvan opsega: ${opts.izvan ?? `sve izvan retka ${t.id}${later.length ? `, uključujući ${later.join(", ")}` : ""}; drugi koraci iz STATE.md`}`,
    `Mape: ${folders}`,
    `Gotovo kad: ${t.doneWhen}; uz zelene testove, otvoren PR i gate prema risku`,
    `Vizualni ugovor: ${visible ? visual : "n/a, zadatak ne mijenja prikaz"}`,
    `Lokalne provjere prije pusha: ${opts.checks ?? "standardne"}`,
    `Plan napada: ${needsPlan ? opts.plan : "n/a, zadatak nije Risk: critical"}`,
    `Privremene datoteke: podmapa ${opts.task} u dijeljenoj privremenoj mapi; zapis odluke: ${TEMP_DECISION_URL}`,
    `Ovisi o: ${t.deps.length || t.external.length ? `ništa otvoreno (spojeno: ${[...t.deps, ...t.external].join(", ")})` : "ništa"}`,
  ].join("\n");
  return { text, problems: [] };
}

/**
 * Ready tasks, best first. A task is ready when it is not done or active, its lane is free
 * and every dependency (task id or #PR) is in `done`. Rank: most transitive dependents,
 * then earlier tier, then id. At most one suggestion per free lane (one writer per lane).
 */
export function pickNext({ tasks, done = [], active = [], now = Date.now() }) {
  const doneSet = new Set(done);
  const activeSet = new Set(active);
  const busy = new Set(tasks.filter((t) => activeSet.has(t.id)).map((t) => t.role));
  const open = tasks.filter((t) => t.role !== "daniel" && !doneSet.has(t.id) && !activeSet.has(t.id));
  const blocked = [];
  const ready = [];
  for (const t of open) {
    const missing = [...t.deps, ...t.external].filter((d) => !doneSet.has(d));
    if (missing.length) blocked.push({ id: t.id, missing });
    else ready.push({ ...t, unlocks: dependents(tasks, t.id).length });
  }
  const tierNo = (t) => Number(/T(\d)/.exec(t.tier)?.[1] ?? 9);
  ready.sort((a, b) => b.unlocks - a.unlocks || tierNo(a) - tierNo(b) || a.id.localeCompare(b.id, "en", { numeric: true }));
  const lanes = new Set(busy);
  const picks = [];
  for (const t of ready) {
    if (lanes.has(t.role)) continue;
    lanes.add(t.role);
    const notes = [];
    if (t.role === "platforma" && now < DEMO_FIRST_UNTIL) notes.push("alat: tek kad nijedan demo PR ne čeka u gateu (D-107)");
    if (riskFloor(t) === "critical") notes.push("Risk: critical, treba plan napada prije dodjele");
    picks.push({ id: t.id, role: t.role, title: t.title, unlocks: t.unlocks, notes });
  }
  const backlog = ready.filter((t) => !picks.some((p) => p.id === t.id)).map((t) => t.id);
  return { picks, backlog, blocked, busy: [...busy].sort() };
}

export function renderNext(res) {
  const lines = [];
  for (const p of res.picks) {
    lines.push(`${p.id} (${p.role}, otključava ${p.unlocks}): ${p.title.slice(0, 110)}`);
    for (const n of p.notes) lines.push(`  ! ${n}`);
    lines.push(`  pnpm orch:brief ${p.id} --task DAN-<n> --done <spojeni>`);
  }
  if (!res.picks.length) lines.push("Nema zadatka za dodjelu: sve trake su zauzete ili ovisnosti nisu spojene.");
  if (res.backlog.length) lines.push(`Spremno, čeka slobodnu traku: ${res.backlog.join(", ")}`);
  if (res.blocked.length) lines.push(`Blokirano: ${res.blocked.map((b) => `${b.id} (čeka ${b.missing.join(", ")})`).join("; ")}`);
  lines.push("Savjet, ne odluka: prije dodjele pokreni pnpm orch:overlap --plan; Linear ostaje izvor statusa.");
  return lines;
}

/** Shared CLI parser: positional id, `--key value` options, `--json` flag. */
export function parseCli(argv, valued, flags = []) {
  const out = { id: null, opts: {}, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--") continue;
    if (flags.includes(a)) out[a.slice(2)] = true;
    else if (valued.includes(a) && argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) out.opts[a.slice(2)] = argv[(i += 1)];
    else if (!a.startsWith("--") && out.id === null) out.id = a;
    else throw new Error(`unknown or incomplete argument: ${a}`);
  }
  return out;
}

/** "B-1,B-2, #240" -> ["B-1","B-2","#240"]; anything else is a typo, not a silent skip. */
export function parseList(value) {
  if (!value) return [];
  const items = value.split(/[,\s]+/).filter(Boolean);
  const bad = items.filter((x) => !TASK_ID_RE.test(x) && !/^#[1-9]\d*$/.test(x));
  if (bad.length) throw new Error(`not a task id or #PR: ${bad.join(", ")}`);
  return items;
}
