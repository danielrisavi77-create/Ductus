import { createHash, randomBytes, randomUUID } from "node:crypto";

import { NextRequest } from "next/server";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { POST } from "../../app/api/institution/courses/[courseId]/enrollment-code/route";
import { createWithActor } from "@/server/db/with-actor";
import { handleEnrollmentCodeRequest } from "@/server/institution/enrollment-code-route";

// Real PostgreSQL and ductus_app login, with entirely invented fixtures.
const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus", max: 3 });
const applicationName = `issue-code-${randomUUID()}`;
const app = new pg.Pool({ connectionString: process.env.APP_DATABASE_URL, max: 3, application_name: applicationName });
const withActor = createWithActor(app);
const ORIGIN = "https://issue-code.example";
const faculties = [randomUUID(), randomUUID()];
const token = () => randomBytes(32).toString("base64url");
const names = ["teacher", "second", "student", "unconfirmed", "revoked", "nonmember", "outsider"] as const;
const people = Object.fromEntries(names.map((name) => [name, { id: randomUUID(), token: token() }])) as
  Record<typeof names[number], { id: string; token: string }>;
const ids = Object.values(people).map((person) => person.id);
const expired = token(), closed = token();
let course: string, foreign: string, validUntil: string;
const hash = (code: string) => createHash("sha256").update(code.replaceAll("-", "")).digest("hex");
const req = (session = people.teacher.token, until = validUntil) => new NextRequest(
  `${ORIGIN}/api/institution/courses/${course}/enrollment-code`, {
    method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", cookie: `__Host-ductus_session=${session}` },
    body: JSON.stringify({ validUntil: until }),
  },
);
const post = (session = people.teacher.token, target = course, until = validUntil) =>
  POST(req(session, until), { params: Promise.resolve({ courseId: target }) });
const codes = async () => (await admin.query(
  "SELECT encode(code_hash, 'hex') AS hash, active, created_by FROM institution.course_enrollment_code WHERE course_id = $1 ORDER BY id", [course],
)).rows;
// DAN-292: every code that a new one switched off has its 'replaced' row.
const events = async () => (await admin.query(
  `SELECT encode(c.code_hash, 'hex') AS hash, e.kind, e.actor_id FROM audit.enrollment_code_event e
     JOIN institution.course_enrollment_code c ON c.id = e.code_id WHERE e.course_id = $1 ORDER BY 1`, [course],
)).rows;

// Scoped snapshots also detect an accidental write to any future table in these
// schemas. No other integration file's random fixtures enter this comparison.
async function snapshot(includeCodes = false) {
  const tables = (await admin.query<{ schemaname: string; tablename: string }>(
    "SELECT schemaname, tablename FROM pg_tables WHERE schemaname IN ('institution','evidence','audit') ORDER BY 1,2",
  )).rows;
  const result: Record<string, unknown> = {};
  for (const { schemaname, tablename } of tables) {
    if (!includeCodes && (tablename === "course_enrollment_code" || tablename === "enrollment_code_event")) continue;
    const qualified = `"${schemaname.replaceAll('"', '""')}"."${tablename.replaceAll('"', '""')}"`;
    result[`${schemaname}.${tablename}`] = (await admin.query(
      `SELECT r::text AS row FROM ${qualified} r WHERE EXISTS (SELECT 1 FROM unnest($1::text[]) n WHERE strpos(r::text, n) > 0) ORDER BY 1`,
      [[...faculties, ...ids, course, foreign]],
    )).rows;
  }
  return result;
}

