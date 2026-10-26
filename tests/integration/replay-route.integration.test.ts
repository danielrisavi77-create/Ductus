import { randomBytes, randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { InstitutionRoutedPayloadStore } from "@/adapters/evidence/institution-routed-payload-store";
import { STORAGE_IDENTITY_KEY } from "@/adapters/evidence/s3-evidence-payload-store";
import { signS3Request } from "@/adapters/evidence/s3-signature";
import { EDIT_STEP_FORMAT_V1 } from "@/domain/document/edit-step";
import { REVISION_ZERO_JCS, REVISION_ZERO_SHA256 } from "@/domain/document/revision-zero";
import { sha256WebCrypto } from "@/domain/forensics/crypto";
import {
  canonicalEvidenceSegmentV2,
  EVIDENCE_CANONICALIZATION_V2,
  EVIDENCE_HASH_ALGORITHM_V2,
  EVIDENCE_SEGMENT_SCHEMA_V2,
} from "@/domain/forensics/evidence-segment-v2";
import { createWithActor, type WithActor } from "@/server/db/with-actor";
import { createEvidencePayloadReader } from "@/server/evidence/payload-reader";
import { handleReplayRequest } from "@/server/evidence/replay-route";

// DAN-344 PR A (contract on #923): the owner and the teacher get the same
// replay bytes through the API (PRODUCT 5 rule 5), over the real read RPCs
// under withActor and the payloads stored in the local S3 store of
// compose.yaml. Loopback only; one random login, one bucket and random
// synthetic rows per run (database rows removed afterwards). Ana, Vesna and
// Dora are invented.
const SAFE_ADMIN_URL: string =
  process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(SAFE_ADMIN_URL).hostname)) {
  throw new Error("The replay test runs only against a loopback database (DATABASE_URL).");
}
const ORIGIN = "http://localhost:3000";
const suffix = randomBytes(5).toString("hex");
const login = `it_replay_${suffix}`;
const password = randomBytes(24).toString("hex");
const institutionId = randomUUID();
const domainId = randomUUID();
const people = { vesna: randomUUID(), ana: randomUUID(), dora: randomUUID() };
const tokens = {
  vesna: randomBytes(32).toString("base64url"),
  ana: randomBytes(32).toString("base64url"),
  dora: randomBytes(32).toString("base64url"),
};
// Ana's sessions that are no longer open, and a token that never was one (DAN-85).
const notOpen = {
  expired: randomBytes(32).toString("base64url"),
  closed: randomBytes(32).toString("base64url"),
  unknown: randomBytes(32).toString("base64url"),
};
const courseId = randomUUID();
const assignmentId = randomUUID();
const projectId = `project-${suffix}`;
const documentId = `doc-${suffix}`;
const packageId = `pkg-${suffix}`;
const receiptId = randomUUID();
const S3_ENDPOINT = process.env.S3_ENDPOINT ?? "http://127.0.0.1:9100";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(S3_ENDPOINT).hostname)) {
  throw new Error("The replay test runs only against the local object store (S3_ENDPOINT).");
}
const s3Credentials = {
  accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "ductus-local",
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "ductus-local-only",
};
const region = "us-east-1";
const bucket = `ductus-replay-${suffix}`;

const admin = new pg.Pool({ connectionString: SAFE_ADMIN_URL, max: 1 });
// The same factory the route uses, over one domain for this run's institution.
const store = createEvidencePayloadReader({
  EVIDENCE_STORAGE_DOMAINS: JSON.stringify({
    requestTimeoutMs: 5_000,
    domains: [
      {
        label: `local-replay-${suffix}`,
        institutionId,
        endpoint: S3_ENDPOINT,
        region,
        bucket,
        accessKeyIdVar: "EVIDENCE_S3_LOCAL_KEY_ID",
        secretAccessKeyVar: "EVIDENCE_S3_LOCAL_SECRET",
        capability: {
          provider: "rustfs-local",
          endpoint: S3_ENDPOINT,
          conditionalWrite: "verified",
          checksumEcho: "verified",
          verifiedOn: "2026-10-11",
          contractTest: "local-stack/s3-evidence-payload-store.integration",
        },
      },
    ],
  }),
  EVIDENCE_S3_LOCAL_KEY_ID: s3Credentials.accessKeyId,
  EVIDENCE_S3_LOCAL_SECRET: s3Credentials.secretAccessKey,
  NODE_ENV: "test",
});
// Ingest writes through the same router; a refused configuration fails here.
function writer(): InstitutionRoutedPayloadStore {
  if (!(store instanceof InstitutionRoutedPayloadStore)) throw new Error("storage configuration was refused");
  return store;
}

