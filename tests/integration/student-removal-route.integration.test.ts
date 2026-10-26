import { randomBytes, randomUUID } from "node:crypto";

import { NextRequest } from "next/server";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { POST } from "../../app/api/institution/courses/[courseId]/students/[studentId]/removal/route";
import { createWithActor } from "@/server/db/with-actor";

// Real PostgreSQL and ductus_app login, with entirely invented fixtures.
const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus", max: 3 });
const app = new pg.Pool({ connectionString: process.env.APP_DATABASE_URL, max: 3, application_name: `remove-student-${randomUUID()}` });
const withActor = createWithActor(app);
const ORIGIN = "https://remove-student.example";
const faculties = [randomUUID(), randomUUID()];
const token = () => randomBytes(32).toString("base64url");
const names = ["teacher", "second", "student", "classmate", "unconfirmed", "revoked", "nonmember", "siblingStudent", "outsider", "foreignStudent"] as const;
type Name = typeof names[number];
const people = Object.fromEntries(names.map((name) => [name, { id: randomUUID(), token: token() }])) as Record<Name, { id: string; token: string }>;
const ids = Object.values(people).map((person) => person.id);
const foreignPeople: readonly Name[] = ["outsider", "foreignStudent"];
const students: readonly Name[] = ["student", "classmate", "siblingStudent", "foreignStudent"];
const expired = token(), closed = token();
let course: string, otherCourse: string, foreign: string, sibling: string, code: string;

const post = (session: string, target = course, student = people.student.id, body = "{}") => POST(new NextRequest(
  `${ORIGIN}/api/institution/courses/${target}/students/${student}/removal`, {
    method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", cookie: `__Host-ductus_session=${session}` }, body,
  },
), { params: Promise.resolve({ courseId: target, studentId: student }) });
const membership = async (target: string, user: string) => (await admin.query(
  "SELECT member_to IS NULL AS open, removed_by FROM institution.course_member WHERE course_id = $1 AND user_id = $2", [target, user],
)).rows[0] as { open: boolean; removed_by: string | null } | undefined;

// Scoped snapshots of every table in these schemas detect an accidental write
// anywhere; only this file's random fixtures enter the comparison.
async function snapshot(skip: string[] = []) {
  const tables = (await admin.query<{ schemaname: string; tablename: string }>(
    "SELECT schemaname, tablename FROM pg_tables WHERE schemaname IN ('institution','evidence','audit') ORDER BY 1,2",
  )).rows;
  const result: Record<string, unknown> = {};
  for (const { schemaname, tablename } of tables) {
    if (skip.includes(tablename)) continue;
    const qualified = `"${schemaname.replaceAll('"', '""')}"."${tablename.replaceAll('"', '""')}"`;
    result[`${schemaname}.${tablename}`] = (await admin.query(
      `SELECT r::text AS row FROM ${qualified} r WHERE EXISTS (SELECT 1 FROM unnest($1::text[]) n WHERE strpos(r::text, n) > 0) ORDER BY 1`,
      [[...faculties, ...ids, course, otherCourse, foreign, sibling]],
    )).rows;
  }
  return result;
}

