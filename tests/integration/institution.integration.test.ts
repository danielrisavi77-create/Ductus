import { randomBytes, randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWithActor, type WithActor } from "@/server/db/with-actor";

// The institution functions (B-7) over withActor and a real ductus_app login,
// against the compose stack (pnpm stack:up, pnpm db:migrate). What pgTAP
// cannot show is here: parallel requests, what one transaction leaves for the
// next, and a login that tries to act as someone else (plan of attack on
// issue #153, items 11, 12, 16, 18 and 29).
// Every person, institution, course, token and password is random or invented.
const ADMIN_URL = process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
// The login exists only while this file runs: pgTAP (010) lists every
// membership in a ductus_* role, and logins belong to the environment.
const LOGIN = "it_institution_login";
const password = randomBytes(24).toString("hex");
const newToken = () => randomBytes(32).toString("base64url");

const facultyA = randomUUID();
const facultyB = randomUUID();
const people = {
  admin: { id: randomUUID(), institution: facultyA, token: newToken() },
  teacher: { id: randomUUID(), institution: facultyA, token: newToken() },
  student: { id: randomUUID(), institution: facultyA, token: newToken() },
  guesser: { id: randomUUID(), institution: facultyA, token: newToken() },
  stranger: { id: randomUUID(), institution: facultyA, token: newToken() },
  outsider: { id: randomUUID(), institution: facultyB, token: newToken() },
};
const userIds = Object.values(people).map((person) => person.id);

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
const pools: pg.Pool[] = [];

function appUrl() {
  const url = new URL(ADMIN_URL);
  url.username = LOGIN;
  url.password = password;
  return url.href;
}

function appPool(max: number) {
  const pool = new pg.Pool({ connectionString: appUrl(), max });
  pools.push(pool);
  return pool;
}

type Enrolment = { outcome: string; enrolled_course_id: string | null };
const ENROLL = "SELECT outcome, enrolled_course_id FROM institution.enroll_with_code($1)";
const enroll = (withActor: WithActor, token: string, code: string | null) =>
  withActor(token, async (tx) => (await tx.query<Enrolment>(ENROLL, [code])).rows[0]);

const visibleCourses = (withActor: WithActor, token: string | null) =>
  withActor(token, async (tx) => (await tx.query<{ id: string }>("SELECT id FROM institution.course")).rows.map((row) => row.id));

const count = async (sql: string, values: unknown[]) => Number((await admin.query(sql, values)).rows[0].count);
const attempts = (userId: string) =>
  count("SELECT count(*) FROM institution.enrollment_attempt WHERE user_id = $1", [userId]);
const memberships = (userId: string) =>
  count("SELECT count(*) FROM institution.course_member WHERE user_id = $1", [userId]);

let withActor: WithActor;
let course = "";
let code = "";

beforeAll(async () => {
  await admin.query(`DROP ROLE IF EXISTS ${LOGIN}`);
  const ddl = await admin.query<{ ddl: string }>(
    "SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L IN ROLE ductus_app', $1::text, $2::text) AS ddl",
    [LOGIN, password],
  );
  await admin.query(ddl.rows[0].ddl);

  const suffix = randomBytes(4).toString("hex");
  await admin.query("INSERT INTO identity.institution (id, slug) VALUES ($1, $2), ($3, $4)", [
    facultyA, `it-fak-a-${suffix}`, facultyB, `it-fak-b-${suffix}`,
  ]);
  // The limit is written out: these tests must not lean on the defaults.
  await admin.query(
    `INSERT INTO institution.institution_settings (institution_id, display_name, enrollment_attempt_limit, enrollment_attempt_window)
     VALUES ($1, 'Fakultet A (test)', 5, '15 minutes'), ($2, 'Fakultet B (test)', 5, '15 minutes')`,
    [facultyA, facultyB],
  );
  for (const [name, person] of Object.entries(people)) {
    await admin.query(
      `INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [person.id, person.institution, `https://issuer-${suffix}.test`, `sub-${name}`, `${name}@it-fak.example`],
    );
    await admin.query(
      `INSERT INTO identity.session (token_hash, user_id, institution_id, expires_at)
       VALUES (sha256(convert_to($1, 'UTF8')), $2, $3, now() + interval '1 hour')`,
      [person.token, person.id, person.institution],
    );
  }
  // The first administrator comes from the operator (docs/PRODUCT.md 6);
  // everything after it goes through the functions, as the demo data will.
  await admin.query(
    "INSERT INTO institution.institution_role (institution_id, user_id, role, confirmed_at) VALUES ($1, $2, 'admin', now())",
    [facultyA, people.admin.id],
  );

  withActor = createWithActor(appPool(6));
  await withActor(people.admin.token, (tx) =>
    tx.query("SELECT institution.confirm_teacher_role($1)", [people.teacher.id]),
  );
  course = await withActor(people.teacher.token, async (tx) => {
    const created = await tx.query<{ id: string }>(
      "SELECT institution.create_course($1, '2026/2027', 'partially_allowed') AS id",
      ["Uvod u izmišljeno"],
    );
    return created.rows[0].id;
  });
  code = await withActor(people.teacher.token, async (tx) => {
    const issued = await tx.query<{ code: string }>(
      "SELECT institution.create_enrollment_code($1, now() + interval '7 days') AS code",
      [course],
    );
    return issued.rows[0].code;
  });
});

