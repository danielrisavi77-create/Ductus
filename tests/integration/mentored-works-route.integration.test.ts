import { randomBytes, randomUUID } from "node:crypto";

import { NextRequest } from "next/server";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET as getList } from "../../app/api/teacher/mentorships/route";
import { GET as getDetail } from "../../app/api/teacher/mentorships/[mentorshipId]/route";
import { SESSION_COOKIE_NAME } from "@/server/auth/session-token";
import { createWithActor } from "@/server/db/with-actor";
import { handleMentoredWorkRequest, handleMentoredWorksRequest } from "@/server/institution/mentored-works";

import { requireLoopbackDatabaseUrl } from "./loopback-database-url";

// DAN-477 (contract on #1091, c.6566072183, attacks 1-10): both real GET
// routes, session and database. The operator writes every row; the routes
// read as ductus_app. Every person, institution, work and hash is invented;
// random ids, removed afterwards.
const ADMIN_URL = requireLoopbackDatabaseUrl(
  process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus",
  "The mentored works test runs only against a loopback database (DATABASE_URL).",
);
const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
const app = new pg.Pool({ connectionString: process.env.APP_DATABASE_URL, max: 2, application_name: `mentored-${randomUUID()}` });
const withActor = createWithActor(app);
const ORIGIN = "https://mentored.example";
const suffix = randomBytes(5).toString("hex");
const faculties = [randomUUID(), randomUUID()];
// mira mentors ana, boris and cvita, and mentored ema (ended); noa teaches a
// course and mentors no one; ivo's teacher role is revoked, nina's never
// confirmed; petra mentors fran at the other institution.
const names = ["mira", "noa", "ivo", "nina", "petra", "ana", "boris", "cvita", "dora", "ema", "gita", "fran"] as const;
type Name = typeof names[number];
const teachers: Partial<Record<Name, "confirmed" | "revoked" | "unconfirmed">> = {
  mira: "confirmed", noa: "confirmed", ivo: "revoked", nina: "unconfirmed", petra: "confirmed",
};
const people = Object.fromEntries(names.map((name) => [name, {
  id: randomUUID(), token: randomBytes(32).toString("base64url"), faculty: faculties[name === "petra" || name === "fran" ? 1 : 0],
}])) as Record<Name, { id: string; token: string; faculty: string }>;
const expired = randomBytes(32).toString("base64url");
const course = randomUUID();
const hash = (n: string) => n.repeat(64);

type Key = "ms1" | "ms2" | "ms3" | "ms4" | "ms5" | "ms6" | "ms7";
// [mentor, student, work type, title, ended]
const mentorships: Record<Key, readonly [Name, Name, string, string, boolean]> = {
  ms1: ["mira", "ana", "master_thesis", "Izmišljeni diplomski rad", false],
  ms2: ["mira", "boris", "bachelor_thesis", "Izmišljeni završni rad", false],
  ms3: ["mira", "cvita", "master_thesis", "Drugi izmišljeni rad", false],
  ms4: ["ivo", "dora", "master_thesis", "Rad opozvanog mentora", false],
  ms5: ["mira", "ema", "bachelor_thesis", "Završeno mentorstvo", true],
  ms6: ["petra", "fran", "master_thesis", "Rad druge ustanove", false],
  ms7: ["nina", "gita", "bachelor_thesis", "Rad nepotvrđene mentorice", false],
};
const keys = Object.keys(mentorships) as Key[];
const ids = Object.fromEntries(keys.map((key) => [key, { mentorship: randomUUID(), assignment: randomUUID() }])) as
  Record<Key, { mentorship: string; assignment: string }>;
const documents = { ana: `doc-ana-${suffix}`, boris: `doc-boris-${suffix}` } as const;

const cookie = (session: string | null): Record<string, string> =>
  session === null ? {} : { cookie: `${SESSION_COOKIE_NAME}=${session}` };
const list = (session: string | null, headers: Record<string, string> = {}) =>
  getList(new NextRequest(`${ORIGIN}/api/teacher/mentorships`, { method: "GET", headers: { ...cookie(session), ...headers } }));
