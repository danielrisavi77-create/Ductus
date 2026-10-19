import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { EvidenceSegmentDescriptorV2 } from "@/application/ports/evidence-ingest";
import { createWithActor, type WithActor } from "@/server/db/with-actor";
import {
  commitEvidenceSegment,
  readEvidenceCommitContext,
  type EvidenceCommitContext,
  type EvidenceCommitInput,
} from "@/server/evidence/evidence-commit";
import { createEvidenceReceiptSigner } from "@/server/evidence/receipt-signer";

// B-8 step 4c / DAN-83 (docs/BACKEND.md 4.13 t. 3.2, 3.6, 4 and 7): the commit
// transaction against the real database, with the persistent development key
// read from a seed outside the repository and registered for the domain. A
// signature that fails leaves nothing behind; a retry gets the stored receipt
// verified under the registry key, also from a new signer instance. Loopback
// only; random synthetic rows and a random seed, all removed afterwards.
const SAFE_ADMIN_URL: string =
  process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(SAFE_ADMIN_URL).hostname)) {
  throw new Error("The evidence commit test runs only against a loopback database (DATABASE_URL).");
}
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const suffix = randomBytes(5).toString("hex");
const login = `it_commit_${suffix}`;
const password = randomBytes(24).toString("hex");
const token = randomBytes(32).toString("base64url");
const [institutionId, teacherId, studentId, courseId, assignmentId] = Array.from({ length: 5 }, () => randomUUID());
const admin = new pg.Pool({ connectionString: SAFE_ADMIN_URL, max: 1 });
let appPool: pg.Pool;
let withActor: WithActor;
let dir: string;
let documentId: string;
let context: EvidenceCommitContext;
const chain = { revision: 0, documentHash: "", head: null as string | null, sequence: 0 };

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const signerFor = (seed: string) =>
  createEvidenceReceiptSigner({ NODE_ENV: "test", DUCTUS_DEV_SIGNING_KEY_FILE: seed }, ROOT);

async function seedFile(name: string) {
  const path = join(dir, name);
  await writeFile(path, randomBytes(32), { mode: 0o600 });
  return path;
}

/** The next segment of the chain, as 4d will build it from the received bytes. */
function next(clientTransactionId: string): EvidenceCommitInput {
  const n = chain.sequence + 1;
  const snapshot = JSON.stringify({ text: `izmisljeni odlomak ${n}`, nonce: suffix });
  const descriptor: EvidenceSegmentDescriptorV2 = {
    evidencePackageId: context.evidencePackageId,
    documentId,
    sessionId: `capture-${suffix}`,
    segmentId: `segment-${suffix}-${n}`,
    evidenceSchema: "ductus-evidence-segment-v2",
    canonicalization: "RFC8785-JCS",
    hashAlgorithm: "sha256",
    evidenceProfileId: context.evidenceProfileId,
    sequenceFrom: n,
    sequenceTo: n,
    eventCount: 1,
    observedStartedAt: "2026-10-19T06:00:00.000Z",
    observedEndedAt: "2026-10-19T06:00:00.000Z",
    segmentHash: sha256(`segment ${suffix} ${n}`),
    predecessorSegmentHash: chain.head,
    payloadBytes: 123,
  };
  return {
    context,
    documentId,
    clientTransactionId,
    baseRevision: chain.revision,
    initialDocumentHash: chain.documentHash,
    finalDocumentHash: sha256(snapshot),
    descriptor,
    storageRef: `local-it:v2/${institutionId}/${context.evidencePackageId}/${descriptor.segmentHash}.json`,
    snapshot,
  };
}

function advance(input: EvidenceCommitInput) {
  chain.revision += 1;
  chain.documentHash = input.finalDocumentHash;
  chain.head = input.descriptor.segmentHash;
  chain.sequence += 1;
}

