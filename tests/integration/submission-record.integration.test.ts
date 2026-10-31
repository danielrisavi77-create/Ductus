import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createEditStepsV1Replayer } from "@/adapters/evidence/edit-steps-v1-replayer";
import { InMemoryEvidencePayloadStore } from "@/adapters/evidence/in-memory-evidence-payload-store";
import { decideSubmission } from "@/application/evidence/submission-decision";
import type { InstitutionEvidencePayloadReader } from "@/application/ports/evidence-reconstruction";
import { REVISION_ZERO_JCS, REVISION_ZERO_NODE_ID, REVISION_ZERO_SHA256 } from "@/domain/document/revision-zero";
import { canonicalizeJcs, type JcsJsonValue } from "@/domain/forensics/jcs";
import { createWithActor, type WithActor } from "@/server/db/with-actor";
import { readEvidenceCommitContext, type EvidenceCommitContext } from "@/server/evidence/evidence-commit";
import { commitEvidenceRequest } from "@/server/evidence/evidence-commit-request";
import { createEvidenceReceiptSigner } from "@/server/evidence/receipt-signer";
import { reconstructSubmissionRecord } from "@/server/evidence/submission-record";
import { handleSubmissionRequest } from "@/server/evidence/submission-route";
import type { SigningKeyProvider } from "@/application/ports/signing-key-provider";
import { digestSubmissionReceiptPayloadV2 } from "@/domain/forensics/submission-receipt-v2";

import { requireLoopbackDatabaseUrl } from "./loopback-database-url";

// B-12 step 4b1 / DAN-87: the reconstruction of a submission request over the
// real database, with segments of real ductus-edit-steps-v1 steps committed
// through the ingest path from revision 0, receipts signed by the persistent
// development key and checked under the registry. Loopback only; random
// synthetic rows ("Odlomak A", "Odlomak B") and a random seed, all removed.
const SAFE_ADMIN_URL: string =
  process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
requireLoopbackDatabaseUrl(SAFE_ADMIN_URL, "The submission record test runs only against a loopback database (DATABASE_URL).");
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const suffix = randomBytes(5).toString("hex");
const login = `it_subrec_${suffix}`;
const password = randomBytes(24).toString("hex");
const [token, classmateToken, expiredToken, closingToken] = Array.from({ length: 4 }, () =>
  randomBytes(32).toString("base64url"),
);
const [institutionId, teacherId, studentId, classmateId, courseId, assignmentId] = Array.from({ length: 6 }, () =>
  randomUUID(),
);
const admin = new pg.Pool({ connectionString: SAFE_ADMIN_URL, max: 1 });
const replayer = createEditStepsV1Replayer();
const store = new InMemoryEvidencePayloadStore();
let appPool: pg.Pool;
let withActor: WithActor;
let dir: string;
let documentId: string;
let context: EvidenceCommitContext;
let requestId: string;
const contentHashes: string[] = [REVISION_ZERO_SHA256];
const chain = {
  document: replayer.load(JSON.parse(REVISION_ZERO_JCS) as JcsJsonValue),
  hash: REVISION_ZERO_SHA256,
  head: null as string | null,
  sequence: 0,
};

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const signer = () => createEvidenceReceiptSigner({ NODE_ENV: "test", DUCTUS_DEV_SIGNING_KEY_FILE: join(dir, "seed") }, ROOT);

/** Commits one event of real steps through the ingest path, as the client sends it. */
async function commit(steps: unknown[]) {
  const n = chain.sequence + 1;
  const event = { sequence: n, source: "editor", steps, touchedNodeIds: [REVISION_ZERO_NODE_ID] };
  const after = replayer.apply(chain.document, event as never);
  const document = canonicalizeJcs(replayer.toCanonical(after));
  const segment = canonicalizeJcs({
    evidenceSchema: "ductus-evidence-segment-v2",
    canonicalization: "RFC8785-JCS",
    hashAlgorithm: "sha256",
    documentId,
    sessionId: `capture-${suffix}`,
    segmentId: `segment-${suffix}-${n}`,
    sequenceFrom: n,
    sequenceTo: n,
    observedStartedAt: "2026-10-20T06:00:00.000Z",
    observedEndedAt: "2026-10-20T06:00:00.000Z",
    initialDocumentHash: chain.hash,
    finalDocumentHash: sha256(document),
    predecessorSegmentHash: chain.head,
    events: [{ ...event, beforeDocumentHash: chain.hash, afterDocumentHash: sha256(document) }],
    captureContext: { editorModel: "prosemirror", transactionFormat: "ductus-edit-steps-v1" },
    evidenceProfileId: context.evidenceProfileId,
  });
  const outcome = await commitEvidenceRequest({ withActor, signer: signer(), payloads: store }, token, {
    documentId,
    clientTransactionId: `tx-${suffix}-${n}`,
    baseRevision: n - 1,
    segment: new TextEncoder().encode(segment),
    document: new TextEncoder().encode(document),
  });
  expect(outcome).toMatchObject({ status: "committed", revision: n });
  Object.assign(chain, { document: after, hash: sha256(document), head: sha256(segment), sequence: n });
  contentHashes.push(sha256(document));
}

