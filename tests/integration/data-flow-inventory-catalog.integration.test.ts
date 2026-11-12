import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { requireLoopbackDatabaseUrl } from "./loopback-database-url";

// DAN-709 (#87 c.6811814371): every table and every database function the
// migrations leave behind has a place in the data-flow inventory
// docs/privacy/08-inventar-tokova-podataka.md. The objects come from
// pg_catalog after `pnpm db:migrate`, never from the text of the migrations,
// so no SQL syntax (SELECT INTO, CREATE TABLE AS, quoted names, dynamic DDL)
// can hide one. Coverage keeps the rule of #1956: the inventory, or a code
// file one of its flows cites, names the object as schema.name; or the body
// of a covered function names it; or it is the trigger function of a covered
// table. What is left is listed by hand below and fails once it goes stale.
//
// Concurrency: the catalog is read in one REPEATABLE READ READ ONLY
// transaction, so schemas, relations, routines, bodies and triggers come from
// one snapshot; DDL another session commits meanwhile is either wholly in it
// or wholly out. The check speaks for the database as the migrations leave it
// in CI, not for one that changes after the read. The full check retries in
// fresh snapshots so that scratch objects of parallel test files, which they
// drop again, do not fail it; objects that stay fail every snapshot.

const ROOT = join(__dirname, "../..");
const INVENTORY = "docs/privacy/08-inventar-tokova-podataka.md";
const FLOWS_HEADING = "## 2. Tokovi";

const ADMIN_URL: string = process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
requireLoopbackDatabaseUrl(ADMIN_URL, "The data-flow catalog test runs only against a loopback database (DATABASE_URL).");

// Schemas of the application. A schema outside this list fails, empty or not.
const APP_SCHEMAS = ["app", "audit", "collaboration", "evidence", "identity", "institution", "pgboss", "public"];

// Objects that carry no data flow, each with its reason.
const NOT_A_FLOW: Record<string, string> = {
  "public.schema_migrations": "dbmate's ledger of applied migration versions",
};

// Objects nothing in the inventory reaches yet, as this test found them on
// main ab3da994 (DAN-709). They are the next work of DAN-430: each needs a
// flow in the inventory, or a reason in NOT_A_FLOW. An entry that stops being
// a gap, or no longer exists, fails the test, so the list only shrinks.
const KNOWN_GAPS: string[] = [
  // Course team, mentorship and work grants (seven of the ten tables of #1956;
  // the other three are now reached through covered function bodies).
  "audit.course_handover",
  "audit.mentorship_event",
  "institution.course_editor",
  "institution.course_holder",
  "institution.mentorship_request",
  "institution.team_substitution",
  "institution.work_grant",
  // Their RPCs and helpers.
  "institution.appoint_institution_admin",
  "institution.approve_mentorship_request",
  "institution.assign_group_student",
  "institution.assign_group_teacher",
  "institution.create_assignment",
  "institution.create_seminar_group",
  "institution.end_course_editor",
  "institution.end_group_assignment",
  "institution.end_team_substitution",
  "institution.grant_work_access",
  "institution.hand_over_course",
  "institution.list_teacher_candidates",
  "institution.publish_faculty_rule_version",
  "institution.request_mentorship",
  "institution.revoke_institution_admin",
  "institution.revoke_work_access",
  "institution.set_course_editor",
  "institution.set_course_holder",
  "institution.set_team_substitution",
  "institution.team_notification_recipients",
  "institution.withdraw_mentorship_request",
  "institution.work_grant_binding_fill",
  // Access decisions and read helpers of the actor.
  "app.current_institution_slug",
  "app.work_document_in_assignment",
  "institution.actor_assignment_ids",
  "institution.actor_course_ids",
  "institution.can",
  "institution.grant_can",
  "institution.institution_academic_years",
  "institution.institution_courses",
  "institution.is_confirmed_teacher",
  "institution.is_course_team_member",
  "institution.is_course_team_teacher",
  "institution.is_grant_action_set",
  "institution.require_admin_request",
  "institution.require_course_teacher",
  // Sessions.
  "identity.close_user_sessions",
  "identity.purge_ended_sessions",
  "identity.touch_current_session",
  // Collaboration retention and listing.
  "collaboration.delete_live_state",
  "collaboration.delete_revision_requests",
  "collaboration.works_started_last",
  // Receipt worker.
  "app.worker_attach_receipt_signature",
  "app.worker_package_checkpoints",
  "app.worker_pending_backlog",
  "app.worker_pending_receipts",
  "app.worker_receipt_keys",
  "app.worker_receipt_object",
];

