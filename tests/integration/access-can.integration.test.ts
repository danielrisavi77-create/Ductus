import { randomBytes, randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWithActor, type WithActor } from "@/server/db/with-actor";

import { requireLoopbackDatabaseUrl } from "./loopback-database-url";

// DAN-351 (M2.7-P02, with M2.15-P03): institution.can(action, document) as a
// new caller reaches it, through the real withActor over a ductus_app login.
// db/tests/098 compares it with the legacy checks over every actor and work;
// this test holds the connection side: the actor comes only from the session
// of the token, it does not outlive the transaction on a pooled connection,
// and an unknown action fails the transaction loudly. Loopback only; one
// random login and random synthetic rows per run, removed afterwards. Vesna,
// Ana and Dora are invented.
const SAFE_ADMIN_URL: string =
  process.env.DATABASE_URL ??
  "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
requireLoopbackDatabaseUrl(
  SAFE_ADMIN_URL,
  "The can() test runs only against a loopback database (DATABASE_URL).",
);
const suffix = randomBytes(5).toString("hex");
const login = `it_access_can_${suffix}`;
const password = randomBytes(24).toString("hex");
const institutionId = randomUUID();
const people = { vesna: randomUUID(), ana: randomUUID(), dora: randomUUID() };
const tokens = {
  vesna: randomBytes(32).toString("base64url"),
  ana: randomBytes(32).toString("base64url"),
  dora: randomBytes(32).toString("base64url"),
};
const closedToken = randomBytes(32).toString("base64url");
const courseId = randomUUID();
const assignmentId = randomUUID();
const projectId = `project-${suffix}`;
const documentId = `doc-${suffix}`;
const ACTIONS = [
  "read",
  "comment",
  "open_fast_path",
  "write",
  "propose",
] as const;

const admin = new pg.Pool({ connectionString: SAFE_ADMIN_URL, max: 1 });
let appPool: pg.Pool;
let withActor: WithActor;
let fixtureReady = false;

async function insertFixture() {
  const client = await admin.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET CONSTRAINTS ALL DEFERRED");
    await client.query(
      "INSERT INTO identity.institution (id, slug) VALUES ($1, $2)",
      [institutionId, `it-${suffix}`],
    );
    for (const [name, id] of Object.entries(people)) {
      await client.query(
        `INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          id,
          institutionId,
          `https://issuer-${suffix}.test`,
          `sub-${name}`,
          `${name}@${suffix}.example`,
        ],
      );
      await client.query(
        `INSERT INTO identity.session (token_hash, user_id, institution_id, expires_at)
         VALUES (sha256(convert_to($1, 'UTF8')), $2, $3, now() + interval '1 hour')`,
        [tokens[name as keyof typeof tokens], id, institutionId],
      );
    }
    // Vesna's session that she has since closed.
    await client.query(
      `INSERT INTO identity.session (token_hash, user_id, institution_id, created_at, expires_at, closed_at, close_reason)
       VALUES (sha256(convert_to($1, 'UTF8')), $2, $3, now() - interval '1 hour', now() + interval '1 hour', now(), 'logout')`,
      [closedToken, people.vesna, institutionId],
    );
    await client.query(
      `INSERT INTO institution.institution_role (institution_id, user_id, role, confirmed_at)
       VALUES ($1, $2, 'teacher', now())`,
      [institutionId, people.vesna],
    );
    await client.query(
      `INSERT INTO institution.course (id, institution_id, name, academic_year, ai_policy, created_by)
       VALUES ($1, $2, $3, '2026/2027', 'partially_allowed', $4)`,
      [courseId, institutionId, `Odluka ${suffix}`, people.vesna],
    );
    for (const [name, role] of [
      ["vesna", "teacher"],
      ["ana", "student"],
      ["dora", "student"],
    ] as const) {
      await client.query(
        "INSERT INTO institution.course_member (course_id, institution_id, user_id, role) VALUES ($1, $2, $3, $4)",
        [courseId, institutionId, people[name], role],
      );
    }
    await client.query(
      `INSERT INTO institution.assignment (id, course_id, institution_id, current_version, created_by)
       VALUES ($1, $2, $3, 1, $4)`,
      [assignmentId, courseId, institutionId, people.vesna],
    );
    await client.query(
      `INSERT INTO institution.assignment_version
         (assignment_id, version_no, title, instructions, work_type, opens_at, due_at, ai_policy,
          ai_purposes, evidence_profile, import_allowed, created_by)
       VALUES ($1, 1, 'Esej', 'Izmisljene upute.', 'essay', now() - interval '1 day',
               now() + interval '14 days', 'partially_allowed', ARRAY[]::text[], 'basic', false, $2)`,
      [assignmentId, people.vesna],
    );
    await client.query(
      "INSERT INTO evidence.project (id, institution_id, assignment_id, principal_id) VALUES ($1, $2, $3, $4)",
      [projectId, institutionId, assignmentId, people.ana],
    );
    await client.query(
      `INSERT INTO evidence.document (id, institution_id, project_id, principal_id, current_revision,
         current_content_hash)
       VALUES ($1, $2, $3, $4, 0, $5)`,
      [documentId, institutionId, projectId, people.ana, "a".repeat(64)],
    );
    await client.query(
      `INSERT INTO evidence.document_revision (document_id, institution_id, revision, base_revision, principal_id,
         content_hash)
       VALUES ($1, $2, 0, NULL, $3, $4)`,
      [documentId, institutionId, people.ana, "a".repeat(64)],
    );
    await client.query("COMMIT");
    fixtureReady = true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function removeFixture() {
  if (!fixtureReady) return;
  await admin.query("BEGIN");
  try {
    // Disposable synthetic rows only (same teardown as the other evidence tests).
    await admin.query("SET LOCAL session_replication_role = replica");
    await admin.query(
      "DELETE FROM evidence.document_revision WHERE document_id = $1",
      [documentId],
    );
    await admin.query("DELETE FROM evidence.document WHERE id = $1", [
      documentId,
    ]);
    await admin.query("DELETE FROM evidence.project WHERE id = $1", [
      projectId,
    ]);
    await admin.query(
      "DELETE FROM institution.assignment_version WHERE assignment_id = $1",
      [assignmentId],
    );
    await admin.query("DELETE FROM institution.assignment WHERE id = $1", [
      assignmentId,
    ]);
    await admin.query(
      "DELETE FROM institution.course_member WHERE course_id = $1",
      [courseId],
    );
    await admin.query("DELETE FROM institution.course WHERE id = $1", [
      courseId,
    ]);
    await admin.query(
      "DELETE FROM institution.institution_role WHERE institution_id = $1",
      [institutionId],
    );
    await admin.query(
      "DELETE FROM identity.session WHERE institution_id = $1",
      [institutionId],
    );
    await admin.query(
      "DELETE FROM identity.user_account WHERE institution_id = $1",
      [institutionId],
    );
    await admin.query("DELETE FROM identity.institution WHERE id = $1", [
      institutionId,
    ]);
    await admin.query("COMMIT");
  } catch (error) {
    await admin.query("ROLLBACK");
    throw error;
  }
}