const insertText = (from: number, text: string) => [
  { stepType: "replace", from, to: from, slice: { content: [{ type: "text", text }] } },
];

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ductus-it-subrec-"));
  await writeFile(join(dir, "seed"), randomBytes(32), { mode: 0o600 });
  const ddl = await admin.query<{ ddl: string }>(
    "SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L IN ROLE ductus_app', $1::text, $2::text) AS ddl",
    [login, password],
  );
  await admin.query(ddl.rows[0].ddl);
  const key = await signer().publicVerificationKey();
  const statements: [string, unknown[]][] = [
    ["INSERT INTO identity.institution (id, slug) VALUES ($1, $2)", [institutionId, `it-subrec-${suffix}`]],
    ...[teacherId, studentId, classmateId].map((id, i): [string, unknown[]] => [
      `INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, institutionId, `https://issuer-${suffix}.test`, `sub-${i}`, `person-${i}@${suffix}.example`],
    ]),
    ...([
      [token, studentId],
      [classmateToken, classmateId],
      [closingToken, studentId],
    ] as const).map(([value, user]): [string, unknown[]] => [
      `INSERT INTO identity.session (token_hash, user_id, institution_id, expires_at)
       VALUES (sha256(convert_to($1, 'UTF8')), $2, $3, now() + interval '1 hour')`,
      [value, user, institutionId],
    ]),
    [
      `INSERT INTO identity.session (token_hash, user_id, institution_id, created_at, expires_at)
       VALUES (sha256(convert_to($1, 'UTF8')), $2, $3, now() - interval '2 hours', now() - interval '1 hour')`,
      [expiredToken, studentId, institutionId],
    ],
    [
      `INSERT INTO institution.course (id, institution_id, name, academic_year, ai_policy, created_by)
       VALUES ($1, $2, $3, '2026/2027', 'partially_allowed', $4)`,
      [courseId, institutionId, `Submission ${suffix}`, teacherId],
    ],
    ...[studentId, classmateId].map((user): [string, unknown[]] => [
      "INSERT INTO institution.course_member (course_id, institution_id, user_id, role) VALUES ($1, $2, $3, 'student')",
      [courseId, institutionId, user],
    ]),
    [
      "INSERT INTO institution.assignment (id, course_id, institution_id, current_version, created_by) VALUES ($1, $2, $3, 1, $4)",
      [assignmentId, courseId, institutionId, teacherId],
    ],
    [
      `INSERT INTO institution.assignment_version
         (assignment_id, version_no, title, instructions, work_type, opens_at, due_at, ai_policy,
          ai_purposes, evidence_profile, import_allowed, created_by)
       VALUES ($1, 1, 'Synthetic submission', 'Synthetic fixture.', 'essay', now() - interval '1 day',
               now() + interval '1 day', 'partially_allowed', ARRAY[]::text[], 'extended', false, $2)`,
      [assignmentId, teacherId],
    ],
    [
      "INSERT INTO institution.notice_acknowledgment (assignment_id, version_no, student_id, institution_id) VALUES ($1, 1, $2, $3)",
      [assignmentId, studentId, institutionId],
    ],
    ["INSERT INTO evidence.domain (id, institution_id, region) VALUES ($1, $2, 'local')", [randomUUID(), institutionId]],
    [
      `INSERT INTO evidence.signing_key
         (key_id, key_version, evidence_domain_id, institution_id, purpose, algorithm, key_base64url, valid_from)
       SELECT $1, $2, d.id, d.institution_id, 'receipt', 'Ed25519', $3, date_trunc('minute', now()) - interval '1 day'
         FROM evidence.domain d WHERE d.institution_id = $4`,
      [key.keyId, key.keyVersion, key.keyBase64Url, institutionId],
    ],
  ];
  const client = await admin.connect();
  try {
    await client.query("BEGIN");
    for (const [text, values] of statements) await client.query(text, values);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  const url = new URL(SAFE_ADMIN_URL);
  url.username = login;
  url.password = password;
  appPool = new pg.Pool({ connectionString: url.href, max: 3 });
  withActor = createWithActor(appPool);
  const opened = await withActor(token, (tx) =>
    tx.query<{ outcome: string; document_id: string; document_hash: string }>(
      "SELECT outcome, document_id, document_hash FROM app.open_student_work($1)",
      [assignmentId],
    ),
  );
  expect(opened.rows[0]).toMatchObject({ outcome: "opened", document_hash: REVISION_ZERO_SHA256 });
  documentId = opened.rows[0].document_id;
  const resolved = await readEvidenceCommitContext(withActor, token, documentId, `tx-${suffix}-0`);
  if (resolved.status !== "ok") throw new Error(`no commit context: ${resolved.status}`);
  context = resolved.context;

  await commit(insertText(1, "Odlomak A"));
  await commit(insertText(10, " i Odlomak B"));
  const requested = await withActor(token, (tx) =>
    tx.query<{ outcome: string; submission_request_id: string }>(
      "SELECT outcome, submission_request_id FROM app.request_submission($1, 2)",
      [documentId],
    ),
  );
  expect(requested.rows[0].outcome).toBe("requested");
  requestId = requested.rows[0].submission_request_id;
});

