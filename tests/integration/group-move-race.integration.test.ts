import { randomBytes, randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWithActor, type WithActor } from "@/server/db/with-actor";

import { requireLoopbackDatabaseUrl } from "./loopback-database-url";

// DAN-351 (#1372, repair round 3, Codex thread on group_scope.sql:92): a
// group teacher reaches a work only if it was started no earlier than the
// student's place in the group and her own place as its teacher. pgTAP runs
// in one transaction and cannot hold two of them open, so here two real
// connections race: the course teacher's transaction begins, the student
// then opens a work in her old group and keeps it uncommitted, and only then
// does the course teacher move her (or hand the group over). The move must
// wait for the work and give the new place a start after it, so the new
// group teacher never reaches a work started in the old group. Loopback
// only; one random login and random synthetic rows, removed afterwards.
// Vesna, Marko, Nina, Ana and Boris are invented.
const SAFE_ADMIN_URL: string =
  process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
requireLoopbackDatabaseUrl(SAFE_ADMIN_URL, "The group move race test runs only against a loopback database (DATABASE_URL).");
const suffix = randomBytes(5).toString("hex");
const login = `it_group_move_${suffix}`;
const applicationName = `it_group_move_${suffix}`;
const password = randomBytes(24).toString("hex");
const institutionId = randomUUID();
const people = { vesna: randomUUID(), marko: randomUUID(), nina: randomUUID(), ana: randomUUID(), boris: randomUUID() };
type Person = keyof typeof people;
const tokens = Object.fromEntries(
  Object.keys(people).map((name) => [name, randomBytes(32).toString("base64url")]),
) as Record<Person, string>;
const courseId = randomUUID();
const moveAssignmentId = randomUUID();
const handoverAssignmentId = randomUUID();
const domainId = randomUUID();
const groups = { g1: "", g2: "" };

const admin = new pg.Pool({ connectionString: SAFE_ADMIN_URL, max: 1 });
let appPool: pg.Pool;
let withActor: WithActor;
let fixtureReady = false;

function applicationUrl() {
  const url = new URL(SAFE_ADMIN_URL);
  url.username = login;
  url.password = password;
  url.searchParams.set("application_name", applicationName);
  return url.href;
}

