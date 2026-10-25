import { randomBytes, randomUUID } from "node:crypto";

import { NextRequest } from "next/server";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { POST } from "../../app/api/institution/courses/[courseId]/enrollment-code/revocation/route";
import { createWithActor } from "@/server/db/with-actor";

// Real PostgreSQL and ductus_app login, with entirely invented fixtures.
const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus", max: 3 });
const app = new pg.Pool({ connectionString: process.env.APP_DATABASE_URL, max: 3, application_name: `revoke-code-${randomUUID()}` });
const withActor = createWithActor(app);
const ORIGIN = "https://revoke-code.example";
const faculties = [randomUUID(), randomUUID()];
const token = () => randomBytes(32).toString("base64url");
const names = ["teacher", "second", "student", "unconfirmed", "revoked", "nonmember", "outsider"] as const;
const people = Object.fromEntries(names.map((name) => [name, { id: randomUUID(), token: token() }])) as
  Record<typeof names[number], { id: string; token: string }>;
const ids = Object.values(people).map((person) => person.id);
const expired = token(), closed = token();
let course: string, foreign: string, sibling: string;

const post = (session: string, target = course, body = "{}") => POST(new NextRequest(
  `${ORIGIN}/api/institution/courses/${target}/enrollment-code/revocation`, {
    method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", cookie: `__Host-ductus_session=${session}` }, body,
  },
), { params: Promise.resolve({ courseId: target }) });
const issue = (name: "teacher" | "outsider" | "nonmember", target: string) => withActor(people[name].token, async (tx) => {
  await tx.query("SELECT institution.create_enrollment_code($1, now() + interval '7 days')", [target]);
});
const active = async (target: string) => Number((await admin.query(
  "SELECT count(*) FROM institution.course_enrollment_code WHERE course_id = $1 AND active", [target],
)).rows[0].count);

// Scoped snapshots of every table in these schemas detect an accidental write
// anywhere; only this file's random fixtures enter the comparison.
async function snapshot(includeCodes = false) {
  const tables = (await admin.query<{ schemaname: string; tablename: string }>(
    "SELECT schemaname, tablename FROM pg_tables WHERE schemaname IN ('institution','evidence','audit') ORDER BY 1,2",
  )).rows;
  const result: Record<string, unknown> = {};
  for (const { schemaname, tablename } of tables) {
    if (!includeCodes && tablename === "course_enrollment_code") continue;
    const qualified = `"${schemaname.replaceAll('"', '""')}"."${tablename.replaceAll('"', '""')}"`;
    result[`${schemaname}.${tablename}`] = (await admin.query(
      `SELECT r::text AS row FROM ${qualified} r WHERE EXISTS (SELECT 1 FROM unnest($1::text[]) n WHERE strpos(r::text, n) > 0) ORDER BY 1`,
      [[...faculties, ...ids, course, foreign, sibling]],
    )).rows;
  }
  return result;
}

beforeAll(async () => {
  vi.stubEnv("OIDC_REDIRECT_URI", `${ORIGIN}/api/auth/callback`);
  const suffix = randomBytes(6).toString("hex");
  for (const [index, faculty] of faculties.entries()) {
    await admin.query("INSERT INTO identity.institution (id, slug) VALUES ($1, $2)", [faculty, `revoke-code-${index}-${suffix}`]);
    await admin.query("INSERT INTO institution.institution_settings (institution_id, display_name) VALUES ($1, 'Izmisljeni fakultet test')", [faculty]);
  }
  for (const name of names) {
    const person = people[name], faculty = faculties[name === "outsider" ? 1 : 0];
    await admin.query(
      `INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
       VALUES ($1, $2, 'https://issuer.example', $3, $4)`, [person.id, faculty, `${suffix}-${name}`, `${suffix}-${name}@revoke-code.example`],
    );
    await admin.query(
      "INSERT INTO identity.session (token_hash, user_id, institution_id, expires_at) VALUES (sha256(convert_to($1, 'UTF8')), $2, $3, now()+interval '1 hour')",
      [person.token, person.id, faculty],
    );
    if (name !== "student") await admin.query(
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
  const create = (name: "teacher" | "outsider" | "nonmember") => withActor(people[name].token, async (tx) =>
    (await tx.query<{ id: string }>("SELECT institution.create_course($1, '2026/2027', 'prohibited') AS id", [`Izmisljeni kolegij ${name}`])).rows[0].id,
  );
  course = await create("teacher"); foreign = await create("outsider"); sibling = await create("nonmember");
  for (const name of ["second", "student", "unconfirmed", "revoked"] as const) await admin.query(
    "INSERT INTO institution.course_member (course_id, user_id, institution_id, role) VALUES ($1,$2,$3,$4)",
    [course, people[name].id, faculties[0], name === "student" ? "student" : "teacher"],
  );
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await app.end();
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

describe("enrollment code revocation real POST, session and database", () => {
  it("refuses every caller who is not a teacher of the course, with no write and the same answer as a missing course", async () => {
    await issue("teacher", course); await issue("outsider", foreign); await issue("nonmember", sibling);
    const before = await snapshot(true);
    for (const session of [token(), expired, closed]) {
      const response = await post(session);
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ error: "unauthorized" });
    }
    for (const name of ["student", "unconfirmed", "revoked", "nonmember", "outsider"] as const) {
      const response = await post(people[name].token);
      expect(response.status).toBe(403);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ error: "forbidden" });
    }
    // A course of another institution, a course of the same institution the
    // teacher is not in, and a course that does not exist answer alike.
    for (const target of [foreign, sibling, randomUUID()]) {
      const response = await post(people.teacher.token, target);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "forbidden" });
    }
    await admin.query("UPDATE institution.course_member SET member_to = now() WHERE course_id = $1 AND user_id = $2", [course, people.second.id]);
    try {
      expect((await post(people.second.token)).status).toBe(403);
    } finally {
      await admin.query("UPDATE institution.course_member SET member_to = NULL WHERE course_id = $1 AND user_id = $2", [course, people.second.id]);
    }
    for (const body of ["null", "[]", JSON.stringify({ courseId: foreign }), JSON.stringify({ role: "teacher" })]) {
      expect((await post(people.teacher.token, course, body)).status).toBe(422);
    }
    expect(await snapshot(true)).toEqual(before);
    expect([await active(course), await active(foreign), await active(sibling)]).toEqual([1, 1, 1]);
  });

  it("lets a teacher of the course revoke its active code once, then answers false, touching no other course or table", async () => {
    if (await active(course) === 0) await issue("teacher", course);
    const before = await snapshot();
    const foreignBefore = await active(foreign), siblingBefore = await active(sibling);
    const first = await post(people.second.token);
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("no-store");
    expect(await first.json()).toEqual({ revoked: true });
    expect(await active(course)).toBe(0);
    const second = await post(people.teacher.token);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ revoked: false });
    expect([await active(foreign), await active(sibling)]).toEqual([foreignBefore, siblingBefore]);
    expect(await snapshot()).toEqual(before);
  });
});
