import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";

import { describe, expect, it } from "vitest";

// DAN-430, M11.8-P01 (D-257, D-278 NQ11): docs/privacy/08-inventar-tokova-podataka.md
// is the one inventory of data flows for the DPIA. This test keeps it tied to
// the code on main: every cited path exists, every class is a DATA-CLASS of
// docs/privacy/06-klase-podataka.md, every API route appears in some flow, and
// the owner questions it depends on stay listed as open. It decides nothing.

const ROOT = join(__dirname, "../../..");
const INVENTORY = "docs/privacy/08-inventar-tokova-podataka.md";
const CLASSES_DOC = "docs/privacy/06-klase-podataka.md";
const FLOWS_HEADING = "## 2. Tokovi";
const OPEN_HEADING = "## 3. Otvoreno";
const CLASSES_HEADING = "## 2. Klase";
const NO_CLASS = "—";

const REQUIRED_AREAS = ["Evidencija", "Prikaz", "Predaja", "Izvoz", "Logovi"];
const AREAS = ["Prijava", "Nastava", ...REQUIRED_AREAS];
const STATES = ["izgrađeno", "planirano", "nije provjereno"];
// Owner questions this draft must list as open and never answer (Q-3, Q-16, D-30 PRIJEDLOG).
const OPEN_QUESTIONS = ["Q-3", "Q-16", "D-30"];

type Flow = { area: string; flow: string; paths: string[]; classes: string; state: string };
type Repo = { exists: (path: string) => boolean; routes: string[]; classCodes: string[] };

/** Rows of the first Markdown table under a heading, without header and separator. */
function tableUnder(markdown: string, heading: string): string[][] {
  const lines = markdown.split("\n");
  const at = lines.findIndex((l) => l.trim() === heading);
  if (at < 0) throw new Error(`missing heading ${heading}`);
  const rows: string[][] = [];
  for (const line of lines.slice(at + 1)) {
    if (line.startsWith("## ")) break;
    if (!line.startsWith("|")) {
      if (rows.length > 0) break;
      continue;
    }
    rows.push(line.slice(1, line.trimEnd().length - 1).split("|").map((c) => c.trim()));
  }
  return rows.slice(2);
}

/** Lines of a section, up to the next level-2 heading. */
function sectionLines(markdown: string, heading: string): string[] {
  const lines = markdown.split("\n");
  const at = lines.findIndex((l) => l.trim() === heading);
  if (at < 0) return [];
  const end = lines.findIndex((l, i) => i > at && l.startsWith("## "));
  return lines.slice(at + 1, end < 0 ? undefined : end);
}

const codeSpans = (cell: string) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

function parseFlows(markdown: string): Flow[] {
  return tableUnder(markdown, FLOWS_HEADING).map(([area, flow, , paths, classes, , state]) => ({
    area,
    flow,
    paths: codeSpans(paths ?? ""),
    classes: classes ?? "",
    state: state ?? "",
  }));
}

/** Every problem between the inventory and the repository; empty when they agree. */
function inventoryErrors(markdown: string, repo: Repo): string[] {
  const errors: string[] = [];
  const flows = parseFlows(markdown);
  const cited = new Set<string>();
  for (const f of flows) {
    const id = `${f.area} / ${f.flow}`;
    if (!AREAS.includes(f.area)) errors.push(`${id}: unknown area`);
    if (!STATES.some((s) => f.state.startsWith(s))) errors.push(`${id}: unknown state ${f.state}`);
    if (f.paths.length === 0) errors.push(`${id}: no path`);
    for (const p of f.paths) {
      cited.add(p);
      if (isAbsolute(p) || p.split("/").includes("..")) errors.push(`${id}: path outside the repository ${p}`);
      else if (!repo.exists(p)) errors.push(`${id}: path not on main ${p}`);
    }
    if (f.state.startsWith("izgrađeno") && !f.paths.some((p) => !p.startsWith("docs/"))) {
      errors.push(`${id}: built without a code path`);
    }
    const cls = f.classes.trim();
    if (cls.startsWith(NO_CLASS)) {
      if (cls.slice(NO_CLASS.length).trim().length === 0) errors.push(`${id}: no personal data needs a reason`);
    } else {
      const codes = cls.split(",").map((c) => c.trim());
      if (codes.some((c) => c === "")) errors.push(`${id}: empty class`);
      for (const c of codes) if (c && !repo.classCodes.includes(c)) errors.push(`${id}: unknown class ${c}`);
    }
  }
  for (const area of REQUIRED_AREAS) {
    if (!flows.some((f) => f.area === area)) errors.push(`${area}: no flow`);
  }
  for (const route of repo.routes) {
    if (!cited.has(route)) errors.push(`${route}: route missing from the inventory`);
  }
  const open = sectionLines(markdown, OPEN_HEADING).filter((l) => l.startsWith("- "));
  for (const q of OPEN_QUESTIONS) {
    const mention = new RegExp(`\\b${q}(?!\\d)`);
    const lines = open.filter((l) => mention.test(l));
    if (lines.length === 0) errors.push(`${q}: not listed as open`);
    else if (!lines.some((l) => l.includes("otvoreno"))) errors.push(`${q}: not marked otvoreno`);
    if (lines.some((l) => l.includes("ODLUČEN"))) errors.push(`${q}: must not be answered here`);
  }
  if (!open.some((l) => /\bD-30(?!\d)/.test(l) && l.includes("PRIJEDLOG"))) errors.push("D-30: must stay PRIJEDLOG");
  return errors;
}

function apiRoutes(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) found.push(...apiRoutes(path));
    else if (entry.name === "route.ts") found.push(path);
  }
  return found;
}