async function waitForBlockedAssign(timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await admin.query<{ blocked: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_stat_activity a
          WHERE a.usename = $1 AND a.application_name = $2 AND a.state = 'active'
            AND a.query ILIKE '%assign_group_%'
            AND cardinality(pg_catalog.pg_blocking_pids(a.pid)) > 0
       ) AS blocked`,
      [login, applicationName],
    );
    if (result.rows[0]?.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("The group change did not reach PostgreSQL and wait on the open work.");
}

async function insertFixture() {
  const client = await admin.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO identity.institution (id, slug) VALUES ($1, $2)", [institutionId, `it-${suffix}`]);
    for (const [name, id] of Object.entries(people)) {
      await client.query(
        `INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, institutionId, `https://issuer-${suffix}.test`, `sub-${name}`, `${name}@${suffix}.example`],
      );
      await client.query(
        `INSERT INTO identity.session (token_hash, user_id, institution_id, expires_at)
         VALUES (sha256(convert_to($1, 'UTF8')), $2, $3, now() + interval '1 hour')`,
        [tokens[name as Person], id, institutionId],
      );
    }
    for (const teacher of [people.vesna, people.marko, people.nina]) {
      await client.query(
        `INSERT INTO institution.institution_role (institution_id, user_id, role, confirmed_at)
         VALUES ($1, $2, 'teacher', now())`,
        [institutionId, teacher],
      );
    }
    await client.query(
      `INSERT INTO institution.course (id, institution_id, name, academic_year, ai_policy, created_by)
       VALUES ($1, $2, $3, '2026/2027', 'partially_allowed', $4)`,
      [courseId, institutionId, `Grupe ${suffix}`, people.vesna],
    );
    for (const [name, role] of [["vesna", "teacher"], ["ana", "student"], ["boris", "student"]] as const) {
      await client.query(
        "INSERT INTO institution.course_member (course_id, institution_id, user_id, role) VALUES ($1, $2, $3, $4)",
        [courseId, institutionId, people[name], role],
      );
    }
    for (const id of [moveAssignmentId, handoverAssignmentId]) {
      await client.query(
        `INSERT INTO institution.assignment (id, course_id, institution_id, current_version, created_by)
         VALUES ($1, $2, $3, 1, $4)`,
        [id, courseId, institutionId, people.vesna],
      );
      await client.query(
        `INSERT INTO institution.assignment_version
           (assignment_id, version_no, title, instructions, work_type, opens_at, due_at, ai_policy,
            ai_purposes, evidence_profile, import_allowed, created_by)
         VALUES ($1, 1, 'Synthetic race', 'Synthetic concurrency fixture.', 'essay',
                 now() - interval '1 day', now() + interval '1 day', 'partially_allowed',
                 ARRAY[]::text[], 'basic', false, $2)`,
        [id, people.vesna],
      );
      for (const student of [people.ana, people.boris]) {
        await client.query(
          `INSERT INTO institution.notice_acknowledgment (assignment_id, version_no, student_id, institution_id)
           VALUES ($1, 1, $2, $3)`,
          [id, student, institutionId],
        );
      }
    }
    await client.query("INSERT INTO evidence.domain (id, institution_id, region) VALUES ($1, $2, 'eu-central-1')", [
      domainId,
      institutionId,
    ]);
    await client.query("COMMIT");
    fixtureReady = true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function removeFixture() {
  if (!fixtureReady) return;
  await admin.query("BEGIN");
  try {
    // Disposable synthetic rows only; the append-only triggers stay active in
    // normal operation (same teardown as the other evidence race tests).
    await admin.query("SET LOCAL session_replication_role = replica");
    for (const table of [
      "evidence.package",
      "evidence.document_checkpoint",
      "evidence.document_revision",
      "evidence.document",
      "evidence.project",
      "evidence.domain",
      "institution.seminar_group_member",
      "institution.seminar_group_teacher",
      "institution.seminar_group",
      "institution.notice_acknowledgment",
    ]) {
      await admin.query(`DELETE FROM ${table} WHERE institution_id = $1`, [institutionId]);
    }
    const assignments = [moveAssignmentId, handoverAssignmentId];
    await admin.query("DELETE FROM institution.assignment_version WHERE assignment_id = ANY ($1)", [assignments]);
    await admin.query("DELETE FROM institution.assignment WHERE id = ANY ($1)", [assignments]);
    await admin.query("DELETE FROM institution.course_member WHERE course_id = $1", [courseId]);
    await admin.query("DELETE FROM institution.course WHERE id = $1", [courseId]);
    await admin.query("DELETE FROM institution.institution_role WHERE institution_id = $1", [institutionId]);
    await admin.query("DELETE FROM identity.session WHERE institution_id = $1", [institutionId]);
    await admin.query("DELETE FROM identity.user_account WHERE institution_id = $1", [institutionId]);
    await admin.query("DELETE FROM identity.institution WHERE id = $1", [institutionId]);
    await admin.query("COMMIT");
  } catch (error) {
    await admin.query("ROLLBACK");
    throw error;
  }
}

function asVesna(sql: string, values: unknown[]) {
  return withActor(tokens.vesna, async (tx) => (await tx.query(sql, values)).rows[0]);
}

function can(person: Person, documentId: string) {
  return withActor(tokens[person], async (tx) => (
    await tx.query<{ can: boolean }>("SELECT institution.can('read', $1) AS can", [documentId])
  ).rows[0].can);
}

// The race of the Codex thread: the course teacher's transaction begins
// first, the student then opens a work and keeps it uncommitted, and the
// group change runs after that. Returns the work's document and whether the
// group change answered before the work was committed.
async function race(student: Person, assignmentId: string, change: Array<[string, unknown[]]>) {
  let begun!: () => void;
  let opened!: () => void;
  let releaseWork!: () => void;
  const teacherBegun = new Promise<void>((resolve) => { begun = resolve; });
  const workOpened = new Promise<void>((resolve) => { opened = resolve; });
  const holdWork = new Promise<void>((resolve) => { releaseWork = resolve; });
  let documentId = "";
  let changeAnswered = false;

  const teacherRun = withActor(tokens.vesna, async (tx) => {
    await tx.query("SELECT now()");
    begun();
    await workOpened;
    for (const [sql, values] of change) await tx.query(sql, values);
    changeAnswered = true;
  });
  const workRun = withActor(tokens[student], async (tx) => {
    await Promise.race([teacherBegun, teacherRun]);
    const row = (await tx.query<{ outcome: string; document_id: string }>(
      "SELECT outcome, document_id FROM app.open_student_work($1)",
      [assignmentId],
    )).rows[0];
    expect(row.outcome).toBe("opened");
    documentId = row.document_id;
    opened();
    await holdWork; // Keep the uncommitted work until the group change waits on it.
  });
  let answeredBeforeRelease = true;
  try {
    await Promise.race([workOpened, workRun]);
    answeredBeforeRelease = await Promise.race([
      teacherRun.then(() => true, () => true),
      waitForBlockedAssign().then(() => changeAnswered),
    ]);
  } finally {
    opened();
    releaseWork();
    await Promise.allSettled([teacherRun, workRun]);
  }
  await workRun;
  await teacherRun;
  return { documentId, answeredBeforeRelease };
}

