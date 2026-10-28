import { randomBytes, randomUUID } from "node:crypto";

import { NextRequest } from "next/server";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { POST } from "../../app/api/institution/assignments/[assignmentId]/versions/route";
import { createWithActor } from "@/server/db/with-actor";

// Real PostgreSQL and ductus_app login, with entirely invented fixtures (DAN-292).
const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus", max: 3 });
const app = new pg.Pool({ connectionString: process.env.APP_DATABASE_URL, max: 3, application_name: `assignment-version-${randomUUID()}` });
const withActor = createWithActor(app);
const ORIGIN = "https://assignment-version.example";
const faculties = [randomUUID(), randomUUID()];
const token = () => randomBytes(32).toString("base64url");
const names = ["teacher", "colleague", "student", "outsider"] as const;
type Name = typeof names[number];
const people = Object.fromEntries(names.map((name) => [name, { id: randomUUID(), token: token() }])) as Record<Name, { id: string; token: string }>;
const ids = Object.values(people).map((person) => person.id);
const CONTENT = {
  title: "Izmišljeni esej", instructions: "Upute za izmišljeni zadatak.", workType: "essay",
  opensAt: "2026-11-01T08:00:00Z", dueAt: "2026-11-30T22:00:00Z", aiPolicy: "partially_allowed",
  aiPurposes: ["proofreading"], evidenceProfile: "basic", importAllowed: false, wordMin: 500, wordMax: 3000,
};
let assignment: string;

const post = (session: string, expectedVersion: number, over: Record<string, unknown> = {}, target = assignment) => POST(new NextRequest(
  `${ORIGIN}/api/institution/assignments/${target}/versions`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json", cookie: `__Host-ductus_session=${session}` },
    body: JSON.stringify({ expectedVersion, ...CONTENT, ...over }),
  },
), { params: Promise.resolve({ assignmentId: target }) });
const versions = async () => (await admin.query(
  `SELECT a.current_version, count(v.*)::int AS rows, max(v.title) FILTER (WHERE v.version_no = a.current_version) AS title
     FROM institution.assignment a JOIN institution.assignment_version v ON v.assignment_id = a.id
    WHERE a.id = $1 GROUP BY a.current_version`, [assignment],
)).rows[0] as { current_version: number; rows: number; title: string };

