import { randomBytes, randomUUID } from "node:crypto";

import { NextRequest } from "next/server";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { POST as ASSIGNMENT_POST } from "../../app/api/institution/assignments/[assignmentId]/work-language/route";
import { POST as WORK_POST } from "../../app/api/institution/assignments/[assignmentId]/students/[studentId]/work-language/route";
import { readWorkLanguageException } from "@/components/teacher/work-language-exception-read";
import { createWithActor } from "@/server/db/with-actor";

import { requireLoopbackDatabaseUrl } from "./loopback-database-url";

// DAN-386 (M2.10-P02b, contract on #1091): both work language routes through
// the real POST, session cookie, ductus_app login and the existing RPCs. Every
// person, course and text is invented; two random institutions, removed
// afterwards. Loopback only.
const SAFE_ADMIN_URL: string =
  process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
requireLoopbackDatabaseUrl(SAFE_ADMIN_URL, "The work language route test runs only against a loopback database (DATABASE_URL).");
const admin = new pg.Pool({ connectionString: SAFE_ADMIN_URL, max: 3 });
const app = new pg.Pool({ connectionString: process.env.APP_DATABASE_URL, max: 3, application_name: `work-language-route-${randomUUID()}` });
const withActor = createWithActor(app);
const ORIGIN = "https://work-language-route.example";
const faculties = [randomUUID(), randomUUID()];
const token = () => randomBytes(32).toString("base64url");
// The stranger studies at the same faculty but is not in the course.
const names = ["teacher", "colleague", "student", "stranger", "outsider"] as const;
type Name = typeof names[number];
const people = Object.fromEntries(names.map((name) => [name, { id: randomUUID(), token: token() }])) as Record<Name, { id: string; token: string }>;
const ids = Object.values(people).map((person) => person.id);
let assignment: string;
// The student's one work, for the page read of its language (P02d).
let documentId: string;

const send = (url: string, session: string, body: unknown) => new NextRequest(url, {
  method: "POST",
  headers: { origin: ORIGIN, "content-type": "application/json", cookie: `__Host-ductus_session=${session}` },
  body: JSON.stringify(body),
});
const setAssignment = (session: string, expectedVersion: number, language: string, target = assignment) => ASSIGNMENT_POST(
  send(`${ORIGIN}/api/institution/assignments/${target}/work-language`, session, { expectedVersion, language }),
  { params: Promise.resolve({ assignmentId: target }) },
);
const setWork = (session: string, student: string, language: string | null, target = assignment) => WORK_POST(
  send(`${ORIGIN}/api/institution/assignments/${target}/students/${student}/work-language`, session, { language }),
  { params: Promise.resolve({ assignmentId: target, studentId: student }) },
);
const state = async () => {
  const version = (await admin.query(
    `SELECT a.current_version, count(v.*)::int AS rows,
            max(v.work_language) FILTER (WHERE v.version_no = a.current_version) AS language
       FROM institution.assignment a JOIN institution.assignment_version v ON v.assignment_id = a.id
      WHERE a.id = $1 GROUP BY a.current_version`, [assignment],
  )).rows[0] as { current_version: number; rows: number; language: string };
  const overrides = (await admin.query(
    "SELECT student_id, work_language FROM institution.work_language_override WHERE assignment_id = $1", [assignment],
  )).rows;
  return { ...version, overrides };
};

