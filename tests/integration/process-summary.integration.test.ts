import { randomBytes, randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { InMemoryEvidencePayloadStore } from "@/adapters/evidence/in-memory-evidence-payload-store";
import { EDIT_STEP_FORMAT_V1 } from "@/domain/document/edit-step";
import { sha256WebCrypto } from "@/domain/forensics/crypto";
import {
  canonicalEvidenceSegmentV2,
  EVIDENCE_CANONICALIZATION_V2,
  EVIDENCE_HASH_ALGORITHM_V2,
  EVIDENCE_SEGMENT_SCHEMA_V2,
} from "@/domain/forensics/evidence-segment-v2";
import { createWithActor, type WithActor } from "@/server/db/with-actor";
import { handleProcessSummaryRequest } from "@/server/projection/process-summary";

// B-13 step 3 / DAN-85, PLAN-DEMO B-13 criterion: the owner and the teacher
// get the same bytes through the API (D-80 point 6), over the real read RPC
// under withActor. Loopback only; one random login and random synthetic
// rows, removed afterwards. Ana, Vesna and Dora are invented.
const SAFE_ADMIN_URL: string =
  process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(SAFE_ADMIN_URL).hostname)) {
  throw new Error("The process summary test runs only against a loopback database (DATABASE_URL).");
}
const ORIGIN = "http://localhost:3000";
const suffix = randomBytes(5).toString("hex");
const login = `it_summary_${suffix}`;
const password = randomBytes(24).toString("hex");
const institutionId = randomUUID();
const domainId = randomUUID();
const people = { vesna: randomUUID(), ana: randomUUID(), dora: randomUUID() };
const tokens = {
  vesna: randomBytes(32).toString("base64url"),
  ana: randomBytes(32).toString("base64url"),
  dora: randomBytes(32).toString("base64url"),
};
const courseId = randomUUID();
const assignmentId = randomUUID();
const projectId = `project-${suffix}`;
const documentId = `doc-${suffix}`;
const packageId = `pkg-${suffix}`;
const receiptId = randomUUID();

const admin = new pg.Pool({ connectionString: SAFE_ADMIN_URL, max: 1 });
const store = new InMemoryEvidencePayloadStore();
let appPool: pg.Pool;
let withActor: WithActor;
let fixtureReady = false;

async function segments() {
  const hash = (n: number) => n.toString(16).padStart(64, "0");
  const out: { id: string; payload: string; hash: string }[] = [];
  for (const [i, minute] of ["10:00", "10:20", "11:30"].entries()) {
    const at = `2026-10-20T${minute}:00.000Z`;
    const payload = canonicalEvidenceSegmentV2({
      evidenceSchema: EVIDENCE_SEGMENT_SCHEMA_V2,
      canonicalization: EVIDENCE_CANONICALIZATION_V2,
      hashAlgorithm: EVIDENCE_HASH_ALGORITHM_V2,
      documentId,
      sessionId: "session-ana",
      segmentId: `segment-${i + 1}`,
      sequenceFrom: i + 1,
      sequenceTo: i + 1,
      observedStartedAt: at,
      observedEndedAt: at,
      initialDocumentHash: hash(i + 1),
      finalDocumentHash: hash(i + 2),
      predecessorSegmentHash: out.at(-1)?.hash ?? null,
      events: [
        {
          sequence: i + 1,
          source: i === 1 ? "paste" : "editor",
          steps: [{ stepType: "replace", from: 1, to: 1, slice: { content: [{ type: "text", text: "Lorem ipsum" }] } }],
          beforeDocumentHash: hash(i + 1),
          afterDocumentHash: hash(i + 2),
        },
      ],
      captureContext: { editorModel: "prosemirror", transactionFormat: EDIT_STEP_FORMAT_V1 },
      evidenceProfileId: "standard-v1",
    });
    out.push({ id: `segment-${i + 1}`, payload, hash: await sha256WebCrypto(payload) });
  }
  return out;
}

