import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// DAN-297, M10.1-P01 (D-271 MQ01, MQ03): every table the migrations leave on
// main sits in exactly one DATA-CLASS of docs/privacy/06-klase-podataka.md, or
// is marked there as holding no personal data, with a reason. The document is
// the only list; this test reads it and does not decide any retention period.

const ROOT = join(__dirname, "../../..");
const INVENTORY = "docs/privacy/06-klase-podataka.md";
const CLASSES_HEADING = "## 2. Klase";
const TABLES_HEADING = "## 3. Tablice po klasama";
const NO_CLASS = "—";

// The 8 C-21 categories (docs/ARCHITECTURE.md §3, D-271 MQ03).
const CATEGORIES = [
  "Lokalni zapis na uređaju",
  "Sesije",
  "Radne verzije",
  "Evidencija",
  "Predaja",
  "Revizijski trag",
  "Kopije",
  "Evaluacija pilota",
];

// Class numbers fixed by decisions, not by this inventory.
const ANCHORS: Record<number, string> = {
  1: "Identitet", // D-272 MQ05
  12: "Privatna povijest rada", // D-274 MQ09, reserved
  16: "Predani rad", // D-272 MQ06
  27: "Hashevi i potvrde", // D-272 MQ06, D-264 Q11
};

type Migration = { name: string; text: string };
type TableRow = { table: string; cls: string; note: string };
type ClassRow = { code: string; name: string; category: string };

const IDENT = String.raw`("?[A-Za-z_][A-Za-z0-9_$]*"?)\s*\.\s*("?[A-Za-z_][A-Za-z0-9_$]*"?)`;
const CREATE_RE = new RegExp(String.raw`\bCREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?${IDENT}`, "gi");
const DROP_RE = /\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([^;]+);/gi;

const name = (part: string) => (part.startsWith('"') ? part.slice(1, -1) : part.toLowerCase());

/** The up section of a dbmate migration, without line comments. */
function upSection({ name: file, text }: Migration): string {
  const start = text.indexOf("-- migrate:up");
  if (start < 0) throw new Error(`${file}: no -- migrate:up`);
  const end = text.indexOf("-- migrate:down", start);
  return (end < 0 ? text.slice(start) : text.slice(start, end)).replace(/--[^\n]*/g, "");
}

/** Tables left by the up sections, applied in file name order. */
function liveTables(migrations: Migration[]): Set<string> {
  const live = new Set<string>();
  for (const m of [...migrations].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const up = upSection(m);
    const events: { at: number; apply: () => void }[] = [];
    for (const c of up.matchAll(CREATE_RE)) {
      const table = `${name(c[1])}.${name(c[2])}`;
      events.push({ at: c.index, apply: () => live.add(table) });
    }
    for (const d of up.matchAll(DROP_RE)) {
      for (const ref of d[1].replace(/\b(?:CASCADE|RESTRICT)\b/gi, "").split(",")) {
        const parts = new RegExp(`^\\s*${IDENT}\\s*$`).exec(ref);
        if (parts) events.push({ at: d.index, apply: () => live.delete(`${name(parts[1])}.${name(parts[2])}`) });
      }
    }
    events.sort((a, b) => a.at - b.at).forEach((e) => e.apply());
  }
  return live;
}

/** Rows of the first Markdown table under a heading. */
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
  return rows.slice(2); // header and separator
}

const unquote = (cell: string) => cell.replace(/^`(.*)`$/, "$1");

function parseInventory(markdown: string): { classes: ClassRow[]; tables: TableRow[] } {
  const classes = tableUnder(markdown, CLASSES_HEADING).map(([code, cname, category]) => ({
    code,
    name: cname,
    category,
  }));
  const tables = tableUnder(markdown, TABLES_HEADING).map(([table, cls, note]) => ({
    table: unquote(table),
    cls,
    note: note ?? "",
  }));
  return { classes, tables };
}

/** Every problem between the live tables and the inventory; empty when they agree. */
function coverageErrors(live: Set<string>, inv: { classes: ClassRow[]; tables: TableRow[] }): string[] {
  const errors: string[] = [];
  const codes = inv.classes.map((c) => c.code);
  const expected = Array.from({ length: 30 }, (_, i) => String(i + 1));
  if (codes.join() !== expected.join()) errors.push(`class codes are not 1..30 in order: ${codes.join()}`);
  for (const c of inv.classes) {
    if (!CATEGORIES.includes(c.category)) errors.push(`class ${c.code}: unknown category ${c.category}`);
  }
  for (const [code, prefix] of Object.entries(ANCHORS)) {
    const c = inv.classes.find((x) => x.code === code);
    if (!c?.name.startsWith(prefix)) errors.push(`class ${code} must be ${prefix} (anchor)`);
  }
  const seen = new Set<string>();
  for (const row of inv.tables) {
    if (seen.has(row.table)) errors.push(`${row.table}: listed twice`);
    seen.add(row.table);
    if (row.cls === NO_CLASS) {
      if (!row.note) errors.push(`${row.table}: no personal data needs a reason`);
    } else if (!codes.includes(row.cls)) {
      errors.push(`${row.table}: unknown class ${row.cls}`);
    }
    const wildcard = row.table.endsWith(".*") ? row.table.slice(0, -1) : null;
    const present = wildcard ? [...live].some((t) => t.startsWith(wildcard)) : live.has(row.table);
    if (!present) errors.push(`${row.table}: not created by any migration on main`);
  }
  for (const table of live) {
    const covered = inv.tables.some((r) =>
      r.table.endsWith(".*") ? table.startsWith(r.table.slice(0, -1)) : r.table === table,
    );
    if (!covered) errors.push(`${table}: missing from the inventory`);
  }
  return errors;
}

