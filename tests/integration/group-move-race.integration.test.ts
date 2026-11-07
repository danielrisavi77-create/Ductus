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
// group teacher never reaches a work started in the old group. Review
// c.6589792083 adds a student who comes back to the course while a teacher of
// the student's group is being assigned: the return must wait for that
// assignment, so no work of the student can start and commit before it. QA
// c.6590203077 adds an ending racing a new assignment of the same person:
// both must commit, not deadlock. A Codex thread adds a student removed from
// the course after an assignment of a group teacher began: the place of the
// new teacher still starts after the work the student started before the
// removal. #1629 pins the same races to the tie that made them flaky: the
// work starts in the very microsecond the course teacher's transaction began.
// Loopback only; one random login and random synthetic rows, removed
// afterwards. Vesna, Marko, Nina, Ana, Boris, Cvita, Daria, Ema and Frane are
// invented.
const SAFE_ADMIN_URL: string =
  process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
requireLoopbackDatabaseUrl(SAFE_ADMIN_URL, "The group move race test runs only against a loopback database (DATABASE_URL).");
const suffix = randomBytes(5).toString("hex");
const login = `it_group_move_${suffix}`;
const applicationName = `it_group_move_${suffix}`;
const password = randomBytes(24).toString("hex");
const institutionId = randomUUID();
const people = {
  vesna: randomUUID(),
  marko: randomUUID(),
  nina: randomUUID(),
  ana: randomUUID(),
  boris: randomUUID(),
  cvita: randomUUID(),
  daria: randomUUID(),
  ema: randomUUID(),
  frane: randomUUID(),
};
type Person = keyof typeof people;
const tokens = Object.fromEntries(
  Object.keys(people).map((name) => [name, randomBytes(32).toString("base64url")]),
) as Record<Person, string>;
const courseId = randomUUID();
const moveAssignmentId = randomUUID();
const handoverAssignmentId = randomUUID();
const returnAssignmentId = randomUUID();
const tieMoveAssignmentId = randomUUID();
const tieHandoverAssignmentId = randomUUID();
const assignments = [moveAssignmentId, handoverAssignmentId, returnAssignmentId, tieMoveAssignmentId, tieHandoverAssignmentId];
const domainId = randomUUID();
const groups = { g1: "", g2: "", g3: "", g4: "", g5: "", g6: "" };
let enrollmentCode = "";

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