afterAll(async () => {
  await Promise.all(pools.map((pool) => pool.end()));
  const institutions = [facultyA, facultyB];
  await admin.query("DELETE FROM institution.enrollment_attempt WHERE user_id = ANY ($1)", [userIds]);
  await admin.query("DELETE FROM institution.course_member WHERE institution_id = ANY ($1)", [institutions]);
  await admin.query(
    "DELETE FROM institution.course_enrollment_code WHERE course_id IN (SELECT id FROM institution.course WHERE institution_id = ANY ($1))",
    [institutions],
  );
  await admin.query("DELETE FROM institution.course WHERE institution_id = ANY ($1)", [institutions]);
  await admin.query("DELETE FROM institution.institution_role WHERE institution_id = ANY ($1)", [institutions]);
  await admin.query("DELETE FROM institution.institution_settings WHERE institution_id = ANY ($1)", [institutions]);
  await admin.query("DELETE FROM identity.session WHERE user_id = ANY ($1)", [userIds]);
  await admin.query("DELETE FROM identity.user_account WHERE id = ANY ($1)", [userIds]);
  await admin.query("DELETE FROM identity.institution WHERE id = ANY ($1)", [institutions]);
  await admin.query(`DROP ROLE IF EXISTS ${LOGIN}`);
  await admin.end();
});

