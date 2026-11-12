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
    const lines = open.filter((l) => hasToken(l, q, (c) => /\w/.test(c), (c) => /\d/.test(c)));
    if (lines.length === 0) errors.push(`${q}: not listed as open`);
    else if (!lines.some((l) => l.includes("otvoreno"))) errors.push(`${q}: not marked otvoreno`);
    if (lines.some((l) => l.includes("ODLUČEN"))) errors.push(`${q}: must not be answered here`);
  }
  if (!open.some((l) => /\bD-30(?!\d)/.test(l) && l.includes("PRIJEDLOG"))) errors.push("D-30: must stay PRIJEDLOG");
  return errors;
}

/** True when `token` occurs in `text` when the character immediately before it fails `before` and the character immediately after it fails `after`. */
function hasToken(text: string, token: string, before: (c: string) => boolean, after: (c: string) => boolean): boolean {
  for (let i = text.indexOf(token); i !== -1; i = text.indexOf(token, i + 1)) {
    const b = text.charAt(i - 1);
    const a = text.charAt(i + token.length);
    if ((i === 0 || !before(b)) && (a === "" || !after(a))) return true;
  }
  return false;
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

  // Writes the database makes on its own (inside an RPC or a trigger), which no
  // route name reveals. While the migration still writes, the flow that cites
  // the triggering code lists the class.
  it.each([
    ["14", "src/server/evidence/evidence-commit.ts", "db/migrations/20261028000000_evidence_segment_v3.sql", /INSERT INTO evidence\.document_checkpoint \(document_id, institution_id, revision, body\)/],
    ["6", "src/server/institution/assignment-version-route.ts", "db/migrations/20261028150000_notification_store.sql", /INSERT INTO institution\.notification \(/],
    ["21", "src/server/evidence/open-route.ts", "db/migrations/20261031200000_open_work_explicit_start.sql", /INSERT INTO evidence\.package \(/],
    ["14", "src/server/collaboration/live-route.ts", "db/migrations/20261026163000_live_state_after_submission.sql", /LEFT JOIN evidence\.document_checkpoint c/],
    ["16", "src/server/collaboration/live-route.ts", "db/migrations/20261026163000_live_state_after_submission.sql", /FROM app\.submitted_document_text\(p_document_id\)/],
    ["7", "src/server/institution/student-workspace.ts", "db/migrations/20261102150000_student_workspace.sql", /FROM institution\.notice_acknowledgment n/],
    ["9", "src/server/institution/student-workspace.ts", "db/migrations/20261102150000_student_workspace.sql", /JOIN institution\.assignment_version v/],
    ["11", "src/server/institution/student-workspace.ts", "db/migrations/20261102150000_student_workspace.sql", /LEFT JOIN evidence\.document d/],
    ["16", "src/server/institution/student-workspace.ts", "db/migrations/20261102150000_student_workspace.sql", /LEFT JOIN evidence\.submission s/],
    // A change of the assignment's language is a new version, which notifies.
    ["9", "app/api/institution/assignments/[assignmentId]/work-language/route.ts", "db/migrations/20261108120000_work_language.sql", /INSERT INTO institution\.assignment_version \(/],
    ["6", "app/api/institution/assignments/[assignmentId]/work-language/route.ts", "db/migrations/20261028150000_notification_store.sql", /AFTER INSERT ON institution\.assignment_version/],
    // Reads of segment payloads from S3 behind a route that does not name them.
    ["21", "src/server/evidence/submission.ts", "src/application/evidence/evidence-reconstruction.ts", /payloads\.readImmutable\(/],
    ["21", "src/server/projection/process-summary.ts", "src/application/projection/process-summary-reader.ts", /storage\.readImmutable\(/],
    ["21", "src/server/teacher/fast-path.ts", "src/application/projection/process-summary-reader.ts", /storage\.readImmutable\(/],
  ])("lists class %s on the flow through %s while %s writes or returns it", (cls, code, migration, touch) => {
    expect(readFileSync(join(ROOT, migration), "utf8")).toMatch(touch);
    const flows = parseFlows(readFileSync(join(ROOT, INVENTORY), "utf8")).filter(
      (f) => f.paths.includes(code) && f.paths.includes(migration),
    );
    expect(flows.length).toBeGreaterThan(0);
    for (const f of flows) expect(f.classes.split(",").map((c) => c.trim())).toContain(cls);
  });

  // The student reads their own work through the same functions as the
  // teacher, and each function records the access only for the teacher role.
  it.each([
    ["process_summary", "db/migrations/20261021130000_audit_access_log_write.sql", /IF v_role = 'teacher' THEN\s+PERFORM audit\.record_work_opening\([^;]*'process_summary'\);/, "src/components/student/Submission.tsx", /fetchProcessSummary\(/],
    ["live_view", "db/migrations/20261026163000_live_state_after_submission.sql", /IF v_role = 'teacher' THEN\s+PERFORM audit\.record_work_opening\([^;]*'live_view'\);/, "src/components/student/TeacherViewSheet.tsx", /useLiveView\(/],
    ["replay", "db/migrations/20261028121000_replay_source.sql", /IF v_role = 'teacher' THEN\s+PERFORM audit\.record_work_opening\([^;]*'replay'\);/, "src/server/evidence/replay-route.ts", /app\.read_replay_source\(/],
  ])("lists the student as a reader of %s and the teacher-only access record", (_surface, migration, record, entry, call) => {
    expect(readFileSync(join(ROOT, migration), "utf8")).toMatch(record);
    expect(readFileSync(join(ROOT, entry), "utf8")).toMatch(call);
    const rows = tableUnder(readFileSync(join(ROOT, INVENTORY), "utf8"), FLOWS_HEADING).filter(([, , , paths]) => {
      const cited = codeSpans(paths ?? "");
      return cited.includes(entry) && cited.includes(migration);
    });
    expect(rows).toHaveLength(1);
    const [, , how, , , readers] = rows[0];
    expect(readers).toContain("student");
    expect(how).toContain("IF v_role = 'teacher'");
  });
});

// DAN-709: completeness in both directions. The tests above check that what the
// inventory cites exists; these check that what the code does is cited. Classes
// of flows: (1) database tables, (2) outside providers, (3) exports. Test only:
// a gap found here is a gap in docs/privacy/08, to be closed there (DAN-430
// follow-up), never hidden by editing the code or skipping the test.

type Sources = {
  inventory: string;
  migrations: Record<string, string>;
  read: (path: string) => string | undefined;
  deps: string[];
  services: string[];
  exporters: string[];
};
type Provider = { name: string; dep?: string; service?: string; inventory: RegExp };

// Every runtime dependency is classified: a provider the inventory must describe,
// or a library that sends nothing anywhere. A new dependency fails until sorted.
const PROVIDERS: Provider[] = [
  { name: "AAI@EduHr (OIDC)", dep: "openid-client", inventory: /AAI@EduHr/ },
  { name: "AWS KMS", dep: "@aws-sdk/client-kms", inventory: /KMS/ },
  { name: "job queue", dep: "pg-boss", inventory: /pgboss/ },
  { name: "S3 storage", service: "objects", inventory: /S3/ },
  { name: "local mail", service: "mail", inventory: /E-pošta/ },
  { name: "browser journal", dep: "dexie", inventory: /Lokalni dnevnik/ },
];
const LOCAL_ONLY_DEPS = [/^@tiptap\//, /^next$/, /^react(-dom)?$/, /^pg$/];
// Compose services that send nothing out: the database and the fake login provider.
const LOCAL_ONLY_SERVICES = ["postgres", "oidc"];
// Tables no inventory-cited code reaches on main (DAN-709, found by this test).
// The first eight have no caller in app code (the note under the table says so
// for mentorships, faculty rules and admins); the last two are read by
// src/server/institution/institution-courses.ts, which no flow cites yet.
// An entry that stops being a gap fails the test, so the list cannot go stale.
const KNOWN_GAPS = [
  "audit.course_handover", "audit.faculty_rule_event", "audit.mentorship_event",
  "institution.course_editor", "institution.faculty_work_rule", "institution.mentorship_request",
  "institution.team_substitution", "institution.work_grant",
  "institution.course_holder", "institution.seminar_group_teacher",
];

// Tables created at run time by format(%I); the parser cannot read their names, so each head is listed by hand.
// They are partitions of pgboss.job and pgboss.queue_stats, which the inventory covers.
const DYNAMIC_TABLES = [
  "20261108110100_pgboss_schema.sql: create table not recognised: CREATE TABLE pgboss.%I PARTITION OF pgbo",
  "20261108110100_pgboss_schema.sql: create table not recognised: CREATE TABLE pgboss.%I (LIKE pgboss.job ",
];

const TABLE_HEAD = /\bcreate\s+(?:(?:global|local|temporary|temp|unlogged)\s+)*table\b/gi;
const TABLE_FULL = /create\s+(?:(?:global|local|temporary|temp|unlogged)\s+)*table\s+(?:if\s+not\s+exists\s+)?(?:"([a-z_]+)"|([a-z_]+))\.(?:"([a-z0-9_]+)"|([a-z0-9_]+))(?=[\s(;])/iy;
const FUNCTION_HEAD = /\bcreate\s+(?:or\s+replace\s+)?(?:function|procedure)\b/gi;
const FUNCTION_FULL = /create\s+(?:or\s+replace\s+)?(?:function|procedure)\s+([a-z_]+\.[a-z0-9_]+)\s*\(/iy;

/** Removes SQL comments but leaves '...', "..." and $tag$...$tag$ intact, so `'image/*'` or `'a--b'` cannot swallow a statement. */
function stripSqlComments(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const rest = sql.slice(i);
    const q = rest.match(/^(?:'(?:[^']|'')*'|"(?:[^"]|"")*"|\$([a-z_]*)\$[\s\S]*?\$\1\$)/i);
    if (q) {
      out += q[0];
      i += q[0].length;
    } else if (rest.startsWith("--")) {
      const nl = rest.indexOf("\n");
      i += nl < 0 ? rest.length : nl;
    } else if (rest.startsWith("/*")) {
      const end = rest.indexOf("*/", 2);
      i += end < 0 ? rest.length : end + 2;
    } else {
      out += sql[i];
      i += 1;
    }
  }
  return out;
}

/** Tables and functions a migration creates. Fail-closed: a CREATE TABLE/FUNCTION/PROCEDURE head that does not parse is an error, never skipped. Known limit: names built at run time are flagged, not read. */
function sqlObjects(sql: string): { tables: string[]; functions: [string, string][]; errors: string[] } {
  const errors: string[] = [];
  const bare = stripSqlComments(sql);
  const tables: string[] = [];
  const functions: [string, string][] = [];
  const seen = (m: RegExpMatchArray) => bare.slice(m.index, (m.index ?? 0) + 40).replace(/\s+/g, " ");
  for (const m of bare.matchAll(TABLE_HEAD)) {
    TABLE_FULL.lastIndex = m.index ?? 0;
    const t = TABLE_FULL.exec(bare);
    if (t) tables.push(`${t[1] ?? t[2]}.${t[3] ?? t[4]}`.toLowerCase());
    else errors.push(`create table not recognised: ${seen(m)}`);
  }
  const heads = [...bare.matchAll(FUNCTION_HEAD)];
  for (const [i, m] of heads.entries()) {
    FUNCTION_FULL.lastIndex = m.index ?? 0;
    const f = FUNCTION_FULL.exec(bare);
    if (!f) {
      errors.push(`function not recognised: ${seen(m)}`);
      continue;
    }
    const part = bare.slice(FUNCTION_FULL.lastIndex, heads[i + 1]?.index ?? bare.length);
    functions.push([f[1].toLowerCase(), part.toLowerCase().split(/\n\$\$;|\n\$[a-z_]*\$;/)[0]]);
  }
  return { tables, functions, errors };
}

function completenessErrors(s: Sources, gaps: string[], providers: Provider[] = PROVIDERS, dynamic: string[] = []): string[] {
  const errors: string[] = [];
  const inv = s.inventory.toLowerCase();
  const flows = parseFlows(s.inventory);
  const cited = [...new Set(flows.flatMap((f) => f.paths))];
  // Cited documents never count as coverage: they describe, the code does.
  const citedText = cited.map((p) => (p.startsWith("docs/") ? "" : (s.read(p)?.toLowerCase() ?? "")));
  const code = citedText.filter((_, i) => !cited[i].startsWith("db/")).join("\n");

  // Known limit: tables created dynamically (format(...%I)) are not seen; only literal CREATE [UNLOGGED] TABLE.
  const tables = new Set<string>();
  const functions: [string, string][] = [];
  for (const [file, sql] of Object.entries(s.migrations)) {
    const found = sqlObjects(sql);
    for (const e of found.errors) if (!dynamic.includes(`${file}: ${e}`)) errors.push(`${file}: ${e}`);
    for (const t of found.tables) tables.add(t);
    functions.push(...found.functions);
  }
  const allErrors = Object.entries(s.migrations).flatMap(([file, sql]) => sqlObjects(sql).errors.map((e) => `${file}: ${e}`));
  for (const d of dynamic) if (!allErrors.includes(d)) errors.push(`dynamic table entry no longer in the migrations, drop it: ${d}`);
  // A table is covered when the inventory or a cited file names it, or a cited
  // code file calls a database function whose body uses it.
  const called = functions.filter(([n]) => hasToken(code, n, (c) => /[a-z0-9_.]/.test(c), (c) => /[a-z0-9_]/.test(c)) || hasToken(code, `${n.split(".")[1]}(`, (c) => /[a-z0-9_.]/.test(c), () => false));
  const ident = (c: string) => /[a-z0-9_]/.test(c);
  const word = (text: string, t: string) => hasToken(text, t, ident, ident);
  const covered = (t: string) => word(inv, t) || citedText.some((x) => word(x, t)) || called.some(([, b]) => word(b, t));
  const stillGaps = new Set<string>();
  for (const t of [...tables].sort()) {
    if (covered(t)) continue;
    stillGaps.add(t);
    if (!gaps.includes(t)) errors.push(`table ${t}: no flow in the inventory`);
  }
  for (const g of gaps) {
    if (!tables.has(g)) errors.push(`known gap ${g}: no such table`);
    else if (!stillGaps.has(g)) errors.push(`known gap ${g}: now covered, remove it from the list`);
  }
  // Reverse: tables or functions the inventory names, and migrations it cites, exist and matter.
  const known = new Set([...tables, ...functions.map(([n]) => n)]);
  for (const m of inv.matchAll(/\b(?:app|audit|collaboration|evidence|identity|institution|pgboss)\.[a-z0-9_]+/g)) {
    if (!known.has(m[0])) errors.push(`inventory names ${m[0]}, not in the migrations`);
  }
  for (const [i, p] of cited.entries()) {
    if (p.startsWith("db/migrations/") && ![...tables].some((t) => citedText[i].includes(t))) {
      errors.push(`${p}: cited migration touches no known table`);
    }
  }
  // Outside providers.
  for (const p of providers) {
    const found = p.dep ? s.deps.includes(p.dep) : s.services.includes(p.service ?? "");
    if (!found) errors.push(`provider ${p.name}: no longer in the code, drop it from the list`);
    else if (!p.inventory.test(s.inventory)) errors.push(`provider ${p.name}: missing from the inventory`);
  }
  const sorted = new Set(providers.flatMap((p) => (p.dep ? [p.dep] : [])));
  const sortedServices = new Set(providers.flatMap((p) => (p.service ? [p.service] : [])));
  for (const v of s.services) {
    if (!sortedServices.has(v) && !LOCAL_ONLY_SERVICES.includes(v)) errors.push(`service ${v}: unclassified`);
  }
  for (const d of s.deps) {
    if (!sorted.has(d) && !LOCAL_ONLY_DEPS.some((re) => re.test(d))) errors.push(`dependency ${d}: unclassified`);
  }
  // Exports: a file that hands the user a download belongs to an Izvoz flow.
  const exportPaths = flows.filter((f) => f.area === "Izvoz").flatMap((f) => f.paths);
  for (const e of s.exporters) if (!exportPaths.includes(e)) errors.push(`${e}: export missing from the Izvoz flows`);
  return errors;
}

const SQL = (body = "") =>
  `CREATE TABLE evidence.thing (id int);\nCREATE TABLE audit.thing_event (id int);\nCREATE FUNCTION app.put_thing(x int) RETURNS void AS $$\n${body}\n$$;`;
const FAKE: Sources = {
  inventory: doc([
    row("Evidencija", "`app/api/x/route.ts`, `db/migrations/a.sql`, `scripts/b.mjs`", "14"),
    row("Izvoz", "`src/dl.ts`", "20"),
  ]).concat("\nOIDC: AAI@EduHr, KMS, pgboss, E-pošta, Lokalni dnevnik, S3.\n"),
  migrations: { "a.sql": SQL("INSERT INTO evidence.thing VALUES (1); INSERT INTO audit.thing_event VALUES (1);") },
  read: (p) => ({ "app/api/x/route.ts": "select app.put_thing(1)", "db/migrations/a.sql": "evidence.thing audit.thing_event" })[p] ?? "",
  deps: ["openid-client", "@aws-sdk/client-kms", "pg-boss", "dexie", "react", "@tiptap/core"],
  services: ["mail", "postgres", "objects"],
  exporters: ["src/dl.ts"],
};

// Top-level keys under `services:` of a compose file. Fail-closed: a line at service level that is not a plain
// `name:` (inline map, anchor, alias, quoted name, tab indent) throws instead of being skipped.
function composeServices(compose: string): string[] {
  const lines = compose.replace(/\r\n?/g, "\n").split("\n");
  const start = lines.findIndex((l) => l.startsWith("services:"));
  if (start === -1) throw new Error("compose: no services: key");
  if (!/^services:[ \t]*(?:#.*)?$/.test(lines[start])) throw new Error(`compose: services: is not a block map: ${lines[start]}`);
  const names: string[] = [];
  let indent = -1;
  for (const line of lines.slice(start + 1)) {
    if (/^[ \t]*(?:#.*)?$/.test(line)) continue;
    if (!/^[ \t]/.test(line)) break;
    if (/^ *\t/.test(line)) throw new Error(`compose: tab in indentation: ${line}`);
    const width = line.length - line.trimStart().length;
    if (indent === -1) indent = width;
    if (width > indent) continue;
    const name = width === indent ? /^ *([a-z][a-z0-9_-]*):[ \t]*(?:#.*)?$/.exec(line)?.[1] : undefined;
    if (!name) throw new Error(`compose: unrecognised service line: ${line}`);
    names.push(name);
  }
  if (names.length === 0) throw new Error("compose: services: holds no service");
  return names;
}

describe("composeServices", () => {
  it("reads names with underscores and lines with a trailing comment, only under services", () => {
    const text = "name: x\nservices:\n  # note\n  postgres:\n    image: a\n  external_relay:\n    image: b\n  relay: # outside\n    image: c\nvolumes:\n  data:\n";
    expect(composeServices(text)).toEqual(["postgres", "external_relay", "relay"]);
  });

  it.each([
    ["a block service", "services:\n  a:\n    image: x\n", ["a"]],
    ["a comment and a blank line", "services:\n\n  # c\n  a:\n\n    image: x\n  # d\n  b:\n", ["a", "b"]],
    ["CRLF line ends", "services:\r\n  a:\r\n    image: x\r\n  b:\r\n", ["a", "b"]],
    ["a nested key that looks like a map", "services:\n  a:\n    deploy: { x: 1 }\n", ["a"]],
    ["four-space indentation", "services:\n    a:\n      image: x\n", ["a"]],
  ])("accepts %s", (_n, text, expected) => {
    expect(composeServices(text)).toEqual(expected);
  });

  it.each([
    ["an inline map", '  a:\n    image: x\n  relay: { image: "example/relay:1" }\n'],
    ["an inline map without a space", "  relay:{image: x}\n"],
    ["an anchor on the name", "  a: &base\n    image: x\n"],
    ["an anchored key", "  &r relay:\n    image: x\n"],
    ["an alias key", "  *base\n"],
    ["a merge key", "  <<: *base\n"],
    ["a double-quoted name", '  "relay":\n    image: x\n'],
    ["a single-quoted name", "  'relay':\n    image: x\n"],
    ["an upper-case name", "  Relay:\n    image: x\n"],
    ["a tab indent", "\ta:\n\t  image: x\n"],
    ["a tab after spaces", "  a:\n  \tb:\n"],
    ["a name with no colon", "  relay\n"],
    ["an indent shallower than the first service", "    a:\n  b:\n"],
    ["a value on the name line", "  a: x\n"],
  ])("rejects %s", (_n, body) => {
    expect(() => composeServices(`services:\n${body}`)).toThrow(/compose:/);
  });

  it.each([
    ["no services key", "name: x\nvolumes:\n  d:\n"],
    ["a flow map", "services: { a: { image: x } }\n"],
    ["an empty services block", "services:\nvolumes:\n  d:\n"],
    ["a services block holding only comments", "services:\n  # none\n"],
  ])("rejects %s", (_n, text) => {
    expect(() => composeServices(text)).toThrow(/compose:/);
  });
});

describe("sqlObjects", () => {
  it.each([
    ["a plain table", "CREATE TABLE a.t (id int);", ["a.t"]],
    ["if not exists and unlogged", "create unlogged table if not exists a.t (id int);", ["a.t"]],
    ["a temporary table", "CREATE TEMP TABLE a.t (id int);", ["a.t"]],
    ["quoted names", 'CREATE TABLE "a"."t2" (id int);', ["a.t2"]],
    ["a break after TABLE", "CREATE TABLE\n  a.t (id int);", ["a.t"]],
    ["a MIME pattern before a later comment", "CREATE TABLE a.t0 (m text DEFAULT 'image/*');\nCREATE TABLE a.t (id int); /* c */ SELECT '*/';", ["a.t0", "a.t"]],
    ["a double dash inside a string", "SELECT 'a--b'; CREATE TABLE a.t (id int);", ["a.t"]],
    ["a commented-out table", "-- CREATE TABLE a.old (id int);\n/* create table a.older (x int) */\nCREATE TABLE a.t (id int);", ["a.t"]],
  ])("reads %s", (_n, sql, tables) => {
    const r = sqlObjects(sql);
    expect(r.errors).toEqual([]);
    expect(r.tables).toEqual(tables);
  });

  it.each([
    ["a table without a schema", "CREATE TABLE t (id int);"],
    ["a dynamic name", "CREATE TABLE %I.%I (id int);"],
    ["a name from a concatenation", "EXECUTE 'create table ' || name;"],
    ["a partition of", "CREATE TABLE a.t PARTITION OF a.p FOR VALUES IN (1);\nCREATE TABLE t2 (id int);"],
    ["a one-sided quote", 'CREATE TABLE "a.t (id int);'],
  ])("flags %s", (_n, sql) => {
    expect(sqlObjects(sql).errors.some((e) => e.includes("create table"))).toBe(true);
  });

  it("reads functions and procedures with their bodies", () => {
    const sql = "CREATE OR REPLACE FUNCTION app.f(x int) RETURNS void AS $$\nINSERT INTO a.t VALUES (1);\n$$;\nCREATE PROCEDURE app.p() AS $$\nSELECT 1;\n$$;";
    const r = sqlObjects(sql);
    expect(r.errors).toEqual([]);
    expect(r.functions.map(([n]) => n)).toEqual(["app.f", "app.p"]);
    expect(r.functions[0][1]).toContain("insert into a.t");
    expect(r.functions[0][1]).not.toContain("select 1");
  });

  it.each([
    ["a function without a schema", "CREATE FUNCTION f() RETURNS void AS $$ $$;"],
    ["a quoted function name", 'CREATE FUNCTION "app"."f"() RETURNS void AS $$ $$;'],
    ["a name with no parenthesis", "CREATE FUNCTION app.f RETURNS void AS $$ $$;"],
    ["a dynamic function name", "CREATE FUNCTION %I.%I() RETURNS void AS $$ $$;"],
  ])("flags %s", (_n, sql) => {
    expect(sqlObjects(sql).errors.some((e) => e.includes("function"))).toBe(true);
  });

  it("accepts a listed dynamic head and rejects a stale or unlisted one", () => {
    const sql = { ...FAKE.migrations, "d.sql": "EXECUTE format('CREATE TABLE x.%I (id int)', n);" };
    const head = "d.sql: create table not recognised: CREATE TABLE x.%I (id int)', n);";
    expect(completenessErrors({ ...FAKE, migrations: sql }, [], PROVIDERS, [head])).toEqual([]);
    expect(completenessErrors({ ...FAKE, migrations: sql }, [], PROVIDERS, []).length).toBe(1);
    expect(completenessErrors(FAKE, [], PROVIDERS, [head])).toEqual([`dynamic table entry no longer in the migrations, drop it: ${head}`]);
  });

  it("surfaces the parse errors through completenessErrors", () => {
    const bad = { ...FAKE, migrations: { ...FAKE.migrations, "b.sql": "CREATE TABLE orphan (id int);" } };
    expect(completenessErrors(bad, []).some((e) => e.includes("b.sql") && e.includes("create table"))).toBe(true);
  });
});

describe("hasToken", () => {
  const ident = (c: string) => /[a-z_]/.test(c);
  it.each([
    ["x audit.things y", "audit.thing", false],
    ["x audit.thing y", "audit.thing", true],
    ["xaudit.thing", "audit.thing", false],
    ["audit.thing", "audit.thing", true],
    ["audit.thing_x", "audit.thing", false],
    ["xaudit.thing audit.thing", "audit.thing", true],
    ["audit.things audit.thing", "audit.thing", true],
  ])("%j contains %j: %s", (text, token, expected) => {
    expect(hasToken(text, token, ident, ident)).toBe(expected);
  });
  it("does not count a schema-qualified call as a bare call", () => {
    const prefix = (c: string) => /[a-z0-9_.]/.test(c);
    expect(hasToken("other.put_thing(", "put_thing(", prefix, () => false)).toBe(false);
    expect(hasToken("put_thing(", "put_thing(", prefix, () => false)).toBe(true);
  });
  it("treats a following digit as a boundary breaker only when asked", () => {
    const digit = (c: string) => /\d/.test(c);
    expect(hasToken("D-300", "D-30", () => false, digit)).toBe(false);
    expect(hasToken("D-300 D-30.", "D-30", () => false, digit)).toBe(true);
  });
});

describe("completenessErrors", () => {
  it("accepts an inventory that names a table with a digit in its name", () => {
    const withDigit = { migrations: { ...FAKE.migrations, "b.sql": "CREATE TABLE evidence.export_v2 (id int);" }, inventory: FAKE.inventory + "\nevidence.export_v2\n" };
    expect(completenessErrors({ ...FAKE, ...withDigit }, [])).toEqual([]);
  });

  it("accepts an inventory that covers tables, providers and exports", () => {
    expect(completenessErrors(FAKE, [])).toEqual([]);
  });

  it.each([
    ["a table no cited file reaches", { migrations: { ...FAKE.migrations, "b.sql": "CREATE TABLE evidence.orphan (id int);" } }, "table evidence.orphan: no flow in the inventory"],
    ["a table created across a line break", { migrations: { ...FAKE.migrations, "b.sql": "CREATE TABLE\nevidence.orphan (id int);" } }, "table evidence.orphan: no flow in the inventory"],
    ["a table used only by a function whose name is a prefix of a called one", { migrations: { ...FAKE.migrations, "b.sql": "CREATE FUNCTION app.put() RETURNS void AS $$\nINSERT INTO evidence.orphan VALUES (1);\n$$;\nCREATE TABLE evidence.orphan (id int);" } }, "table evidence.orphan: no flow in the inventory"],
    ["a table reached only by an uncalled function", { read: () => "" }, "table evidence.thing: no flow in the inventory"],
    ["a table only a cited document names", { migrations: { ...FAKE.migrations, "b.sql": "CREATE TABLE evidence.docd (id int);" }, read: (p: string) => (p === "docs/b.md" ? "evidence.docd" : FAKE.read(p)), inventory: FAKE.inventory.replace("`src/dl.ts`", "`src/dl.ts`, `docs/b.md`") }, "table evidence.docd: no flow in the inventory"],
    ["a table whose name is a prefix of a digit-suffixed one", { migrations: { ...FAKE.migrations, "b.sql": "CREATE TABLE x.t (id int);\nCREATE TABLE x.t2 (id int);" }, inventory: FAKE.inventory + "\nx.t2\n" }, "table x.t: no flow in the inventory"],
    ["a table the inventory names that does not exist", { inventory: FAKE.inventory + "\nevidence.gone\n" }, "inventory names evidence.gone, not in the migrations"],
    ["a cited migration with no known table", { migrations: { "a.sql": "CREATE TABLE evidence.other (id int);" } }, "db/migrations/a.sql: cited migration touches no known table"],
    ["a provider missing from the inventory", { inventory: FAKE.inventory.replace("KMS", "kms-less") }, "provider AWS KMS: missing from the inventory"],
    ["a provider gone from the code", { deps: FAKE.deps.filter((d) => d !== "pg-boss") }, "provider job queue: no longer in the code, drop it from the list"],
    ["a new compose service", { services: ["mail", "postgres", "objects", "relay"] }, "service relay: unclassified"],
    ["S3 dropped from the inventory", { inventory: FAKE.inventory.replace("S3", "bucket") }, "provider S3 storage: missing from the inventory"],
    ["a mail service gone from compose", { services: ["postgres", "objects"] }, "provider local mail: no longer in the code, drop it from the list"],
    ["a new dependency nobody classified", { deps: [...FAKE.deps, "nodemailer"] }, "dependency nodemailer: unclassified"],
    ["a new outside SDK nobody classified", { deps: [...FAKE.deps, "@aws-sdk/client-s3"] }, "dependency @aws-sdk/client-s3: unclassified"],
    ["an export outside the Izvoz flows", { exporters: ["src/dl.ts", "src/new-export.tsx"] }, "src/new-export.tsx: export missing from the Izvoz flows"],
  ])("fails on %s", (_case, change, error) => {
    expect(completenessErrors({ ...FAKE, ...change }, [])).toContain(error);
  });

  it("lets a listed gap pass, and fails when the list goes stale", () => {
    const orphan = { migrations: { ...FAKE.migrations, "b.sql": "CREATE TABLE evidence.orphan (id int);" } };
    expect(completenessErrors({ ...FAKE, ...orphan }, ["evidence.orphan"])).toEqual([]);
    expect(completenessErrors(FAKE, ["evidence.thing"])).toContain("known gap evidence.thing: now covered, remove it from the list");
    expect(completenessErrors(FAKE, ["evidence.nope"])).toContain("known gap evidence.nope: no such table");
  });
});

describe(`${INVENTORY} completeness`, () => {
  it("covers every table, outside provider and export in the code on main", () => {
    const migrations = Object.fromEntries(
      readdirSync(join(ROOT, "db/migrations")).map((f) => [f, readFileSync(join(ROOT, "db/migrations", f), "utf8")]),
    );
    const read = (p: string) => (existsSync(join(ROOT, p)) && statSync(join(ROOT, p)).isFile() ? readFileSync(join(ROOT, p), "utf8") : undefined);
    const exporters: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) && /content-disposition|createObjectURL|\bdownload\b/i.test(readFileSync(join(ROOT, p), "utf8"))) exporters.push(p);
      }
    };
    walk("src");
    walk("app");
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    const compose = readFileSync(join(ROOT, "compose.yaml"), "utf8");
    const services = composeServices(compose);
    const sources: Sources = { inventory: readFileSync(join(ROOT, INVENTORY), "utf8"), migrations, read, deps: Object.keys(pkg.dependencies), services, exporters };
    expect(exporters.length).toBeGreaterThan(0);
    expect(Object.keys(migrations).length).toBeGreaterThan(50);
    expect(completenessErrors(sources, KNOWN_GAPS, PROVIDERS, DYNAMIC_TABLES)).toEqual([]);
  });
});