afterAll(async () => {
  await appPool?.end();
  await admin.query("BEGIN");
  await admin.query("SET LOCAL session_replication_role = replica");
  for (const table of ["submission_receipt", "submission_receipt_issuance", "submission", "submission_request", "receipt", "segment", "package", "document_checkpoint", "document_revision", "signing_key"]) {
    await admin.query(`DELETE FROM evidence.${table} WHERE institution_id = $1`, [institutionId]);
  }
  for (const table of ["evidence.document", "evidence.project", "evidence.domain"]) {
    await admin.query(`DELETE FROM ${table} WHERE institution_id = $1`, [institutionId]);
  }
  await admin.query("DELETE FROM institution.notice_acknowledgment WHERE assignment_id = $1", [assignmentId]);
  await admin.query("DELETE FROM institution.assignment_version WHERE assignment_id = $1", [assignmentId]);
  await admin.query("DELETE FROM institution.assignment WHERE id = $1", [assignmentId]);
  await admin.query("DELETE FROM institution.course_member WHERE course_id = $1", [courseId]);
  await admin.query("DELETE FROM institution.course WHERE id = $1", [courseId]);
  await admin.query("DELETE FROM identity.session WHERE institution_id = $1", [institutionId]);
  await admin.query("DELETE FROM identity.user_account WHERE institution_id = $1", [institutionId]);
  await admin.query("DELETE FROM identity.institution WHERE id = $1", [institutionId]);
  await admin.query("COMMIT");
  const drop = await admin.query<{ ddl: string }>("SELECT format('DROP ROLE IF EXISTS %I', $1::text) AS ddl", [login]);
  await admin.query(drop.rows[0].ddl);
  await admin.end();
  if (dir) await rm(dir, { recursive: true, force: true });
});

const reconstruct = (payloads: InstitutionEvidencePayloadReader = store, as: string | null = token) =>
  reconstructSubmissionRecord({ withActor, payloads }, as, requestId);