beforeAll(async () => {
  vi.stubEnv("OIDC_REDIRECT_URI", `${ORIGIN}/api/auth/callback`);
  const suffix = randomBytes(6).toString("hex");
  for (const [index, faculty] of faculties.entries()) {
    await admin.query("INSERT INTO identity.institution (id, slug) VALUES ($1, $2)", [faculty, `remove-student-${index}-${suffix}`]);
    await admin.query("INSERT INTO institution.institution_settings (institution_id, display_name) VALUES ($1, 'Izmisljeni fakultet test')", [faculty]);
  }
  for (const name of names) {
    const person = people[name], faculty = faculties[foreignPeople.includes(name) ? 1 : 0];
    await admin.query(
      `INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
       VALUES ($1, $2, 'https://issuer.example', $3, $4)`, [person.id, faculty, `${suffix}-${name}`, `${suffix}-${name}@remove-student.example`],
    );
    await admin.query(
      "INSERT INTO identity.session (token_hash, user_id, institution_id, expires_at) VALUES (sha256(convert_to($1, 'UTF8')), $2, $3, now()+interval '1 hour')",
      [person.token, person.id, faculty],
    );
    if (!students.includes(name)) await admin.query(
      `INSERT INTO institution.institution_role (institution_id, user_id, role, confirmed_at, revoked_at)
       VALUES ($1, $2, 'teacher', CASE WHEN $3 THEN NULL ELSE now() END, CASE WHEN $4 THEN now() ELSE NULL END)`,
      [faculty, person.id, name === "unconfirmed", name === "revoked"],
    );
  }
  for (const [session, isClosed] of [[expired, false], [closed, true]] as const) await admin.query(
    `INSERT INTO identity.session (token_hash, user_id, institution_id, created_at, expires_at, closed_at, close_reason)
     VALUES (sha256(convert_to($1,'UTF8')), $2, $3, now()-interval '2 hours', now()+CASE WHEN $4 THEN interval '1 hour' ELSE interval '-1 hour' END,
       CASE WHEN $4 THEN now() ELSE NULL END, CASE WHEN $4 THEN 'logout' ELSE NULL END)`,
    [session, people.teacher.id, faculties[0], isClosed],
  );
  const create = (name: "teacher" | "outsider" | "nonmember", label: string = name) => withActor(people[name].token, async (tx) =>
    (await tx.query<{ id: string }>("SELECT institution.create_course($1, '2026/2027', 'prohibited') AS id", [`Izmisljeni kolegij ${label}`])).rows[0].id,
  );
  course = await create("teacher"); otherCourse = await create("teacher", "teacher drugi");
  foreign = await create("outsider"); sibling = await create("nonmember");
  const member = (target: string, name: Name, role: "student" | "teacher") => admin.query(
    "INSERT INTO institution.course_member (course_id, user_id, institution_id, role) VALUES ($1,$2,$3,$4)",
    [target, people[name].id, faculties[foreignPeople.includes(name) ? 1 : 0], role],
  );
  for (const name of ["second", "unconfirmed", "revoked"] as const) await member(course, name, "teacher");
  for (const name of ["student", "classmate"] as const) await member(course, name, "student");
  // The same student also takes the teacher's second course.
  await member(otherCourse, "student", "student");
  await member(sibling, "siblingStudent", "student");
  await member(foreign, "foreignStudent", "student");
  code = await withActor(people.teacher.token, async (tx) => (await tx.query<{ code: string }>(
    "SELECT institution.create_enrollment_code($1, now() + interval '7 days') AS code", [course],
  )).rows[0].code);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await app.end();
  await admin.query("DELETE FROM institution.enrollment_attempt WHERE user_id = ANY($1)", [ids]);
  await admin.query("DELETE FROM institution.course_member WHERE institution_id = ANY($1)", [faculties]);
  await admin.query("DELETE FROM institution.course_enrollment_code WHERE course_id IN (SELECT id FROM institution.course WHERE institution_id = ANY($1))", [faculties]);
  await admin.query("DELETE FROM institution.course WHERE institution_id = ANY($1)", [faculties]);
  await admin.query("DELETE FROM institution.institution_role WHERE institution_id = ANY($1)", [faculties]);
  await admin.query("DELETE FROM institution.institution_settings WHERE institution_id = ANY($1)", [faculties]);
  await admin.query("DELETE FROM identity.session WHERE user_id = ANY($1)", [ids]);
  await admin.query("DELETE FROM identity.user_account WHERE id = ANY($1)", [ids]);
  await admin.query("DELETE FROM identity.institution WHERE id = ANY($1)", [faculties]);
  expect(Number((await admin.query("SELECT count(*) FROM identity.institution WHERE id = ANY($1)", [faculties])).rows[0].count)).toBe(0);
  await admin.end();
});