async function waitForBlocked(pattern: string, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await admin.query<{ blocked: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_stat_activity a
          WHERE a.usename = $1 AND a.application_name = $2 AND a.state = 'active'
            AND a.query ILIKE $3
            AND cardinality(pg_catalog.pg_blocking_pids(a.pid)) > 0
       ) AS blocked`,
      [login, applicationName, pattern],
    );
    if (result.rows[0]?.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`No ${pattern} call reached PostgreSQL and waited on the open transaction.`);
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
    await client.query(
      "INSERT INTO institution.institution_settings (institution_id, display_name) VALUES ($1, 'Izmisljeni fakultet grupe')",
      [institutionId],
    );
    for (const [name, role] of [
      ["vesna", "teacher"],
      ["ana", "student"],
      ["boris", "student"],
      ["cvita", "student"],
      ["daria", "student"],
      ["ema", "student"],
      ["frane", "student"],
    ] as const) {
      await client.query(
        "INSERT INTO institution.course_member (course_id, institution_id, user_id, role) VALUES ($1, $2, $3, $4)",
        [courseId, institutionId, people[name], role],
      );
    }
    for (const id of assignments) {
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
      for (const student of [people.ana, people.boris, people.cvita, people.daria, people.ema, people.frane]) {
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
      "audit.course_member_event",
      "audit.enrollment_code_event",
      "institution.institution_settings",
    ]) {
      await admin.query(`DELETE FROM ${table} WHERE institution_id = $1`, [institutionId]);
    }
    await admin.query("DELETE FROM institution.enrollment_attempt WHERE user_id = ANY ($1)", [Object.values(people)]);
    await admin.query("DELETE FROM institution.course_enrollment_code WHERE course_id = $1", [courseId]);
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
      waitForBlocked("%assign_group_%").then(() => changeAnswered),
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
  for (const [key, name] of [
    ["g1", "Grupa 1"], ["g2", "Grupa 2"], ["g3", "Grupa 3"], ["g4", "Grupa 4"], ["g5", "Grupa 5"], ["g6", "Grupa 6"],
  ] as const) {
    groups[key] = (await asVesna("SELECT institution.create_seminar_group($1, $2) AS id", [courseId, name])).id;
  }
  for (const [fn, group, person] of [
    ["assign_group_teacher", groups.g1, people.marko],
    ["assign_group_teacher", groups.g2, people.nina],
    ["assign_group_student", groups.g1, people.ana],
    ["assign_group_student", groups.g1, people.boris],
    ["assign_group_student", groups.g3, people.cvita],
    ["assign_group_teacher", groups.g5, people.marko],
    ["assign_group_teacher", groups.g6, people.nina],
    ["assign_group_student", groups.g5, people.ema],
    ["assign_group_student", groups.g5, people.frane],
  ] as const) {
    await asVesna(`SELECT institution.${fn}($1, $2)`, [group, person]);
  }
  // Cvita and Daria leave the course and may come back; Cvita keeps the open
  // place in group 3, Daria has none.
  enrollmentCode = (await asVesna(
    "SELECT institution.create_enrollment_code($1, now() + interval '1 day') AS code",
    [courseId],
  )).code;
  for (const student of [people.cvita, people.daria]) {
    expect((await asVesna("SELECT institution.remove_student($1, $2) AS done", [courseId, student])).done).toBe(true);
    expect((await asVesna("SELECT institution.allow_student_return($1, $2) AS done", [courseId, student])).done).toBe(true);
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

// The race of review c.6589792083: the course teacher assigns a teacher to a
// group and keeps the transaction open; a student then comes back to the
// course and starts a work, each in its own transaction. Returns what the
// student's steps returned, whether they all finished before the assignment
// was committed, and clock_timestamp() taken just before that commit.
async function returnDuringAssignment<T>(group: string, teacher: string, studentSteps: () => Promise<T>) {
  let assigned!: () => void;
  let releaseAssignment!: () => void;
  const assignmentOpen = new Promise<void>((resolve) => { assigned = resolve; });
  const holdAssignment = new Promise<void>((resolve) => { releaseAssignment = resolve; });
  let committedAfter = "";
  const teacherRun = withActor(tokens.vesna, async (tx) => {
    await tx.query("SELECT institution.assign_group_teacher($1, $2)", [group, teacher]);
    assigned();
    await holdAssignment;
    committedAfter = (await tx.query<{ at: string }>("SELECT clock_timestamp()::text AS at")).rows[0].at;
  });
  let studentRun: Promise<T> | undefined;
  let finishedBeforeCommit = false;
  try {
    await Promise.race([assignmentOpen, teacherRun]);
    studentRun = studentSteps();
    finishedBeforeCommit = await Promise.race([
      studentRun.then(() => true, () => true),
      waitForBlocked("%enroll_with_code%").then(() => false),
    ]);
  } finally {
    assigned();
    releaseAssignment();
    await Promise.allSettled([teacherRun, studentRun]);
  }
  await teacherRun;
  return { result: await studentRun, finishedBeforeCommit, committedAfter };
}

function enroll(person: Person) {
  return withActor(tokens[person], async (tx) => (
    await tx.query<{ outcome: string }>("SELECT outcome FROM institution.enroll_with_code($1::text)", [enrollmentCode])
  ).rows[0].outcome);
}

describe("a course return racing the assignment of a group teacher (DAN-351, #1372, c.6589792083)", () => {
  it("a return with an open group place waits, and the work starts after the new teacher's place", async () => {
    const { result, finishedBeforeCommit, committedAfter } = await returnDuringAssignment(groups.g3, people.nina, async () => {
      const outcome = await enroll("cvita");
      const work = await withActor(tokens.cvita, async (tx) => (
        await tx.query<{ outcome: string; document_id: string }>(
          "SELECT outcome, document_id FROM app.open_student_work($1)",
          [returnAssignmentId],
        )
      ).rows[0]);
      return { outcome, work };
    });
    expect.soft(finishedBeforeCommit).toBe(false);
    expect(result.outcome).toBe("enrolled");
    expect(result.work.outcome).toBe("opened");
    const order = await admin.query<{ after_commit: boolean; after_place: boolean }>(
      `SELECT p.created_at > $3::timestamptz AS after_commit, p.created_at >= t.valid_from AS after_place
         FROM evidence.project p, institution.seminar_group_teacher t
        WHERE p.assignment_id = $1 AND p.principal_id = $2
          AND t.group_id = $4 AND t.user_id = $5 AND t.valid_to IS NULL`,
      [returnAssignmentId, people.cvita, committedAfter, groups.g3, people.nina],
    );
    expect(order.rows).toEqual([{ after_commit: true, after_place: true }]);
    // Positive control: the work started after Nina's place, so she reaches it.
    expect({
      nina: await can("nina", result.work.document_id),
      marko: await can("marko", result.work.document_id),
      vesna: await can("vesna", result.work.document_id),
      cvita: await can("cvita", result.work.document_id),
    }).toStrictEqual({ nina: true, marko: false, vesna: true, cvita: true });
  });

  it("a return without a group place does not wait for the assignment", async () => {
    const { result, finishedBeforeCommit } = await returnDuringAssignment(groups.g4, people.marko, () => enroll("daria"));
    expect(finishedBeforeCommit).toBe(true);
    expect(result).toBe("enrolled");
  });
});

// The schedule of QA c.6590203077: the course teacher ends a place in one
// transaction and keeps it open; a second transaction assigns the same
// person again and waits on the ended place; the first then assigns someone
// else to the group the second wants. Each assignment and each ending takes
// the course's group lock first, so the second waits before it holds a row
// and both commit; without that lock PostgreSQL aborts one as a deadlock.
async function endDuringReassignment(
  ending: [string, unknown[]],
  reassignment: [string, unknown[]],
  following: [string, unknown[]],
) {
  let ended!: () => void;
  let releaseEnding!: () => void;
  const endingOpen = new Promise<void>((resolve) => { ended = resolve; });
  const holdEnding = new Promise<void>((resolve) => { releaseEnding = resolve; });
  const endingRun = withActor(tokens.vesna, async (tx) => {
    await tx.query(...ending);
    ended();
    await holdEnding;
    await tx.query(...following);
  });
  let reassignmentRun: Promise<unknown> | undefined;
  let waited = false;
  try {
    await Promise.race([endingOpen, endingRun]);
    reassignmentRun = asVesna(...reassignment);
    waited = await Promise.race([
      reassignmentRun.then(() => false, () => false),
      waitForBlocked("%assign_group_%").then(() => true),
    ]);
  } finally {
    ended();
    releaseEnding();
  }
  const settled = await Promise.allSettled([endingRun, reassignmentRun]);
  return { waited, statuses: settled.map((result) => (result.status === "fulfilled" ? "committed" : String(result.reason))) };
}

async function openPlaces(table: "seminar_group_teacher" | "seminar_group_member", group: string) {
  return (await admin.query<{ user_id: string }>(
    `SELECT user_id FROM institution.${table} WHERE group_id = $1 AND valid_to IS NULL ORDER BY user_id`,
    [group],
  )).rows.map((row) => row.user_id);
}

describe("an ending racing a new assignment of the same person (DAN-351, #1372, c.6590203077)", () => {
  it("a teacher handover and a repeated assignment of the old teacher both commit", async () => {
    const { waited, statuses } = await endDuringReassignment(
      ["SELECT institution.end_group_assignment($1, $2)", [groups.g4, people.marko]],
      ["SELECT institution.assign_group_teacher($1, $2)", [groups.g4, people.marko]],
      ["SELECT institution.assign_group_teacher($1, $2)", [groups.g4, people.nina]],
    );
    expect(waited).toBe(true);
    expect(statuses).toEqual(["committed", "committed"]);
    expect(await openPlaces("seminar_group_teacher", groups.g4)).toEqual([people.marko, people.nina].sort());
  });

  it("a student move and a new place in the student's next group both commit", async () => {
    const { waited, statuses } = await endDuringReassignment(
      ["SELECT institution.end_group_assignment($1, $2)", [groups.g2, people.ana]],
      ["SELECT institution.assign_group_student($1, $2)", [groups.g3, people.ana]],
      ["SELECT institution.assign_group_student($1, $2)", [groups.g3, people.daria]],
    );
    expect(waited).toBe(true);
    expect(statuses).toEqual(["committed", "committed"]);
    expect(await openPlaces("seminar_group_member", groups.g2)).toEqual([]);
    expect(await openPlaces("seminar_group_member", groups.g3)).toEqual(
      [people.ana, people.cvita, people.daria].sort(),
    );
  });
});

// The schedule of the Codex thread on group_scope.sql:336: the course
// teacher's transaction begins; a student with an open place in the group
// then starts a work and commits it, is removed from the course and allowed
// back, each in its own transaction; only then does the first transaction
// assign a new teacher to the group, and the student comes back. The removed
// student keeps the place, so the new teacher's place must still start after
// that work.
describe("a student removed after an assignment of a group teacher began (DAN-351, #1372, Codex)", () => {
  it("the new teacher does not reach the work the student started before the removal", async () => {
    let begun!: () => void;
    let releaseAssignment!: () => void;
    const teacherBegun = new Promise<void>((resolve) => { begun = resolve; });
    const holdAssignment = new Promise<void>((resolve) => { releaseAssignment = resolve; });
    const teacherRun = withActor(tokens.vesna, async (tx) => {
      await tx.query("SELECT now()");
      begun();
      await holdAssignment;
      await tx.query("SELECT institution.assign_group_teacher($1, $2)", [groups.g1, people.marko]);
    });
    let documentId = "";
    try {
      await Promise.race([teacherBegun, teacherRun]);
      const work = await withActor(tokens.boris, async (tx) => (
        await tx.query<{ outcome: string; document_id: string }>(
          "SELECT outcome, document_id FROM app.open_student_work($1)",
          [returnAssignmentId],
        )
      ).rows[0]);
      expect(work.outcome).toBe("opened");
      documentId = work.document_id;
      expect((await asVesna("SELECT institution.remove_student($1, $2) AS done", [courseId, people.boris])).done).toBe(true);
      expect((await asVesna("SELECT institution.allow_student_return($1, $2) AS done", [courseId, people.boris])).done).toBe(true);
    } finally {
      begun();
      releaseAssignment();
      await Promise.allSettled([teacherRun]);
    }
    await teacherRun;
    expect(await enroll("boris")).toBe("enrolled");
    expect(await openPlaces("seminar_group_member", groups.g1)).toEqual([people.boris]);
    const order = await admin.query<{ after: boolean }>(
      `SELECT t.valid_from > p.created_at AS after
         FROM institution.seminar_group_teacher t, evidence.project p
        WHERE t.group_id = $1 AND t.user_id = $2 AND t.valid_to IS NULL
          AND p.assignment_id = $3 AND p.principal_id = $4`,
      [groups.g1, people.marko, returnAssignmentId, people.boris],
    );
    expect(order.rows).toEqual([{ after: true }]);
    // Positive control: Nina's place in group 1 started before the work.
    expect({
      marko: await can("marko", documentId),
      nina: await can("nina", documentId),
      vesna: await can("vesna", documentId),
      boris: await can("boris", documentId),
    }).toStrictEqual({ marko: false, nina: true, vesna: true, boris: true });
  });
});

// The tie of #1629 (run 42229299335): now() is the start of the transaction
// in microseconds, so the course teacher's transaction can begin in the very
// microsecond in which another transaction starts a work. The race above hit
// it only by chance; here the teacher's transaction reads its now(), the
// student starts a work and commits it, and the work's start is then set to
// exactly that now() before the group change runs. Returns the work's
// document. Ema and Frane are in group 5 (Marko) only; Nina teaches group 6.
async function changeAtTie(student: Person, assignmentId: string, change: Array<[string, unknown[]]>) {
  let begun!: () => void;
  let releaseChange!: () => void;
  const teacherBegun = new Promise<void>((resolve) => { begun = resolve; });
  const holdChange = new Promise<void>((resolve) => { releaseChange = resolve; });
  let teacherNow = "";
  const teacherRun = withActor(tokens.vesna, async (tx) => {
    teacherNow = (await tx.query<{ at: string }>("SELECT now()::text AS at")).rows[0].at;
    begun();
    await holdChange;
    for (const [sql, values] of change) await tx.query(sql, values);
  });
  let documentId = "";
  try {
    await Promise.race([teacherBegun, teacherRun]);
    const work = await withActor(tokens[student], async (tx) => (
      await tx.query<{ outcome: string; document_id: string }>(
        "SELECT outcome, document_id FROM app.open_student_work($1)",
        [assignmentId],
      )
    ).rows[0]);
    expect(work.outcome).toBe("opened");
    documentId = work.document_id;
    const client = await admin.connect();
    try {
      await client.query("BEGIN");
      // Synthetic row only: the start is written once by the server, so the
      // tie is set with the append-only triggers off for this transaction.
      await client.query("SET LOCAL session_replication_role = replica");
      const tied = await client.query(
        `UPDATE evidence.project SET created_at = $1::timestamptz
          WHERE institution_id = $2 AND assignment_id = $3 AND principal_id = $4`,
        [teacherNow, institutionId, assignmentId, people[student]],
      );
      expect(tied.rowCount).toBe(1);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } finally {
    begun();
    releaseChange();
    await Promise.allSettled([teacherRun]);
  }
  await teacherRun;
  const start = await admin.query<{ tied: boolean }>(
    "SELECT p.created_at = $4::timestamptz AS tied FROM evidence.project p WHERE p.institution_id = $1 AND p.assignment_id = $2 AND p.principal_id = $3",
    [institutionId, assignmentId, people[student], teacherNow],
  );
  expect(start.rows).toEqual([{ tied: true }]);
  return documentId;
}

describe("a group change in the microsecond a work started (DAN-351, #1629)", () => {
  it("a move places the student after the tied work, and the new group teacher does not reach it", async () => {
    const documentId = await changeAtTie("ema", tieMoveAssignmentId, [
      ["SELECT institution.end_group_assignment($1, $2)", [groups.g5, people.ema]],
      ["SELECT institution.assign_group_student($1, $2)", [groups.g6, people.ema]],
    ]);
    const order = await admin.query<{ after: boolean }>(
      `SELECT g.valid_from > p.created_at AS after
         FROM institution.seminar_group_member g, evidence.project p
        WHERE g.group_id = $1 AND g.user_id = $2 AND g.valid_to IS NULL
          AND p.assignment_id = $3 AND p.principal_id = $2`,
      [groups.g6, people.ema, tieMoveAssignmentId],
    );
    expect(order.rows).toEqual([{ after: true }]);
    expect({
      nina: await can("nina", documentId),
      marko: await can("marko", documentId),
      vesna: await can("vesna", documentId),
      ema: await can("ema", documentId),
    }).toStrictEqual({ nina: false, marko: false, vesna: true, ema: true });
  });

  it("a handover places the new teacher after the tied work, and she does not reach it", async () => {
    const documentId = await changeAtTie("frane", tieHandoverAssignmentId, [
      ["SELECT institution.end_group_assignment($1, $2)", [groups.g5, people.marko]],
      ["SELECT institution.assign_group_teacher($1, $2)", [groups.g5, people.nina]],
    ]);
    const order = await admin.query<{ after: boolean }>(
      `SELECT t.valid_from > p.created_at AS after
         FROM institution.seminar_group_teacher t, evidence.project p
        WHERE t.group_id = $1 AND t.user_id = $2 AND t.valid_to IS NULL
          AND p.assignment_id = $3 AND p.principal_id = $4`,
      [groups.g5, people.nina, tieHandoverAssignmentId, people.frane],
    );
    expect(order.rows).toEqual([{ after: true }]);
    expect({
      nina: await can("nina", documentId),
      marko: await can("marko", documentId),
      vesna: await can("vesna", documentId),
      frane: await can("frane", documentId),
    }).toStrictEqual({ nina: false, marko: false, vesna: true, frane: true });
  });
});
