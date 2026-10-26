import { randomBytes, randomUUID } from "node:crypto";

import { NextRequest } from "next/server";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { POST } from "../../app/api/institution/courses/[courseId]/students/[studentId]/return-permission/route";
import { createWithActor } from "@/server/db/with-actor";

// Real PostgreSQL and ductus_app login, with entirely invented fixtures.
const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus", max: 3 });
const app = new pg.Pool({ connectionString: process.env.APP_DATABASE_URL, max: 3, application_name: `student-return-${randomUUID()}` });
const withActor = createWithActor(app);
const ORIGIN = "https://student-return.example";
const faculties = [randomUUID(), randomUUID()];
const token = () => randomBytes(32).toString("base64url");
const names = ["teacher", "second", "student", "classmate", "leaver", "wanderer", "unconfirmed", "revoked", "nonmember",
  "siblingStudent", "outsider", "foreignStudent"] as const;
type Name = typeof names[number];
const people = Object.fromEntries(names.map((name) => [name, { id: randomUUID(), token: token() }])) as Record<Name, { id: string; token: string }>;
const ids = Object.values(people).map((person) => person.id);
const foreignPeople: readonly Name[] = ["outsider", "foreignStudent"];
const students: readonly Name[] = ["student", "classmate", "leaver", "wanderer", "siblingStudent", "foreignStudent"];
const expired = token(), closed = token();
let course: string, otherCourse: string, foreign: string, sibling: string, code: string;

const post = (session: string, target = course, student = people.student.id, body = "{}") => POST(new NextRequest(
  `${ORIGIN}/api/institution/courses/${target}/students/${student}/return-permission`, {
    method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", cookie: `__Host-ductus_session=${session}` }, body,
  },
), { params: Promise.resolve({ courseId: target, studentId: student }) });
const rows = async (target: string, user: string) => (await admin.query(
  `SELECT member_to IS NULL AS open, removed_by, return_allowed_at IS NOT NULL AS allowed
     FROM institution.course_member WHERE course_id = $1 AND user_id = $2 ORDER BY member_from, member_to NULLS LAST`, [target, user],
)).rows as { open: boolean; removed_by: string | null; allowed: boolean }[];
const enroll = (name: Name) => withActor(people[name].token, async (tx) => (await tx.query<{ outcome: string }>(
  "SELECT outcome FROM institution.enroll_with_code($1::text)", [code],
)).rows[0].outcome);
const remove = (name: "teacher" | "outsider" | "nonmember", target: string, student: Name) => withActor(people[name].token, async (tx) => {
  await tx.query("SELECT institution.remove_student($1, $2)", [target, people[student].id]);
});

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
    await admin.query("INSERT INTO identity.institution (id, slug) VALUES ($1, $2)", [faculty, `student-return-${index}-${suffix}`]);
    await admin.query("INSERT INTO institution.institution_settings (institution_id, display_name) VALUES ($1, 'Izmisljeni fakultet test')", [faculty]);
  }
  for (const name of names) {
    const person = people[name], faculty = faculties[foreignPeople.includes(name) ? 1 : 0];
    await admin.query(
      `INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
       VALUES ($1, $2, 'https://issuer.example', $3, $4)`, [person.id, faculty, `${suffix}-${name}`, `${suffix}-${name}@student-return.example`],
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
  for (const name of ["student", "classmate", "leaver"] as const) await member(course, name, "student");
  await member(otherCourse, "wanderer", "student");
  await member(sibling, "siblingStudent", "student");
  await member(foreign, "foreignStudent", "student");
  // Removed by a teacher: the student here, the wanderer in the teacher's
  // other course, and students of two other teachers. The leaver left alone.
  await remove("teacher", course, "student");
  await remove("teacher", otherCourse, "wanderer");
  await remove("nonmember", sibling, "siblingStudent");
  await remove("outsider", foreign, "foreignStudent");
  await admin.query("UPDATE institution.course_member SET member_to = now() WHERE course_id = $1 AND user_id = $2", [course, people.leaver.id]);
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

describe("student return permission real POST, session and database", () => {
  it("refuses every caller who is not a teacher of the course, and allows nobody outside that course", async () => {
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
    // A teacher of course A asking about a student removed from course B:
    // another institution's, a sibling course of the same institution, or one
    // that does not exist.
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
    // Through the own course, nobody whom a teacher removed from it is false:
    // removed elsewhere, of another institution, left alone, never removed, unknown.
    for (const user of [people.wanderer.id, people.siblingStudent.id, people.foreignStudent.id, people.leaver.id, people.classmate.id, randomUUID()]) {
      const response = await post(people.teacher.token, course, user);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ allowed: false });
    }
    for (const body of ["null", "[]", JSON.stringify({ studentId: people.wanderer.id }), JSON.stringify({ courseId: otherCourse })]) {
      expect((await post(people.teacher.token, course, people.student.id, body)).status).toBe(422);
    }
    expect(await snapshot()).toEqual(before);
  });

  it("lets a teacher of the course allow one removed student back, once, without enrolling them", async () => {
    expect(await enroll("student")).toBe("refused");
    const before = await snapshot(["course_member"]);
    const others = (await admin.query(
      "SELECT course_id, user_id, member_to, return_allowed_at FROM institution.course_member WHERE institution_id = ANY($1) AND user_id <> $2 ORDER BY 1, 2",
      [faculties, people.student.id],
    )).rows;
    // Both teachers at once: the row lock makes exactly one of them the one who allowed it.
    const answers = await Promise.all([post(people.second.token), post(people.teacher.token)]);
    for (const answer of answers) {
      expect(answer.status).toBe(200);
      expect(answer.headers.get("cache-control")).toBe("no-store");
    }
    expect((await Promise.all(answers.map((answer) => answer.json()))).map((body) => body.allowed).sort()).toEqual([false, true]);
    // Allowed, still not a member: the student needs the code.
    expect(await rows(course, people.student.id)).toEqual([{ open: false, removed_by: people.teacher.id, allowed: true }]);
    const again = await post(people.teacher.token);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ allowed: false });
    expect((await admin.query(
      "SELECT course_id, user_id, member_to, return_allowed_at FROM institution.course_member WHERE institution_id = ANY($1) AND user_id <> $2 ORDER BY 1, 2",
      [faculties, people.student.id],
    )).rows).toEqual(others);
    expect(await snapshot(["course_member"])).toEqual(before);
    // With the code the student is back; the wanderer stays blocked in the other course.
    expect(await enroll("student")).toBe("enrolled");
    expect((await rows(course, people.student.id)).map((row) => row.open)).toEqual([false, true]);
    expect(await rows(otherCourse, people.wanderer.id)).toEqual([{ open: false, removed_by: people.teacher.id, allowed: false }]);
  });
});
