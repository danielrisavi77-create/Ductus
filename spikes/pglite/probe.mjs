// DAN-715 / S-0.3: manual probe, not part of CI and not part of `pnpm test`.
//
//   cd spikes/pglite && npm install && node probe.mjs [--tests] [--json out.json]
//
// Runs the repo's SQL against an in-memory PGlite, never against a real
// database, and prints what passed and what failed. Nothing here is imported
// by the application. All data is synthetic (the migrations create schema only).
import { PGlite } from "@electric-sql/pglite";
import { pageinspect } from "@electric-sql/pglite/contrib/pageinspect";
import { pgtap } from "@electric-sql/pglite/pgtap";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const withTests = args.includes("--tests");
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;

const ms = (t0) => Math.round(performance.now() - t0);
const short = (e) => String(e?.message ?? e).split("\n")[0].slice(0, 160);

/** dbmate file: the part between `-- migrate:up` and `-- migrate:down`. */
export function upSection(sql) {
  const up = sql.indexOf("-- migrate:up");
  if (up < 0) throw new Error("no -- migrate:up marker");
  const down = sql.indexOf("-- migrate:down", up);
  return sql.slice(up, down < 0 ? undefined : down);
}

/** psql `\\ir file` inlined (relative to the including file); PGlite has no psql meta-commands. */
export function inlineIr(file, depth = 0) {
  if (depth > 5) throw new Error("\\ir nesting too deep");
  return readFileSync(file, "utf8").replace(/^\\ir[ \t]+(\S+)[ \t]*$/gm, (_, rel) =>
    inlineIr(resolve(dirname(file), rel), depth + 1),
  );
}

/**
 * psql sends every statement as its own protocol message, so statement_timestamp()
 * moves between them; PGlite's exec() sends the whole text as one. This splits a
 * script into statements (quotes, dollar quotes, comments) and understands `\\gset`.
 * Returns [{ sql, gset }].
 */
export function splitSql(text) {
  const out = [];
  let cur = "";
  const push = (gset) => { if (cur.trim()) out.push({ sql: cur.trim(), gset }); cur = ""; };
  for (let i = 0; i < text.length; ) {
    const c = text[i], two = text.slice(i, i + 2);
    if (two === "--") { const e = text.indexOf("\n", i); const j = e < 0 ? text.length : e; cur += text.slice(i, j); i = j; continue; }
    if (two === "/*") { let d = 1, j = i + 2; while (j < text.length && d) { if (text.startsWith("/*", j)) { d++; j += 2; } else if (text.startsWith("*/", j)) { d--; j += 2; } else j++; } cur += text.slice(i, j); i = j; continue; }
    if (c === "'" || c === '"') { let j = i + 1; while (j < text.length) { if (text[j] === c) { if (text[j + 1] === c) j += 2; else { j++; break; } } else j++; } cur += text.slice(i, j); i = j; continue; }
    if (c === "$") { const m = /^\$([A-Za-z_]\w*)?\$/.exec(text.slice(i)); if (m) { const e = text.indexOf(m[0], i + m[0].length); const j = e < 0 ? text.length : e + m[0].length; cur += text.slice(i, j); i = j; continue; } }
    if (c === ";") { cur += c; push(false); i++; continue; }
    if (c === "\\" && text.startsWith("\\gset", i)) { const e = text.indexOf("\n", i); i = e < 0 ? text.length : e; push(true); continue; }
    cur += c; i++;
  }
  push(false);
  return out;
}

/** Runs a script statement by statement; returns the string cells of every result (TAP lines). */
export async function runScript(db, text) {
  const vars = new Map();
  const cells = [];
  for (const st of splitSql(text)) {
    let sql = st.sql;
    for (const [k, v] of vars) {
      sql = sql.replace(new RegExp(`(?<![:\\w]):'${k}'`, "g"), () => `'${v.replaceAll("'", "''")}'`)
               .replace(new RegExp(`(?<![:\\w]):${k}\\b`, "g"), () => v);
    }
    const res = await db.exec(sql);
    for (const r of res) for (const row of r.rows) for (const v of Object.values(row)) if (typeof v === "string") cells.push(v);
    if (st.gset) {
      const row = res.at(-1)?.rows?.[0] ?? {};
      for (const [k, v] of Object.entries(row)) vars.set(k, v instanceof Date ? v.toISOString() : String(v));
    }
  }
  return cells;
}

const report = { migrations: [], probes: [], tests: [], timings: {} };

const t0 = performance.now();
const db = new PGlite({ extensions: { pgtap, pageinspect } });
await db.waitReady;
report.timings.startMs = ms(t0);

