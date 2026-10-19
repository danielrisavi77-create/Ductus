import { createHash, randomBytes, randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { loadGoldenVectors } from "@/domain/forensics/golden-vectors/load";
import { canonicalizeJcs } from "@/domain/forensics/jcs";
import { handleLivePublishRequest, handleLiveReadRequest } from "@/server/collaboration/live-route";
import { createWithActor, type WithActor } from "@/server/db/with-actor";

// B-LIVE step 3 (DAN-216, BACKEND 4.12 point 6): the live view route over the
// real RPCs under withActor. The owner and the teacher read the same bytes
// through the API (rule 5); only the owner who acknowledged the notice
// publishes; a stale token never overwrites a newer state. Loopback only; one
// random login and random synthetic rows per run, removed afterwards. Ana,
// Vesna and Dora are invented.
const SAFE_ADMIN_URL: string =
  process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(SAFE_ADMIN_URL).hostname)) {
  throw new Error("The live view test runs only against a loopback database (DATABASE_URL).");
}
const ORIGIN = "http://localhost:3000";
const suffix = randomBytes(5).toString("hex");
const login = `it_live_${suffix}`;
const password = randomBytes(24).toString("hex");
const institutionId = randomUUID();
const people = { vesna: randomUUID(), ana: randomUUID(), dora: randomUUID() };
const tokens = {
  vesna: randomBytes(32).toString("base64url"),
  ana: randomBytes(32).toString("base64url"),
  dora: randomBytes(32).toString("base64url"),
};
const expiredToken = randomBytes(32).toString("base64url");
const courseId = randomUUID();
const assignmentId = randomUUID();
const projectId = `project-${suffix}`;
const documentId = `doc-${suffix}`;

// Two invented document states of the golden chain, as exact JCS bytes.
const states = loadGoldenVectors().chain.documentStates;
const FIRST = Buffer.from(canonicalizeJcs(states[0]?.value), "utf8");
const SECOND = Buffer.from(canonicalizeJcs(states[states.length - 1]?.value), "utf8");
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Every text of a document, for the log canary: none may reach a log line. */
function texts(value: unknown): string[] {
  if (typeof value === "string") return [];
  if (Array.isArray(value)) return value.flatMap(texts);
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, inner]) =>
      key === "text" && typeof inner === "string" && inner.length >= 4 ? [inner] : texts(inner));
  }
  return [];
}

const admin = new pg.Pool({ connectionString: SAFE_ADMIN_URL, max: 1 });
let appPool: pg.Pool | undefined;
let withActor: WithActor;
let fixtureReady = false;