export type Catalog = {
  schemas: string[];
  relations: { schema: string; name: string; kind: string }[];
  routines: { schema: string; name: string; body: string }[];
  triggers: { table: string; fn: string }[];
};
export type Inventory = { text: string; cited: string[] };

const IDENT = /^[a-z_][a-z0-9_$]*$/;
const qualified = (schema: string, name: string) => `${schema}.${name}`;
const inner = (c: string | undefined) => c !== undefined && /[A-Za-z0-9_$."]/.test(c);

/** True when `text` names `name` with nothing identifier-like glued to either side. */
export function names(text: string, name: string): boolean {
  for (let at = text.indexOf(name); at >= 0; at = text.indexOf(name, at + 1)) {
    if (!inner(text[at - 1]) && !inner(text[at + name.length])) return true;
  }
  return false;
}

/** Every problem between the catalog and the inventory; empty when they agree. */
export function catalogErrors(cat: Catalog, inv: Inventory, gaps: string[] = KNOWN_GAPS, notAFlow = NOT_A_FLOW): string[] {
  const errors: string[] = [];
  for (const s of cat.schemas) if (!APP_SCHEMAS.includes(s)) errors.push(`schema ${s}: not in the inventory's schemas`);

  const objects = new Map<string, string>();
  for (const r of cat.relations) objects.set(qualified(r.schema, r.name), `relation (${r.kind})`);
  for (const f of cat.routines) objects.set(qualified(f.schema, f.name), "function");
  for (const [o, what] of objects) {
    const [schema, ...rest] = o.split(".");
    if (!IDENT.test(schema) || !IDENT.test(rest.join("."))) errors.push(`${what} ${JSON.stringify(o)}: quoted identifier`);
  }

  const sources = [inv.text, ...inv.cited];
  const covered = new Set([...objects.keys()].filter((o) => sources.some((t) => names(t, o))));
  for (let grew = true; grew; ) {
    grew = false;
    const add = (o: string) => {
      if (objects.has(o) && !covered.has(o)) {
        covered.add(o);
        grew = true;
      }
    };
    for (const f of cat.routines) {
      if (!covered.has(qualified(f.schema, f.name))) continue;
      for (const o of objects.keys()) if (names(f.body, o)) add(o);
    }
    for (const t of cat.triggers) if (covered.has(t.table)) add(t.fn);
  }

  for (const o of [...objects.keys()].sort()) {
    if (covered.has(o) || o in notAFlow) continue;
    if (!gaps.includes(o)) errors.push(`${objects.get(o)} ${o}: no flow in the inventory`);
  }
  for (const g of gaps) {
    if (!objects.has(g)) errors.push(`known gap ${g}: not in the database, drop it`);
    else if (covered.has(g)) errors.push(`known gap ${g}: now covered, drop it`);
  }
  for (const n of Object.keys(notAFlow)) if (!objects.has(n)) errors.push(`${n}: not in the database, drop it from NOT_A_FLOW`);

  // Stale: the inventory names an object of an application schema that the database does not have.
  const schemas = APP_SCHEMAS.filter((s) => s !== "public").join("|");
  for (const m of inv.text.matchAll(new RegExp(`(?<![A-Za-z0-9_$./-])(?:${schemas})\\.[a-z_][a-z0-9_]*(?![A-Za-z0-9_$/])`, "g"))) {
    if (!objects.has(m[0])) errors.push(`inventory names ${m[0]}, not in the database`);
  }
  return [...new Set(errors)];
}

/** The inventory text and the code files its flows cite; cited documents never count. */
const CODE_FILE = /\.(?:sql|ts|tsx|mjs|js)$/;
function readInventory(): Inventory {
  const text = readFileSync(join(ROOT, INVENTORY), "utf8");
  const lines = text.split("\n");
  const at = lines.findIndex((l) => l.trim() === FLOWS_HEADING);
  const end = lines.findIndex((l, i) => i > at && l.startsWith("## "));
  const section = lines.slice(at + 1, end < 0 ? undefined : end).join("\n");
  const paths = [...new Set([...section.matchAll(/`([^`]+)`/g)].map((m) => m[1]))];
  const cited = paths
    .filter((p) => CODE_FILE.test(p) && existsSync(join(ROOT, p)) && statSync(join(ROOT, p)).isFile())
    .map((p) => readFileSync(join(ROOT, p), "utf8"));
  if (at < 0 || cited.length < 50) throw new Error(`${INVENTORY}: no flows table or too few cited files (${cited.length})`);
  return { text, cited };
}

const SYSTEM = "n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'";
const NOT_EXTENSION = (catalog: string, oid: string) =>
  `NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = '${catalog}'::regclass AND d.objid = ${oid} AND d.deptype = 'e')`;

/** Reads the catalog; every query runs on `client` inside the caller's transaction. */
async function readCatalog(client: pg.ClientBase): Promise<Catalog> {
  const schemas = await client.query<{ schema: string }>(
    `SELECT n.nspname AS schema FROM pg_namespace n WHERE ${SYSTEM} AND ${NOT_EXTENSION("pg_namespace", "n.oid")}`,
  );
  // Partitions are counted under their parent table.
  const relations = await client.query<Catalog["relations"][number]>(
    `SELECT n.nspname AS schema, c.relname AS name, c.relkind::text AS kind
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f') AND NOT c.relispartition AND ${SYSTEM}
        AND ${NOT_EXTENSION("pg_class", "c.oid")}`,
  );
  const routines = await client.query<Catalog["routines"][number]>(
    `SELECT n.nspname AS schema, p.proname AS name, coalesce(p.prosrc, '') AS body
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE ${SYSTEM} AND ${NOT_EXTENSION("pg_proc", "p.oid")}`,
  );
  const triggers = await client.query<Catalog["triggers"][number]>(
    `SELECT tn.nspname || '.' || c.relname AS table, fn.nspname || '.' || p.proname AS fn
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace tn ON tn.oid = c.relnamespace
       JOIN pg_proc p ON p.oid = t.tgfoid JOIN pg_namespace fn ON fn.oid = p.pronamespace
      WHERE NOT t.tgisinternal`,
  );
  return {
    schemas: schemas.rows.map((r) => r.schema),
    relations: relations.rows,
    routines: routines.rows,
    triggers: triggers.rows,
  };
}

const SNAPSHOT = "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY";

describe("catalogErrors", () => {
  const CAT: Catalog = {
    schemas: ["app", "institution"],
    relations: [
      { schema: "institution", name: "course", kind: "r" },
      { schema: "institution", name: "hidden", kind: "r" },
      { schema: "institution", name: "logged", kind: "r" },
    ],
    routines: [
      { schema: "app", name: "list_courses", body: "SELECT * FROM institution.hidden" },
      { schema: "app", name: "log_course", body: "INSERT INTO institution.logged VALUES (1)" },
    ],
    triggers: [{ table: "institution.course", fn: "app.log_course" }],
  };
  const INV: Inventory = { text: "Tok: `institution.course`.", cited: ["await sql`select app.list_courses()`"] };

  it("accepts an inventory that reaches everything directly, through a body or a trigger", () => {
    expect(catalogErrors(CAT, INV, [], {})).toEqual([]);
  });

  it.each([
    ["a new table", { ...CAT, relations: [...CAT.relations, { schema: "institution", name: "x", kind: "r" }] }, INV, "relation (r) institution.x: no flow in the inventory"],
    ["a new schema", { ...CAT, schemas: [...CAT.schemas, "extra"] }, INV, "schema extra: not in the inventory's schemas"],
    ["a quoted name", { ...CAT, relations: [...CAT.relations, { schema: "institution", name: "Course", kind: "r" }] }, { ...INV, text: `${INV.text} institution.Course` }, 'relation (r) "institution.Course": quoted identifier'],
    ["a name only as a prefix", CAT, { ...INV, text: "Tok: `institution.course_x`." }, "relation (r) institution.course: no flow in the inventory"],
    ["a new function", { ...CAT, routines: [...CAT.routines, { schema: "app", name: "f", body: "" }] }, INV, "function app.f: no flow in the inventory"],
    ["a stale inventory name", CAT, { ...INV, text: `${INV.text} institution.gone` }, "inventory names institution.gone, not in the database"],
  ])("fails on %s", (_case, cat, inv, error) => {
    expect(catalogErrors(cat, inv, [], {})).toContain(error);
  });

  it("fails on a known gap that is gone or covered, and on a stale NOT_A_FLOW entry", () => {
    expect(catalogErrors(CAT, INV, ["institution.gone", "institution.course"], { "public.gone": "x" })).toEqual([
      "known gap institution.gone: not in the database, drop it",
      "known gap institution.course: now covered, drop it",
      "public.gone: not in the database, drop it from NOT_A_FLOW",
    ]);
  });
});

describe(`${INVENTORY} against the migrated database`, () => {
  const pool = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
  afterAll(() => pool.end());
  const inventory = readInventory();

  /** Runs `ddl` in a transaction that is rolled back, and returns the errors seen inside it. */
  async function errorsWith(ddl: string): Promise<string[]> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      await client.query(ddl);
      return catalogErrors(await readCatalog(client), inventory);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  // Other integration files run in parallel against the same database and
  // create scratch objects for a few seconds (job-queue.integration.test.ts
  // adds public.it_jobq_* trigger functions and drops them). Each attempt reads
  // a fresh snapshot; the check passes only once one snapshot has no errors.
  // Objects of the migrations persist, so a real gap fails every attempt.
  it("covers every schema, table and function after the migrations", async () => {
    const snapshotErrors = async () => {
      const client = await pool.connect();
      try {
        await client.query(SNAPSHOT);
        const cat = await readCatalog(client);
        expect(cat.relations.length).toBeGreaterThan(50);
        expect(cat.routines.length).toBeGreaterThan(100);
        return catalogErrors(cat, inventory);
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    };
    await expect.poll(snapshotErrors, { timeout: 50_000, interval: 1_000 }).toEqual([]);
  }, 60_000);

  it.each([
    ["a new table in an existing schema", "CREATE TABLE institution.dan709_probe (x int)", "relation (r) institution.dan709_probe: no flow in the inventory"],
    ["a new empty schema", "CREATE SCHEMA dan709_probe", "schema dan709_probe: not in the inventory's schemas"],
    ["a table in a new schema", "CREATE SCHEMA dan709_probe; CREATE TABLE dan709_probe.t (x int)", "relation (r) dan709_probe.t: no flow in the inventory"],
    ["CREATE TABLE AS", "CREATE TABLE evidence.dan709_probe AS SELECT 1 AS x", "relation (r) evidence.dan709_probe: no flow in the inventory"],
    ["SELECT INTO", "SELECT 1 AS x INTO audit.dan709_probe", "relation (r) audit.dan709_probe: no flow in the inventory"],
    ["a quoted identifier that folds to a covered name", 'CREATE TABLE institution."Notification" (x int)', 'relation (r) "institution.Notification": quoted identifier'],
    ["a view", "CREATE VIEW institution.dan709_probe AS SELECT 1 AS x", "relation (v) institution.dan709_probe: no flow in the inventory"],
    ["a materialized view", "CREATE MATERIALIZED VIEW institution.dan709_probe AS SELECT 1 AS x", "relation (m) institution.dan709_probe: no flow in the inventory"],
    ["a new function", "CREATE FUNCTION app.dan709_probe() RETURNS int LANGUAGE sql AS 'SELECT 1'", "function app.dan709_probe: no flow in the inventory"],
    ["a new procedure", "CREATE PROCEDURE app.dan709_probe() LANGUAGE sql AS 'SELECT 1'", "function app.dan709_probe: no flow in the inventory"],
    ["a table built at run time by dynamic SQL", "DO $$ BEGIN EXECUTE format('CREATE TABLE institution.%I (x int)', 'dan709_' || 'probe'); END $$", "relation (r) institution.dan709_probe: no flow in the inventory"],
  ])("fails on %s", async (_case, ddl, error) => {
    expect(await errorsWith(ddl)).toContain(error);
  });

  it("fails on a renamed table twice: the new name has no flow and the old one is stale", async () => {
    const errors = await errorsWith("ALTER TABLE institution.notification RENAME TO dan709_probe");
    expect(errors).toContain("relation (r) institution.dan709_probe: no flow in the inventory");
    expect(errors).toContain("inventory names institution.notification, not in the database");
  });

  it("fails on a table moved to another schema", async () => {
    const errors = await errorsWith("ALTER TABLE institution.notification SET SCHEMA audit");
    expect(errors).toContain("inventory names institution.notification, not in the database");
  });

  it("reads one snapshot: a table committed during the read appears only in the next one", async () => {
    const reader = await pool.connect();
    const writer = await pool.connect();
    try {
      await reader.query(SNAPSHOT);
      const before = catalogErrors(await readCatalog(reader), inventory);
      await writer.query("CREATE TABLE institution.dan709_concurrent (x int)");
      expect(catalogErrors(await readCatalog(reader), inventory)).toEqual(before);
      await reader.query("ROLLBACK");
      await reader.query(SNAPSHOT);
      expect(catalogErrors(await readCatalog(reader), inventory)).toContain(
        "relation (r) institution.dan709_concurrent: no flow in the inventory",
      );
    } finally {
      await reader.query("ROLLBACK");
      await writer.query("DROP TABLE IF EXISTS institution.dan709_concurrent");
      reader.release();
      writer.release();
    }
  });
});