describe("reconstruction of a submission request over the stored record (B-12 step 4b1)", () => {
  it("matches the requested revision from revision 0 under the registry key (C1, P2)", async () => {
    const result = await reconstruct();
    expect(result).toMatchObject({
      status: "reconstructed",
      record: { documentId, revision: 2, contentHash: contentHashes[2], head: { segmentHash: chain.head, segmentCount: 2 } },
      outcome: { status: "match", documentSha256: contentHashes[2] },
    });
    if (result.status !== "reconstructed") throw new Error(result.status);
    expect(decideSubmission(result.outcome)).toMatchObject({ decision: "submit", artifactSha256: contentHashes[2] });
  });

  it("reconstructs the requested revision, not a segment accepted after the request (B4)", async () => {
    await commit(insertText(1, "Uvod. "));
    const result = await reconstruct();
    expect(result).toMatchObject({
      status: "reconstructed",
      record: { revision: 2, segments: { length: 2 } },
      outcome: { status: "match", documentSha256: contentHashes[2] },
    });
  });

  it("never matches when the stored bytes of a segment differ (C8)", async () => {
    const tampered: InstitutionEvidencePayloadReader = {
      readImmutable: async (input) => {
        const read = await store.readImmutable(input);
        if (read.status !== "found") return read;
        const text = new TextDecoder().decode(read.bytes).replace("Odlomak A", "Odlomak C");
        return { status: "found", bytes: new TextEncoder().encode(text) };
      },
    };
    const result = await reconstruct(tampered);
    if (result.status !== "reconstructed") throw new Error(result.status);
    expect(result.outcome.status).toBe("mismatch");
    expect(decideSubmission(result.outcome)).toEqual({ decision: "blocked", reason: "record_mismatch" });
  });

  it("answers another student and a missing session without a record (F1)", async () => {
    expect(await reconstruct(store, classmateToken)).toEqual({ status: "not_found" });
    expect(await reconstruct(store, null)).toEqual({ status: "unauthenticated" });
    expect(await reconstructSubmissionRecord({ withActor, payloads: store }, token, randomUUID())).toEqual({
      status: "not_found",
    });
    expect(await reconstructSubmissionRecord({ withActor, payloads: store }, token, "not-a-uuid")).toEqual({
      status: "not_found",
    });
  });

});