async function insertFixture() {
  const client = await admin.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET CONSTRAINTS ALL DEFERRED");
    await client.query("INSERT INTO identity.institution (id, slug) VALUES ($1, $2)", [institutionId, `it-${suffix}`]);
    for (const [name, id] of Object.entries(people)) {
      await client.query(
        `INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, institutionId, `https://issuer-${suffix}.test`, `sub-${name}`, `${name}@${suffix}.example`],
      );
      await client.query(
        `INSERT INTO identity.session (token_hash, user_id, institution_id, expires_at)
         VALUES (sha256(convert_to($1, 'UTF8')), $2, $3, now() + interval '1 hour')`,
        [tokens[name as keyof typeof tokens], id, institutionId],
      );
    }
    await client.query(
      `INSERT INTO identity.session (token_hash, user_id, institution_id, created_at, expires_at)
       VALUES (sha256(convert_to($1, 'UTF8')), $2, $3, now() - interval '2 hours', now() - interval '1 hour')`,
      [expiredToken, people.ana, institutionId],
    );
    await client.query(
      `INSERT INTO institution.institution_role (institution_id, user_id, role, confirmed_at)
       VALUES ($1, $2, 'teacher', now())`,
      [institutionId, people.vesna],
    );
    await client.query(
      `INSERT INTO institution.course (id, institution_id, name, academic_year, ai_policy, created_by)
       VALUES ($1, $2, $3, '2026/2027', 'partially_allowed', $4)`,
      [courseId, institutionId, `Uzivo ${suffix}`, people.vesna],
    );
    for (const [name, role] of [["vesna", "teacher"], ["ana", "student"], ["dora", "student"]] as const) {
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
       VALUES ($1, 1, 'Uzivo', 'Izmisljene upute.', 'essay', now() - interval '1 day',
               now() + interval '14 days', 'partially_allowed', ARRAY[]::text[], 'basic', false, $2)`,
      [assignmentId, people.vesna],
    );
    await client.query(
      "INSERT INTO evidence.project (id, institution_id, assignment_id, principal_id) VALUES ($1, $2, $3, $4)",
      [projectId, institutionId, assignmentId, people.ana],
    );
    await client.query(
      `INSERT INTO evidence.document (id, institution_id, project_id, principal_id, current_content_hash)
       VALUES ($1, $2, $3, $4, $5)`,
      [documentId, institutionId, projectId, people.ana, "a".repeat(64)],
    );
    await client.query(
      `INSERT INTO evidence.document_revision (document_id, institution_id, revision, principal_id, content_hash)
       VALUES ($1, $2, 0, $3, $4)`,
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
    await admin.query("DELETE FROM collaboration.live_state WHERE institution_id = $1", [institutionId]);
    await admin.query("DELETE FROM evidence.document_revision WHERE document_id = $1", [documentId]);
    await admin.query("DELETE FROM evidence.document WHERE id = $1", [documentId]);
    await admin.query("DELETE FROM evidence.project WHERE id = $1", [projectId]);
    await admin.query("DELETE FROM institution.notice_acknowledgment WHERE assignment_id = $1", [assignmentId]);
    await admin.query("DELETE FROM institution.assignment_version WHERE assignment_id = $1", [assignmentId]);
    await admin.query("DELETE FROM institution.assignment WHERE id = $1", [assignmentId]);
    await admin.query("DELETE FROM institution.course_member WHERE course_id = $1", [courseId]);
    await admin.query("DELETE FROM institution.course WHERE id = $1", [courseId]);
    await admin.query("DELETE FROM institution.institution_role WHERE institution_id = $1", [institutionId]);
    await admin.query("DELETE FROM identity.session WHERE institution_id = $1", [institutionId]);
    await admin.query("DELETE FROM identity.user_account WHERE institution_id = $1", [institutionId]);
    await admin.query("DELETE FROM identity.institution WHERE id = $1", [institutionId]);
    await admin.query("COMMIT");
  } catch (error) {
    await admin.query("ROLLBACK");
    throw error;
  }
}

function put(sessionToken: string, body: Uint8Array, precondition: Record<string, string>) {
  const request = new Request(`${ORIGIN}/api/live/${documentId}`, {
    method: "PUT",
    headers: { origin: ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json", ...precondition },
    body: Buffer.from(body),
  });
  return handleLivePublishRequest(request, documentId, { withActor, expectedOrigin: ORIGIN, sessionToken });
}

function get(sessionToken: string, id = documentId, headers: Record<string, string> = {}) {
  const request = new Request(`${ORIGIN}/api/live/${id}`, { headers: { "sec-fetch-site": "same-origin", ...headers } });
  return handleLiveReadRequest(request, id, { withActor, sessionToken });
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
    const drop = await admin.query<{ ddl: string }>("SELECT format('DROP ROLE IF EXISTS %I', $1::text) AS ddl", [login]);
    await admin.query(drop.rows[0].ddl);
  } finally {
    await admin.end();
  }
  if (cleanupError) throw cleanupError;
});

describe("live view over the API and the RPCs (B-LIVE step 3, rule 5)", () => {
  it("publishes only for the owner who acknowledged the notice, reads the same bytes for her and the teacher, and keeps a newer state", async () => {
    const log = vi.spyOn(console, "error");
    const warn = vi.spyOn(console, "warn");

    // Before the notice is acknowledged: no publishing, reading answers empty.
    const early = await put(tokens.ana, FIRST, { "if-none-match": "*" });
    expect([early.status, await early.json()]).toStrictEqual([404, { error: "not_found" }]);
    expect((await get(tokens.vesna)).status).toBe(204);
    await admin.query(
      "INSERT INTO institution.notice_acknowledgment (assignment_id, version_no, student_id, institution_id) VALUES ($1, 1, $2, $3)",
      [assignmentId, people.ana, institutionId],
    );

    // A token for a state that does not exist yet is a conflict with no token.
    const none = await put(tokens.ana, FIRST, { "if-match": `"${randomUUID()}"` });
    expect([none.status, await none.json()]).toStrictEqual([409, { outcome: "conflict", token: null }]);

    const first = await put(tokens.ana, FIRST, { "if-none-match": "*" });
    expect(first.status).toBe(200);
    const accepted = (await first.json()) as { outcome: string; token: string };
    expect(accepted.outcome).toBe("accepted");

    // One reading for the owner and the teacher: status, ETag and bytes.
    const [ana, vesna] = [await get(tokens.ana), await get(tokens.vesna)];
    for (const answer of [ana, vesna]) {
      expect(answer.status).toBe(200);
      expect(answer.headers.get("etag")).toBe(`"${sha256(FIRST)}"`);
      expect(answer.headers.get("cache-control")).toBe("no-store");
    }
    const [anaBytes, vesnaBytes] = [Buffer.from(await ana.arrayBuffer()), Buffer.from(await vesna.arrayBuffer())];
    expect(anaBytes.equals(FIRST)).toBe(true);
    expect(vesnaBytes.equals(anaBytes)).toBe(true);
    const same = await get(tokens.vesna, documentId, { "if-none-match": `"${sha256(FIRST)}"` });
    expect([same.status, await same.text()]).toStrictEqual([304, ""]);

    // A stale token never overwrites; the same body with it only refreshes the token.
    const stale = await put(tokens.ana, SECOND, { "if-match": `"${randomUUID()}"` });
    expect([stale.status, await stale.json()]).toStrictEqual([409, { outcome: "conflict", token: accepted.token }]);
    const repeat = await put(tokens.ana, FIRST, { "if-match": `"${randomUUID()}"` });
    expect([repeat.status, await repeat.json()]).toStrictEqual([200, { outcome: "unchanged", token: accepted.token }]);
    const again = await put(tokens.ana, SECOND, { "if-none-match": "*" });
    expect([again.status, await again.json()]).toStrictEqual([409, { outcome: "conflict", token: accepted.token }]);
    expect(Buffer.from(await (await get(tokens.vesna)).arrayBuffer()).equals(FIRST)).toBe(true);

    const next = await put(tokens.ana, SECOND, { "if-match": `"${accepted.token}"` });
    expect(next.status).toBe(200);
    expect(((await next.json()) as { outcome: string }).outcome).toBe("accepted");
    const changed = await get(tokens.vesna, documentId, { "if-none-match": `"${sha256(FIRST)}"` });
    expect([changed.status, changed.headers.get("etag")]).toStrictEqual([200, `"${sha256(SECOND)}"`]);
    expect(Buffer.from(await changed.arrayBuffer()).equals(SECOND)).toBe(true);

    // Nobody else publishes; the classmate reads nothing; a missing document is the same answer.
    for (const response of [
      await put(tokens.vesna, FIRST, { "if-none-match": "*" }),
      await put(tokens.dora, FIRST, { "if-none-match": "*" }),
      await get(tokens.dora),
      await get(tokens.vesna, `doc-nema-${suffix}`),
    ]) {
      expect([response.status, await response.json()]).toStrictEqual([404, { error: "not_found" }]);
    }
    // A session that is not open is told to sign in again.
    for (const response of [await get(expiredToken), await put(expiredToken, FIRST, { "if-none-match": "*" })]) {
      expect([response.status, await response.json()]).toStrictEqual([401, { error: "unauthorized" }]);
    }

    // Log canary: no text of the work reaches a log line.
    const lines = JSON.stringify([...log.mock.calls, ...warn.mock.calls]);
    const canary = [...texts(states[0]?.value), ...texts(states[states.length - 1]?.value)];
    expect(FIRST.equals(SECOND)).toBe(false);
    expect(canary.length).toBeGreaterThan(0);
    for (const text of canary) {
      expect(lines).not.toContain(text);
    }
  });
});
