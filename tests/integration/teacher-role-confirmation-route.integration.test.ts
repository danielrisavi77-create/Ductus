import { randomBytes, randomUUID } from "node:crypto";

import { NextRequest } from "next/server";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { POST } from "../../app/api/institution/teachers/[teacherId]/role-confirmation/route";
import { GET as COURSES } from "../../app/api/teacher/courses/route";

// Real PostgreSQL and ductus_app login, with entirely invented fixtures (DAN-476).
const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus", max: 3 });
const app = new pg.Pool({ connectionString: process.env.APP_DATABASE_URL, max: 3, application_name: `confirm-teacher-${randomUUID()}` });
const ORIGIN = "https://confirm-teacher.example";
const faculties = [randomUUID(), randomUUID()];
const token = () => randomBytes(32).toString("base64url");
// Roles per person: "?" a role nobody confirmed, "-" one already revoked.
// `eligible` is whether the last login gave the teacher right. The two
// "foreign" people alone belong to the second faculty.
const people = {
  admin: { roles: ["admin"], eligible: true },
  secondAdmin: { roles: ["admin"], eligible: false },
  unconfirmedAdmin: { roles: ["admin?"], eligible: false },
  revokedAdmin: { roles: ["admin-"], eligible: false },
  teacher: { roles: ["teacher"], eligible: true },
  student: { roles: [], eligible: false },
  candidate: { roles: [], eligible: true },
  pendingCandidate: { roles: ["teacher?"], eligible: true },
  formerTeacher: { roles: ["teacher-"], eligible: true },
  raceCandidate: { roles: [], eligible: true },
  spareCandidate: { roles: [], eligible: true },
  ineligible: { roles: [], eligible: false },
  foreignAdmin: { roles: ["admin"], eligible: false },
  foreignCandidate: { roles: [], eligible: true },
} as const;
type Name = keyof typeof people;
const names = Object.keys(people) as Name[];
const person = Object.fromEntries(names.map((name) => [name, { id: randomUUID(), token: token() }])) as Record<Name, { id: string; token: string }>;
const ids = Object.values(person).map((p) => p.id);
const facultyOf = (name: Name) => faculties[name.startsWith("foreign") ? 1 : 0];
const expired = token(), closed = token();

const post = (session: string, candidate: string, body = "{}") => POST(new NextRequest(
  `${ORIGIN}/api/institution/teachers/${candidate}/role-confirmation`, {
    method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", cookie: `__Host-ductus_session=${session}` }, body,
  },
), { params: Promise.resolve({ teacherId: candidate }) });
const courses = (session: string) => COURSES(new NextRequest(`${ORIGIN}/api/teacher/courses`, {
  method: "GET", headers: { cookie: `__Host-ductus_session=${session}` },
}));
const roleRows = async (user: string) => (await admin.query(
  `SELECT role, confirmed_at IS NOT NULL AS confirmed, confirmed_by, revoked_at IS NOT NULL AS revoked
     FROM institution.institution_role WHERE user_id = $1 ORDER BY role, revoked_at NULLS FIRST`, [user],
)).rows as { role: string; confirmed: boolean; confirmed_by: string | null; revoked: boolean }[];

// Scoped snapshots of every table in these schemas detect an accidental write
// anywhere; only this file's random fixtures enter the comparison. Sessions
// are left out: reading one may move its last_seen_at.
async function snapshot() {
  const tables = (await admin.query<{ schemaname: string; tablename: string }>(
    "SELECT schemaname, tablename FROM pg_tables WHERE schemaname IN ('identity','institution','evidence','audit') ORDER BY 1,2",
  )).rows;
  const result: Record<string, unknown> = {};
  for (const { schemaname, tablename } of tables) {
    if (schemaname === "identity" && tablename === "session") continue;
    const qualified = `"${schemaname.replaceAll('"', '""')}"."${tablename.replaceAll('"', '""')}"`;
    result[`${schemaname}.${tablename}`] = (await admin.query(
      `SELECT r::text AS row FROM ${qualified} r WHERE EXISTS (SELECT 1 FROM unnest($1::text[]) n WHERE strpos(r::text, n) > 0) ORDER BY 1`,
      [[...faculties, ...ids]],
    )).rows;
  }
  return result;
}

