import { randomBytes, randomUUID } from "node:crypto";

import { NextRequest } from "next/server";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { POST } from "../../app/api/institution/teachers/[teacherId]/role-revocation/route";
import { POST as REMOVE } from "../../app/api/institution/courses/[courseId]/students/[studentId]/removal/route";
import { createWithActor } from "@/server/db/with-actor";

// Real PostgreSQL and ductus_app login, with entirely invented fixtures.
const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus", max: 3 });
const app = new pg.Pool({ connectionString: process.env.APP_DATABASE_URL, max: 3, application_name: `revoke-teacher-${randomUUID()}` });
const withActor = createWithActor(app);
const ORIGIN = "https://revoke-teacher.example";
const faculties = [randomUUID(), randomUUID()];
const token = () => randomBytes(32).toString("base64url");
// Roles per person at its faculty; "foreignAdmin" alone belongs to the second one.
const roles = {
  admin: ["admin"], secondAdmin: ["admin"], adminTeacher: ["admin", "teacher"], unconfirmedAdmin: ["admin?"], revokedAdmin: ["admin-"],
  teacher: ["teacher"], raceTeacher: ["teacher"], unconfirmedTeacher: ["teacher?"], student: [], foreignAdmin: ["admin"],
} as const;
type Name = keyof typeof roles;
const names = Object.keys(roles) as Name[];
const people = Object.fromEntries(names.map((name) => [name, { id: randomUUID(), token: token() }])) as Record<Name, { id: string; token: string }>;
const ids = Object.values(people).map((person) => person.id);
const facultyOf = (name: Name) => faculties[name === "foreignAdmin" ? 1 : 0];
const expired = token(), closed = token();
let course: string;

const post = (session: string, teacher = people.teacher.id, body = "{}") => POST(new NextRequest(
  `${ORIGIN}/api/institution/teachers/${teacher}/role-revocation`, {
    method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", cookie: `__Host-ductus_session=${session}` }, body,
  },
), { params: Promise.resolve({ teacherId: teacher }) });
const remove = (session: string) => REMOVE(new NextRequest(
  `${ORIGIN}/api/institution/courses/${course}/students/${people.student.id}/removal`, {
    method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", cookie: `__Host-ductus_session=${session}` }, body: "{}",
  },
), { params: Promise.resolve({ courseId: course, studentId: people.student.id }) });
// Every role row of this file's people, with whether it still opens anything.
const roleRows = async () => (await admin.query(
  `SELECT user_id, role, confirmed_at IS NOT NULL AS confirmed, revoked_at IS NOT NULL AS revoked
     FROM institution.institution_role WHERE institution_id = ANY($1) ORDER BY user_id, role, revoked_at NULLS FIRST`, [faculties],
)).rows as { user_id: string; role: string; confirmed: boolean; revoked: boolean }[];
const withoutUser = (rows: Awaited<ReturnType<typeof roleRows>>, user: string) => rows.filter((row) => row.user_id !== user);

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
      [[...faculties, ...ids, course]],
    )).rows;
  }
  return result;
}

beforeAll(async () => {
  vi.stubEnv("OIDC_REDIRECT_URI", `${ORIGIN}/api/auth/callback`);
  const suffix = randomBytes(6).toString("hex");
  for (const [index, faculty] of faculties.entries()) {
    await admin.query("INSERT INTO identity.institution (id, slug) VALUES ($1, $2)", [faculty, `revoke-teacher-${index}-${suffix}`]);
    await admin.query("INSERT INTO institution.institution_settings (institution_id, display_name) VALUES ($1, 'Izmisljeni fakultet test')", [faculty]);
  }
  for (const name of names) {
    const person = people[name], faculty = facultyOf(name);
    await admin.query(
      `INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
       VALUES ($1, $2, 'https://issuer.example', $3, $4)`, [person.id, faculty, `${suffix}-${name}`, `${suffix}-${name}@revoke-teacher.example`],
    );
    await admin.query(
      "INSERT INTO identity.session (token_hash, user_id, institution_id, expires_at) VALUES (sha256(convert_to($1, 'UTF8')), $2, $3, now()+interval '1 hour')",
      [person.token, person.id, faculty],
    );
    // "?" marks a role nobody confirmed, "-" one already revoked.
    for (const role of roles[name] as readonly string[]) await admin.query(
      `INSERT INTO institution.institution_role (institution_id, user_id, role, confirmed_at, revoked_at)
       VALUES ($1, $2, $3, CASE WHEN $4 THEN NULL ELSE now() END, CASE WHEN $5 THEN now() ELSE NULL END)`,
      [faculty, person.id, role.replace(/[?-]$/, ""), role.endsWith("?"), role.endsWith("-")],
    );
  }
  for (const [session, isClosed] of [[expired, false], [closed, true]] as const) await admin.query(
    `INSERT INTO identity.session (token_hash, user_id, institution_id, created_at, expires_at, closed_at, close_reason)
     VALUES (sha256(convert_to($1,'UTF8')), $2, $3, now()-interval '2 hours', now()+CASE WHEN $4 THEN interval '1 hour' ELSE interval '-1 hour' END,
       CASE WHEN $4 THEN now() ELSE NULL END, CASE WHEN $4 THEN 'logout' ELSE NULL END)`,
    [session, people.admin.id, faculties[0], isClosed],
  );
  course = await withActor(people.teacher.token, async (tx) => (await tx.query<{ id: string }>(
    "SELECT institution.create_course('Izmisljeni kolegij opoziv', '2026/2027', 'prohibited') AS id",
  )).rows[0].id);
  await admin.query(
    "INSERT INTO institution.course_member (course_id, user_id, institution_id, role) VALUES ($1,$2,$3,'student')",
    [course, people.student.id, faculties[0]],
  );
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await app.end();
  await admin.query("DELETE FROM institution.course_member WHERE institution_id = ANY($1)", [faculties]);
  await admin.query("DELETE FROM institution.course WHERE institution_id = ANY($1)", [faculties]);
  await admin.query("DELETE FROM institution.institution_role WHERE institution_id = ANY($1)", [faculties]);
  await admin.query("DELETE FROM institution.institution_settings WHERE institution_id = ANY($1)", [faculties]);
  await admin.query("DELETE FROM identity.session WHERE user_id = ANY($1)", [ids]);
  await admin.query("DELETE FROM identity.user_account WHERE id = ANY($1)", [ids]);
  await admin.query("DELETE FROM identity.institution WHERE id = ANY($1)", [faculties]);
  expect(Number((await admin.query("SELECT count(*) FROM identity.institution WHERE id = ANY($1)", [faculties])).rows[0].count)).toBe(0);
  await admin.end();
});