// Provisioning that staging gets in B0.1 and compose gets from db/local/migrator.sql.
let t = performance.now();
await db.exec(readFileSync(join(ROOT, "db/local/migrator.sql"), "utf8"));
await db.exec(
  "SET ROLE ductus_migrator; CREATE TABLE public.schema_migrations (version varchar PRIMARY KEY); RESET ROLE;",
);
report.timings.provisionMs = ms(t);

// The compose stack also creates the web login after the migrations
// (db/local/app-login.sql). worker-login.sql and auth-login.sql use psql
// \\if / \\gset and a password variable, so they are not run here.
await db.exec(readFileSync(join(ROOT, "db/local/app-login.sql"), "utf8"));
// Stand-ins for what worker-login.sql and auth-login.sql make (same names and
// memberships, a dummy password) and for the `ductus` superuser compose makes.
await db.exec(`
  CREATE ROLE ductus_worker_local LOGIN PASSWORD 'probe-only-not-a-secret' NOSUPERUSER NOBYPASSRLS;
  GRANT ductus_worker TO ductus_worker_local WITH INHERIT TRUE, SET FALSE;
  CREATE ROLE ductus_auth_local LOGIN PASSWORD 'probe-only-not-a-secret' NOSUPERUSER NOBYPASSRLS;
  GRANT ductus_auth TO ductus_auth_local WITH INHERIT TRUE, SET FALSE;
  CREATE ROLE ductus SUPERUSER LOGIN PASSWORD 'probe-only-not-a-secret';`);

// 1. Migrations, in file order, each as ductus_migrator in its own transaction.
const files = readdirSync(join(ROOT, "db/migrations")).filter((f) => f.endsWith(".sql")).sort();
t = performance.now();
for (const f of files) {
  const version = f.split("_")[0];
  const m0 = performance.now();
  const row = { file: f, ok: false, error: null, ms: 0 };
  try {
    await db.exec("BEGIN; SET LOCAL ROLE ductus_migrator;");
    await db.exec(upSection(readFileSync(join(ROOT, "db/migrations", f), "utf8")));
    await db.query("INSERT INTO public.schema_migrations VALUES ($1)", [version]);
    await db.exec("COMMIT");
    row.ok = true;
  } catch (e) {
    row.error = short(e);
    await db.exec("ROLLBACK").catch(() => {});
  }
  row.ms = ms(m0);
  report.migrations.push(row);
}
report.timings.migrationsMs = ms(t);
const failed = report.migrations.filter((r) => !r.ok);

