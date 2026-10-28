// Before the deploy that applies the stricter is_plain_label (#377, #182):
// lists the stored rows that would stop that migration (#446). It only reads,
// in a READ ONLY transaction, and names a row by table, column and primary
// key; the stored name itself is never printed.
//
// One source of truth: the rule and the guarded columns are read from the
// migration file itself, so this check cannot drift from what the migration
// enforces. It works whether or not the migration has been applied.
//
//   DATABASE_URL=<the login dbmate uses> node src/server/db/plain-label-check.ts
//
// It lives here because only src/server/db may hold the database driver
// (eslint.config.mjs); the application never imports it.
//
// Exit code 0: no row would stop the migration. 1: rows listed. 2: the check
// could not run.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import pg from "pg";

export const MIGRATION = "20261018130000_institution_plain_label_marks.sql";
const MIGRATION_FILE = new URL(`../../../db/migrations/${MIGRATION}`, import.meta.url);

export type Target = { table: string; column: string };
export type Finding = { table: string; column: string; id: string };

const DEFINITION =
  /CREATE OR REPLACE FUNCTION institution\.is_plain_label\(p_text text\) RETURNS boolean\s+LANGUAGE sql IMMUTABLE SET search_path = ''\s+AS \$\$([\s\S]*?)\$\$;/g;
const GUARD = /FROM institution\.([a-z_]+) ([a-z_]+) WHERE NOT institution\.is_plain_label\(\2\.([a-z_]+)\)/g;

/**
 * The body of is_plain_label as the up section of the migration defines it,
 * and the columns its guard reads. Anything unexpected stops the check rather
 * than letting it check a different rule.
 */
export function readRule(migration: string): { body: string; targets: Target[] } {
  const up = migration.indexOf("-- migrate:up");
  const down = migration.indexOf("-- migrate:down");
  if (up < 0 || down < up) throw new Error(`${MIGRATION} is not a dbmate migration`);
  const section = migration.slice(up, down);
  const definitions = [...section.matchAll(DEFINITION)];
  if (definitions.length !== 1) throw new Error(`${MIGRATION} does not define is_plain_label exactly once`);
  const body = definitions[0][1].trim();
  // The body is one SELECT of an expression over p_text, without FROM.
  if (!/^SELECT\s/.test(body) || /\bFROM\b|;/i.test(body)) {
    throw new Error(`is_plain_label in ${MIGRATION} is not a single SELECT expression`);
  }
  const targets = [...section.matchAll(GUARD)].map(([, table, , column]) => ({ table, column }));
  if (targets.length === 0) throw new Error(`${MIGRATION} has no guard over stored names`);
  return { body, targets };
}

async function primaryKey(client: pg.ClientBase, table: string): Promise<string[]> {
  const { rows } = await client.query<{ attname: string }>(
    `SELECT a.attname
       FROM pg_catalog.pg_index i
       JOIN pg_catalog.pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
      WHERE i.indrelid = $1::regclass AND i.indisprimary
      ORDER BY pg_catalog.array_position(i.indkey::int2[], a.attnum)`,
    [`institution.${pg.escapeIdentifier(table)}`],
  );
  if (rows.length === 0) throw new Error(`institution.${table} has no primary key`);
  return rows.map((row) => row.attname);
}

/**
 * Every stored row the stricter rule refuses. Runs in its own READ ONLY
 * transaction as ductus_identity, the role the migration's guard runs as, so
 * it sees the same rows; nothing it does stays.
 */
export async function findRefusedLabels(client: pg.ClientBase, migration: string): Promise<Finding[]> {
  const { body, targets } = readRule(migration);
  const findings: Finding[] = [];
  await client.query("BEGIN READ ONLY");
  try {
    await client.query("SET LOCAL ROLE ductus_identity");
    await client.query("SET LOCAL search_path = ''");
    for (const { table, column } of targets) {
      const key = await primaryKey(client, table);
      const { rows } = await client.query<Record<string, string>>(
        `SELECT ${key.map((name) => `t.${pg.escapeIdentifier(name)}::text AS ${pg.escapeIdentifier(name)}`).join(", ")}
           FROM institution.${pg.escapeIdentifier(table)} AS t
          WHERE NOT (${body} FROM (SELECT t.${pg.escapeIdentifier(column)} AS p_text) AS arg)
          ORDER BY ${key.map((_, index) => index + 1).join(", ")}`,
      );
      for (const row of rows) {
        findings.push({ table: `institution.${table}`, column, id: key.map((name) => `${name}=${row[name]}`).join(" ") });
      }
    }
  } finally {
    await client.query("ROLLBACK");
  }
  return findings;
}

/** The report: table, column and key of each row, never the stored name. */
export function report(findings: Finding[]): string {
  if (findings.length === 0) return `No stored name would stop ${MIGRATION}.`;
  return [
    `${findings.length} stored name(s) would stop ${MIGRATION}:`,
    ...findings.map((finding) => `${finding.table}\t${finding.column}\t${finding.id}`),
  ].join("\n");
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL must name the login dbmate uses for this database.");
    return 2;
  }
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
    const findings = await findRefusedLabels(client, readFileSync(MIGRATION_FILE, "utf8"));
    console.log(report(findings));
    return findings.length === 0 ? 0 : 1;
  } catch (error) {
    console.error(`The check could not run: ${error instanceof Error ? error.message : "unknown error"}`);
    return 2;
  } finally {
    await client.end().catch(() => undefined);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