describe("teacher role revocation real POST, session and database", () => {
  it("refuses every caller who is not a confirmed administrator, and revokes nothing outside the own institution", async () => {
    const before = await snapshot();
    for (const session of [token(), expired, closed]) {
      const response = await post(session);
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ error: "unauthorized" });
    }
    // A teacher or student cannot revoke anyone, not even the own role.
    for (const [name, target] of [["teacher", people.raceTeacher.id], ["teacher", people.teacher.id], ["student", people.teacher.id],
      ["unconfirmedAdmin", people.teacher.id], ["revokedAdmin", people.teacher.id], ["unconfirmedTeacher", people.unconfirmedTeacher.id]] as const) {
      const response = await post(people[name].token, target);
      expect(response.status).toBe(403);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ error: "forbidden" });
    }
    // Another institution's administrator sees the same answer as for a person who does not exist.
    for (const [name, target] of [["foreignAdmin", people.teacher.id], ["admin", randomUUID()], ["admin", people.student.id],
      ["admin", people.unconfirmedTeacher.id], ["admin", people.secondAdmin.id], ["admin", people.foreignAdmin.id]] as const) {
      const response = await post(people[name].token, target);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ revoked: false });
    }
    for (const body of ["null", "[]", JSON.stringify({ teacherId: people.raceTeacher.id }), JSON.stringify({ role: "admin" })]) {
      expect((await post(people.admin.token, people.teacher.id, body)).status).toBe(422);
    }
    expect(await snapshot()).toEqual(before);
  });

  it("revokes exactly one teacher role, once, and the next request of that teacher is refused", async () => {
    const before = await snapshot(["institution_role"]);
    const rows = await roleRows();
    const first = await post(people.admin.token);
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("no-store");
    expect(await first.json()).toEqual({ revoked: true });
    expect((await roleRows()).filter((row) => row.user_id === people.teacher.id)).toEqual([
      { user_id: people.teacher.id, role: "teacher", confirmed: true, revoked: true },
    ]);
    const again = await post(people.secondAdmin.token);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ revoked: false });
    expect(withoutUser(await roleRows(), people.teacher.id)).toEqual(withoutUser(rows, people.teacher.id));
    // The course and its memberships stay; only the role is gone.
    expect(await snapshot(["institution_role"])).toEqual(before);
    const refused = await remove(people.teacher.token);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: "forbidden" });
    expect((await admin.query(
      "SELECT member_to IS NULL AS open FROM institution.course_member WHERE course_id = $1 AND user_id = $2", [course, people.student.id],
    )).rows).toEqual([{ open: true }]);
  });

  it("keeps the administrator role when an administrator revokes the own teacher role", async () => {
    const response = await post(people.adminTeacher.token, people.adminTeacher.id);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revoked: true });
    expect((await roleRows()).filter((row) => row.user_id === people.adminTeacher.id)).toEqual([
      { user_id: people.adminTeacher.id, role: "admin", confirmed: true, revoked: false },
      { user_id: people.adminTeacher.id, role: "teacher", confirmed: true, revoked: true },
    ]);
  });

  it("revokes once when two administrators revoke the same teacher at once", async () => {
    const answers = await Promise.all([post(people.admin.token, people.raceTeacher.id), post(people.secondAdmin.token, people.raceTeacher.id)]);
    for (const answer of answers) expect(answer.status).toBe(200);
    const revoked = (await Promise.all(answers.map((answer) => answer.json()))).map((body) => body.revoked);
    expect([...revoked].sort()).toEqual([false, true]);
    expect((await roleRows()).filter((row) => row.user_id === people.raceTeacher.id)).toEqual([
      { user_id: people.raceTeacher.id, role: "teacher", confirmed: true, revoked: true },
    ]);
  });
});
