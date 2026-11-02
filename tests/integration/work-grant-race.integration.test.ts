import { randomBytes, randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWithActor, type WithActor } from "@/server/db/with-actor";

import { requireLoopbackDatabaseUrl } from "./loopback-database-url";

// DAN-379 (M2.8-P01): a grant to a co-mentor or a committee member is decided
// at the time of each statement, never cached. db/tests/102 covers expiry and
// revocation inside one transaction of one connection; this test holds the
// other side: a revocation committed from another connection closes access at
// the grantee's next statement, inside the transaction that already read it,
// and two revocations racing each other revoke exactly once. Loopback only;
// one random login and random synthetic rows per run, removed afterwards.
// Vesna, Ana and Hana are invented.
const SAFE_ADMIN_URL: string =
  process.env.DATABASE_URL ??
  "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
requireLoopbackDatabaseUrl(
  SAFE_ADMIN_URL,
  "The grant race test runs only against a loopback database (DATABASE_URL).",
);
const suffix = randomBytes(5).toString("hex");
const login = `it_work_grant_${suffix}`;
const password = randomBytes(24).toString("hex");
const institutionId = randomUUID();
const people = { vesna: randomUUID(), ana: randomUUID(), hana: randomUUID() };
const tokens = {
  vesna: randomBytes(32).toString("base64url"),
  ana: randomBytes(32).toString("base64url"),
  hana: randomBytes(32).toString("base64url"),
};
const courseId = randomUUID();
const assignmentId = randomUUID();
const projectId = `project-${suffix}`;
const documentId = `doc-${suffix}`;

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
    for (const teacher of [people.vesna, people.hana]) {
      await client.query(
        `INSERT INTO institution.institution_role (institution_id, user_id, role, confirmed_at)
         VALUES ($1, $2, 'teacher', now())`,
        [institutionId, teacher],
      );
    }
    await client.query(
      `INSERT INTO institution.course (id, institution_id, name, academic_year, ai_policy, created_by)
       VALUES ($1, $2, $3, '2026/2027', 'partially_allowed', $4)`,
      [courseId, institutionId, `Pristup ${suffix}`, people.vesna],
    );
    for (const [name, role] of [
      ["vesna", "teacher"],
      ["ana", "student"],
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
      "DELETE FROM institution.work_grant WHERE institution_id = $1",
      [institutionId],
    );
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

function grantCan(token: string, action: string) {
  return withActor(token, async (tx) => {
    const row = await tx.query<{ can: boolean }>(
      "SELECT institution.grant_can($1, $2) AS can",
      [action, documentId],
    );
    return row.rows[0].can;
  });
}

function grant() {
  return withActor(tokens.vesna, async (tx) => {
    const row = await tx.query<{ id: string }>(
      `SELECT institution.grant_work_access($1, $2, $3, 'committee', '{read_text}', NULL,
                                            now() + interval '1 day') AS id`,
      [assignmentId, people.ana, people.hana],
    );
    return row.rows[0].id;
  });
}

function revoke(grantId: string) {
  return withActor(tokens.vesna, async (tx) => {
    const row = await tx.query<{ revoked: boolean }>(
      "SELECT institution.revoke_work_access($1) AS revoked",
      [grantId],
    );
    return row.rows[0].revoked;
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
  // Two connections: the grantee's transaction stays open on one while the
  // revocation commits on the other.
  appPool = new pg.Pool({ connectionString: url.href, max: 2 });
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

describe("work grants under withActor (DAN-379)", () => {
  it("gives the grantee only the granted action, and nobody else anything", async () => {
    const grantId = await grant();
    try {
      expect(await grantCan(tokens.hana, "read_text")).toBe(true);
      expect(await grantCan(tokens.hana, "comment")).toBe(false);
      // The teacher and the student have their access through can(), not a grant.
      expect(await grantCan(tokens.vesna, "read_text")).toBe(false);
      expect(await grantCan(tokens.ana, "read_text")).toBe(false);
    } finally {
      await revoke(grantId);
    }
  });

  it("closes access at the grantee's next statement when another connection revokes", async () => {
    const grantId = await grant();
    // The grantee's transaction is held open on its own ductus_app
    // connection (withActor does not nest), with the token set as withActor
    // sets it; the revocation commits through withActor on the other one.
    const client = await appPool.connect();
    let seen: { before: boolean; revoked: boolean; after: boolean };
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_catalog.set_config('app.session_token', $1, true)",
        [tokens.hana],
      );
      const ask = async () =>
        (
          await client.query<{ can: boolean }>(
            "SELECT institution.grant_can('read_text', $1) AS can",
            [documentId],
          )
        ).rows[0].can;
      const before = await ask();
      const revoked = await revoke(grantId);
      const after = await ask();
      await client.query("COMMIT");
      seen = { before, revoked, after };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    expect(seen).toStrictEqual({ before: true, revoked: true, after: false });
    expect(await grantCan(tokens.hana, "read_text")).toBe(false);
    // A second revocation changes nothing.
    expect(await revoke(grantId)).toBe(false);
  });

  it("revokes exactly once when two revocations race", async () => {
    const grantId = await grant();
    const results = await Promise.all([revoke(grantId), revoke(grantId)]);
    expect([...results].sort()).toStrictEqual([false, true]);
    const row = await admin.query<{ revoked: number }>(
      "SELECT count(*)::int AS revoked FROM institution.work_grant WHERE id = $1 AND revoked_at IS NOT NULL",
      [grantId],
    );
    expect(row.rows[0].revoked).toBe(1);
    expect(await grantCan(tokens.hana, "read_text")).toBe(false);
  });
});