beforeAll(async () => {
  vi.stubEnv("OIDC_REDIRECT_URI", `${ORIGIN}/api/auth/callback`);
  const suffix = randomBytes(6).toString("hex");
  for (const [index, faculty] of faculties.entries()) {
    await admin.query("INSERT INTO identity.institution (id, slug) VALUES ($1, $2)", [faculty, `work-lang-${index}-${suffix}`]);
    await admin.query("INSERT INTO institution.institution_settings (institution_id, display_name) VALUES ($1, 'Izmisljeni fakultet test')", [faculty]);
  }
  for (const name of names) {
    const person = people[name], faculty = faculties[name === "outsider" ? 1 : 0];
    await admin.query(
      `INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
       VALUES ($1, $2, 'https://issuer.example', $3, $4)`, [person.id, faculty, `${suffix}-${name}`, `${suffix}-${name}@work-language-route.example`],
    );
    await admin.query(
      "INSERT INTO identity.session (token_hash, user_id, institution_id, expires_at) VALUES (sha256(convert_to($1, 'UTF8')), $2, $3, now()+interval '1 hour')",
      [person.token, person.id, faculty],
    );
    if (["teacher", "colleague", "outsider"].includes(name)) await admin.query(
      "INSERT INTO institution.institution_role (institution_id, user_id, role, confirmed_at) VALUES ($1, $2, 'teacher', now())", [faculty, person.id],
    );
  }
  const course = await withActor(people.teacher.token, async (tx) =>
    (await tx.query<{ id: string }>("SELECT institution.create_course('Izmisljeni kolegij', '2026/2027', 'encouraged') AS id")).rows[0].id);
  // The colleague teaches a course of its own, not this one.
  await withActor(people.colleague.token, (tx) => tx.query("SELECT institution.create_course('Izmisljeni drugi kolegij', '2026/2027', 'encouraged')"));
  await admin.query(
    "INSERT INTO institution.course_member (course_id, user_id, institution_id, role) VALUES ($1, $2, $3, 'student')", [course, people.student.id, faculties[0]],
  );
  assignment = await withActor(people.teacher.token, async (tx) => (await tx.query<{ id: string }>(
    "SELECT institution.create_assignment($1, $2, $3, $4, $5, $6, $7, $8::text[], $9, $10, $11, $12) AS id",
    [course, "Izmišljeni esej", "Upute za izmišljeni zadatak.", "essay", "2026-11-01T08:00:00Z", "2026-11-30T22:00:00Z",
      "partially_allowed", ["proofreading"], "basic", false, null, 3000],
  )).rows[0].id);
  documentId = `izmisljeni-rad-${suffix}`;
  const project = `project-${documentId}`, hash = (n: string) => n.repeat(64);
  // The document and its revisions name each other; the deferred keys need one transaction.
  const client = await admin.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO institution.notice_acknowledgment (assignment_id, version_no, student_id, institution_id) VALUES ($1, 1, $2, $3)",
      [assignment, people.student.id, faculties[0]],
    );
    await client.query(
      "INSERT INTO evidence.project (id, institution_id, assignment_id, principal_id) VALUES ($1, $2, $3, $4)",
      [project, faculties[0], assignment, people.student.id],
    );
    await client.query(
      `INSERT INTO evidence.document (id, institution_id, project_id, principal_id, current_revision, current_content_hash)
       VALUES ($1, $2, $3, $4, 1, $5)`, [documentId, faculties[0], project, people.student.id, hash("d")],
    );
    await client.query(
      `INSERT INTO evidence.document_revision (document_id, institution_id, revision, base_revision, principal_id, content_hash)
       VALUES ($1, $2, 0, NULL, $3, $4), ($1, $2, 1, 0, $3, $5)`, [documentId, faculties[0], people.student.id, hash("a"), hash("d")],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await app.end();
  const inFaculties = "SELECT a.id FROM institution.assignment a JOIN institution.course c ON c.id = a.course_id WHERE c.institution_id = ANY ($1)";
  await admin.query(`DELETE FROM institution.work_language_override WHERE assignment_id IN (${inFaculties})`, [faculties]);
  // A version is immutable, for the operator too; only this clean-up steps around the trigger.
  const cleaner = await admin.connect();
  try {
    await cleaner.query("BEGIN");
    await cleaner.query("SET LOCAL session_replication_role = replica");
    for (const table of ["evidence.document_revision", "evidence.document", "evidence.project", "institution.notice_acknowledgment"]) {
      await cleaner.query(`DELETE FROM ${table} WHERE institution_id = ANY ($1)`, [faculties]);
    }
    await cleaner.query(`DELETE FROM institution.assignment_version WHERE assignment_id IN (${inFaculties})`, [faculties]);
    await cleaner.query("COMMIT");
  } finally {
    cleaner.release();
  }
  await admin.query("DELETE FROM institution.notification WHERE institution_id = ANY ($1)", [faculties]);
  await admin.query("DELETE FROM institution.assignment WHERE course_id IN (SELECT id FROM institution.course WHERE institution_id = ANY ($1))", [faculties]);
  await admin.query("DELETE FROM institution.course_member WHERE institution_id = ANY ($1)", [faculties]);
  await admin.query("DELETE FROM institution.course WHERE institution_id = ANY ($1)", [faculties]);
  await admin.query("DELETE FROM institution.institution_role WHERE institution_id = ANY ($1)", [faculties]);
  await admin.query("DELETE FROM institution.institution_settings WHERE institution_id = ANY ($1)", [faculties]);
  await admin.query("DELETE FROM identity.session WHERE user_id = ANY ($1)", [ids]);
  await admin.query("DELETE FROM identity.user_account WHERE id = ANY ($1)", [ids]);
  await admin.query("DELETE FROM identity.institution WHERE id = ANY ($1)", [faculties]);
  await admin.end();
});