const HEADER = "| Područje | Tok | Izvor → odredište | Putanje | Klase | Tko čita | Stanje |";
const SEPARATOR = "| --- | --- | --- | --- | --- | --- | --- |";
const row = (area: string, paths: string, classes = "11", state = "izgrađeno", flow = "t") =>
  `| ${area} | ${flow} | a → b | ${paths} | ${classes} | s | ${state} |`;
const OK_ROWS = [
  row("Evidencija", "`app/api/x/route.ts`, `src/a.ts`", "21, 27"),
  row("Prikaz", "`app/api/x/route.ts`"),
  row("Predaja", "`src/a.ts`", "16"),
  row("Izvoz", "`docs/b.md`", "20", "planirano"),
  row("Logovi", "`src/a.ts`", "— samo poruka bez podatka", "nije provjereno"),
];
const OK_OPEN = [
  "- Q-3: paket za FPZG, otvoreno.",
  "- Q-16: čuvanje, otvoreno.",
  "- D-30: rokovi su PRIJEDLOG, otvoreno.",
];
const doc = (rows: string[], open = OK_OPEN) =>
  [FLOWS_HEADING, "", HEADER, SEPARATOR, ...rows, "", OPEN_HEADING, "", ...open, ""].join("\n");
const REPO: Repo = {
  exists: (p) => ["app/api/x/route.ts", "src/a.ts", "docs/b.md"].includes(p),
  routes: ["app/api/x/route.ts"],
  classCodes: Array.from({ length: 30 }, (_, i) => String(i + 1)),
};

describe("inventoryErrors", () => {
  it("accepts a complete inventory, also when a route takes part in several flows", () => {
    expect(inventoryErrors(doc(OK_ROWS), REPO)).toEqual([]);
  });

  it.each([
    ["a path not on main", [...OK_ROWS, row("Prikaz", "`src/gone.ts`")], "Prikaz / t: path not on main src/gone.ts"],
    ["a path with ..", [...OK_ROWS, row("Prikaz", "`src/../a.ts`")], "Prikaz / t: path outside the repository src/../a.ts"],
    ["an absolute path", [...OK_ROWS, row("Prikaz", "`/etc/passwd`")], "Prikaz / t: path outside the repository /etc/passwd"],
    ["a class not in 06", [...OK_ROWS, row("Prikaz", "`src/a.ts`", "11, 31")], "Prikaz / t: unknown class 31"],
    ["an empty class in a list", [...OK_ROWS, row("Prikaz", "`src/a.ts`", "11,")], "Prikaz / t: empty class"],
    ["no personal data without a reason", [...OK_ROWS, row("Prikaz", "`src/a.ts`", "—")], "Prikaz / t: no personal data needs a reason"],
    ["a route missing", OK_ROWS.slice(2).concat(row("Evidencija", "`src/a.ts`"), row("Prikaz", "`src/a.ts`")), "app/api/x/route.ts: route missing from the inventory"],
    ["a required area without a flow", OK_ROWS.filter((r) => !r.startsWith("| Izvoz")), "Izvoz: no flow"],
    ["an unknown area", [...OK_ROWS, row("Pogon", "`src/a.ts`")], "Pogon / t: unknown area"],
    ["an unknown state", [...OK_ROWS, row("Prikaz", "`src/a.ts`", "11", "gotovo")], "Prikaz / t: unknown state gotovo"],
    ["a flow without a path", [...OK_ROWS, row("Prikaz", "src/a.ts")], "Prikaz / t: no path"],
    ["a built flow citing only docs", [...OK_ROWS, row("Prikaz", "`docs/b.md`")], "Prikaz / t: built without a code path"],
  ])("fails on %s", (_case, rows, error) => {
    expect(inventoryErrors(doc(rows), REPO)).toContain(error);
  });

  it.each([
    ["Q-3 missing", OK_OPEN.slice(1), "Q-3: not listed as open"],
    ["Q-3 matched only by Q-30", ["- Q-30: drugo, otvoreno.", ...OK_OPEN.slice(1)], "Q-3: not listed as open"],
    ["Q-16 not marked open", [OK_OPEN[0], "- Q-16: čuvanje.", OK_OPEN[2]], "Q-16: not marked otvoreno"],
    ["D-30 answered", [...OK_OPEN.slice(0, 2), "- D-30: ODLUČENO, otvoreno."], "D-30: must not be answered here"],
    ["D-30 not a proposal", [...OK_OPEN.slice(0, 2), "- D-30: rokovi, otvoreno."], "D-30: must stay PRIJEDLOG"],
    ["the open section missing", [], "D-30: not listed as open"],
  ])("fails when %s", (_case, open, error) => {
    expect(inventoryErrors(doc(OK_ROWS, open), REPO)).toContain(error);
  });
});

describe(INVENTORY, () => {
  it("agrees with the API routes, paths and DATA-CLASS list on main", () => {
    const classCodes = tableUnder(readFileSync(join(ROOT, CLASSES_DOC), "utf8"), CLASSES_HEADING).map(([c]) => c);
    expect(classCodes).toHaveLength(30);
    const routes = apiRoutes("app/api");
    expect(routes.length).toBeGreaterThan(30);
    const exists = (p: string) => {
      const full = join(ROOT, p);
      return !relative(ROOT, full).startsWith("..") && existsSync(full) && (statSync(full).isFile() || statSync(full).isDirectory());
    };
    expect(inventoryErrors(readFileSync(join(ROOT, INVENTORY), "utf8"), { exists, routes, classCodes })).toEqual([]);
  });
});
