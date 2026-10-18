import { randomBytes, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { findRefusedLabels, MIGRATION, readRule, report } from "@/server/db/plain-label-check";

// The check before the deploy of the stricter is_plain_label (#446), against
// the compose stack (pnpm stack:up, pnpm db:migrate). Each case gets a
// database of its own, migrated up to the one before that migration, with
// rows written as the compose superuser past every function; then the check
// runs, and then the migration itself, as dbmate runs it. Every institution,
// person, course and title is random or invented.
const ADMIN_URL = process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
const MIGRATIONS = fileURLToPath(new URL("../../db/migrations/", import.meta.url));
const MIGRATION_TEXT = readFileSync(`${MIGRATIONS}${MIGRATION}`, "utf8");

/** The up section of a dbmate migration file; dbmate allows comments before it. */
function upSection(file: string) {
  const text = readFileSync(`${MIGRATIONS}${file}`, "utf8");
  const up = text.indexOf("-- migrate:up");
  const down = text.indexOf("-- migrate:down");
  if (up < 0 || down < up) throw new Error(`${file} is not a dbmate migration`);
  return text.slice(up, down);
}

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 1 });
const created: { name: string; client: pg.Client }[] = [];

afterEach(async () => {
  for (const { name, client } of created.splice(0)) {
    await client.end();
    await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
  }
});
afterAll(() => admin.end());

/** A database of its own, migrated up to the one before the stricter rule. */
async function beforeTheRule() {
  const name = `ductus_label_${randomBytes(6).toString("hex")}`;
  await admin.query(`CREATE DATABASE ${name} OWNER ductus_migrator`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  const client = new pg.Client({ connectionString: url.href });
  await client.connect();
  created.push({ name, client });
  await client.query("SET ROLE ductus_migrator");
  const earlier = readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith(".sql") && file < MIGRATION)
    .sort();
  for (const file of earlier) await client.query(`BEGIN;\n${upSection(file)}\nCOMMIT;`);
  await client.query("RESET ROLE");
  return client;
}

/** Runs the migration the way dbmate does; on failure nothing of it stays. */
async function migrate(client: pg.Client) {
  await client.query("SET ROLE ductus_migrator");
  await client.query("BEGIN");
  try {
    await client.query(upSection(MIGRATION));
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.query("RESET ROLE");
  }
}

/** One institution with a course and an assignment, named as given; returns their keys. */
async function rows(client: pg.Client, names: { display: string; course: string; title: string }) {
  const ids = { institution: randomUUID(), teacher: randomUUID(), course: randomUUID(), assignment: randomUUID() };
  await client.query("INSERT INTO identity.institution (id, slug) VALUES ($1, $2)", [
    ids.institution,
    `fak-${randomBytes(4).toString("hex")}`,
  ]);
  await client.query("INSERT INTO institution.institution_settings (institution_id, display_name) VALUES ($1, $2)", [
    ids.institution,
    names.display,
  ]);
  await client.query(
    `INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
     VALUES ($1, $2, 'https://issuer.test', $3, $3 || '@test.example')`,
    [ids.teacher, ids.institution, `sub-${ids.teacher}`],
  );
  await client.query(
    `INSERT INTO institution.course (id, institution_id, name, academic_year, ai_policy, created_by)
     VALUES ($1, $2, $3, '2026/2027', 'prohibited', $4)`,
    [ids.course, ids.institution, names.course, ids.teacher],
  );
  await client.query("BEGIN");
  await client.query(
    "INSERT INTO institution.assignment (id, course_id, institution_id, created_by) VALUES ($1, $2, $3, $4)",
    [ids.assignment, ids.course, ids.institution, ids.teacher],
  );
  await client.query(
    `INSERT INTO institution.assignment_version (
       assignment_id, version_no, title, instructions, work_type, opens_at, due_at, ai_policy, ai_purposes,
       evidence_profile, import_allowed, created_by)
     VALUES ($1, 1, $2, 'Upute za izmišljeni zadatak.', 'essay', now(), now() + interval '30 days',
             'prohibited', '{}', 'basic', false, $3)`,
    [ids.assignment, names.title, ids.teacher],
  );
  await client.query("COMMIT");
  return ids;
}

const PLAIN = { display: "Izmišljeni fakultet", course: "Kolegij K1", title: "Izmišljeni zadatak" };
// Each passes the rule before #377 and is refused by the stricter one: a tag
// character or the combining grapheme joiner beside a visible name.
const HIDDEN = {
  display: "Skriveni fakultet\u034F",
  course: "Skriveni kolegij\u{E0001}",
  title: "Skriveni zadatak\u{E0041}\u{E007F}",
};

describe("the check before the stricter is_plain_label", () => {
  it("finds nothing on a database whose names all pass, and the migration then applies the rule it read", async () => {
    const client = await beforeTheRule();
    await rows(client, PLAIN);
    const { rows: before } = await client.query("SELECT current_user, pg_catalog.current_setting('search_path') AS path");

    expect(await findRefusedLabels(client, MIGRATION_TEXT)).toEqual([]);
    // Nothing of the check's transaction, role or search_path stays.
    const { rows: after } = await client.query("SELECT current_user, pg_catalog.current_setting('search_path') AS path");
    expect(after).toEqual(before);

    await migrate(client);
    const { rows: applied } = await client.query(
      "SELECT prosrc FROM pg_catalog.pg_proc WHERE oid = 'institution.is_plain_label(text)'::regprocedure",
    );
    expect(applied[0].prosrc.trim()).toBe(readRule(MIGRATION_TEXT).body);
    expect(await findRefusedLabels(client, MIGRATION_TEXT)).toEqual([]);
  });

  it("names every row the migration would stop on by table, column and key, and never prints the name", async () => {
    const client = await beforeTheRule();
    await rows(client, PLAIN);
    const hidden = await rows(client, HIDDEN);

    const findings = await findRefusedLabels(client, MIGRATION_TEXT);
    expect(findings).toEqual([
      { table: "institution.course", column: "name", id: `id=${hidden.course}` },
      { table: "institution.institution_settings", column: "display_name", id: `institution_id=${hidden.institution}` },
      {
        table: "institution.assignment_version",
        column: "title",
        id: `assignment_id=${hidden.assignment} version_no=1`,
      },
    ]);
    const printed = report(findings);
    expect(printed).toContain("3 stored name(s)");
    expect(printed).not.toMatch(/Skriveni|\u034F|[\u{E0000}-\u{E007F}]/u);

    // The migration stops on exactly these rows.
    await expect(migrate(client)).rejects.toThrow("a stored name does not pass the stricter is_plain_label");
  });
});
