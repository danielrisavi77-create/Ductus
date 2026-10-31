import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { expect, it } from "vitest";

// K-3b2 / DAN-88 (#635): db/local/demo-k3.sql, the file `pnpm local:up` loads,
// run twice through the same psql path inside one transaction that is rolled
// back, so CI checks it without leaving a confirmed teacher for the E2E tests.
const ADMIN_URL = process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
const root = fileURLToPath(new URL("../../", import.meta.url));
const k3 = readFileSync(new URL("../../db/local/demo-k3.sql", import.meta.url), "utf8");

function requireLocalStack() {
  const url = new URL(ADMIN_URL);
  if (url.protocol !== "postgres:" || url.hostname !== "127.0.0.1" || url.port !== "54329" ||
      url.pathname !== "/ductus" || url.username !== "ductus" || url.search || url.hash) {
    throw new Error("DATABASE_URL must target the local Compose database");
  }
  if (process.env.DOCKER_HOST || process.env.DOCKER_CONTEXT || process.env.COMPOSE_FILE ||
      (process.env.COMPOSE_PROJECT_NAME && process.env.COMPOSE_PROJECT_NAME !== "ductus")) {
    throw new Error("The K-3 data test requires the local ductus Compose project");
  }
  const endpoint = execFileSync("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"],
    { encoding: "utf8" }).trim();
  if (!endpoint.startsWith("unix://") && !endpoint.startsWith("npipe://")) {
    throw new Error("The K-3 data test requires a local Docker socket");
  }
}

// Everything K-3 writes, for the three demo accounts, as the compose superuser sees it.
const SNAPSHOT = `
WITH u AS (
  SELECT u.id, u.oidc_subject FROM identity.user_account u
   WHERE u.oidc_issuer = 'http://localhost:8090'
     AND u.oidc_subject IN ('demo-teacher', 'demo-student', 'demo-student-2')),
t AS (SELECT id FROM u WHERE oidc_subject = 'demo-teacher'),
c AS (SELECT c.id FROM institution.course c, t
       WHERE c.created_by = t.id AND c.academic_year = '2026/2027'
         AND c.name = 'Lokalne javne politike (izmišljeni kolegij)'),
a AS (SELECT a.id, a.course_id, a.current_version FROM institution.assignment a, t
       WHERE a.created_by = t.id AND a.request_id = 'c3b20000-0000-4000-8000-000000000001')
SELECT json_build_object(
  'accounts', (SELECT count(*) FROM u),
  'teacherRoles', (SELECT count(*) FROM institution.institution_role r, t
                    WHERE r.user_id = t.id AND r.role = 'teacher' AND r.confirmed_at IS NOT NULL AND r.revoked_at IS NULL),
  'courses', (SELECT json_agg(id) FROM c),
  'assignments', (SELECT json_agg(id) FROM a),
  'assignmentInCourse', (SELECT bool_and(a.course_id IN (SELECT id FROM c)) FROM a),
  'versions', (SELECT json_agg(json_build_object('no', v.version_no, 'workType', v.work_type, 'aiPolicy', v.ai_policy,
                 'importAllowed', v.import_allowed, 'wordMin', v.word_min, 'wordMax', v.word_max))
                 FROM institution.assignment_version v JOIN a ON a.id = v.assignment_id),
  'students', (SELECT count(*) FROM institution.course_member m JOIN u ON u.id = m.user_id
                WHERE m.course_id IN (SELECT id FROM c) AND m.role = 'student' AND m.member_to IS NULL
                  AND u.oidc_subject <> 'demo-teacher'),
  'memberships', (SELECT count(*) FROM institution.course_member m WHERE m.course_id IN (SELECT id FROM c)),
  'acknowledgments', (SELECT count(*) FROM institution.notice_acknowledgment n JOIN a ON a.id = n.assignment_id
                       AND n.version_no = a.current_version),
  'codes', (SELECT count(*) FROM institution.course_enrollment_code e WHERE e.course_id IN (SELECT id FROM c)),
  'activeCodes', (SELECT count(*) FROM institution.course_enrollment_code e WHERE e.course_id IN (SELECT id FROM c) AND e.active),
  'attempts', (SELECT count(*) FROM institution.enrollment_attempt x JOIN u ON u.id = x.user_id),
  'openSessions', (SELECT count(*) FROM identity.session s JOIN u ON u.id = s.user_id WHERE s.closed_at IS NULL),
  'sessions', (SELECT count(*) FROM identity.session s JOIN u ON u.id = s.user_id),
  'documents', (SELECT count(*) FROM evidence.document d JOIN u ON u.id = d.principal_id),
  'role', current_user
);`;

type Snapshot = {
  accounts: number; teacherRoles: number; courses: string[] | null; assignments: string[] | null;
  assignmentInCourse: boolean | null; versions: unknown[] | null; students: number; memberships: number;
  acknowledgments: number; codes: number; activeCodes: number; attempts: number; openSessions: number;
  sessions: number; documents: number; role: string;
};

it("loads the K-3 course, assignment and enrolment through the RPCs, and a rerun adds nothing (#635)", () => {
  requireLocalStack();
  const input = ["BEGIN;", SNAPSHOT, k3, SNAPSHOT, k3, SNAPSHOT, "ROLLBACK;", ""].join("\n");
  const output = execFileSync("docker",
    ["compose", "exec", "-T", "postgres", "psql", "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-U", "ductus", "-d", "ductus"],
    { cwd: root, input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  const [before, first, second] = output.split(/\r?\n/).filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as Snapshot);

  expect(first).toMatchObject({
    accounts: 3, teacherRoles: 1, assignmentInCourse: true, students: 2, memberships: 3,
    acknowledgments: 2, activeCodes: 0, openSessions: 0, documents: before.documents, role: "ductus",
  });
  expect(first.courses).toHaveLength(1);
  expect(first.assignments).toHaveLength(1);
  expect(first.versions).toEqual([{
    no: 1, workType: "seminar_paper", aiPolicy: "partially_allowed", importAllowed: false, wordMin: 1500, wordMax: 2500,
  }]);
  // Three sign-ins and sign-outs; no wrong code was counted.
  expect(first.sessions).toBe(before.sessions + 3);
  expect(first.attempts).toBe(before.attempts);

  // The rerun: the same rows, no new code, three more closed sessions only.
  expect({ ...second, sessions: 0 }).toEqual({ ...first, sessions: 0 });
  expect(second.sessions).toBe(first.sessions + 3);
});

it("refuses to run anywhere but over the compose socket as the superuser (#635)", async () => {
  requireLocalStack();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    // The same superuser over TCP: inet_server_addr() is set, so the guard stops the file first.
    await expect(admin.query(k3)).rejects.toThrow("K-3 demo data is local compose only");
  } finally {
    await admin.end();
  }
});