const detail = (session: string | null, id: string, headers: Record<string, string> = {}) => getDetail(
  new NextRequest(`${ORIGIN}/api/teacher/mentorships/${encodeURIComponent(id)}`, { method: "GET", headers: { ...cookie(session), ...headers } }),
  { params: Promise.resolve({ mentorshipId: id }) },
);
const works = async (session: string) => {
  const response = await list(session);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  return ((await response.json()) as { works: { mentorshipId: string }[] }).works;
};
/** Status, every header and the exact body, for comparing two refusals. */
const shape = async (response: Response) => ({
  status: response.status,
  headers: [...response.headers.entries()].sort(),
  body: await response.text(),
});
const TABLES = ["evidence.project", "evidence.document", "evidence.document_revision", "evidence.submission_request",
  "evidence.submission", "audit.access_log"];
const counts = async () => Object.fromEntries(await Promise.all(TABLES.map(async (table) => [table, Number((await admin.query(
  `SELECT count(*) FROM ${table} WHERE institution_id = ANY($1)`, [faculties],
)).rows[0].count)])));

async function submit(student: Name, document: string) {
  await withActor(people[student].token, async (tx) => {
    const request = (await tx.query<{ outcome: string; submission_request_id: string }>(
      "SELECT outcome, submission_request_id FROM app.request_submission($1, 1)", [document],
    )).rows[0];
    expect(request.outcome).toBe("requested");
    const recorded = (await tx.query<{ outcome: string }>(
      "SELECT outcome FROM app.record_submission($1, $2)", [request.submission_request_id, hash("d")],
    )).rows[0];
    expect(recorded.outcome).toBe("recorded");
  });
}

