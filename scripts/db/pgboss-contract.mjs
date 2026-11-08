// DAN-517, attack plan #1021 step 3 (D-71, D-91; docs/backend/baza-i-pogon.md
// 4.8 t. 7): the worker runs pg-boss with migrate: false, so its schema is a
// dbmate migration. This checks that pg-boss is pinned exactly and equally in
// package.json, the lockfile importer and node_modules, with schema 46; that
// the up section of the schema migration is PREAMBLE + the transactional body
// of getConstructionPlans("pgboss") verbatim + POSTAMBLE, with one squawk-ignore
// line before the singleton_on column of pgboss.job as the only addition; and that only the
// three pg-boss migrations name the schema, so an upgrade (a new migration
// from getMigrationPlans) changes this list and the pin together.
//
//   node scripts/db/pgboss-contract.mjs
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PIN = Object.freeze({ version: "12.38.0", schema: 46 });
export const SCHEMA_NAME = "pgboss";
export const MIGRATIONS = Object.freeze({
  owner: "20261108110000_pgboss_owner.sql",
  schema: "20261108110100_pgboss_schema.sql",
  access: "20261108110200_pgboss_access.sql",
});
// The owner holds DDL rights only while the plan runs: CREATE on the schema,
// and on the database because CREATE SCHEMA IF NOT EXISTS checks that first.
export const PREAMBLE = [
  "SET LOCAL ROLE ductus_migrator;",
  "DO $$ BEGIN EXECUTE format('GRANT CREATE ON DATABASE %I TO ductus_queue', current_database()); END $$;",
  "GRANT CREATE ON SCHEMA pgboss TO ductus_queue;",
  "SET LOCAL ROLE ductus_queue;",
  "",
].join("\n");
export const POSTAMBLE = [
  "",
  "SET LOCAL ROLE ductus_migrator;",
  "DO $$ BEGIN EXECUTE format('REVOKE CREATE ON DATABASE %I FROM ductus_queue', current_database()); END $$;",
  "REVOKE CREATE ON SCHEMA pgboss FROM ductus_queue;",
  "",
].join("\n");

const DIR = "db/migrations";
const UP = "-- migrate:up";
const DOWN = "-- migrate:down";
const WRAPPED = /^\s*BEGIN;\n([\s\S]*)\n\s*COMMIT;\s*$/;
// pg-boss keeps pgboss.job.singleton_on as timestamp without time zone; Squawk's
// prefer-timestamp-tz is acknowledged for that column (INLINE_RULES of the
// Squawk migration lint, DAN-319). Squawk 2.70.0 applies a
// squawk-ignore comment to the next line only, so the line goes right before
// the column, indented like it, not before the statement.
export const IGNORE = "-- squawk-ignore prefer-timestamp-tz";
const JOB_TABLE = /^\s*CREATE TABLE pgboss\.job \($/;
const SINGLETON_ON = /^(\s*)singleton_on timestamp without time zone,?$/;

/** The plan without its BEGIN and COMMIT: dbmate wraps the migration itself. */
export function planBody(plan) {
  const match = WRAPPED.exec(plan);
  if (!match) throw new Error("the construction plan is not one BEGIN ... COMMIT block");
  return match[1];
}

/**
 * The body with the IGNORE line before the singleton_on column of its only
 * CREATE TABLE pgboss.job; that column is the plan's only timestamp without
 * time zone, and it must lie inside that statement.
 */
export function acknowledged(body) {
  const lines = body.split("\n");
  const table = lines.flatMap((line, index) => (JOB_TABLE.test(line) ? [index] : []));
  if (table.length !== 1) throw new Error(`the construction plan has ${table.length} CREATE TABLE pgboss.job statements, expected 1`);
  const column = lines.flatMap((line, index) => (SINGLETON_ON.test(line) ? [index] : []));
  if (column.length !== 1) throw new Error(`the construction plan has ${column.length} singleton_on timestamp without time zone columns, expected 1`);
  const end = lines.findIndex((line, index) => index > table[0] && /^\s*\)/.test(line));
  if (column[0] < table[0] || end < 0 || column[0] > end) throw new Error("the singleton_on column is not inside CREATE TABLE pgboss.job");
  const untimed = lines.filter((line) => /timestamp without time zone/i.test(line)).length;
  if (untimed !== 1) throw new Error(`the construction plan has ${untimed} lines with timestamp without time zone, expected 1`);
  lines.splice(column[0], 0, `${SINGLETON_ON.exec(lines[column[0]])[1]}${IGNORE}`);
  return lines.join("\n");
}