beforeAll(async () => {
  vi.stubEnv("OIDC_REDIRECT_URI", `${ORIGIN}/api/auth/callback`);
  const suffix = randomBytes(6).toString("hex");
  for (const [index, faculty] of faculties.entries()) {
    await admin.query("INSERT INTO identity.institution (id, slug) VALUES ($1, $2)", [faculty, `confirm-teacher-${index}-${suffix}`]);
    await admin.query("INSERT INTO institution.institution_settings (institution_id, display_name) VALUES ($1, 'Izmisljeni fakultet test')", [faculty]);
  }
  for (const name of names) {
    const { id, token: session } = person[name], faculty = facultyOf(name);
    await admin.query(
      `INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
       VALUES ($1, $2, 'https://issuer.example', $3, $4)`, [id, faculty, `${suffix}-${name}`, `${suffix}-${name}@confirm-teacher.example`],
    );
    await admin.query(
      "INSERT INTO identity.session (token_hash, user_id, institution_id, expires_at) VALUES (sha256(convert_to($1, 'UTF8')), $2, $3, now()+interval '1 hour')",
      [session, id, faculty],
    );
    if (people[name].eligible) {
      await admin.query("INSERT INTO identity.teacher_eligibility (user_id, institution_id) VALUES ($1, $2)", [id, faculty]);
    }
    for (const role of people[name].roles as readonly string[]) await admin.query(
      `INSERT INTO institution.institution_role (institution_id, user_id, role, confirmed_at, revoked_at)
       VALUES ($1, $2, $3, CASE WHEN $4 THEN NULL ELSE now() END, CASE WHEN $5 THEN now() ELSE NULL END)`,
      [faculty, id, role.replace(/[?-]$/, ""), role.endsWith("?"), role.endsWith("-")],
    );
  }
  for (const [session, isClosed] of [[expired, false], [closed, true]] as const) await admin.query(
    `INSERT INTO identity.session (token_hash, user_id, institution_id, created_at, expires_at, closed_at, close_reason)
     VALUES (sha256(convert_to($1,'UTF8')), $2, $3, now()-interval '2 hours', now()+CASE WHEN $4 THEN interval '1 hour' ELSE interval '-1 hour' END,
       CASE WHEN $4 THEN now() ELSE NULL END, CASE WHEN $4 THEN 'logout' ELSE NULL END)`,
    [session, person.admin.id, faculties[0], isClosed],
  );
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await app.end();
  await admin.query("DELETE FROM institution.institution_role WHERE institution_id = ANY($1)", [faculties]);
  await admin.query("DELETE FROM institution.institution_settings WHERE institution_id = ANY($1)", [faculties]);
  await admin.query("DELETE FROM identity.teacher_eligibility WHERE user_id = ANY($1)", [ids]);
  await admin.query("DELETE FROM identity.session WHERE user_id = ANY($1)", [ids]);
  await admin.query("DELETE FROM identity.user_account WHERE id = ANY($1)", [ids]);
  await admin.query("DELETE FROM identity.institution WHERE id = ANY($1)", [faculties]);
  expect(Number((await admin.query("SELECT count(*) FROM identity.institution WHERE id = ANY($1)", [faculties])).rows[0].count)).toBe(0);
  await admin.end();
});

describe("teacher role confirmation real POST, session and database", () => {
  it("refuses a missing session and every caller who is not a confirmed administrator, writing nothing", async () => {
    const before = await snapshot();
    for (const session of [token(), expired, closed]) {
      const response = await post(session, person.spareCandidate.id);
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ error: "unauthorized" });
    }
    // Nobody but an administrator confirms anyone, not even an eligible self.
    for (const [name, target] of [["teacher", person.spareCandidate.id], ["student", person.spareCandidate.id],
      ["unconfirmedAdmin", person.spareCandidate.id], ["revokedAdmin", person.spareCandidate.id],
      ["candidate", person.candidate.id], ["pendingCandidate", person.pendingCandidate.id]] as const) {
      const response = await post(person[name].token, target);
      expect(response.status).toBe(403);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ error: "forbidden" });
    }
    for (const body of ["null", "[]", JSON.stringify({ candidateId: person.foreignCandidate.id }), JSON.stringify({ role: "admin" })]) {
      expect((await post(person.admin.token, person.spareCandidate.id, body)).status).toBe(422);
    }
    expect(await snapshot()).toEqual(before);
  });

  it("answers byte for byte the same 404 for another institution, a stranger, no right and the own account", async () => {
    const before = await snapshot();
    const answers: string[] = [];
    for (const [name, target] of [["admin", person.foreignCandidate.id], ["foreignAdmin", person.candidate.id],
      ["admin", randomUUID()], ["admin", person.ineligible.id], ["admin", person.student.id], ["admin", person.admin.id],
      ["admin", person.foreignAdmin.id]] as const) {
      const response = await post(person[name].token, target);
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("content-type")).toBe("application/json");
      answers.push(await response.text());
    }
    expect(new Set(answers)).toEqual(new Set(['{"error":"not_found"}']));
    expect(await snapshot()).toEqual(before);
  });

  it("confirms exactly one eligible candidate, once, and the same cookie then reaches the teacher route", async () => {
    const refused = await courses(person.candidate.token);
    expect(refused.status).toBe(404);
    expect(await refused.json()).toEqual({ error: "not_found" });
    const first = await post(person.admin.token, person.candidate.id);
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("no-store");
    expect(await first.json()).toEqual({ confirmed: true });
    const confirmed = [{ role: "teacher", confirmed: true, confirmed_by: person.admin.id, revoked: false }];
    expect(await roleRows(person.candidate.id)).toEqual(confirmed);
    // Repeating it by another administrator changes nothing, not even who confirmed.
    const before = await snapshot();
    const again = await post(person.secondAdmin.token, person.candidate.id);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ confirmed: true });
    expect(await snapshot()).toEqual(before);
    const allowed = await courses(person.candidate.token);
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ courses: [] });
  });

  it("confirms a pending role in place and gives a former teacher a new role beside the revoked one", async () => {
    expect((await post(person.admin.token, person.pendingCandidate.id)).status).toBe(200);
    expect(await roleRows(person.pendingCandidate.id)).toEqual([
      { role: "teacher", confirmed: true, confirmed_by: person.admin.id, revoked: false },
    ]);
    expect((await post(person.admin.token, person.formerTeacher.id)).status).toBe(200);
    expect((await roleRows(person.formerTeacher.id)).map(({ confirmed, revoked }) => ({ confirmed, revoked }))).toEqual([
      { confirmed: true, revoked: false }, { confirmed: true, revoked: true },
    ]);
  });

  it("confirms once when two administrators confirm the same candidate at once", async () => {
    const answers = await Promise.all([post(person.admin.token, person.raceCandidate.id), post(person.secondAdmin.token, person.raceCandidate.id)]);
    for (const answer of answers) expect(answer.status).toBe(200);
    const rows = await roleRows(person.raceCandidate.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ role: "teacher", confirmed: true, revoked: false });
    expect([person.admin.id, person.secondAdmin.id]).toContain(rows[0].confirmed_by);
  });
});