describe("institution functions over withActor", () => {
  it("builds a course through the functions alone, and a stranger reads none of it", async () => {
    expect(code).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
    expect(await visibleCourses(withActor, people.teacher.token)).toEqual([course]);
    for (const token of [people.stranger.token, people.student.token, people.admin.token, people.outsider.token, null]) {
      expect(await visibleCourses(withActor, token)).toEqual([]);
    }
    // The stranger asks about the real course and about one that does not
    // exist: the two refusals are the same.
    const refusals = [];
    for (const target of [course, randomUUID()]) {
      const refusal = await withActor(people.stranger.token, (tx) =>
        tx.query("SELECT institution.create_enrollment_code($1, now() + interval '1 day')", [target]),
      ).catch((error: { code?: string; message?: string }) => ({ code: error.code, message: error.message }));
      refusals.push(refusal);
    }
    expect(refusals).toEqual([
      { code: "ZD403", message: "forbidden" },
      { code: "ZD403", message: "forbidden" },
    ]);
  });

  it("ten parallel requests with the same code leave exactly one membership", async () => {
    const answers = await Promise.all(Array.from({ length: 10 }, () => enroll(withActor, people.student.token, code)));
    expect(answers).toEqual(Array.from({ length: 10 }, () => ({ outcome: "enrolled", enrolled_course_id: course })));
    expect(await memberships(people.student.id)).toBe(1);
    expect(await attempts(people.student.id)).toBe(0);
    expect(await visibleCourses(withActor, people.student.token)).toEqual([course]);
  });

  it("refuses a user of another institution although the code is right", async () => {
    expect(await enroll(withActor, people.outsider.token, code)).toEqual({ outcome: "refused", enrolled_course_id: null });
    expect(await memberships(people.outsider.id)).toBe(0);
    expect(await attempts(people.outsider.id)).toBe(1);
  });

  it("parallel wrong codes cannot pass the limit, and the lock outlives the transaction", async () => {
    const guesses = await Promise.all(
      Array.from({ length: 12 }, (_, i) => enroll(withActor, people.guesser.token, `WRONG-CODE-${i}`)),
    );
    const outcomes = guesses.map((guess) => guess.outcome);
    expect(outcomes.filter((outcome) => outcome === "refused")).toHaveLength(5);
    expect(outcomes.filter((outcome) => outcome === "too_many_attempts")).toHaveLength(7);
    expect(await attempts(people.guesser.id)).toBe(5);

    // The right code, on fresh connections: still locked out.
    const fresh = createWithActor(appPool(2));
    expect(await enroll(fresh, people.guesser.token, code)).toEqual({ outcome: "too_many_attempts", enrolled_course_id: null });
    expect(await memberships(people.guesser.id)).toBe(0);
    // Someone else is not locked out by it.
    expect((await enroll(fresh, people.stranger.token, "WRONG-CODE")).outcome).toBe("refused");

    // The window passes (the operator's clock stands in for fifteen minutes).
    await admin.query(
      "UPDATE institution.enrollment_attempt SET attempted_at = now() - interval '15 minutes' WHERE user_id = $1",
      [people.guesser.id],
    );
    expect(await enroll(fresh, people.guesser.token, code)).toEqual({ outcome: "enrolled", enrolled_course_id: course });
    expect(await attempts(people.guesser.id)).toBe(0);
  });

  it("refuses to count attempts in a transaction that cannot see parallel ones", async () => {
    const client = new pg.Client({ connectionString: appUrl() });
    await client.connect();
    try {
      for (const level of ["REPEATABLE READ", "SERIALIZABLE"]) {
        await client.query(`BEGIN ISOLATION LEVEL ${level}`);
        await client.query("SELECT set_config('app.session_token', $1, true)", [people.stranger.token]);
        await expect(client.query(ENROLL, [code])).rejects.toMatchObject({ code: "ZD500" });
        await client.query("ROLLBACK");
      }
    } finally {
      await client.end();
    }
    expect(await memberships(people.stranger.id)).toBe(0);
  });

  it("a ductus_app login cannot become the owner role or another user", async () => {
    const pool = appPool(1);
    const single = createWithActor(pool);
    for (const statement of [
      "SET ROLE ductus_identity",
      "SET LOCAL ROLE ductus_identity",
      "SET SESSION AUTHORIZATION ductus_identity",
      "SET ROLE ductus_migrator",
    ]) {
      // withActor refuses the statement before it reaches the database ...
      await expect(single(people.stranger.token, (tx) => tx.query(statement))).rejects.toThrow(/not allowed/);
      // ... and the database refuses it to the ductus_app login as well.
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await expect(client.query(statement)).rejects.toMatchObject({ code: "42501" });
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
    }
    // A raw user id in a setting is nobody's identity.
    const posed = await single(people.stranger.token, async (tx) => {
      await tx.query("SELECT set_config('app.user_id', $1, true), set_config('app.current_user_id', $1, true)", [
        people.teacher.id,
      ]);
      const role = await tx.query<{ role: string | null }>("SELECT institution.actor_course_role($1) AS role", [course]);
      const seen = await tx.query("SELECT id FROM institution.course");
      return { role: role.rows[0].role, courses: seen.rowCount };
    });
    expect(posed).toEqual({ role: null, courses: 0 });
    // Direct writes are refused whoever asks, the teacher included.
    for (const token of [people.stranger.token, people.teacher.token]) {
      await expect(
        single(token, (tx) =>
          tx.query(
            "INSERT INTO institution.course_member (course_id, institution_id, user_id, role) VALUES ($1, $2, $3, 'teacher')",
            [course, facultyA, people.stranger.id],
          ),
        ),
      ).rejects.toMatchObject({ code: "42501" });
    }
    expect(await memberships(people.stranger.id)).toBe(0);
  });

  it("a transaction that ended itself and left a token behind gives the next caller nothing", async () => {
    const pool = appPool(1);
    const single = createWithActor(pool);
    // What an injected multi-statement string would do (QA finding 2 on #148):
    // end the transaction, then leave the teacher's token on the session.
    // withActor refuses it, so the token is left on the connection directly.
    await expect(
      single(people.stranger.token, (tx) =>
        tx.query(`COMMIT; SELECT set_config('app.session_token', '${people.teacher.token}', false)`),
      ),
    ).rejects.toThrow(/COMMIT statement is not allowed/);
    // withActor resets the connection when it gives it back, so the token is
    // left again before every call.
    const leave = async () => {
      await pool.query("SELECT set_config('app.session_token', $1, false)", [people.teacher.token]);
      // The token is on the pooled connection now, outside withActor.
      expect((await pool.query("SELECT app.current_user_id() AS id")).rows[0].id).toBe(people.teacher.id);
    };

    await leave();
    expect(await visibleCourses(single, null)).toEqual([]);
    await leave();
    expect(await visibleCourses(single, people.stranger.token)).toEqual([]);
    await leave();
    await expect(
      single(null, (tx) => tx.query("SELECT institution.revoke_enrollment_code($1)", [course])),
    ).rejects.toMatchObject({ code: "ZD401" });
    await leave();
    await expect(
      single(people.stranger.token, (tx) => tx.query("SELECT institution.revoke_enrollment_code($1)", [course])),
    ).rejects.toMatchObject({ code: "ZD403" });
    expect(await count("SELECT count(*) FROM institution.course_enrollment_code WHERE course_id = $1 AND active", [course])).toBe(1);
  });

  it("parallel requests for a new code leave one active code, and only that one works", async () => {
    const issued = await Promise.all(
      Array.from({ length: 6 }, () =>
        withActor(people.teacher.token, async (tx) => {
          const result = await tx.query<{ code: string }>(
            "SELECT institution.create_enrollment_code($1, now() + interval '7 days') AS code",
            [course],
          );
          return result.rows[0].code;
        }),
      ),
    );
    expect(new Set(issued).size).toBe(6);
    const active = await admin.query<{ hash: string }>(
      "SELECT encode(code_hash, 'hex') AS hash FROM institution.course_enrollment_code WHERE course_id = $1 AND active",
      [course],
    );
    expect(active.rows).toHaveLength(1);
    const hashes = await admin.query<{ code: string; hash: string }>(
      "SELECT c AS code, encode(sha256(convert_to(replace(c, '-', ''), 'UTF8')), 'hex') AS hash FROM unnest($1::text[]) AS c",
      [issued],
    );
    const working = hashes.rows.filter((row) => row.hash === active.rows[0].hash).map((row) => row.code);
    expect(working).toHaveLength(1);
    code = working[0];

    // The stranger tries a replaced code, then the working one.
    const replaced = issued.find((candidate) => candidate !== code) ?? "";
    expect((await enroll(withActor, people.stranger.token, replaced)).outcome).toBe("refused");
    expect(await enroll(withActor, people.stranger.token, code)).toEqual({ outcome: "enrolled", enrolled_course_id: course });
    await admin.query("DELETE FROM institution.course_member WHERE user_id = $1", [people.stranger.id]);
    await admin.query("DELETE FROM institution.enrollment_attempt WHERE user_id = $1", [people.stranger.id]);
  });

  it("refuses hostile input without repeating it", async () => {
    const create = (name: string, extra = "") =>
      withActor(people.teacher.token, (tx) =>
        tx.query(`SELECT institution.create_course(p_name => $1, p_academic_year => '2026/2027', p_ai_policy => 'prohibited'${extra})`, [name]),
      ).catch((error: { code?: string; message?: string }) => ({ code: error.code, message: error.message }));

    const long = "a".repeat(100_000);
    expect(await create(long)).toEqual({ code: "ZD422", message: "invalid input" });
    for (const name of ["zero​width", "bidi‮override", "two\nlines", ""]) {
      expect(await create(name)).toEqual({ code: "ZD422", message: "invalid input" });
    }
    // PostgreSQL text cannot hold a zero byte; the request fails as a whole.
    expect(await create("zero\u0000byte")).toMatchObject({ code: "22021" });
    // A field the function does not know is no function at all.
    expect(await create("Kolegij", `, p_created_by => '${people.stranger.id}'`)).toMatchObject({ code: "42883" });
    expect(await count("SELECT count(*) FROM institution.course WHERE institution_id = $1", [facultyA])).toBe(1);
  });
});