/** Every action for one token, as `action:true|false`, in one withActor transaction. */
function decisions(token: string | null) {
  return withActor(token, async (tx) => {
    const out: string[] = [];
    for (const action of ACTIONS) {
      const row = await tx.query<{ can: boolean }>(
        "SELECT institution.can($1, $2) AS can",
        [action, documentId],
      );
      out.push(`${action}:${row.rows[0].can}`);
    }
    return out;
  });
}

beforeAll(async () => {
  const ddl = await admin.query<{ ddl: string }>(
    "SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L IN ROLE ductus_app', $1::text, $2::text) AS ddl",
    [login, password],
  );
  await admin.query(ddl.rows[0].ddl);
  await insertFixture();
  const url = new URL(SAFE_ADMIN_URL);
  url.username = login;
  url.password = password;
  // One connection, so every call below reuses the one before it.
  appPool = new pg.Pool({ connectionString: url.href, max: 1 });
  withActor = createWithActor(appPool);
});

afterAll(async () => {
  await appPool?.end();
  let cleanupError: unknown;
  try {
    await removeFixture();
  } catch (error) {
    cleanupError = error;
  }
  try {
    const drop = await admin.query<{ ddl: string }>(
      "SELECT format('DROP ROLE IF EXISTS %I', $1::text) AS ddl",
      [login],
    );
    await admin.query(drop.rows[0].ddl);
  } finally {
    await admin.end();
  }
  if (cleanupError) throw cleanupError;
});

describe("institution.can under withActor (DAN-351)", () => {
  it("answers for the actor of the token: the teacher, the owner and another student of the course", async () => {
    expect(await decisions(tokens.vesna)).toStrictEqual([
      "read:true",
      "comment:true",
      "open_fast_path:true",
      "write:false",
      "propose:true",
    ]);
    expect(await decisions(tokens.ana)).toStrictEqual([
      "read:true",
      "comment:false",
      "open_fast_path:false",
      "write:true",
      "propose:false",
    ]);
    expect(await decisions(tokens.dora)).toStrictEqual(
      ACTIONS.map((action) => `${action}:false`),
    );
  });

  it("is false for every action without a token, with a malformed one and with a closed session", async () => {
    const none = ACTIONS.map((action) => `${action}:false`);
    expect(await decisions(null)).toStrictEqual(none);
    expect(await decisions("not-a-token")).toStrictEqual(none);
    expect(await decisions(closedToken)).toStrictEqual(none);
  });

  it("does not keep the actor on the pooled connection after the transaction", async () => {
    expect(await decisions(tokens.vesna)).toContain("read:true");
    // The same, only connection, outside withActor: no session token is left on it.
    const after = await appPool.query<{ can: boolean }>(
      "SELECT institution.can('read', $1) AS can",
      [documentId],
    );
    expect(after.rows[0].can).toBe(false);
    // And the next actor on it gets their own answer, not the one before.
    expect(await decisions(tokens.dora)).toContain("read:false");
  });

  it("fails an unknown action with ZD422 and rolls the transaction back", async () => {
    await expect(
      withActor(tokens.vesna, async (tx) => {
        await tx.query("SELECT institution.can('read', $1)", [documentId]);
        return tx.query("SELECT institution.can('delete', $1)", [documentId]);
      }),
    ).rejects.toMatchObject({ code: "ZD422" });
    // The connection is clean for the next call.
    expect(await decisions(tokens.ana)).toContain("write:true");
  });
});