async function insertFixture() {
  const record = await segments();
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
      `INSERT INTO institution.institution_role (institution_id, user_id, role, confirmed_at)
       VALUES ($1, $2, 'teacher', now())`,
      [institutionId, people.vesna],
    );
    await client.query(
      `INSERT INTO institution.course (id, institution_id, name, academic_year, ai_policy, created_by)
       VALUES ($1, $2, $3, '2026/2027', 'partially_allowed', $4)`,
      [courseId, institutionId, `Sazetak ${suffix}`, people.vesna],
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
       VALUES ($1, 1, 'Sazetak', 'Izmisljene upute.', 'essay', now() - interval '1 day',
               now() + interval '14 days', 'partially_allowed', ARRAY[]::text[], 'basic', false, $2)`,
      [assignmentId, people.vesna],
    );
    await client.query("INSERT INTO evidence.domain (id, institution_id, region) VALUES ($1, $2, 'eu-central-1')", [
      domainId,
      institutionId,
    ]);
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
    await client.query(
      `INSERT INTO evidence.package (id, institution_id, evidence_domain_id, document_id, project_id, principal_id,
         evidence_profile_id, max_payload_bytes)
       VALUES ($1, $2, $3, $4, $5, $6, 'standard-v1', 2097152)`,
      [packageId, institutionId, domainId, documentId, projectId, people.ana],
    );
    for (const [i, segment] of record.entries()) {
      const bytes = Buffer.byteLength(segment.payload, "utf8");
      await client.query(
        `INSERT INTO evidence.segment (id, evidence_package_id, institution_id, document_id, principal_id, session_id,
           sequence_from, sequence_to, event_count, descriptor, segment_hash, payload_bytes, storage_ref, accepted_at)
         VALUES ($1, $2, $3, $4, $5, 'session-ana', $6, $6, 1, $7::jsonb, $8, $9, $10, now() - interval '1 hour')`,
        [segment.id, packageId, institutionId, documentId, people.ana, i + 1,
          JSON.stringify({ segmentHash: segment.hash, payloadBytes: bytes }), segment.hash, bytes,
          `synthetic://${packageId}/${segment.id}`],
      );
      await store.putImmutable({ institutionId, evidencePackageId: packageId, segmentHash: segment.hash, canonicalPayload: segment.payload });
    }
    // The head reserve writes: a receipt for the last segment, named by the package.
    const last = record[record.length - 1];
    await client.query(
      `INSERT INTO evidence.receipt (id, evidence_package_id, institution_id, evidence_domain_id, segment_id,
         principal_id, client_request_id, payload_sha256, descriptor, receipt_payload, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'request-ana', $7, '{}', '{}', 'pending_signature')`,
      [receiptId, packageId, institutionId, domainId, last.id, people.ana, last.hash],
    );
    await client.query(
      `UPDATE evidence.package SET head_receipt_id = $1, head_segment_hash = $2, last_sequence_to = $3
        WHERE id = $4`,
      [receiptId, last.hash, record.length, packageId],
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
    // Disposable synthetic rows only; the append-only triggers stay active in
    // normal operation (same teardown as the other evidence tests).
    await admin.query("SET LOCAL session_replication_role = replica");
    await admin.query("DELETE FROM evidence.receipt WHERE evidence_package_id = $1", [packageId]);
    await admin.query("DELETE FROM evidence.segment WHERE evidence_package_id = $1", [packageId]);
    await admin.query("DELETE FROM evidence.package WHERE id = $1", [packageId]);
    await admin.query("DELETE FROM evidence.document_revision WHERE document_id = $1", [documentId]);
    await admin.query("DELETE FROM evidence.document WHERE id = $1", [documentId]);
    await admin.query("DELETE FROM evidence.project WHERE id = $1", [projectId]);
    await admin.query("DELETE FROM evidence.domain WHERE id = $1", [domainId]);
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

function ask(name: keyof typeof tokens) {
  const request = new Request(`${ORIGIN}/api/process-summary`, {
    method: "POST",
    headers: { origin: ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json" },
    body: JSON.stringify({ documentId }),
  });
  return handleProcessSummaryRequest(request, {
    withActor,
    payloads: store,
    thresholds: { sessionBreakAboveMinutes: 30, pasteListedAboveCharacters: 200 },
    expectedOrigin: ORIGIN,
    sessionToken: tokens[name],
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

describe("process summary over the API and the read RPC (B-13, D-80 point 6)", () => {
  it("gives Ana and Vesna the same bytes and Dora the answer for a missing document", async () => {
    const ana = await ask("ana");
    const vesna = await ask("vesna");
    expect(ana.status).toBe(200);
    expect(vesna.status).toBe(200);
    const [anaBytes, vesnaBytes] = await Promise.all([ana.arrayBuffer(), vesna.arrayBuffer()]);
    expect(Buffer.from(vesnaBytes).equals(Buffer.from(anaBytes))).toBe(true);
    expect(JSON.parse(Buffer.from(anaBytes).toString("utf8"))).toMatchObject({
      sessions: { count: 2, breakAboveMinutes: 30 },
      pastes: { listedAboveCharacters: 200, smallerCount: 1 },
      recordState: "complete",
    });

    const dora = await ask("dora");
    expect(dora.status).toBe(404);
    expect(await dora.json()).toStrictEqual({ error: "not_found" });
  });
});