async function rawPut(path: string[], body: Uint8Array<ArrayBuffer>) {
  const signed = signS3Request({
    method: "PUT",
    endpoint: new URL(S3_ENDPOINT),
    path,
    headers: {},
    body,
    region,
    credentials: s3Credentials,
    now: new Date(),
  });
  const response = await fetch(signed.url, { method: "PUT", body, headers: signed.headers, redirect: "error" });
  await response.arrayBuffer();
  return response.status;
}

/** This run's bucket, labelled for its institution (P3), as the operator sets it up. */
async function createBucket() {
  let status = 0;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    status = await rawPut([bucket], new Uint8Array()).catch(() => 0);
    if (status === 200 || status === 409) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  expect([200, 409]).toContain(status);
  const label = new TextEncoder().encode(JSON.stringify({ institutionId, region }));
  expect(await rawPut([bucket, STORAGE_IDENTITY_KEY], label)).toBe(200);
}
let appPool: pg.Pool;
let withActor: WithActor;
let fixtureReady = false;

// The text a checkpoint holds for the document the third segment starts from.
const RESUME_TEXT = '{"nodes":[{"children":[],"id":"00000000-0000-4000-8000-0000000000aa","type":"paragraph"}],"schemaVersion":1}';
let resumeHash = "";
let record: { id: string; payload: string; hash: string }[] = [];