const ORIGIN = "http://localhost:3000";
const submit = (
  payloads: InstitutionEvidencePayloadReader = store,
  as: string = token,
  body: unknown = { documentId, revision: 2 },
  receiptSigner: SigningKeyProvider = signer(),
) =>
  handleSubmissionRequest(
    new Request(`${ORIGIN}/api/submission`, {
      method: "POST",
      headers: { origin: ORIGIN, "sec-fetch-site": "same-origin", "ductus-protocol": "1", "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { withActor, payloads, signer: receiptSigner, expectedOrigin: ORIGIN, sessionToken: as, log: () => {} },
  );

async function submissions() {
  const { rows } = await admin.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM evidence.submission WHERE institution_id = $1",
    [institutionId],
  );
  return rows[0].n;
}

describe("POST /api/submission (B-12 step 4b2)", () => {
  it("writes no submission for a record that does not reproduce, whatever the client knows (D-11, D1)", async () => {
    const tampered: InstitutionEvidencePayloadReader = {
      readImmutable: async (input) => {
        const read = await store.readImmutable(input);
        if (read.status !== "found") return read;
        const text = new TextDecoder().decode(read.bytes).replace("Odlomak A", "Odlomak C");
        return { status: "found", bytes: new TextEncoder().encode(text) };
      },
    };
    const response = await submit(tampered);
    expect([response.status, await response.json()]).toEqual([409, { status: "blocked", reason: "record_mismatch" }]);
    // The body has no hash to offer; a stored hash from the client is refused as an unknown key.
    expect((await submit(store, token, { documentId, revision: 2, artifactSha256: contentHashes[2] })).status).toBe(422);
    expect(await submissions()).toBe("0");
  });

  it("answers an ended session with 401 and another student with 404, writing nothing", async () => {
    expect((await submit(store, expiredToken)).status).toBe(401);
    const other = await submit(store, classmateToken);
    expect([other.status, await other.json()]).toEqual([404, { status: "not_found" }]);
    expect(await submissions()).toBe("0");
  });

  it("answers a session closed while the record is reconstructed with 401, not 404, writing nothing", async () => {
    let closed = false;
    const closing: InstitutionEvidencePayloadReader = {
      readImmutable: async (input) => {
        if (!closed) {
          closed = true;
          await admin.query(
            "UPDATE identity.session SET closed_at = now(), close_reason = 'logout' WHERE token_hash = sha256(convert_to($1, 'UTF8'))",
            [closingToken],
          );
        }
        return store.readImmutable(input);
      },
    };
    const response = await submit(closing, closingToken);
    expect(closed).toBe(true);
    expect([response.status, await response.json()]).toEqual([401, { status: "unauthenticated" }]);
    expect(await submissions()).toBe("0");
  });

  it("submits the matching revision with one bound v2 receipt: two tabs at once and a repeat get the same bytes (C1, A6, A7, E1, DAN-291)", async () => {
    // Both tabs sign before either binds, so one bind waits on the other's lock
    // of the submission row (291a) and answers `existing` with the stored row.
    const base = signer();
    let signs = 0;
    let release = () => {};
    const bothSigned = new Promise<void>((resolve) => (release = resolve));
    const counting: SigningKeyProvider = {
      publicVerificationKey: () => base.publicVerificationKey(),
      verify: (message, signature) => base.verify(message, signature),
      sign: async (message) => {
        const signature = await base.sign(message);
        if (++signs === 2) release();
        await Promise.race([bothSigned, new Promise((resolve) => setTimeout(resolve, 5_000))]);
        return signature;
      },
    };
    const [first, second] = await Promise.all([1, 2].map(() => submit(store, token, undefined, counting)));
    expect([first.status, second.status, signs]).toEqual([200, 200, 2]);
    const text = await first.text();
    expect(await second.text()).toBe(text);
    const body = JSON.parse(text);
    const bound = await admin.query<{ receipts: string; attempts: string }>(
      `SELECT (SELECT count(*) FROM evidence.submission_receipt WHERE institution_id = $1)::text AS receipts,
              (SELECT count(*) FROM evidence.submission_receipt_issuance WHERE institution_id = $1)::text AS attempts`,
      [institutionId],
    );
    expect(bound.rows).toEqual([{ receipts: "1", attempts: "2" }]);
    const { rows } = await admin.query<{ requested_at: string; artifact_hash: string; revision: string }>(
      `SELECT to_char(requested_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS requested_at, artifact_hash,
              revision::text FROM evidence.submission WHERE institution_id = $1`,
      [institutionId],
    );
    expect(rows).toEqual([{ requested_at: body.receipt.payload.requestedAt, artifact_hash: contentHashes[2], revision: "2" }]);
    expect(body.receipt.payload).toMatchObject({
      documentId,
      revision: 2,
      artifactSha256: contentHashes[2],
      evidenceRecord: "continuous",
      afterDeadline: false,
      principalId: studentId,
      assignmentId,
    });
    expect(body.receipt.payload.receiptSchema).toBe("ductus-submission-receipt-v2");
    const digest = await digestSubmissionReceiptPayloadV2(body.receipt.payload);
    expect(body.receipt.payloadDigestSha256).toBe(digest.sha256);
    expect(await base.verify(digest.signingInput, body.receipt.signature)).toBe(true);

    // A later request reads the bound receipt and never asks the signer.
    const again = await submit(store, token, undefined, counting);
    expect([again.status, await again.text(), signs]).toEqual([200, text, 2]);
    // One submission per work (P8) and the first click binds (P5): a click that
    // names a later revision is told the requested one (owner, #87 6264259216).
    const later = await submit(store, token, { documentId, revision: 3 });
    expect([later.status, await later.json()]).toEqual([409, { status: "already_requested", revision: 2 }]);
    expect(await submissions()).toBe("1");
    const { rows: requests } = await admin.query<{ n: string; revision: string }>(
      `SELECT count(*)::text AS n, max(revision)::text AS revision FROM evidence.submission_request WHERE institution_id = $1`,
      [institutionId],
    );
    expect(requests).toEqual([{ n: "1", revision: "2" }]);
  });
});

describe("registry (last: it revokes the key)", () => {
  it("asks for a retry, never a verdict, when the registry no longer vouches for the key", async () => {
    await admin.query("UPDATE evidence.signing_key SET revoked_at = now() WHERE institution_id = $1", [institutionId]);
    const result = await reconstruct();
    if (result.status !== "reconstructed") throw new Error(result.status);
    expect(result.outcome).toMatchObject({ status: "unavailable", stage: "verification" });
    expect(decideSubmission(result.outcome)).toEqual({ decision: "retry", stage: "verification" });
  });
});