const CLASSES = [
  "| Klasa | Naziv | Kategorija |",
  "| --- | --- | --- |",
  ...Array.from({ length: 30 }, (_, i) => {
    const n = i + 1;
    return `| ${n} | ${ANCHORS[n] ?? `Klasa ${n}`} | ${CATEGORIES[i % 8]} |`;
  }),
].join("\n");

const doc = (tableRows: string[], classes = CLASSES) =>
  [CLASSES_HEADING, "", classes, "", TABLES_HEADING, "", "| Tablica | Klasa | Napomena |", "| --- | --- | --- |", ...tableRows, ""].join("\n");

const up = (sql: string, down = "") => `-- migrate:up\n${sql}\n-- migrate:down\n${down}\n`;

describe("liveTables", () => {
  it.each([
    ["a plain CREATE TABLE", [up("CREATE TABLE a.t (id int);")], ["a.t"]],
    ["IF NOT EXISTS, quotes and upper case", [up('create table IF NOT EXISTS "a".T (id int);')], ["a.t"]],
    ["UNLOGGED", [up("CREATE UNLOGGED TABLE a.t (id int);")], ["a.t"]],
    ["a CREATE only in the down section", [up("SELECT 1;", "CREATE TABLE a.t (id int);")], []],
    ["a CREATE in a line comment", [up("-- CREATE TABLE a.t (id int);")], []],
    ["a dynamic name in a string", [up("EXECUTE format('CREATE TABLE a.%I (id int)', x);")], []],
    ["a later DROP in an up section", [up("CREATE TABLE a.t ();"), up("DROP TABLE IF EXISTS a.t, a.u CASCADE;")], []],
    ["a DROP only in the down section", [up("CREATE TABLE a.t ();", "DROP TABLE a.t;")], ["a.t"]],
    ["a DROP then CREATE in one file", [up("DROP TABLE IF EXISTS a.t; CREATE TABLE a.t ();")], ["a.t"]],
  ])("%s", (_case, files, expected) => {
    const migrations = files.map((text, i) => ({ name: `2026${i}.sql`, text }));
    expect([...liveTables(migrations)].sort()).toEqual(expected);
  });

  it("refuses a migration without an up section", () => {
    expect(() => liveTables([{ name: "x.sql", text: "CREATE TABLE a.t ();" }])).toThrow(/migrate:up/);
  });
});

describe("coverageErrors", () => {
  const live = new Set(["a.t", "q.job", "q.queue"]);
  const ok = ["| `a.t` | 1 | |", "| `q.*` | — | samo konfiguracija reda |"];

  it("accepts a complete inventory", () => {
    expect(coverageErrors(live, parseInventory(doc(ok)))).toEqual([]);
  });

  it.each([
    ["a table missing from the inventory", ["| `q.*` | — | razlog |"], "a.t: missing from the inventory"],
    ["a stale table", [...ok, "| `a.gone` | 2 | |"], "a.gone: not created by any migration on main"],
    ["a stale wildcard", [...ok, "| `z.*` | — | razlog |"], "z.*: not created by any migration on main"],
    ["a table listed twice", [...ok, "| `a.t` | 3 | |"], "a.t: listed twice"],
    ["an unknown class", ["| `a.t` | 31 | |", ok[1]], "a.t: unknown class 31"],
    ["no personal data without a reason", ["| `a.t` | — | |", ok[1]], "a.t: no personal data needs a reason"],
  ])("fails on %s", (_case, rows, error) => {
    expect(coverageErrors(live, parseInventory(doc(rows)))).toContain(error);
  });

  it.each([
    ["29 classes", (c: string) => c.replace(/\n\| 30 \|[^\n]*/, ""), "class codes are not 1..30 in order"],
    ["a duplicate code", (c: string) => c.replace("| 30 |", "| 29 |"), "class codes are not 1..30 in order"],
    ["a category outside C-21", (c: string) => c.replace("| 2 | Klasa 2 | Sesije |", "| 2 | Klasa 2 | Pogon |"), "class 2: unknown category Pogon"],
    ["a moved anchor", (c: string) => c.replace("| 16 | Predani rad |", "| 16 | Komentari |"), "class 16 must be Predani rad (anchor)"],
  ])("fails on %s", (_case, edit, error) => {
    const errors = coverageErrors(live, parseInventory(doc(ok, edit(CLASSES))));
    expect(errors.some((e) => e.startsWith(error))).toBe(true);
  });
});

describe(INVENTORY, () => {
  it("covers every table the migrations leave on main", () => {
    const dir = join(ROOT, "db/migrations");
    const migrations = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => ({ name: f, text: readFileSync(join(dir, f), "utf8") }));
    const live = liveTables(migrations);
    expect(live.size).toBeGreaterThan(50);
    expect(coverageErrors(live, parseInventory(readFileSync(join(ROOT, INVENTORY), "utf8")))).toEqual([]);
  });
});
