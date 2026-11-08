import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  IGNORE, MIGRATIONS, PIN, POSTAMBLE, PREAMBLE,
  acknowledged, checkPin, checkRepository, expectedUp, installedPackage, planBody, strayMentions, upText,
} from "./pgboss-contract.mjs";

// DAN-517 (D-91, baza-i-pogon 4.8 t. 7): the pg-boss schema migration is the
// package's construction plan verbatim, and the pin cannot drift from it.
const root = fileURLToPath(new URL("../../", import.meta.url));
const schemaFile = `${root}db/migrations/${MIGRATIONS.schema}`;

const manifest = { dependencies: { "pg-boss": PIN.version } };
const lockfile = `importers:\n  .:\n    dependencies:\n      pg-boss:\n        specifier: ${PIN.version}\n        version: ${PIN.version}\n`;
const installed = { version: PIN.version, pgboss: { schema: PIN.schema } };

test("the repository holds the contract", async () => {
  assert.deepEqual(await checkRepository(root), []);
});

test("one changed byte in the up section breaks the contract", async () => {
  const text = readFileSync(schemaFile, "utf8");
  const { plan } = await installedPackage(root);
  assert.equal(upText(text), expectedUp(plan));
  const edited = text.replace("CREATE TABLE", "CREATE  TABLE");
  assert.notEqual(edited, text);
  assert.notEqual(upText(edited), expectedUp(plan));
  const noPostamble = text.replace("REVOKE CREATE ON SCHEMA pgboss FROM ductus_queue;\n", "");
  assert.notEqual(upText(noPostamble), expectedUp(plan));
});

test("the up section accepts exactly one squawk-ignore line, right before the singleton_on column", async () => {
  const text = readFileSync(schemaFile, "utf8");
  const { plan } = await installedPackage(root);
  // Squawk 2.70.0 applies squawk-ignore to the next line only, so the line sits
  // on the column it acknowledges, not on the statement.
  const line = `      ${IGNORE}\n`;
  const column = "      singleton_on timestamp without time zone,\n";
  assert.equal(text.split(line).length, 2);
  assert.ok(text.includes(line + column));
  assert.equal(upText(text), expectedUp(plan));
  // Each changed shape or place of the line is a different up section, so the contract fails.
  const shapes = {
    "no line": text.replace(line, ""),
    "another comment": text.replace(line, "      -- pg-boss column\n"),
    "another rule": text.replace(line, "      -- squawk-ignore ban-drop-column\n"),
    "two rules": text.replace(line, "      -- squawk-ignore prefer-timestamp-tz, ban-drop-constraint\n"),
    "two lines": text.replace(line, line + line),
    "not indented": text.replace(line, `${IGNORE}\n`),
    "trailing comment instead": text.replace(line + column, column.replace(",\n", `, ${IGNORE}\n`)),
    "after the column": text.replace(line + column, column + line),
    "before the statement": text.replace(line, "").replace("    CREATE TABLE pgboss.job (\n", `    ${IGNORE}\n    CREATE TABLE pgboss.job (\n`),
    "before an earlier statement": text.replace(line, "").replace("    CREATE TABLE pgboss.version (", `    ${IGNORE}\n    CREATE TABLE pgboss.version (`),
    "file wide": text.replace(line, "      -- squawk-ignore-file prefer-timestamp-tz\n"),
  };
  for (const [label, edited] of Object.entries(shapes)) {
    assert.notEqual(edited, text, label);
    assert.notEqual(upText(edited), expectedUp(plan), label);
  }
});

test("acknowledged puts the line before the one singleton_on column inside CREATE TABLE pgboss.job", () => {
  const job = (columns) => `A;\n    CREATE TABLE pgboss.job (\n${columns}\n    ) PARTITION BY LIST (name)\n  ;`;
  const singleton = "      singleton_on timestamp without time zone,";
  assert.equal(
    acknowledged(job(`      id uuid,\n${singleton}\n      started_on timestamp with time zone`)),
    job(`      id uuid,\n      ${IGNORE}\n${singleton}\n      started_on timestamp with time zone`),
  );
  assert.equal(acknowledged("CREATE TABLE pgboss.job (\nsingleton_on timestamp without time zone\n);"), `CREATE TABLE pgboss.job (\n${IGNORE}\nsingleton_on timestamp without time zone\n);`);
  assert.throws(() => acknowledged(job("      id uuid").replace("pgboss.job (", "pgboss.queue (")), /has 0 CREATE TABLE pgboss\.job/);
  assert.throws(() => acknowledged(job(singleton).replace("pgboss.job (", "pgboss.job_common (")), /has 0 CREATE TABLE/);
  assert.throws(() => acknowledged(`${job(singleton)}\n${job("      id uuid")}`), /has 2 CREATE TABLE/);
  assert.throws(() => acknowledged(job("      id uuid")), /has 0 singleton_on/);
  assert.throws(() => acknowledged(job(`${singleton}\n${singleton}`)), /has 2 singleton_on/);
  assert.throws(() => acknowledged(`CREATE TABLE pgboss.x (\n${singleton}\n);\n${job("      id uuid")}`), /not inside CREATE TABLE pgboss\.job/);
  assert.throws(() => acknowledged(`${job(singleton)}\nCREATE TABLE pgboss.y (at timestamp without time zone);`), /has 2 lines with timestamp without time zone/);
});