beforeAll(async () => {
  vi.stubEnv("OIDC_REDIRECT_URI", `${ORIGIN}/api/auth/callback`);
  const suffix = randomBytes(6).toString("hex");
  for (const [index, faculty] of faculties.entries()) {
    await admin.query("INSERT INTO identity.institution (id, slug) VALUES ($1, $2)", [faculty, `asgn-version-${index}-${suffix}`]);
    await admin.query("INSERT INTO institution.institution_settings (institution_id, display_name) VALUES ($1, 'Izmisljeni fakultet test')", [faculty]);
  }
  for (const name of names) {
    const person = people[name], faculty = faculties[name === "outsider" ? 1 : 0];
    await admin.query(
      `INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
       VALUES ($1, $2, 'https://issuer.example', $3, $4)`, [person.id, faculty, `${suffix}-${name}`, `${suffix}-${name}@assignment-version.example`],
    );
    await admin.query(
      "INSERT INTO identity.session (token_hash, user_id, institution_id, expires_at) VALUES (sha256(convert_to($1, 'UTF8')), $2, $3, now()+interval '1 hour')",
      [person.token, person.id, faculty],
    );
    if (name !== "student") await admin.query(
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
  const c = CONTENT;
  assignment = await withActor(people.teacher.token, async (tx) => (await tx.query<{ id: string }>(
    "SELECT institution.create_assignment($1, $2, $3, $4, $5, $6, $7, $8::text[], $9, $10, $11, $12) AS id",
    [course, c.title, c.instructions, c.workType, c.opensAt, c.dueAt, c.aiPolicy, c.aiPurposes, c.evidenceProfile, c.importAllowed, c.wordMin, c.wordMax],
  )).rows[0].id);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await app.end();
  // A version is immutable, for the operator too; only this clean-up steps around the trigger.
  const cleaner = await admin.connect();
  try {
    await cleaner.query("BEGIN");
    await cleaner.query("SET LOCAL session_replication_role = replica");
    await cleaner.query(
      `DELETE FROM institution.assignment_version WHERE assignment_id IN (
         SELECT a.id FROM institution.assignment a JOIN institution.course c ON c.id = a.course_id WHERE c.institution_id = ANY ($1))`, [faculties],
    );
    await cleaner.query("COMMIT");
  } finally {
    cleaner.release();
  }
  await admin.query("DELETE FROM institution.assignment WHERE course_id IN (SELECT id FROM institution.course WHERE institution_id = ANY ($1))", [faculties]);
  await admin.query("DELETE FROM institution.course_member WHERE institution_id = ANY ($1)", [faculties]);
  await admin.query("DELETE FROM institution.course WHERE institution_id = ANY ($1)", [faculties]);
  await admin.query("DELETE FROM institution.institution_role WHERE institution_id = ANY ($1)", [faculties]);
  await admin.query("DELETE FROM institution.institution_settings WHERE institution_id = ANY ($1)", [faculties]);
  await admin.query("DELETE FROM institution.notification WHERE institution_id = ANY ($1)", [faculties]);
  await admin.query("DELETE FROM identity.session WHERE user_id = ANY ($1)", [ids]);
  await admin.query("DELETE FROM identity.user_account WHERE id = ANY ($1)", [ids]);
  await admin.query("DELETE FROM identity.institution WHERE id = ANY ($1)", [faculties]);
  await admin.end();
});

describe("new assignment version: real POST, session and database (DAN-292)", () => {
  it("refuses everyone who is not a teacher of the assignment alike, and writes nothing", async () => {
    expect((await post(token(), 1)).status).toBe(401);
    for (const [session, target] of [[people.student.token, assignment], [people.colleague.token, assignment],
      [people.outsider.token, assignment], [people.teacher.token, randomUUID()]] as const) {
      const response = await post(session, 1, {}, target);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "forbidden" });
    }
    expect(await versions()).toEqual({ current_version: 1, rows: 1, title: CONTENT.title });
  });

  it("publishes version 2 once; a stale version and a change rule 14 forbids write nothing", async () => {
    const created = await post(people.teacher.token, 1, { title: "Izmišljeni esej, druga verzija", wordMin: null });
    expect(created.status).toBe(201);
    expect(created.headers.get("cache-control")).toBe("no-store");
    expect(await created.json()).toEqual({ assignmentId: assignment, versionNo: 2 });
    const stale = await post(people.teacher.token, 1);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: "version_conflict" });
    for (const over of [{ aiPolicy: "encouraged" }, { wordMin: 100 }, { evidenceProfile: "extended" }]) {
      const response = await post(people.teacher.token, 2, { wordMin: null, ...over });
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: "invalid_input" });
    }
    expect(await versions()).toEqual({ current_version: 2, rows: 2, title: "Izmišljeni esej, druga verzija" });
    const events = await admin.query(
      "SELECT recipient_id, kind, target_id, event_key FROM institution.notification WHERE target_id = $1",
      [assignment],
    );
    expect(events.rows).toEqual([{
      recipient_id: people.student.id,
      kind: "assignment_version",
      target_id: assignment,
      event_key: `assignment_version:${assignment}:2`,
    }]);
  });

  it("lets exactly one of two requests with the same expectedVersion write", async () => {
    const answers = await Promise.all(["Treća A", "Treća B"].map((title) => post(people.teacher.token, 2, { title, wordMin: null })));
    expect(answers.map((answer) => answer.status).sort()).toEqual([201, 409]);
    const winner = answers[0].status === 201 ? "Treća A" : "Treća B";
    expect(await versions()).toEqual({ current_version: 3, rows: 3, title: winner });
    const events = await admin.query(
      "SELECT event_key FROM institution.notification WHERE target_id = $1 ORDER BY event_key", [assignment],
    );
    expect(events.rows).toEqual([
      { event_key: `assignment_version:${assignment}:2` },
      { event_key: `assignment_version:${assignment}:3` },
    ]);
  });
});