describe("work language routes: real POST, session and database (DAN-386)", () => {
  it("refuses everyone who is not a teacher of the work alike, and writes nothing", async () => {
    expect((await setAssignment(token(), 1, "en")).status).toBe(401);
    expect((await setWork(token(), people.student.id, "en")).status).toBe(401);
    for (const [session, target] of [[people.student.token, assignment], [people.colleague.token, assignment],
      [people.outsider.token, assignment], [people.teacher.token, randomUUID()]] as const) {
      for (const response of [await setAssignment(session, 1, "en", target), await setWork(session, people.student.id, "en", target)]) {
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({ error: "forbidden" });
      }
    }
    // A student who is not in the assignment looks like any other refusal.
    for (const student of [people.stranger.id, people.outsider.id, randomUUID()]) {
      const response = await setWork(people.teacher.token, student, "en");
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "forbidden" });
    }
    expect(await state()).toEqual({ current_version: 1, rows: 1, language: "hr", overrides: [] });
  });

  it("sets the assignment's language once; the same language and a stale version write nothing", async () => {
    const changed = await setAssignment(people.teacher.token, 1, "en");
    expect(changed.status).toBe(200);
    expect(changed.headers.get("cache-control")).toBe("no-store");
    expect(await changed.json()).toEqual({ version: 2 });
    const same = await setAssignment(people.teacher.token, 2, "en");
    expect(same.status).toBe(200);
    expect(await same.json()).toEqual({ version: 2 });
    const stale = await setAssignment(people.teacher.token, 1, "hr");
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: "conflict" });
    expect(await state()).toEqual({ current_version: 2, rows: 2, language: "en", overrides: [] });
  });

  it("sets one work's exception and with null removes it", async () => {
    const set = await setWork(people.teacher.token, people.student.id, "hr");
    expect(set.status).toBe(200);
    expect(set.headers.get("cache-control")).toBe("no-store");
    expect(await set.json()).toEqual({ language: "hr" });
    expect((await state()).overrides).toEqual([{ student_id: people.student.id, work_language: "hr" }]);
    const removed = await setWork(people.teacher.token, people.student.id, null);
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ language: "en" });
    expect(await state()).toEqual({ current_version: 2, rows: 2, language: "en", overrides: [] });
  });

  it("lets exactly one of two requests with the same expectedVersion write", async () => {
    const answers = await Promise.all([1, 2].map(() => setAssignment(people.teacher.token, 2, "hr")));
    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409]);
    const bodies = await Promise.all(answers.map((answer) => answer.json()));
    expect(bodies).toContainEqual({ version: 3 });
    expect(bodies).toContainEqual({ error: "conflict" });
    expect(await state()).toEqual({ current_version: 3, rows: 3, language: "hr", overrides: [] });
  });
});

describe("the page read of one work's language: real session and database (DAN-386, P02d)", () => {
  const read = (session: string | undefined, target: string, document: string) =>
    readWorkLanguageException(session, target, document, withActor);

  it("gives a teacher of the work its student, the assignment's language and the exception", async () => {
    const base = {
      kind: "available", assignmentId: assignment, documentId, studentId: people.student.id,
      title: "Izmišljeni esej", assignmentLanguage: "hr",
    };
    expect(await read(people.teacher.token, assignment, documentId)).toEqual({ ...base, exception: null });
    expect((await setWork(people.teacher.token, people.student.id, "en")).status).toBe(200);
    expect(await read(people.teacher.token, assignment.toUpperCase(), documentId)).toEqual({ ...base, exception: "en" });
    expect((await setWork(people.teacher.token, people.student.id, null)).status).toBe(200);
    expect(await read(people.teacher.token, assignment, documentId)).toEqual({ ...base, exception: null });
  });

  it("reads a missing, someone else's and a malformed id alike, as not found (#1836 c.6858862817)", async () => {
    // Not a teacher of the work: the student, a colleague, a stranger, another faculty's teacher.
    for (const name of ["student", "colleague", "stranger", "outsider"] as const) {
      expect(await read(people[name].token, assignment, documentId)).toEqual({ kind: "notFound" });
    }
    // The teacher, with an assignment or a work that does not exist, or ids that are not ids.
    for (const [target, document] of [[randomUUID(), documentId], [assignment, `${documentId}-x`], [assignment, people.student.id],
      ["1; DROP", documentId], [assignment, ""], [assignment, ` ${documentId}`]] as const) {
      expect(await read(people.teacher.token, target, document)).toEqual({ kind: "notFound" });
    }
    expect(await read(token(), assignment, documentId)).toEqual({ kind: "signedOut" });
    expect(await read(undefined, assignment, documentId)).toEqual({ kind: "signedOut" });
    expect((await state()).overrides).toEqual([]);
  });
});