beforeAll(async () => {
  const ddl = await admin.query<{ ddl: string }>(
    "SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L IN ROLE ductus_app', $1::text, $2::text) AS ddl",
    [login, password],
  );
  await admin.query(ddl.rows[0].ddl);
  await insertFixture();
  // Three connections: the teacher's and the student's transactions stay
  // open on two while the third asks.
  appPool = new pg.Pool({ connectionString: applicationUrl(), max: 3 });
  withActor = createWithActor(appPool);
  for (const [key, name] of [["g1", "Grupa 1"], ["g2", "Grupa 2"]] as const) {
    groups[key] = (await asVesna("SELECT institution.create_seminar_group($1, $2) AS id", [courseId, name])).id;
  }
  for (const [fn, group, person] of [
    ["assign_group_teacher", groups.g1, people.marko],
    ["assign_group_teacher", groups.g2, people.nina],
    ["assign_group_student", groups.g1, people.ana],
    ["assign_group_student", groups.g1, people.boris],
  ] as const) {
    await asVesna(`SELECT institution.${fn}($1, $2)`, [group, person]);
  }
});

afterAll(async () => {
  await appPool?.end();
  let cleanupError: unknown;
  try {
    await removeFixture();
  } catch (error) {
    cleanupError = error;
  }
  try {
    const drop = await admin.query<{ ddl: string }>("SELECT format('DROP ROLE IF EXISTS %I', $1::text) AS ddl", [login]);
    await admin.query(drop.rows[0].ddl);
  } finally {
    await admin.end();
  }
  if (cleanupError) throw cleanupError;
});

describe("a group change racing a work started in the old group (DAN-351, #1372)", () => {
  it("a move waits for the work, and the new group teacher does not reach it", async () => {
    const { documentId, answeredBeforeRelease } = await race("ana", moveAssignmentId, [
      ["SELECT institution.end_group_assignment($1, $2)", [groups.g1, people.ana]],
      ["SELECT institution.assign_group_student($1, $2)", [groups.g2, people.ana]],
    ]);
    expect.soft(answeredBeforeRelease).toBe(false);
    const order = await admin.query<{ after: boolean }>(
      `SELECT g.valid_from > p.created_at AS after
         FROM institution.seminar_group_member g, evidence.project p
        WHERE g.group_id = $1 AND g.user_id = $2 AND g.valid_to IS NULL
          AND p.assignment_id = $3 AND p.principal_id = $2`,
      [groups.g2, people.ana, moveAssignmentId],
    );
    expect(order.rows).toEqual([{ after: true }]);
    expect({
      nina: await can("nina", documentId),
      marko: await can("marko", documentId),
      vesna: await can("vesna", documentId),
      ana: await can("ana", documentId),
    }).toStrictEqual({ nina: false, marko: false, vesna: true, ana: true });
  });

  it("a handover waits for the work, and the new teacher of the group does not reach it", async () => {
    const { documentId, answeredBeforeRelease } = await race("boris", handoverAssignmentId, [
      ["SELECT institution.end_group_assignment($1, $2)", [groups.g1, people.marko]],
      ["SELECT institution.assign_group_teacher($1, $2)", [groups.g1, people.nina]],
    ]);
    expect.soft(answeredBeforeRelease).toBe(false);
    expect({
      nina: await can("nina", documentId),
      marko: await can("marko", documentId),
      vesna: await can("vesna", documentId),
      boris: await can("boris", documentId),
    }).toStrictEqual({ nina: false, marko: false, vesna: true, boris: true });
  });
});