// Segment 1 starts from revision 0, segment 2 continues it, segment 3 starts
// after a break, from a document a checkpoint holds.
async function segments() {
  resumeHash = await sha256WebCrypto(RESUME_TEXT);
  const documents = [REVISION_ZERO_SHA256, "1".repeat(64), "2".repeat(64), resumeHash, "3".repeat(64)];
  const out: { id: string; payload: string; hash: string }[] = [];
  for (const [i, minute] of ["10:00", "10:20", "11:30"].entries()) {
    const at = `2026-10-20T${minute}:00.000Z`;
    const hash = (n: number) => documents[i === 2 ? n + 1 : n];
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
      initialDocumentHash: hash(i),
      finalDocumentHash: hash(i + 1),
      predecessorSegmentHash: out.at(-1)?.hash ?? null,
      events: [
        {
          sequence: i + 1,
          source: i === 1 ? "paste" : "editor",
          steps: [{ stepType: "replace", from: 1, to: 1, slice: { content: [{ type: "text", text: "Lorem ipsum" }] } }],
          beforeDocumentHash: hash(i),
          afterDocumentHash: hash(i + 1),
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
  record = await segments();
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
      `INSERT INTO identity.session (token_hash, user_id, institution_id, created_at, expires_at, closed_at, close_reason)
       VALUES (sha256(convert_to($1, 'UTF8')), $3, $4, now() - interval '2 hours', now() - interval '1 hour', NULL, NULL),
              (sha256(convert_to($2, 'UTF8')), $3, $4, now() - interval '1 hour', now() + interval '1 hour', now(), 'logout')`,
      [notOpen.expired, notOpen.closed, people.ana, institutionId],
    );
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
       VALUES ($1, $2, 0, $3, $4), ($1, $2, 1, $3, $5)`,
      [documentId, institutionId, people.ana, "a".repeat(64), resumeHash],
    );
    // The seal trigger computes the hash from the text; the key ties it to revision 1.
    await client.query(
      "INSERT INTO evidence.document_checkpoint (document_id, institution_id, revision, body) VALUES ($1, $2, 1, $3)",
      [documentId, institutionId, RESUME_TEXT],
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
      const stored = await writer().putImmutable({
        institutionId,
        evidencePackageId: packageId,
        segmentHash: segment.hash,
        canonicalPayload: segment.payload,
      });
      expect(stored.status).toBe("stored");
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
    await admin.query("DELETE FROM audit.access_log WHERE institution_id = $1", [institutionId]);
    await admin.query("DELETE FROM evidence.receipt WHERE evidence_package_id = $1", [packageId]);
    await admin.query("DELETE FROM evidence.segment WHERE evidence_package_id = $1", [packageId]);
    await admin.query("DELETE FROM evidence.package WHERE id = $1", [packageId]);
    await admin.query("DELETE FROM evidence.document_checkpoint WHERE document_id = $1", [documentId]);
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

// The access log of the work, with names in place of ids (DAN-228 step 2).
async function openings() {
  const names = new Map<string, string>(Object.entries(people).map(([name, id]) => [id, name]));
  const rows = await admin.query<{ owner_id: string; reader_id: string; reader_role: string; surface: string }>(
    "SELECT owner_id, reader_id, reader_role, surface FROM audit.access_log WHERE document_id = $1 AND institution_id = $2",
    [documentId, institutionId],
  );
  return rows.rows.map((r) => `${names.get(r.reader_id)} ${r.reader_role} ${r.surface} of ${names.get(r.owner_id)}`);
}

function ask(name: keyof typeof tokens, body: unknown = { documentId, from: 0 }) {
  return askWith(tokens[name], body);
}

function askWith(sessionToken: string, body: unknown = { documentId, from: 0 }) {
  const request = new Request(`${ORIGIN}/api/evidence/replay`, {
    method: "POST",
    headers: { origin: ORIGIN, "sec-fetch-site": "same-origin", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return handleReplayRequest(request, { withActor, payloads: store, expectedOrigin: ORIGIN, sessionToken });
}
beforeAll(async () => {
  const ddl = await admin.query<{ ddl: string }>(
    "SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L IN ROLE ductus_app', $1::text, $2::text) AS ddl",
    [login, password],
  );
  await admin.query(ddl.rows[0].ddl);
  await createBucket();
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

describe("replay over the API and the read RPCs (DAN-344 R3, PRODUCT 5 rule 5)", () => {
  it("gives Ana and Vesna the same verified bytes, the start and the resume text, and Dora the answer for a missing document", async () => {
    const ana = await ask("ana");
    const vesna = await ask("vesna");
    expect(ana.status).toBe(200);
    expect(vesna.status).toBe(200);
    expect(vesna.headers.get("cache-control")).toBe("no-store");
    const [anaBytes, vesnaBytes] = await Promise.all([ana.arrayBuffer(), vesna.arrayBuffer()]);
    expect(Buffer.from(vesnaBytes).equals(Buffer.from(anaBytes))).toBe(true);
    expect(JSON.parse(Buffer.from(anaBytes).toString("utf8"))).toStrictEqual({
      replayFormat: "ductus-evidence-replay-v1",
      segmentCount: 3,
      head: { segmentHash: record[2].hash, segmentCount: 3 },
      from: 0,
      next: null,
      startDocument: REVISION_ZERO_JCS,
      segments: record.map((segment) => segment.payload),
      resumeDocuments: { [resumeHash]: RESUME_TEXT },
    });

    const dora = await ask("dora");
    expect(dora.status).toBe(404);
    expect(await dora.json()).toStrictEqual({ error: "not_found" });

    // PRODUCT 5 rule 17: Vesna's opening is one row; Ana's own read and Dora's refused one write none.
    expect(await openings()).toStrictEqual(["vesna teacher replay of ana"]);
  });

  it("starts a later page at its index, without the start document, and answers an index past the end like a refusal", async () => {
    const page = await ask("vesna", { documentId, from: 2 });
    expect(page.status).toBe(200);
    expect(await page.json()).toMatchObject({
      from: 2,
      next: null,
      startDocument: null,
      segments: [record[2].payload],
      resumeDocuments: { [resumeHash]: RESUME_TEXT },
    });
    expect((await ask("vesna", { documentId, from: 3 })).status).toBe(404);
    expect((await ask("vesna", { documentId, from: -1 })).status).toBe(422);
    expect((await ask("vesna", { documentId, from: 0, role: "teacher" })).status).toBe(422);
  });

  it("tells Ana's expired or closed session and an unknown token to sign in again with 401, not 404", async () => {
    for (const sessionToken of Object.values(notOpen)) {
      const response = await askWith(sessionToken);
      expect(response.status).toBe(401);
      expect(await response.json()).toStrictEqual({ error: "unauthorized" });
    }
    expect((await ask("ana")).status).toBe(200);
  });
});