// 2. Targeted probes: roles, SET ROLE, RLS and SECURITY DEFINER on a scratch table.
async function probe(name, fn) {
  try {
    report.probes.push({ name, ok: true, detail: String(await fn()) });
  } catch (e) {
    report.probes.push({ name, ok: false, detail: short(e) });
  }
}
await db.exec("BEGIN"); // the scratch schema below is rolled back before the pgTAP files run
const one = async (sql) => (await db.query(sql)).rows[0];
await probe("migrator is not superuser and not bypassrls", async () => {
  const r = await one(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'ductus_migrator'`);
  if (r.rolsuper || r.rolbypassrls) throw new Error("elevated migrator");
  return "ok";
});
await probe("SET ROLE changes current_user, RESET ROLE restores it", async () => {
  await db.exec("SET ROLE ductus_app");
  const a = (await one("SELECT current_user AS u")).u;
  await db.exec("RESET ROLE");
  const b = (await one("SELECT current_user AS u")).u;
  if (a !== "ductus_app" || b !== "postgres") throw new Error(`${a} / ${b}`);
  return `${a} -> ${b}`;
});
await probe("RLS: non-owner sees only its rows, cross-owner insert denied, FORCE binds the owner", async () => {
  await db.exec(`
    SET ROLE ductus_migrator;
    CREATE SCHEMA probe; CREATE TABLE probe.t (owner_id text, v int);
    ALTER TABLE probe.t ENABLE ROW LEVEL SECURITY;
    CREATE POLICY p ON probe.t USING (owner_id = current_setting('probe.me', true));
    GRANT USAGE ON SCHEMA probe TO ductus_app; GRANT SELECT, INSERT ON probe.t TO ductus_app;
    RESET ROLE;`);
  // Owner without FORCE bypasses its own policy.
  await db.exec("SET ROLE ductus_migrator; INSERT INTO probe.t VALUES ('a', 1), ('b', 2); RESET ROLE;");
  await db.exec("SET ROLE ductus_app; SET probe.me = 'a'");
  const n = (await one("SELECT count(*)::int AS n FROM probe.t")).n;
  let denied = false;
  await db.exec("SAVEPOINT denied");
  try { await db.exec("INSERT INTO probe.t VALUES ('b', 3)"); } catch { denied = true; }
  await db.exec("ROLLBACK TO SAVEPOINT denied");
  await db.exec("RESET ROLE; RESET probe.me");
  // FORCE: the same owner is now filtered (no probe.me set, so no row matches).
  await db.exec("SET ROLE ductus_migrator; ALTER TABLE probe.t FORCE ROW LEVEL SECURITY");
  const forced = (await one("SELECT count(*)::int AS n FROM probe.t")).n;
  await db.exec("RESET ROLE");
  if (n !== 1 || !denied || forced !== 0) throw new Error(`visible=${n} insertDenied=${denied} ownerForced=${forced}`);
  return "1 visible row, cross-owner insert denied, FORCE hides rows from the owner";
});
await probe("SECURITY DEFINER runs with the owner's rights and fixed search_path", async () => {
  await db.exec(`
    SET ROLE ductus_migrator;
    ALTER TABLE probe.t NO FORCE ROW LEVEL SECURITY;
    CREATE FUNCTION probe.count_all() RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, probe
      AS $f$ SELECT count(*)::int FROM probe.t $f$;
    REVOKE ALL ON FUNCTION probe.count_all() FROM PUBLIC; GRANT EXECUTE ON FUNCTION probe.count_all() TO ductus_app;
    RESET ROLE;`);
  await db.exec("SET ROLE ductus_app; SET probe.me = 'a'");
  const direct = (await one("SELECT count(*)::int AS n FROM probe.t")).n;
  const viaDefiner = (await one("SELECT probe.count_all() AS n")).n;
  await db.exec("RESET ROLE; RESET probe.me");
  if (direct !== 1 || viaDefiner !== 2) throw new Error(`direct=${direct} definer=${viaDefiner}`);
  return "caller sees 1 row, definer (owner, no FORCE) sees 2";
});
await probe("a second connection exists (concurrency)", async () => {
  // PGlite is one backend: there is no second session to hold a lock against.
  const r = await one("SELECT count(*)::int AS n FROM pg_stat_activity").catch((e) => ({ n: short(e) }));
  return `pg_stat_activity rows: ${r.n} (single backend, no concurrent transactions possible)`;
});

await db.exec("ROLLBACK");

// 3. The repo's pgTAP files (db/tests), each in its own run, as written for CI.
if (withTests) {
  const tfiles = readdirSync(join(ROOT, "db/tests")).filter((f) => f.endsWith(".sql")).sort();
  t = performance.now();
  for (const f of tfiles) {
    const m0 = performance.now();
    const row = { file: f, ok: false, notOk: 0, total: 0, firstNotOk: [], error: null, ms: 0 };
    try {
      const sql = inlineIr(join(ROOT, "db/tests", f));
      const lines = await runScript(db, sql);
      row.total = lines.filter((l) => /^(not )?ok /.test(l)).length;
      row.notOk = lines.filter((l) => /^not ok /.test(l)).length;
      row.firstNotOk = lines.filter((l) => /^not ok /.test(l)).slice(0, 3);
      row.ok = row.notOk === 0 && row.total > 0;
    } catch (e) {
      row.error = short(e);
      await db.exec("ROLLBACK").catch(() => {});
    }
    row.ms = ms(m0);
    report.tests.push(row);
  }
  report.timings.testsMs = ms(t);
}

await db.close();
report.timings.totalMs = ms(t0);

// Output.
const line = (s) => console.log(s);
line(`PGlite probe: ${files.length} migrations, ${files.length - failed.length} passed, ${failed.length} failed`);
for (const r of report.migrations) line(`${r.ok ? "PASS" : "FAIL"} ${String(r.ms).padStart(5)} ms  ${r.file}${r.error ? "  :: " + r.error : ""}`);
for (const p of report.probes) line(`${p.ok ? "PASS" : "FAIL"} probe: ${p.name} :: ${p.detail}`);
for (const r of report.tests) line(`${r.ok ? "PASS" : "FAIL"} ${String(r.ms).padStart(5)} ms  db/tests/${r.file}  ${r.total - r.notOk}/${r.total}${r.error ? "  :: " + r.error : ""}${r.firstNotOk.length ? "  :: " + r.firstNotOk.join(" | ") : ""}`);
line(`timings: ${JSON.stringify(report.timings)}`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(report, null, 2));
process.exitCode = 0;