async function stored() {
  const { rows } = await admin.query<{ revision: string; receipts: string; signed: string; checkpoints: string; signatures: string }>(
    `SELECT (SELECT current_revision FROM evidence.document WHERE id = $1)::text AS revision,
            (SELECT count(*) FROM evidence.receipt r JOIN evidence.package p ON p.id = r.evidence_package_id
              WHERE p.document_id = $1)::text AS receipts,
            (SELECT count(*) FROM evidence.receipt r JOIN evidence.package p ON p.id = r.evidence_package_id
              WHERE p.document_id = $1 AND r.status = 'signed')::text AS signed,
            (SELECT count(*) FROM evidence.document_checkpoint WHERE document_id = $1)::text AS checkpoints,
            (SELECT string_agg(r.signature::text, ',' ORDER BY r.id) FROM evidence.receipt r
               JOIN evidence.package p ON p.id = r.evidence_package_id WHERE p.document_id = $1) AS signatures`,
    [documentId],
  );
  return rows[0];
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ductus-it-commit-"));
  const ddl = await admin.query<{ ddl: string }>(
    "SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L IN ROLE ductus_app', $1::text, $2::text) AS ddl",
    [login, password],
  );
  await admin.query(ddl.rows[0].ddl);
  const key = await signerFor(await seedFile("seed")).publicVerificationKey();
  const statements: [string, unknown[]][] = [
    ["INSERT INTO identity.institution (id, slug) VALUES ($1, $2)", [institutionId, `it-commit-${suffix}`]],
    ...[teacherId, studentId].map((id, i): [string, unknown[]] => [
      `INSERT INTO identity.user_account (id, institution_id, oidc_issuer, oidc_subject, hr_edu_person_unique_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, institutionId, `https://issuer-${suffix}.test`, `sub-${i}`, `person-${i}@${suffix}.example`],
    ]),
    [
      `INSERT INTO identity.session (token_hash, user_id, institution_id, expires_at)
       VALUES (sha256(convert_to($1, 'UTF8')), $2, $3, now() + interval '1 hour')`,
      [token, studentId, institutionId],
    ],
    [
      `INSERT INTO institution.course (id, institution_id, name, academic_year, ai_policy, created_by)
       VALUES ($1, $2, $3, '2026/2027', 'partially_allowed', $4)`,
      [courseId, institutionId, `Commit ${suffix}`, teacherId],
    ],
    [
      "INSERT INTO institution.course_member (course_id, institution_id, user_id, role) VALUES ($1, $2, $3, 'student')",
      [courseId, institutionId, studentId],
    ],
    [
      "INSERT INTO institution.assignment (id, course_id, institution_id, current_version, created_by) VALUES ($1, $2, $3, 1, $4)",
      [assignmentId, courseId, institutionId, teacherId],
    ],
    [
      `INSERT INTO institution.assignment_version
         (assignment_id, version_no, title, instructions, work_type, opens_at, due_at, ai_policy,
          ai_purposes, evidence_profile, import_allowed, created_by)
       VALUES ($1, 1, 'Synthetic commit', 'Synthetic fixture.', 'essay', now() - interval '1 day',
               now() + interval '1 day', 'partially_allowed', ARRAY[]::text[], 'extended', false, $2)`,
      [assignmentId, teacherId],
    ],
    [
      "INSERT INTO institution.notice_acknowledgment (assignment_id, version_no, student_id, institution_id) VALUES ($1, 1, $2, $3)",
      [assignmentId, studentId, institutionId],
    ],
    ["INSERT INTO evidence.domain (id, institution_id, region) VALUES ($1, $2, 'local')", [randomUUID(), institutionId]],
    // The key of the seed, registered as the db/local script does (4a).
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
  expect(opened.rows[0].outcome).toBe("opened");
  documentId = opened.rows[0].document_id;
  chain.documentHash = opened.rows[0].document_hash;
  const resolved = await readEvidenceCommitContext(withActor, token, documentId, `tx-${suffix}-1`);
  if (resolved.status !== "ok") throw new Error(`no commit context: ${resolved.status}`);
  context = resolved.context;
});