describe("student removal real POST, session and database", () => {
  it("refuses every caller who is not a teacher of the course, and removes nobody outside that course", async () => {
    const before = await snapshot();
    for (const session of [token(), expired, closed]) {
      const response = await post(session);
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ error: "unauthorized" });
    }
    for (const name of ["student", "classmate", "unconfirmed", "revoked", "nonmember", "outsider", "foreignStudent"] as const) {
      const response = await post(people[name].token);
      expect(response.status).toBe(403);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ error: "forbidden" });
    }
    // A teacher of course A asking about course B: another institution's, a
    // sibling course of the same institution, or one that does not exist.
    for (const [target, student] of [[foreign, people.foreignStudent.id], [sibling, people.siblingStudent.id], [randomUUID(), people.student.id]]) {
      const response = await post(people.teacher.token, target, student);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "forbidden" });
    }
    await admin.query("UPDATE institution.course_member SET member_to = now() WHERE course_id = $1 AND user_id = $2", [course, people.second.id]);
    try {
      expect((await post(people.second.token)).status).toBe(403);
    } finally {
      await admin.query("UPDATE institution.course_member SET member_to = NULL WHERE course_id = $1 AND user_id = $2", [course, people.second.id]);
    }
    // Through the own course, nobody who is not its open student is touched.
    for (const user of [people.siblingStudent.id, people.foreignStudent.id, people.second.id, people.teacher.id, randomUUID()]) {
      const response = await post(people.teacher.token, course, user);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ removed: false });
    }
    for (const body of ["null", "[]", JSON.stringify({ studentId: people.classmate.id }), JSON.stringify({ courseId: sibling })]) {
      expect((await post(people.teacher.token, course, people.student.id, body)).status).toBe(422);
    }
    expect(await snapshot()).toEqual(before);
  });

  it("lets a teacher of the course remove exactly one student, once, and keeps that student out of the code", async () => {
    const before = await snapshot(["course_member"]);
    const members = (await admin.query(
      "SELECT course_id, user_id, member_to FROM institution.course_member WHERE institution_id = ANY($1) AND user_id <> $2 ORDER BY 1, 2",
      [faculties, people.student.id],
    )).rows;
    const first = await post(people.second.token);
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("no-store");
    expect(await first.json()).toEqual({ removed: true });
    expect(await membership(course, people.student.id)).toEqual({ open: false, removed_by: people.second.id });
    // Only the named course: the same student's membership in the teacher's other course stays open.
    expect(await membership(otherCourse, people.student.id)).toEqual({ open: true, removed_by: null });
    const again = await post(people.teacher.token);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ removed: false });
    expect(await membership(course, people.student.id)).toEqual({ open: false, removed_by: people.second.id });
    expect((await admin.query(
      "SELECT course_id, user_id, member_to FROM institution.course_member WHERE institution_id = ANY($1) AND user_id <> $2 ORDER BY 1, 2",
      [faculties, people.student.id],
    )).rows).toEqual(members);
    expect(await snapshot(["course_member"])).toEqual(before);
    // The code still works for others; the removed student is refused.
    const outcome = await withActor(people.student.token, async (tx) => (await tx.query<{ outcome: string }>(
      "SELECT outcome FROM institution.enroll_with_code($1::text)", [code],
    )).rows[0].outcome);
    expect(outcome).toBe("refused");
    expect((await membership(course, people.classmate.id))?.open).toBe(true);
  });

  it("ends the membership exactly once when two teachers remove the same student at once (#800 QA finding)", async () => {
    const answers = await Promise.all([post(people.second.token, course, people.classmate.id), post(people.teacher.token, course, people.classmate.id)]);
    for (const answer of answers) expect(answer.status).toBe(200);
    const removed = (await Promise.all(answers.map((answer) => answer.json()))).map((body) => body.removed);
    expect([...removed].sort()).toEqual([false, true]);
    const winner = removed[0] ? people.second.id : people.teacher.id;
    expect(await membership(course, people.classmate.id)).toEqual({ open: false, removed_by: winner });
    expect(Number((await admin.query(
      "SELECT count(*) FROM institution.course_member WHERE course_id = $1 AND user_id = $2", [course, people.classmate.id],
    )).rows[0].count)).toBe(1);
  });
});
