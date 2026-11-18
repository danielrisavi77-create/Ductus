// Pure core of orch:owner: the Owner queue of STATE.md as items with a label, a
// deadline and an action holder, grouped by deadline. No I/O. It only displays;
// STATE.md and Linear stay the source of status.

const SECTION = /^## Owner queue\b/;
const ITEM = /^- \[( |x)\] (.*)$/;
const DATE = /(\d{1,2})\. (\d{1,2})\.(?: (\d{4}))?/g;
const DAY = 86_400_000;
export const SOON_DAYS = 14;
export const GROUPS = ["overdue", "soon", "later", "none"];

const iso = (y, m, d) => {
  const t = Date.UTC(y, m - 1, d);
  const back = new Date(t);
  return back.getUTCMonth() === m - 1 && back.getUTCDate() === d ? back.toISOString().slice(0, 10) : null;
};

/** Croatian dates ("13. 11. 2026.") in `text`; a date without a year takes the year of the next dated one, else `fallbackYear`. */
export function datesIn(text, fallbackYear) {
  const found = [...String(text).matchAll(DATE)].map((m) => ({ index: m.index, d: Number(m[1]), m: Number(m[2]), y: m[3] ? Number(m[3]) : null }));
  for (let i = found.length - 1; i >= 0; i--) found[i].y ??= found[i + 1]?.y ?? fallbackYear;
  return found.map((f) => ({ index: f.index, date: iso(f.y, f.m, f.d) })).filter((f) => f.date);
}

/** Deadline of one item: the date after "Rok:", else the earliest date introduced by "do". Null when there is none. */
export function deadlineOf(text, fallbackYear) {
  const dates = datesIn(text, fallbackYear);
  const after = (re) => [...text.matchAll(re)].map((m) => dates.find((d) => d.index === m.index + m[0].length)?.date).filter(Boolean);
  const explicit = after(/Rok: /g);
  if (explicit.length) return explicit[0];
  return after(/\bdo /g).sort()[0] ?? null;
}

/** Items of the Owner queue section. An unreadable or missing section gives an empty list. */
export function parseOwnerQueue(markdown, fallbackYear) {
  const items = [];
  let inside = false;
  for (const line of String(markdown).split(/\r?\n/)) {
    if (line.startsWith("## ")) { inside = SECTION.test(line); continue; }
    const m = inside ? ITEM.exec(line) : null;
    if (!m) continue;
    const text = m[2].trim();
    const cut = /^(Q-\d+|D-\d+(?:\/D-\d+)?|M\d+)\b/.exec(text);
    const label = cut ? cut[1] : text.split(/[:,(]/)[0].trim().slice(0, 40);
    const rest = text.slice(label.length).replace(/^[\s,:]+/, "");
    items.push({
      done: m[1] === "x",
      label,
      text: rest,
      deadline: deadlineOf(text, fallbackYear),
      action: /Radnja(?: vlasnika)?[: ]/.test(text) ? "vlasnik" : null,
    });
  }
  return items;
}

/** Open items grouped by deadline against `today` (YYYY-MM-DD), each group sorted by date. */
export function groupByDeadline(items, today) {
  const now = Date.parse(today);
  if (Number.isNaN(now)) throw new Error(`bad date: ${today}`);
  const groups = Object.fromEntries(GROUPS.map((g) => [g, []]));
  for (const item of items.filter((i) => !i.done)) {
    if (!item.deadline) { groups.none.push({ ...item, days: null }); continue; }
    const days = Math.round((Date.parse(item.deadline) - now) / DAY);
    groups[days < 0 ? "overdue" : days <= SOON_DAYS ? "soon" : "later"].push({ ...item, days });
  }
  for (const g of GROUPS) groups[g].sort((a, b) => (a.deadline ?? "").localeCompare(b.deadline ?? ""));
  return groups;
}

const TITLES = { overdue: "Prekoračeno", soon: `Uskoro (do ${SOON_DAYS} dana)`, later: "Kasnije", none: "Bez roka" };
const hr = (date) => { const [y, m, d] = date.split("-").map(Number); return `${d}. ${m}. ${y}.`; };
const when = (item) => item.days === null ? "" : item.days < 0 ? `${hr(item.deadline)} (kasni ${-item.days} d)` : `${hr(item.deadline)} (za ${item.days} d)`;
const short = (text, max) => text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** Plain text lines for a terminal. */
export function renderText(groups, today) {
  const out = [`Owner queue na dan ${hr(today)}`];
  for (const g of GROUPS) {
    if (!groups[g].length) continue;
    out.push("", `${TITLES[g]} (${groups[g].length})`);
    for (const item of groups[g]) out.push(`  ${item.label}${item.days === null ? "" : `  ${when(item)}`}`, `    ${short(item.text, 140)}`);
  }
  return out;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** One self-contained HTML page (no scripts, no external requests), palette of D-188. */
export function renderHtml(groups, today) {
  const section = (g) => groups[g].length === 0 ? "" : `<section class="${g}"><h2>${esc(TITLES[g])} <span>${groups[g].length}</span></h2>${groups[g].map((item) =>
    `<details><summary><b>${esc(item.label)}</b>${item.days === null ? "" : `<time datetime="${item.deadline}">${esc(when(item))}</time>`}<p>${esc(short(item.text, 110))}</p></summary><p>${esc(item.text)}</p></details>`).join("")}</section>`;
  return `<!doctype html>
<html lang="hr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Owner queue</title>
<style>
:root{--bg:#242422;--panel:#2e2e2b;--ink:#faf9f5;--mute:#b8b6ad;--gold:#c8aa6e;--late:#e08b7a}
*{box-sizing:border-box}body{margin:0;padding:16px;background:var(--bg);color:var(--ink);font:16px/1.45 system-ui,sans-serif}
main{max-width:720px;margin:0 auto}h1{font-size:22px;margin:0 0 4px}header p{margin:0 0 20px;color:var(--mute);font-size:14px}
h2{font-size:14px;letter-spacing:.06em;text-transform:uppercase;color:var(--gold);margin:24px 0 8px}h2 span{color:var(--mute)}
.overdue h2{color:var(--late)}details{background:var(--panel);border-radius:8px;padding:12px 14px;margin-bottom:8px}
.overdue details{border-left:3px solid var(--late)}.soon details{border-left:3px solid var(--gold)}
summary{cursor:pointer;list-style:none}summary::-webkit-details-marker{display:none}
summary b{font-size:17px}time{float:right;font-size:14px;color:var(--mute)}.overdue time{color:var(--late)}
p{margin:6px 0 0;color:var(--mute);font-size:14px;overflow-wrap:anywhere}details[open] summary p{display:none}details>p{color:var(--ink)}
</style></head><body><main>
<header><h1>Owner queue</h1><p>Stanje iz STATE.md na dan ${esc(hr(today))}. Prikaz, ne izvor statusa.</p></header>
${GROUPS.map(section).join("\n")}
</main></body></html>
`;
}
