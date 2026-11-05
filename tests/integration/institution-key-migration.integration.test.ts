import { randomBytes, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { requireLoopbackDatabaseUrl } from "./loopback-database-url";

// The institution key migration (DAN-83) over rows that predate it, against
// the compose stack (pnpm stack:up, pnpm db:migrate). pgTAP sees the schema
// only after every migration; here each case gets a database of its own,
// migrated up to the one before the key, then filled with rows written
// without it, and only then given the migration itself, as dbmate runs it:
// the up section in one transaction, as ductus_migrator. Every institution,
// person and assignment is random or invented.
const ADMIN_URL = process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
requireLoopbackDatabaseUrl(ADMIN_URL, "The migration test runs only against a loopback database (DATABASE_URL).");
const MIGRATIONS = fileURLToPath(new URL("../../db/migrations/", import.meta.url));
const TARGET = "20261011100000_institution_assignment_key.sql";

/** The up section of a dbmate migration file. */
function upSection(file: string) {
  const text = readFileSync(`${MIGRATIONS}${file}`, "utf8");
  const up = text.indexOf("-- migrate:up");
  const down = text.indexOf("-- migrate:down");
  if (up !== 0 || down < 0) throw new Error(`${file} is not a dbmate migration`);
  return text.slice(0, down);
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

/** A database of its own, migrated up to the one before the key. */
async function beforeTheKey() {
  const name = `ductus_key_${randomBytes(6).toString("hex")}`;
  await admin.query(`CREATE DATABASE ${name} OWNER ductus_migrator`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  const client = new pg.Client({ connectionString: url.href });
  await client.connect();
  created.push({ name, client });
  await client.query("SET ROLE ductus_migrator");
  const earlier = readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith(".sql") && file < TARGET)
    .sort();
  for (const file of earlier) await client.query(`BEGIN;\n${upSection(file)}\nCOMMIT;`);
  return client;
}

/** Runs the key migration the way dbmate does; on failure nothing of it stays. */
async function migrate(client: pg.Client) {
  await client.query("BEGIN");
  try {
    await client.query(upSection(TARGET));
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

/**
 * Old rows, written as the compose superuser past every function, as the
 * schema before the key allowed them: fak-a has K1 with Z1, fak-b K3 with Z3,
 * each assignment acknowledged by a student of its own institution.
 */
async function oldRows(client: pg.Client) {
  const ids = {
    facultyA: randomUUID(),
    facultyB: randomUUID(),
    teacherA: randomUUID(),
    studentA: randomUUID(),
    teacherB: randomUUID(),
    studentB: randomUUID(),
    courseA: randomUUID(),
    courseB: randomUUID(),
    assignmentA: randomUUID(),
    assignmentB: randomUUID(),
  };
  await client.query("RESET ROLE");
  await client.query("INSERT INTO identity.institution (id, slug) VALUES ($1, 'fak-a'), ($2, 'fak-b')", [
    ids.facultyA,
    ids.facultyB,
  ]);
  const people: [string, string, string][] = [
    [ids.teacherA, ids.facultyA, "nastavnik-a"],
    [ids.studentA, ids.facultyA, "student-a"],
    [ids.teacherB, ids.facultyB, "nastavnik-b"],
    [ids.studentB, ids.facultyB, "student-b"],
  ];
  for (const [id, institution, name] of people) {
    await client.query(
      `INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
       VALUES ($1, $2, 'https://issuer.test', $3, $3 || '@test.example')`,
      [id, institution, `sub-${name}`],
    );
  }
  await client.query(
    `INSERT INTO institution.course (id, institution_id, name, academic_year, ai_policy, created_by)
     VALUES ($1, $2, 'K1', '2026/2027', 'prohibited', $3), ($4, $5, 'K3', '2026/2027', 'prohibited', $6)`,
    [ids.courseA, ids.facultyA, ids.teacherA, ids.courseB, ids.facultyB, ids.teacherB],
  );
  await assignment(client, ids.assignmentA, ids.courseA, ids.teacherA);
  await assignment(client, ids.assignmentB, ids.courseB, ids.teacherB);
  await acknowledgment(client, ids.assignmentA, ids.studentA);
  await acknowledgment(client, ids.assignmentB, ids.studentB);
  return ids;
}

/** An assignment with its first version, which its pointer needs by the end of the transaction. */
async function assignment(client: pg.Client, id: string, course: string, author: string) {
  await client.query("BEGIN");
  await client.query("INSERT INTO institution.assignment (id, course_id, created_by) VALUES ($1, $2, $3)", [
    id,
    course,
    author,
  ]);
  await client.query(
    `INSERT INTO institution.assignment_version (
       assignment_id, version_no, title, instructions, work_type, opens_at, due_at, ai_policy, ai_purposes,
       evidence_profile, import_allowed, created_by)
     VALUES ($1, 1, 'Zadatak', 'Upute za izmišljeni zadatak.', 'essay', now(), now() + interval '30 days',
             'prohibited', '{}', 'basic', false, $2)`,
    [id, author],
  );
  await client.query("COMMIT");
}

async function acknowledgment(client: pg.Client, assignmentId: string, student: string) {
  await client.query(
    "INSERT INTO institution.notice_acknowledgment (assignment_id, version_no, student_id) VALUES ($1, 1, $2)",
    [assignmentId, student],
  );
}

const ASSIGNMENTS = "SELECT * FROM institution.assignment ORDER BY id";
const ACKNOWLEDGMENTS = "SELECT * FROM institution.notice_acknowledgment ORDER BY assignment_id, student_id";
const KEY_COLUMNS = `
  SELECT table_name FROM information_schema.columns
  WHERE table_schema = 'institution' AND table_name IN ('assignment', 'notice_acknowledgment')
    AND column_name = 'institution_id'`;

describe("the institution key migration over old rows", () => {
  it("gives every old row the institution of its parent and keeps the rest of it", async () => {
    const client = await beforeTheKey();
    const ids = await oldRows(client);
    const assignmentsBefore = (await client.query(ASSIGNMENTS)).rows;
    const acknowledgmentsBefore = (await client.query(ACKNOWLEDGMENTS)).rows;

    await client.query("SET ROLE ductus_migrator");
    await migrate(client);
    await client.query("RESET ROLE");

    const assignments = (await client.query(ASSIGNMENTS)).rows;
    expect(assignments).toEqual(
      assignmentsBefore.map((row) => ({
        ...row,
        institution_id: row.id === ids.assignmentA ? ids.facultyA : ids.facultyB,
      })),
    );
    const acknowledgments = (await client.query(ACKNOWLEDGMENTS)).rows;
    expect(acknowledgments).toEqual(
      acknowledgmentsBefore.map((row) => ({
        ...row,
        institution_id: row.assignment_id === ids.assignmentA ? ids.facultyA : ids.facultyB,
      })),
    );
    expect(assignments).toHaveLength(2);
    expect(acknowledgments).toHaveLength(2);
  });

  it.each([
    {
      what: "an assignment of fak-a whose author belongs to fak-b",
      constraint: "assignment_created_by_institution_fkey",
      write: async (client: pg.Client, ids: Awaited<ReturnType<typeof oldRows>>) =>
        assignment(client, randomUUID(), ids.courseA, ids.teacherB),
    },
    {
      what: "an acknowledgment of an assignment of fak-a by a student of fak-b",
      constraint: "notice_acknowledgment_student_institution_fkey",
      write: async (client: pg.Client, ids: Awaited<ReturnType<typeof oldRows>>) =>
        acknowledgment(client, ids.assignmentA, ids.studentB),
    },
  ])("refuses $what as a whole and leaves the old schema", async ({ constraint, write }) => {
    const client = await beforeTheKey();
    const ids = await oldRows(client);
    await write(client, ids);
    const assignmentsBefore = (await client.query(ASSIGNMENTS)).rows;
    const acknowledgmentsBefore = (await client.query(ACKNOWLEDGMENTS)).rows;

    await client.query("SET ROLE ductus_migrator");
    await expect(migrate(client)).rejects.toMatchObject({ code: "23503", constraint });
    await client.query("RESET ROLE");

    expect((await client.query(KEY_COLUMNS)).rows).toEqual([]);
    expect((await client.query(ASSIGNMENTS)).rows).toEqual(assignmentsBefore);
    expect((await client.query(ACKNOWLEDGMENTS)).rows).toEqual(acknowledgmentsBefore);
  });
});