beforeAll(async () => {
  const client = await admin.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET CONSTRAINTS ALL DEFERRED");
    for (const [index, faculty] of faculties.entries()) {
      await client.query("INSERT INTO identity.institution (id, slug) VALUES ($1, $2)", [faculty, `mentored-${index}-${suffix}`]);
      await client.query(
        `INSERT INTO institution.faculty_work_rule (institution_id, work_type, ai_policy, ai_purposes, evidence_profile, import_allowed)
         VALUES ($1, 'master_thesis', 'partially_allowed', '{proofreading}', 'extended', false),
                ($1, 'bachelor_thesis', 'prohibited', '{}', 'basic', false)`, [faculty],
      );
    }
    for (const name of names) {
      const { id, token, faculty } = people[name];
      await client.query(
        `INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
         VALUES ($1, $2, 'https://issuer.example', $3, $4)`, [id, faculty, `${suffix}-${name}`, `${suffix}-${name}@mentored.example`],
      );
      await client.query(
        "INSERT INTO identity.session (token_hash, user_id, institution_id, expires_at) VALUES (sha256(convert_to($1, 'UTF8')), $2, $3, now() + interval '1 hour')",
        [token, id, faculty],
      );
      const role = teachers[name];
      if (role !== undefined) await client.query(
        `INSERT INTO institution.institution_role (institution_id, user_id, role, confirmed_at, revoked_at)
         VALUES ($1, $2, 'teacher', CASE WHEN $3 = 'unconfirmed' THEN NULL ELSE now() END, CASE WHEN $3 = 'revoked' THEN now() END)`,
        [faculty, id, role],
      );
    }
    await client.query(
      `INSERT INTO identity.session (token_hash, user_id, institution_id, created_at, expires_at)
       VALUES (sha256(convert_to($1, 'UTF8')), $2, $3, now() - interval '2 hours', now() - interval '1 hour')`,
      [expired, people.mira.id, faculties[0]],
    );
    // Noa teaches a course that ana takes: a course teacher is no mentor.
    await client.query(
      `INSERT INTO institution.course (id, institution_id, name, academic_year, ai_policy, created_by)
       VALUES ($1, $2, 'Izmišljeni kolegij', '2026/2027', 'partially_allowed', $3)`, [course, faculties[0], people.noa.id],
    );
    await client.query(
      "INSERT INTO institution.course_member (course_id, institution_id, user_id, role) VALUES ($1, $2, $3, 'teacher'), ($1, $2, $4, 'student')",
      [course, faculties[0], people.noa.id, people.ana.id],
    );
    for (const key of keys) {
      const [mentor, student, workType, title, ended] = mentorships[key];
      const faculty = people[mentor].faculty;
      await client.query(
        `INSERT INTO institution.mentorship (id, institution_id, mentor_id, student_id, work_type, started_at, ended_at)
         VALUES ($1, $2, $3, $4, $5, now() - interval '30 days', CASE WHEN $6 THEN now() END)`,
        [ids[key].mentorship, faculty, people[mentor].id, people[student].id, workType, ended],
      );
      await client.query(
        "INSERT INTO institution.assignment (id, mentorship_id, institution_id, current_version, created_by) VALUES ($1, $2, $3, 1, $4)",
        [ids[key].assignment, ids[key].mentorship, faculty, people[mentor].id],
      );
      await client.query(
        `INSERT INTO institution.assignment_version
           (assignment_id, version_no, title, instructions, work_type, opens_at, due_at, ai_policy,
            ai_purposes, evidence_profile, import_allowed, created_by)
         VALUES ($1, 1, $2, 'Upute za izmišljeni mentorski rad.', $3, now() - interval '1 day', now() + interval '365 days',
                 'prohibited', ARRAY[]::text[], 'basic', false, $4)`, [ids[key].assignment, title, workType, people[mentor].id],
      );
      await client.query(
        "INSERT INTO institution.notice_acknowledgment (assignment_id, version_no, student_id, institution_id) VALUES ($1, 1, $2, $3)",
        [ids[key].assignment, people[student].id, faculty],
      );
    }
    for (const [student, key] of [["ana", "ms1"], ["boris", "ms2"]] as const) {
      const document = documents[student];
      const project = `project-${document}`;
      await client.query(
        "INSERT INTO evidence.project (id, institution_id, assignment_id, principal_id) VALUES ($1, $2, $3, $4)",
        [project, faculties[0], ids[key].assignment, people[student].id],
      );
      await client.query(
        `INSERT INTO evidence.document (id, institution_id, project_id, principal_id, current_revision, current_content_hash)
         VALUES ($1, $2, $3, $4, 1, $5)`, [document, faculties[0], project, people[student].id, hash("d")],
      );
      await client.query(
        `INSERT INTO evidence.document_revision (document_id, institution_id, revision, base_revision, principal_id, content_hash)
         VALUES ($1, $2, 0, NULL, $3, $4), ($1, $2, 1, 0, $3, $5)`, [document, faculties[0], people[student].id, hash("a"), hash("d")],
      );
    }
    await client.query(
      "INSERT INTO identity.person_name (user_id, institution_id, given_name, family_name) VALUES ($1, $2, 'Iskra', 'Izmišljenić'), ($3, $2, 'Bruno', 'Primjerić')",
      [people.ana.id, faculties[0], people.boris.id],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  await submit("ana", documents.ana);
});

afterAll(async () => {
  await app.end();
  const client = await admin.connect();
  try {
    await client.query("BEGIN");
    // Disposable synthetic rows only; the append-only triggers stay active in normal operation.
    await client.query("SET LOCAL session_replication_role = replica");
    for (const table of ["evidence.submission", "evidence.submission_request", "evidence.document_revision", "evidence.document",
      "evidence.project", "audit.access_log", "institution.notice_acknowledgment"]) {
      await client.query(`DELETE FROM ${table} WHERE institution_id = ANY($1)`, [faculties]);
    }
    await client.query("DELETE FROM institution.assignment_version WHERE assignment_id = ANY($1)", [keys.map((key) => ids[key].assignment)]);
    for (const table of ["institution.assignment", "institution.mentorship", "institution.course_member", "institution.course",
      "institution.faculty_work_rule", "institution.institution_role", "identity.person_name", "identity.session", "identity.user_account"]) {
      await client.query(`DELETE FROM ${table} WHERE institution_id = ANY($1)`, [faculties]);
    }
    await client.query("DELETE FROM identity.institution WHERE id = ANY($1)", [faculties]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await admin.end();
  }
});

const expected = () => [
  { mentorshipId: ids.ms1.mentorship, assignmentId: ids.ms1.assignment, documentId: documents.ana,
    student: { givenName: "Iskra", familyName: "Izmišljenić" }, title: "Izmišljeni diplomski rad", workType: "master_thesis", workState: "submitted" },
  { mentorshipId: ids.ms2.mentorship, assignmentId: ids.ms2.assignment, documentId: documents.boris,
    student: { givenName: "Bruno", familyName: "Primjerić" }, title: "Izmišljeni završni rad", workType: "bachelor_thesis", workState: "in_progress" },
  { mentorshipId: ids.ms3.mentorship, assignmentId: ids.ms3.assignment, documentId: null,
    student: null, title: "Drugi izmišljeni rad", workType: "master_thesis", workState: "not_started" },
];
const byId = (a: { mentorshipId: string }, b: { mentorshipId: string }) => (a.mentorshipId < b.mentorshipId ? -1 : 1);

describe("GET /api/teacher/mentorships over the real database", () => {
  it("gives the mentor exactly the open mentorships, each with its work and state, and writes nothing (1, 4, 10)", async () => {
    const before = await counts();
    const listed = await works(people.mira.token);
    expect([...listed].sort(byId)).toEqual(expected().sort(byId));
    for (const work of expected()) {
      const response = await detail(people.mira.token, work.mentorshipId);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ work });
    }
    expect(await counts()).toEqual(before);
  });

  it("gives everyone else the same empty list (4, 5, 6, 9)", async () => {
    for (const name of ["noa", "ivo", "nina", "ana", "boris", "cvita", "dora", "ema", "gita"] as const) {
      expect(await works(people[name].token)).toEqual([]);
    }
    // Petra sees only her own institution's mentorship.
    expect((await works(people.petra.token)).map((w) => w.mentorshipId)).toEqual([ids.ms6.mentorship]);
  });

  it("answers every mentorship that is not the caller's exactly as one that does not exist (2-7)", async () => {
    const nothing = await shape(await detail(people.mira.token, randomUUID()));
    expect(nothing.status).toBe(404);
    expect(JSON.parse(nothing.body)).toEqual({ error: "not_found" });
    const refusals: [Name, string][] = [
      ["noa", ids.ms1.mentorship], // another teacher of the same institution (2)
      ["petra", ids.ms1.mentorship], // another institution (3)
      ["mira", ids.ms6.mentorship], // the other institution's mentorship (3)
      ["mira", ids.ms5.mentorship], // ended (4)
      ["ivo", ids.ms4.mentorship], // revoked role (5)
      ["nina", ids.ms7.mentorship], // unconfirmed role (5)
      ["ana", ids.ms1.mentorship], // the mentorship's own student (6)
      ["dora", ids.ms4.mentorship],
      ["mira", ids.ms1.mentorship.toUpperCase()], // malformed ids (7)
      ["mira", "abc"],
      ["mira", "' OR true --"],
      ["mira", ""],
    ];
    for (const [name, id] of refusals) {
      expect(await shape(await detail(people[name].token, id)), `${name} ${id}`).toEqual(nothing);
    }
  });

  it("refuses a missing, malformed, expired or unknown session with 401 (8)", async () => {
    for (const session of [null, "kratko", expired, randomBytes(32).toString("base64url")]) {
      for (const response of [await list(session), await detail(session, ids.ms1.mentorship)]) {
        expect(response.status).toBe(401);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await response.json()).toEqual({ error: "unauthorized" });
      }
    }
  });

  it("refuses another method with 405 and a cross-site read with 403 (8)", async () => {
    const deps = { withActor, sessionToken: people.mira.token };
    const post = (path: string) => new Request(`${ORIGIN}${path}`, { method: "POST" });
    expect((await handleMentoredWorksRequest(post("/api/teacher/mentorships"), deps)).status).toBe(405);
    expect((await handleMentoredWorkRequest(post(`/api/teacher/mentorships/${ids.ms1.mentorship}`), deps, ids.ms1.mentorship)).status).toBe(405);
    for (const response of [
      await list(people.mira.token, { "sec-fetch-site": "cross-site" }),
      await detail(people.mira.token, ids.ms1.mentorship, { "sec-fetch-site": "same-site" }),
    ]) {
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "forbidden" });
    }
  });
});