afterAll(async () => {
  await appPool?.end();
  await admin.query("BEGIN");
  await admin.query("SET LOCAL session_replication_role = replica");
  for (const table of ["receipt", "segment", "package", "document_checkpoint", "document_revision", "signing_key"]) {
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
  await admin.query("DELETE FROM identity.session WHERE user_id = $1", [studentId]);
  await admin.query("DELETE FROM identity.user_account WHERE institution_id = $1", [institutionId]);
  await admin.query("DELETE FROM identity.institution WHERE id = $1", [institutionId]);
  await admin.query("COMMIT");
  const drop = await admin.query<{ ddl: string }>("SELECT format('DROP ROLE IF EXISTS %I', $1::text) AS ddl", [login]);
  await admin.query(drop.rows[0].ddl);
  await admin.end();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("evidence commit transaction", () => {
  it("commits a signed receipt, and a retry from a new signer instance gets the same bytes (restart, T6, T7)", async () => {
    const input = next(`tx-${suffix}-1`);
    const started = performance.now();
    const committed = await commitEvidenceSegment({ withActor, signer: signerFor(join(dir, "seed")) }, token, input);
    const elapsed = performance.now() - started;
    expect(committed).toMatchObject({ status: "committed", revision: 1 });
    // Signing under the locks of the transaction stays far below its timeouts (T7).
    expect(elapsed).toBeLessThan(5_000);
    const after = await stored();
    expect(after).toMatchObject({ revision: "1", receipts: "1", signed: "1", checkpoints: "2" });
    advance(input);

    const known = await readEvidenceCommitContext(withActor, token, documentId, input.clientTransactionId);
    expect(known).toMatchObject({ status: "ok", context: { transactionKnown: true } });
    // A new instance stands in for a restarted process: it reads the same seed.
    const again = await commitEvidenceSegment({ withActor, signer: signerFor(join(dir, "seed")) }, token, input);
    expect(again.status).toBe("duplicate");
    expect(JSON.stringify(again.status === "duplicate" && again.signedReceipt)).toBe(
      JSON.stringify(committed.status === "committed" && committed.signedReceipt),
    );
    expect(await stored()).toEqual(after);
  });

  it("leaves nothing behind when signing fails, and a retry with the same key then commits once (T1, T3, T5)", async () => {
    const input = next(`tx-${suffix}-2`);
    const before = await stored();
    const missing = signerFor(join(dir, "missing"));
    const unregistered = signerFor(await seedFile("unregistered"));
    expect(await commitEvidenceSegment({ withActor, signer: missing }, token, input)).toEqual({
      status: "unavailable",
      stage: "signing",
      code: "signing_failed",
    });
    expect(await commitEvidenceSegment({ withActor, signer: unregistered }, token, input)).toEqual({
      status: "unavailable",
      stage: "signing",
      code: "signature_unverified",
    });
    expect(await stored()).toEqual(before);

    expect(await commitEvidenceSegment({ withActor, signer: signerFor(join(dir, "seed")) }, token, input)).toMatchObject({
      status: "committed",
      revision: 2,
    });
    expect(await stored()).toMatchObject({ revision: "2", receipts: "2", signed: "2" });
    advance(input);
  });

  it("answers two identical concurrent requests with one commit and one duplicate of it (T4)", async () => {
    const input = next(`tx-${suffix}-3`);
    const deps = { withActor, signer: signerFor(join(dir, "seed")) };
    const both = await Promise.all([commitEvidenceSegment(deps, token, input), commitEvidenceSegment(deps, token, input)]);
    expect(both.map((o) => o.status).sort()).toEqual(["committed", "duplicate"]);
    const receipts = both.map((o) => (o.status === "committed" || o.status === "duplicate" ? JSON.stringify(o.signedReceipt) : o));
    expect(receipts[0]).toBe(receipts[1]);
    expect(await stored()).toMatchObject({ revision: "3", receipts: "3", signed: "3" });
    advance(input);
  });

  it("answers a stale base with the state of the locked rows and writes nothing", async () => {
    const input = { ...next(`tx-${suffix}-4`), baseRevision: 1 };
    const before = await stored();
    expect(await commitEvidenceSegment({ withActor, signer: signerFor(join(dir, "seed")) }, token, input)).toEqual({
      status: "stale_base",
      state: { currentRevision: 3, documentHash: chain.documentHash, headSegmentHash: chain.head, lastSequenceTo: 3 },
    });
    expect(await stored()).toEqual(before);
  });
});