beforeAll(async () => {
  vi.stubEnv("OIDC_REDIRECT_URI", `${ORIGIN}/api/auth/callback`);
  const suffix = randomBytes(6).toString("hex");
  for (const [index, faculty] of faculties.entries()) {
    await admin.query("INSERT INTO identity.institution (id, slug) VALUES ($1, $2)", [faculty, `issue-code-${index}-${suffix}`]);
    await admin.query("INSERT INTO institution.institution_settings (institution_id, display_name) VALUES ($1, 'Izmišljeni fakultet test')", [faculty]);
  }
  for (const name of names) {
    const person = people[name], faculty = faculties[name === "outsider" ? 1 : 0];
    await admin.query(
      `INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
       VALUES ($1, $2, 'https://issuer.example', $3, $4)`, [person.id, faculty, `${suffix}-${name}`, `${suffix}-${name}@issue-code.example`],
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
    (await tx.query<{ id: string }>("SELECT institution.create_course($1, '2026/2027', 'prohibited') AS id", [`Izmišljeni kolegij ${name}`])).rows[0].id,
  );
  course = await create("teacher"); foreign = await create("outsider"); await create("nonmember");
  for (const name of ["second", "student", "unconfirmed", "revoked"] as const) await admin.query(
    "INSERT INTO institution.course_member (course_id, user_id, institution_id, role) VALUES ($1,$2,$3,$4)",
    [course, people[name].id, faculties[0], name === "student" ? "student" : "teacher"],
  );
  validUntil = (await admin.query("SELECT to_char(now()+interval '7 days', 'YYYY-MM-DD\"T\"HH24:MI:SS.USOF') AS until")).rows[0].until;
  // OF can be +00: explicit ISO timestamps use +00:00.
  if (/[-+]\d{2}$/.test(validUntil)) validUntil += ":00";
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await app.end();
  // The audit trail is append-only; only this clean-up steps around it, on its own connection and for its own rows.
  const cleaner = await admin.connect();
  try {
    await cleaner.query("BEGIN");
    await cleaner.query("SET LOCAL session_replication_role = replica");
    await cleaner.query("DELETE FROM audit.enrollment_code_event WHERE institution_id = ANY($1)", [faculties]);
    await cleaner.query("COMMIT");
  } finally {
    cleaner.release();
  }
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

describe("enrollment code real POST, session and database", () => {
  it("issues once per request, preserves exact microseconds and changes no enrollment/notice/evidence/submission/audit state", async () => {
    const before = await snapshot();
    const response = await post();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(Object.keys(body)).toEqual(["code"]);
    expect(body.code).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
    expect(await codes()).toEqual([{ hash: hash(body.code), active: true, created_by: people.teacher.id }]);
    expect(await events()).toEqual([]);
    expect((await admin.query("SELECT valid_until = $2::timestamptz AS exact FROM institution.course_enrollment_code WHERE course_id=$1 AND active", [course, validUntil])).rows[0].exact).toBe(true);
    expect(await snapshot()).toEqual(before);
    const stored = JSON.stringify(await snapshot(true));
    expect(stored.includes(body.code) || stored.includes(body.code.replaceAll("-", ""))).toBe(false);
    const second = await post();
    expect(second.status).toBe(200);
    const next = (await second.json()).code;
    expect(next).not.toBe(body.code);
    expect((await codes()).filter((row) => row.active)).toEqual([{ hash: hash(next), active: true, created_by: people.teacher.id }]);
    expect((await codes()).find((row) => row.hash === hash(body.code))?.active).toBe(false);
    expect(await events()).toEqual([{ hash: hash(body.code), kind: "replaced", actor_id: people.teacher.id }]);
    expect(await snapshot()).toEqual(before);
  });

  it("rejects unknown/expired/closed sessions and all unauthorized roles without mutations or resource enumeration", async () => {
    const before = await snapshot(true);
    for (const session of [token(), expired, closed]) {
      const response = await post(session);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "unauthorized" });
    }
    for (const name of ["student", "unconfirmed", "revoked", "nonmember", "outsider"] as const) {
      const response = await post(people[name].token);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "forbidden" });
    }
    for (const target of [foreign, randomUUID()]) {
      const response = await post(people.teacher.token, target);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "forbidden" });
    }
    await admin.query("UPDATE institution.course_member SET member_to=now() WHERE course_id=$1 AND user_id=$2", [course, people.second.id]);
    try {
      expect((await post(people.second.token)).status).toBe(403);
    } finally {
      await admin.query("UPDATE institution.course_member SET member_to=NULL WHERE course_id=$1 AND user_id=$2", [course, people.second.id]);
    }
    expect(await snapshot(true)).toEqual(before);
  });

  it("uses DB time for expired, present and over-one-year timestamps, preserving the active code", async () => {
    const before = await snapshot(true);
    const times = (await admin.query("SELECT now() - interval '1 day' AS past, now() AS present, now()+interval '1 year 1 day' AS future")).rows[0];
    for (const time of Object.values(times) as Date[]) {
      const response = await post(people.teacher.token, course, time.toISOString());
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: "invalid_input" });
    }
    expect(await snapshot(true)).toEqual(before);
  });

  it("blocks concurrent teachers on the course lock, then returns each new code with one active hash", async () => {
    const before = await snapshot();
    const blocker = await admin.connect();
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM institution.course WHERE id=$1 FOR UPDATE", [course]);
    const calls = [people.teacher, people.second].map((person) => handleEnrollmentCodeRequest(req(person.token), course, {
      withActor, expectedOrigin: ORIGIN, sessionToken: person.token,
    }));
    try {
      const deadline = Date.now() + 3000;
      let waiting = 0;
      do {
        waiting = Number((await admin.query("SELECT count(*) FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE 'SELECT institution.create_enrollment_code%'", [applicationName])).rows[0].count);
        if (waiting < 2) await new Promise((resolve) => setTimeout(resolve, 25));
      } while (waiting < 2 && Date.now() < deadline);
      expect(waiting).toBe(2);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
    const responses = await Promise.all(calls);
    const issued = [];
    for (const response of responses) {
      expect(response.status).toBe(200);
      issued.push((await response.json()).code as string);
    }
    expect(new Set(issued).size).toBe(2);
    const rows = await codes();
    expect(rows.filter((row) => row.active)).toHaveLength(1);
    for (const [index, code] of issued.entries()) expect(rows).toContainEqual({
      hash: hash(code), active: rows.find((row) => row.hash === hash(code))?.active,
      created_by: [people.teacher.id, people.second.id][index],
    });
    expect(issued.map(hash)).toContain(rows.find((row) => row.active)!.hash);
    // Each code that stopped being active has exactly one 'replaced' row, by one of the two teachers.
    const ended = await events();
    expect(ended.map((row) => row.hash).sort()).toEqual(rows.filter((row) => !row.active).map((row) => row.hash).sort());
    for (const row of ended) {
      expect(row.kind).toBe("replaced");
      expect([people.teacher.id, people.second.id]).toContain(row.actor_id);
    }
    expect(await snapshot()).toEqual(before);
  });
});