export function expectedUp(plan) {
  return PREAMBLE + acknowledged(planBody(plan)) + POSTAMBLE;
}

/** The lines between "-- migrate:up" and "-- migrate:down", each ending in LF. */
export function upText(text) {
  const lines = text.split("\n");
  const up = lines.indexOf(UP);
  const down = lines.indexOf(DOWN);
  if (up < 0 || down < up || lines.lastIndexOf(UP) !== up || lines.lastIndexOf(DOWN) !== down) {
    throw new Error(`needs one "${UP}" line followed by one "${DOWN}" line`);
  }
  return lines.slice(up + 1, down).map((line) => `${line}\n`).join("");
}

/** Why the pin is not exact and equal in all three places; empty when it is. */
export function checkPin({ manifest, lockfile, installed }, pin = PIN) {
  const errors = [];
  const declared = manifest.dependencies?.["pg-boss"];
  if (declared !== pin.version) errors.push(`package.json pins pg-boss ${JSON.stringify(declared)}, expected exactly "${pin.version}"`);
  const importer = /^ {6}pg-boss:\n {8}specifier: (\S+)\n {8}version: (\S+)$/m.exec(lockfile);
  if (!importer) errors.push("pnpm-lock.yaml has no pg-boss importer entry");
  else if (importer[1] !== pin.version || (importer[2] !== pin.version && !importer[2].startsWith(`${pin.version}(`))) {
    errors.push(`pnpm-lock.yaml resolves pg-boss ${importer[1]} to ${importer[2]}, expected ${pin.version}`);
  }
  if (installed.version !== pin.version) errors.push(`node_modules has pg-boss ${installed.version}, expected ${pin.version}`);
  if (installed.pgboss?.schema !== pin.schema) {
    errors.push(`pg-boss ${installed.version} builds schema ${installed.pgboss?.schema}, expected ${pin.schema}`);
  }
  return errors;
}

/** Migrations other than the listed ones that name the pgboss schema. */
export function strayMentions(migrations, allowed = Object.values(MIGRATIONS)) {
  const pattern = new RegExp(`\\b${SCHEMA_NAME}\\b`, "i");
  return [...migrations]
    .filter(([name, text]) => !allowed.includes(name) && pattern.test(text))
    .map(([name]) => name)
    .sort();
}

/**
 * The installed pg-boss: its package.json and its construction plan for the
 * pgboss schema. Loaded by path, since only src/server/db imports the package.
 */
export async function installedPackage(root = process.cwd()) {
  const require = createRequire(path.join(root, "package.json"));
  const installedFile = require.resolve("pg-boss/package.json");
  const pgboss = await import(pathToFileURL(path.join(path.dirname(installedFile), "dist", "index.js")).href);
  return { manifest: JSON.parse(readFileSync(installedFile, "utf8")), plan: pgboss.getConstructionPlans(SCHEMA_NAME) };
}

/** Every contract error for the repository at root; empty when it holds. */
export async function checkRepository(root = process.cwd()) {
  const read = (file) => readFileSync(path.join(root, file), "utf8");
  const installed = await installedPackage(root);
  const errors = checkPin({
    manifest: JSON.parse(read("package.json")),
    lockfile: read("pnpm-lock.yaml"),
    installed: installed.manifest,
  });
  const actual = upText(read(path.posix.join(DIR, MIGRATIONS.schema)));
  if (actual !== expectedUp(installed.plan)) {
    errors.push(`${DIR}/${MIGRATIONS.schema}: the up section is not PREAMBLE + getConstructionPlans("${SCHEMA_NAME}") of pg-boss ${PIN.version}, with "${IGNORE}" before the singleton_on column of pgboss.job, + POSTAMBLE`);
  }
  const names = readdirSync(path.join(root, DIR)).filter((name) => name.endsWith(".sql"));
  for (const name of Object.values(MIGRATIONS)) {
    if (!names.includes(name)) errors.push(`${DIR}/${name} is missing`);
  }
  for (const name of strayMentions(names.map((name) => [name, read(path.posix.join(DIR, name))]))) {
    errors.push(`${DIR}/${name} names the ${SCHEMA_NAME} schema; a pg-boss upgrade changes the pin and MIGRATIONS together`);
  }
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = await checkRepository();
  for (const error of errors) console.error(error);
  if (errors.length === 0) console.log(`pg-boss ${PIN.version}, schema ${PIN.schema}: the migrations match the package`);
  process.exitCode = errors.length > 0 ? 1 : 0;
}