test("the postamble takes back every right the preamble grants and ends as the migrator", () => {
  const grants = PREAMBLE.match(/GRANT CREATE ON (DATABASE|SCHEMA)/g);
  const revokes = POSTAMBLE.match(/REVOKE CREATE ON (DATABASE|SCHEMA)/g);
  assert.deepEqual(grants.map((g) => g.replace("GRANT", "")), revokes.map((r) => r.replace("REVOKE", "")));
  assert.match(PREAMBLE, /SET LOCAL ROLE ductus_queue;\n$/);
  assert.match(POSTAMBLE, /^\nSET LOCAL ROLE ductus_migrator;\n/);
  assert.doesNotMatch(POSTAMBLE, /SET LOCAL ROLE ductus_queue/);
});

test("planBody strips one BEGIN ... COMMIT and refuses anything else", () => {
  assert.equal(planBody("BEGIN;\nSELECT 1;\nCOMMIT;\n"), "SELECT 1;");
  assert.throws(() => planBody("SELECT 1;\n"), /not one BEGIN/);
  assert.throws(() => planBody("BEGIN;\nSELECT 1;\n"), /not one BEGIN/);
});

test("upText needs exactly one up marker followed by one down marker", () => {
  assert.equal(upText("-- head\n-- migrate:up\nA;\nB;\n-- migrate:down\nC;\n"), "A;\nB;\n");
  assert.throws(() => upText("-- migrate:up\nA;\n"), /needs one/);
  assert.throws(() => upText("-- migrate:down\n-- migrate:up\nA;\n"), /needs one/);
  assert.throws(() => upText("-- migrate:up\nA;\n-- migrate:up\n-- migrate:down\n"), /needs one/);
});

test("checkPin accepts the exact pin in all three places", () => {
  assert.deepEqual(checkPin({ manifest, lockfile, installed }), []);
  const peers = lockfile.replace(`version: ${PIN.version}`, `version: ${PIN.version}(pg@8.16.3)`);
  assert.deepEqual(checkPin({ manifest, lockfile: peers, installed }), []);
});

test("checkPin refuses a range, a drifted lockfile, another install or another schema", () => {
  const caret = { dependencies: { "pg-boss": `^${PIN.version}` } };
  assert.match(checkPin({ manifest: caret, lockfile, installed }).join("\n"), /package\.json pins pg-boss/);
  assert.match(checkPin({ manifest: {}, lockfile, installed }).join("\n"), /package\.json pins pg-boss undefined/);
  const drift = lockfile.replace(`version: ${PIN.version}`, "version: 12.39.0");
  assert.match(checkPin({ manifest, lockfile: drift, installed }).join("\n"), /pnpm-lock\.yaml resolves/);
  const prefix = lockfile.replace(`version: ${PIN.version}`, `version: ${PIN.version}0`);
  assert.match(checkPin({ manifest, lockfile: prefix, installed }).join("\n"), /pnpm-lock\.yaml resolves/);
  assert.match(checkPin({ manifest, lockfile: "importers: {}\n", installed }).join("\n"), /no pg-boss importer/);
  assert.match(checkPin({ manifest, lockfile, installed: { ...installed, version: "12.39.0" } }).join("\n"), /node_modules has/);
  assert.match(checkPin({ manifest, lockfile, installed: { ...installed, pgboss: { schema: 47 } } }).join("\n"), /builds schema 47/);
});

test("strayMentions finds the pgboss schema outside the three migrations, as a whole word", () => {
  const migrations = new Map([
    [MIGRATIONS.owner, "CREATE SCHEMA pgboss;"],
    [MIGRATIONS.schema, "CREATE TABLE pgboss.job ();"],
    ["20261201000000_later.sql", "ALTER TABLE PgBoss.job ADD COLUMN x int;"],
    ["20261201000100_other.sql", "CREATE TABLE app.pgbossy ();"],
  ]);
  assert.deepEqual(strayMentions(migrations), ["20261201000000_later.sql"]);
});

// Review c.6721624678, QA c.6721626288: dbmate deletes the ledger row in the
// same transaction after the down section, and ductus_queue cannot touch
// public.schema_migrations, so every section has to end as the migrator.
const ROLE = /^SET LOCAL ROLE (\w+);$/gm;
const sections = (text) => {
  const [, rest] = text.split("-- migrate:up\n");
  const [up, down] = rest.split("-- migrate:down\n");
  return { up, down };
};
const lastRole = (section) => [...section.matchAll(ROLE)].at(-1)?.[1];

test("lastRole reads the role a section ends as", () => {
  assert.equal(lastRole("SET LOCAL ROLE ductus_queue;\nDROP TABLE x;\nSET LOCAL ROLE ductus_migrator;\n"), "ductus_migrator");
  assert.equal(lastRole("SET LOCAL ROLE ductus_queue;\nDROP TABLE x;\n"), "ductus_queue");
  assert.equal(lastRole("SET LOCAL ROLE ductus_migrator;\nSET LOCAL ROLE ductus_queue;\nDROP TABLE x;\n"), "ductus_queue");
  assert.equal(lastRole("  SET LOCAL ROLE ductus_migrator; -- not a whole line\n"), undefined);
});

test("every up and down section of the three pg-boss migrations ends as ductus_migrator", () => {
  for (const [kind, file] of Object.entries(MIGRATIONS)) {
    const text = readFileSync(`${root}db/migrations/${file}`, "utf8");
    for (const [part, section] of Object.entries(sections(text))) {
      assert.equal(lastRole(section), "ductus_migrator", `${kind} ${part}`);
    }
  }
});

test("the three pg-boss migrations run owner, schema, access, one after another", () => {
  const all = readdirSync(`${root}db/migrations`).filter((name) => name.endsWith(".sql")).sort();
  const at = [MIGRATIONS.owner, MIGRATIONS.schema, MIGRATIONS.access].map((name) => all.indexOf(name));
  assert.ok(at[0] >= 0, MIGRATIONS.owner);
  assert.deepEqual(at, [at[0], at[0] + 1, at[0] + 2]);
});
