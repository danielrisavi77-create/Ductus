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

/** True when `token` occurs in `text` with no `before` character directly ahead and no `after` character directly behind. */
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

function completenessErrors(s: Sources, gaps: string[], providers: Provider[] = PROVIDERS): string[] {
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
  for (const sql of Object.values(s.migrations)) {
    for (const m of sql.matchAll(/create (?:unlogged )?table (?:if not exists )?"?([a-z_]+)"?\."?([a-z0-9_]+)"?/gi)) tables.add(`${m[1]}.${m[2]}`.toLowerCase());
    for (const part of sql.split(/create (?:or replace )?function /i).slice(1)) {
      const name = part.match(/^([a-z_]+\.[a-z0-9_]+)\s*\(/i)?.[1]?.toLowerCase();
      if (name) functions.push([name, part.toLowerCase().split(/\n\$\$;|\n\$[a-z_]*\$;/)[0]]);
    }
  }
  // A table is covered when the inventory or a cited file names it, or a cited
  // code file calls a database function whose body uses it.
  const called = functions.filter(([n]) => code.includes(n) || hasToken(code, `${n.split(".")[1]}(`, (c) => /[a-z0-9_.]/.test(c), () => false));
  const ident = (c: string) => /[a-z_]/.test(c);
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
  for (const m of inv.matchAll(/\b(?:app|audit|collaboration|evidence|identity|institution|pgboss)\.[a-z_]+/g)) {
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

describe("completenessErrors", () => {
  it("accepts an inventory that covers tables, providers and exports", () => {
    expect(completenessErrors(FAKE, [])).toEqual([]);
  });

  it.each([
    ["a table no cited file reaches", { migrations: { ...FAKE.migrations, "b.sql": "CREATE TABLE evidence.orphan (id int);" } }, "table evidence.orphan: no flow in the inventory"],
    ["a table reached only by an uncalled function", { read: () => "" }, "table evidence.thing: no flow in the inventory"],
    ["a table only a cited document names", { migrations: { ...FAKE.migrations, "b.sql": "CREATE TABLE evidence.docd (id int);" }, read: (p: string) => (p === "docs/b.md" ? "evidence.docd" : FAKE.read(p)), inventory: FAKE.inventory.replace("`src/dl.ts`", "`src/dl.ts`, `docs/b.md`") }, "table evidence.docd: no flow in the inventory"],
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
    const services = [...compose.matchAll(/^ {2}([a-z][a-z0-9-]*):\s*$/gm)].map((m) => m[1]);
    const sources: Sources = { inventory: readFileSync(join(ROOT, INVENTORY), "utf8"), migrations, read, deps: Object.keys(pkg.dependencies), services, exporters };
    expect(exporters.length).toBeGreaterThan(0);
    expect(Object.keys(migrations).length).toBeGreaterThan(50);
    expect(completenessErrors(sources, KNOWN_GAPS)).toEqual([]);
  });
});
