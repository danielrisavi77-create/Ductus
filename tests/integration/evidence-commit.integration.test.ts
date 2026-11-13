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
import { InMemoryEvidencePayloadStore } from "@/adapters/evidence/in-memory-evidence-payload-store";
import { loadGoldenVectors } from "@/domain/forensics/golden-vectors/load";
import { canonicalizeJcs } from "@/domain/forensics/jcs";
import { digestEvidenceReceiptPayloadV2 } from "@/domain/forensics/evidence-receipt";
import { commitEvidenceRequest } from "@/server/evidence/evidence-commit-request";
import { handleEvidenceCommitRequest } from "@/server/evidence/commit-route";
import { handleEvidenceOpenRequest } from "@/server/evidence/open-route";
import {
  commitOutcomeFrom,
  createCommitProtocol,
  openWork,
  type CommitProtocol,
  type FetchLike,
  type OpenedWork,
} from "@/client/evidence-ingest";
import { DUCTUS_PROTOCOL_VERSION } from "@/domain/evidence/commit-envelope";
import { ackedRevision, isRetryable, outcomeToEvents, type QueuedRow } from "@/domain/sync/drain";
import type { EvidenceSegmentTransaction, PendingTransaction } from "@/domain/sync/journal-types";
import { createEvidenceTransport, evidenceVerifierFor } from "@/lib/sync/evidence-transport";

import { requireLoopbackDatabaseUrl } from "./loopback-database-url";

// B-8 step 4c / DAN-83 (docs/BACKEND.md 4.13 t. 3.2, 3.6, 4 and 7): the commit
// transaction against the real database, with the persistent development key
// read from a seed outside the repository and registered for the domain. A
// signature that fails leaves nothing behind; a retry gets the stored receipt
// verified under the registry key, also from a new signer instance. Loopback
// only; random synthetic rows and a random seed, all removed afterwards.
const SAFE_ADMIN_URL: string =
  process.env.DATABASE_URL ?? "postgres://ductus:ductus-local-only@127.0.0.1:54329/ductus";
requireLoopbackDatabaseUrl(SAFE_ADMIN_URL, "The evidence commit test runs only against a loopback database (DATABASE_URL).");
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const suffix = randomBytes(5).toString("hex");
const login = `it_commit_${suffix}`;
const password = randomBytes(24).toString("hex");
const token = randomBytes(32).toString("base64url");
const expiredToken = randomBytes(32).toString("base64url");
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
      `INSERT INTO identity.session (token_hash, user_id, institution_id, created_at, expires_at)
       VALUES (sha256(convert_to($1, 'UTF8')), $2, $3, now() - interval '2 hours', now() - interval '1 hour')`,
      [expiredToken, studentId, institutionId],
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

  it("commits a request from its received bytes, and a retry of it writes no object and gets the same receipt (4d)", async () => {
    // A segment v2 of this document, made from the invented golden segment.
    const golden = loadGoldenVectors().chain;
    const template = golden.segments[0].segment;
    const document = canonicalizeJcs(golden.documentStates[1].value);
    const n = chain.sequence + 1;
    const segment = canonicalizeJcs({
      ...template,
      documentId,
      sessionId: `capture-${suffix}`,
      segmentId: `segment-${suffix}-${n}`,
      sequenceFrom: n,
      sequenceTo: n,
      initialDocumentHash: chain.documentHash,
      finalDocumentHash: sha256(document),
      predecessorSegmentHash: chain.head,
      evidenceProfileId: context.evidenceProfileId,
      events: [{ ...template.events[0], sequence: n, beforeDocumentHash: chain.documentHash, afterDocumentHash: sha256(document) }],
    });
    const payloads = new InMemoryEvidencePayloadStore();
    const deps = { withActor, signer: signerFor(join(dir, "seed")), payloads };
    const request = {
      documentId,
      clientTransactionId: `tx-${suffix}-5`,
      baseRevision: chain.revision,
      segment: new TextEncoder().encode(segment),
      document: new TextEncoder().encode(document),
    };
    const first = await commitEvidenceRequest(deps, token, request);
    expect(first).toMatchObject({ status: "committed", revision: chain.revision + 1, signedReceipt: { payload: { segmentHash: sha256(segment) } } });
    expect(payloads.size).toBe(1);
    const row = await admin.query<{ storage_ref: string; body: string }>(
      `SELECT s.storage_ref, c.body FROM evidence.segment s
         JOIN evidence.document_checkpoint c ON c.document_id = s.document_id AND c.revision = $2
        WHERE s.id = $1`,
      [`segment-${suffix}-${n}`, chain.revision + 1],
    );
    expect(row.rows).toEqual([
      { storage_ref: `memory:v2/${institutionId}/${context.evidencePackageId}/${sha256(segment)}.json`, body: document },
    ]);
    const after = await stored();

    const again = await commitEvidenceRequest({ ...deps, signer: signerFor(join(dir, "seed")) }, token, request);
    expect(again.status).toBe("duplicate");
    expect(JSON.stringify(again.status === "duplicate" && again.signedReceipt)).toBe(
      JSON.stringify(first.status === "committed" && first.signedReceipt),
    );
    expect(payloads.size).toBe(1);
    expect(await stored()).toEqual(after);
    Object.assign(chain, { revision: chain.revision + 1, documentHash: sha256(document), head: sha256(segment), sequence: n });
  });

  // DAN-343 (contract on #896): a v3 segment goes through the real route and
  // database, and its signed receipt names v3; a v2 segment after it continues
  // the same chain; citation-form in v2 is refused before anything is stored.
  it("commits a v3 segment with a receipt naming v3, then a v2 one in the same package", async () => {
    const golden = loadGoldenVectors().chain;
    const template = golden.segments[0].segment;
    const states = golden.documentStates.map((state) => canonicalizeJcs(state.value));
    const payloads = new InMemoryEvidencePayloadStore();
    const deps = { withActor, signer: signerFor(join(dir, "seed")), payloads };
    const request = (evidenceSchema: string, source: string, tx: string) => {
      const n = chain.sequence + 1;
      const document = states.find((text) => sha256(text) !== chain.documentHash)!;
      const segment = canonicalizeJcs({
        ...template,
        evidenceSchema,
        documentId,
        sessionId: `capture-${suffix}`,
        segmentId: `segment-${suffix}-${n}`,
        sequenceFrom: n,
        sequenceTo: n,
        initialDocumentHash: chain.documentHash,
        finalDocumentHash: sha256(document),
        predecessorSegmentHash: chain.head,
        evidenceProfileId: context.evidenceProfileId,
        events: [{ ...template.events[0], source, sequence: n, beforeDocumentHash: chain.documentHash, afterDocumentHash: sha256(document) }],
      });
      const body = {
        documentId,
        clientTransactionId: `tx-${suffix}-${tx}`,
        baseRevision: chain.revision,
        segment: new TextEncoder().encode(segment),
        document: new TextEncoder().encode(document),
      };
      const advance = () =>
        Object.assign(chain, { revision: chain.revision + 1, documentHash: sha256(document), head: sha256(segment), sequence: n });
      return { body, segment, advance };
    };

    const before = await stored();
    const refused = request("ductus-evidence-segment-v2", "citation-form", "v2-citation");
    expect(await commitEvidenceRequest(deps, token, refused.body)).toEqual({ status: "invalid" });
    expect(payloads.size).toBe(0);
    expect(await stored()).toEqual(before);

    const v3 = request("ductus-evidence-segment-v3", "citation-form", "v3");
    const third = await commitEvidenceRequest(deps, token, v3.body);
    expect(third).toMatchObject({
      status: "committed",
      signedReceipt: { payload: { evidenceSchema: "ductus-evidence-segment-v3", segmentHash: sha256(v3.segment) } },
    });
    v3.advance();

    const v2 = request("ductus-evidence-segment-v2", "editor", "v2-after-v3");
    const fourth = await commitEvidenceRequest(deps, token, v2.body);
    expect(fourth).toMatchObject({
      status: "committed",
      signedReceipt: {
        payload: { evidenceSchema: "ductus-evidence-segment-v2", predecessorSegmentHash: sha256(v3.segment) },
      },
    });
    v2.advance();
    expect(payloads.size).toBe(2);
  });
});

/** The next segment of the chain and the document it ends in, as the client sends them. */
function nextEnvelope(clientTransactionId: string) {
  const golden = loadGoldenVectors().chain;
  const template = golden.segments[0].segment;
  const n = chain.sequence + 1;
  const states = golden.documentStates.map((state) => canonicalizeJcs(state.value));
  const document = states.find((text, i) => i >= n % states.length && sha256(text) !== chain.documentHash) ?? states[0];
  const segment = canonicalizeJcs({
    ...template,
    documentId,
    sessionId: `capture-${suffix}`,
    segmentId: `segment-${suffix}-${n}`,
    sequenceFrom: n,
    sequenceTo: n,
    initialDocumentHash: chain.documentHash,
    finalDocumentHash: sha256(document),
    predecessorSegmentHash: chain.head,
    evidenceProfileId: context.evidenceProfileId,
    events: [{ ...template.events[0], sequence: n, beforeDocumentHash: chain.documentHash, afterDocumentHash: sha256(document) }],
  });
  const body = {
    documentId,
    clientTransactionId,
    baseRevision: chain.revision,
    segments: [Buffer.from(segment, "utf8").toString("base64")],
    document: Buffer.from(document, "utf8").toString("base64"),
  };
  return { body, advance: () => Object.assign(chain, { revision: chain.revision + 1, documentHash: sha256(document), head: sha256(segment), sequence: n }) };
}

const ORIGIN = "http://localhost:3000";
const post = (path: string, body: unknown) =>
  new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { origin: ORIGIN, "sec-fetch-site": "same-origin", "ductus-protocol": "1", "content-type": "application/json" },
    body: JSON.stringify(body),
  });

/** The route's dependencies, counting every object write, signature and signature RPC. */
function countedDeps() {
  const counts = { puts: 0, signs: 0, attaches: 0 };
  const store = new InMemoryEvidencePayloadStore();
  const counting: WithActor = (t, fn) =>
    withActor(t, (tx) =>
      fn({
        query: (text, values) => {
          if (text.includes("attach_receipt_signature")) counts.attaches += 1;
          return tx.query(text, values);
        },
      }),
    );
  const base = signerFor(join(dir, "seed"));
  const deps = {
    withActor: counting,
    signer: {
      sign: (message: Uint8Array) => {
        counts.signs += 1;
        return base.sign(message);
      },
      verify: base.verify.bind(base),
      publicVerificationKey: base.publicVerificationKey.bind(base),
    },
    payloads: {
      putImmutable: (input: Parameters<typeof store.putImmutable>[0]) => {
        counts.puts += 1;
        return store.putImmutable(input);
      },
      storageRefFor: store.storageRefFor.bind(store),
    },
    expectedOrigin: ORIGIN,
    sessionToken: token,
  };
  return { deps, counts };
}

// DAN-518: deferred signing (protocol 2) against the real database. The
// process accepts and never signs; a login that inherits ductus_worker stands
// in for the worker. The retry while the worker holds the receipt row must
// answer pending at once, never wait on that lock and never sign itself.
describe("deferred signing against the database (DAN-518)", () => {
  const workerLogin = `it_commit_w_${suffix}`;
  const workerPassword = randomBytes(24).toString("hex");
  let workerClient: pg.Client | undefined;
  let pending: EvidenceCommitInput;
  let signCalls = 0;
  const countingSigner = () => {
    const real = signerFor(join(dir, "seed"));
    return {
      verify: real.verify.bind(real),
      publicVerificationKey: real.publicVerificationKey.bind(real),
      sign: (message: Uint8Array) => {
        signCalls += 1;
        return real.sign(message);
      },
    };
  };

  beforeAll(async () => {
    const ddl = await admin.query<{ ddl: string }>(
      "SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L IN ROLE ductus_worker', $1::text, $2::text) AS ddl",
      [workerLogin, workerPassword],
    );
    await admin.query(ddl.rows[0].ddl);
    const url = new URL(SAFE_ADMIN_URL);
    url.username = workerLogin;
    url.password = workerPassword;
    workerClient = new pg.Client({ connectionString: url.href });
    await workerClient.connect();
  });

  afterAll(async () => {
    await workerClient?.end().catch(() => {});
    const drop = await admin.query<{ ddl: string }>("SELECT format('DROP ROLE IF EXISTS %I', $1::text) AS ddl", [workerLogin]);
    await admin.query(drop.rows[0].ddl);
  });

  it("answers two identical concurrent v2 requests with one pending acceptance and one pending duplicate, signing nothing", async () => {
    pending = next(`tx-${suffix}-async-1`);
    const before = await stored();
    const deps = { withActor, signer: countingSigner() };
    const both = await Promise.all([
      commitEvidenceSegment(deps, token, pending, "deferred"),
      commitEvidenceSegment(deps, token, pending, "deferred"),
    ]);
    expect(both.map((o) => o.status).sort()).toEqual(["committed_pending", "duplicate_pending"]);
    for (const outcome of both) expect(outcome).toMatchObject({ revision: chain.revision + 1 });
    expect(signCalls).toBe(0);
    expect(await stored()).toMatchObject({
      revision: String(chain.revision + 1),
      receipts: String(Number(before.receipts) + 1),
      signed: before.signed,
    });
    advance(pending);
  });

  it("answers a retry while the worker holds the receipt with pending at once, and the signed receipt after its commit", async () => {
    const { rows } = await admin.query<{ id: string; receipt_payload: string }>(
      `SELECT r.id, r.receipt_payload FROM evidence.receipt r JOIN evidence.package p ON p.id = r.evidence_package_id
        WHERE p.document_id = $1 AND r.status = 'pending_signature'`,
      [documentId],
    );
    expect(rows).toHaveLength(1);
    const digest = await digestEvidenceReceiptPayloadV2(JSON.parse(rows[0].receipt_payload));
    const signature = await signerFor(join(dir, "seed")).sign(digest.signingInput);
    const before = await stored();
    const deps = { withActor, signer: countingSigner() };
    const worker = workerClient!;
    await worker.query("BEGIN");
    try {
      const attached = await worker.query<{ outcome: string }>(
        "SELECT outcome FROM app.worker_attach_receipt_signature($1::uuid, $2, $3::jsonb)",
        [rows[0].id, digest.sha256, JSON.stringify(signature)],
      );
      expect(attached.rows[0].outcome).toBe("signed");
      // The worker's transaction is open and holds the receipt row FOR UPDATE.
      const retry = commitEvidenceSegment(deps, token, pending, "deferred");
      const waited = new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 2_000));
      expect(await Promise.race([retry, waited])).toEqual({ status: "duplicate_pending", revision: chain.revision });
      await worker.query("COMMIT");
    } catch (error) {
      await worker.query("ROLLBACK").catch(() => {});
      throw error;
    }
    expect(signCalls).toBe(0);
    const after = await stored();
    expect(after).toMatchObject({ receipts: before.receipts, signed: String(Number(before.signed) + 1) });

    for (const signing of ["deferred", "inline"] as const) {
      const again = await commitEvidenceSegment(deps, token, pending, signing);
      expect(again).toMatchObject({ status: "duplicate", revision: chain.revision });
      expect(again.status === "duplicate" && again.signedReceipt.signature).toEqual(signature);
    }
    expect(signCalls).toBe(0);
    expect(await stored()).toEqual(after);
  });

  // Istodobnost (DAN-593): the reconciler and the worker attach a signature to
  // the same pending receipt at once. The second attach waits on the row lock
  // and then answers already_signed with the first signature, never its own.
  it("keeps the first of two concurrent worker attaches, and the second gets that signature, not its own", async () => {
    const input = next(`tx-${suffix}-async-race`);
    expect(await commitEvidenceSegment({ withActor, signer: countingSigner() }, token, input, "deferred")).toMatchObject({
      status: "committed_pending",
    });
    advance(input);
    const { rows } = await admin.query<{ id: string; receipt_payload: string }>(
      `SELECT r.id, r.receipt_payload FROM evidence.receipt r JOIN evidence.package p ON p.id = r.evidence_package_id
        WHERE p.document_id = $1 AND r.status = 'pending_signature'`,
      [documentId],
    );
    expect(rows).toHaveLength(1);
    const digest = await digestEvidenceReceiptPayloadV2(JSON.parse(rows[0].receipt_payload));
    const first = await signerFor(join(dir, "seed")).sign(digest.signingInput);
    const second = await signerFor(await seedFile("race")).sign(digest.signingInput);
    expect(second).not.toEqual(first);
    const before = await stored();

    const url = new URL(SAFE_ADMIN_URL);
    url.username = workerLogin;
    url.password = workerPassword;
    const other = new pg.Client({ connectionString: url.href });
    await other.connect();
    const attach = "SELECT outcome, signature FROM app.worker_attach_receipt_signature($1::uuid, $2, $3::jsonb)";
    const worker = workerClient!;
    try {
      const otherPid = (await other.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      await worker.query("BEGIN");
      try {
        const a = await worker.query<{ outcome: string }>(attach, [rows[0].id, digest.sha256, JSON.stringify(first)]);
        expect(a.rows[0].outcome).toBe("signed");
        const b = other.query<{ outcome: string; signature: unknown }>(attach, [
          rows[0].id,
          digest.sha256,
          JSON.stringify(second),
        ]);
        // The second attach is waiting on the row lock, not finished before it.
        let waiting = false;
        for (let i = 0; i < 100 && !waiting; i += 1) {
          const lock = await admin.query("SELECT 1 FROM pg_stat_activity WHERE pid = $1 AND wait_event_type = 'Lock'", [
            otherPid,
          ]);
          waiting = lock.rowCount === 1;
          if (!waiting) await new Promise((resolve) => setTimeout(resolve, 50));
        }
        expect(waiting).toBe(true);
        await worker.query("COMMIT");
        const late = await b;
        expect(late.rows[0]).toEqual({ outcome: "already_signed", signature: first });
      } catch (error) {
        await worker.query("ROLLBACK").catch(() => {});
        throw error;
      }
    } finally {
      await other.end().catch(() => {});
    }
    const after = await stored();
    expect(after).toMatchObject({ receipts: before.receipts, signed: String(Number(before.signed) + 1) });
    const kept = await admin.query<{ signature: unknown }>("SELECT signature FROM evidence.receipt WHERE id = $1", [rows[0].id]);
    expect(kept.rows[0].signature).toEqual(first);
  });
});

// DAN-320 (M3.10-P02, D-211, contract on #1836): the answer to a commit is
// lost after the server has committed it, with the real client sender and
// receipt check (`createEvidenceTransport`, `evidenceVerifierFor`, keys from
// the real open route) against the real route and database. No Toxiproxy:
// the loss is made in the client's `fetch`, after the route has answered.
describe("a lost answer after the commit, client and route together (M3.10-P02)", () => {
  /** Every way the committed answer can fail to arrive (input classes L1 to L4 of the contract). */
  const LOSSES: readonly { name: string; lose: (answer: string) => Promise<Response>; first: "transport_error" | "invalid" }[] = [
    { name: "L1 connection dropped", lose: () => Promise.reject(new TypeError("Failed to fetch")), first: "transport_error" },
    {
      name: "L2 gateway 502 with a page",
      lose: async () => new Response("<html>Bad Gateway</html>", { status: 502, headers: { "content-type": "text/html" } }),
      first: "transport_error",
    },
    { name: "L3 gateway 504 with no body", lose: async () => new Response(null, { status: 504 }), first: "transport_error" },
    {
      name: "L4 200 cut off mid body",
      lose: async (answer) =>
        new Response(answer.slice(0, Math.floor(answer.length / 2)), { status: 200, headers: { "content-type": "application/json" } }),
      // The commit may have landed: the row is held, nothing is retried by itself.
      first: "invalid",
    },
  ];
  const PROTOCOLS: readonly { name: string; make: () => CommitProtocol; headers: string[] }[] = [
    // The tab probes "2", the route without deferred signing answers 426, the same body goes under "1".
    { name: "tab still on 2", make: createCommitProtocol, headers: ["2", "1", "1"] },
    { name: "tab already on 1", make: () => ({ ...createCommitProtocol(), version: DUCTUS_PROTOCOL_VERSION }), headers: ["1", "1"] },
  ];

  /** The browser's fetch in process: it adds what the browser adds, and can lose the next committed answer. */
  function browser(deps: ReturnType<typeof countedDeps>["deps"]) {
    const sent: { protocol: string | null; body: string }[] = [];
    const answers: string[] = [];
    const state: { lose: ((answer: string) => Promise<Response>) | null } = { lose: null };
    const fetchImpl: FetchLike = async (path, init) => {
      const headers = new Headers(init.headers);
      headers.set("origin", ORIGIN);
      headers.set("sec-fetch-site", "same-origin");
      const request = new Request(`${ORIGIN}${path}`, { method: init.method, headers, body: init.body });
      if (path === "/api/evidence/open") {
        return handleEvidenceOpenRequest(request, { withActor, expectedOrigin: ORIGIN, sessionToken: token });
      }
      sent.push({ protocol: headers.get("ductus-protocol"), body: String(init.body) });
      const response = await handleEvidenceCommitRequest(request, deps);
      const text = await response.text();
      answers.push(text);
      const lose = state.lose;
      if (lose && response.status === 200) {
        state.lose = null;
        return lose(text);
      }
      return new Response(text, { status: response.status, headers: response.headers });
    };
    return { fetchImpl, sent, answers, state };
  }

  async function openedWork(fetchImpl: FetchLike) {
    const opened = await openWork(assignmentId, fetchImpl);
    if (opened.status !== "opened") throw new Error(`not opened: ${opened.status}`);
    expect(opened.work.currentRevision).toBe(chain.revision);
    return opened.work;
  }

  /** The queued row the journal would hold for the next segment, with the hash stored beside it. */
  function nextRow(clientTransactionId: string) {
    const { body, advance } = nextEnvelope(clientTransactionId);
    const segment = new Uint8Array(Buffer.from(body.segments[0], "base64"));
    const row: PendingTransaction<EvidenceSegmentTransaction> = {
      documentId,
      localSeq: chain.sequence + 1,
      queuedAt: "2026-11-13T08:00:00.000Z",
      tx: {
        kind: "EVIDENCE_SEGMENT",
        clientTransactionId,
        baseRevision: body.baseRevision,
        segment,
        segmentHash: createHash("sha256").update(segment).digest("hex"),
        document: new Uint8Array(Buffer.from(body.document, "base64")),
        sequenceFrom: chain.sequence + 1,
        sequenceTo: chain.sequence + 1,
        createdAt: "2026-11-13T08:00:00.000Z",
      },
    };
    return { row, advance };
  }

  const verification = (work: OpenedWork, row: QueuedRow, revision: number) => ({
    expected: { documentId, clientTransactionId: row.tx.clientTransactionId, revision },
    verify: evidenceVerifierFor(work)(row),
  });

  const cases = PROTOCOLS.flatMap((protocol) => LOSSES.map((loss) => ({ protocol, loss })));
  it.each(cases)("$loss.name, $protocol.name: no ACK for the lost answer, the same bytes again get the same receipt", async ({ protocol, loss }) => {
    const { deps, counts } = countedDeps();
    const tab = browser(deps);
    const work = await openedWork(tab.fetchImpl);
    const transport = createEvidenceTransport(tab.fetchImpl, protocol.make());
    const { row, advance } = nextRow(`tx-${suffix}-lost-${protocol.headers.length}-${loss.name.slice(0, 2)}`);
    const revision = chain.revision + 1;
    const before = await stored();

    tab.state.lose = loss.lose;
    const first = await transport(documentId, row.tx);
    expect(first.status).toBe(loss.first);
    expect(isRetryable(first)).toBe(loss.first === "transport_error");
    expect(await outcomeToEvents(first, verification(work, row, revision), { sent: row, pending: [row] })).toEqual([
      { type: "SYNC_FAILED", retryable: loss.first === "transport_error" },
    ]);
    expect(ackedRevision(first)).toBeNull();
    // The server did commit before the answer was lost.
    const lost = tab.answers.at(-1)!;
    expect(JSON.parse(lost)).toMatchObject({ status: "committed", revision, receipt: { status: "signed" } });
    expect(counts).toEqual({ puts: 1, signs: 1, attaches: 1 });
    const after = await stored();
    expect(after).toMatchObject({
      revision: String(revision),
      receipts: String(Number(before.receipts) + 1),
      signed: String(Number(before.signed) + 1),
    });

    // The row was kept with its bytes; the retry (by itself, or by hand after L4) sends them again.
    const again = await transport(documentId, row.tx);
    expect(again).toMatchObject({ status: "duplicate", revision });
    expect(tab.answers.at(-1)).toBe(lost.replace('"status":"committed"', '"status":"duplicate"'));
    expect(tab.sent.map((s) => s.protocol)).toEqual(protocol.headers);
    expect(new Set(tab.sent.map((s) => s.body)).size).toBe(1);
    expect(await outcomeToEvents(again, verification(work, row, revision), { sent: row, pending: [row] })).toEqual([
      { type: "SYNC_ACK" },
    ]);
    expect(ackedRevision(again)).toBe(revision);
    // No second object, revision, receipt or signature.
    expect(counts).toEqual({ puts: 1, signs: 1, attaches: 1 });
    expect(await stored()).toEqual(after);

    // The same receipt checked against a row whose stored hash is another segment's is never SYNCED.
    const other: PendingTransaction<EvidenceSegmentTransaction> = { ...row, tx: { ...row.tx, segmentHash: sha256(`other ${suffix}`) } };
    expect(await outcomeToEvents(again, verification(work, other, revision), { sent: other, pending: [other] })).toEqual([
      { type: "SYNC_FAILED", retryable: false },
    ]);
    expect(ackedRevision(again)).toBeNull();
    advance();
  });

  // Istodobnost: the original request is still in the server, before its
  // transaction, when the client has given up on it and its retry commits.
  // The late original must then find the key and answer the same receipt,
  // never a second revision; its answer reaches nobody and acknowledges nothing.
  it("keeps one revision when the original lands after the client's retry has committed", async () => {
    const { deps, counts } = countedDeps();
    let entered!: () => void;
    const inside = new Promise<void>((resolve) => { entered = resolve; });
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let calls = 0;
    const holding = {
      ...deps,
      payloads: {
        ...deps.payloads,
        putImmutable: async (input: Parameters<typeof deps.payloads.putImmutable>[0]) => {
          calls += 1;
          if (calls === 1) {
            entered();
            await held;
          }
          return deps.payloads.putImmutable(input);
        },
      },
    };
    const tab = browser(holding);
    const work = await openedWork(tab.fetchImpl);
    let original: Promise<Response> | undefined;
    const dropping: FetchLike = (path, init) => {
      if (original || path !== "/api/evidence/commit") return tab.fetchImpl(path, init);
      // The request reaches the server; the connection breaks before any answer.
      original = tab.fetchImpl(path, init);
      return inside.then(() => Promise.reject(new TypeError("Failed to fetch")));
    };
    const transport = createEvidenceTransport(dropping, { ...createCommitProtocol(), version: DUCTUS_PROTOCOL_VERSION });
    const { row, advance } = nextRow(`tx-${suffix}-lost-race`);
    const revision = chain.revision + 1;
    const before = await stored();

    expect(await transport(documentId, row.tx)).toEqual({ status: "transport_error" });
    const retried = await transport(documentId, row.tx);
    expect(retried).toMatchObject({ status: "committed", revision });
    expect(await outcomeToEvents(retried, verification(work, row, revision), { sent: row, pending: [row] })).toEqual([
      { type: "SYNC_ACK" },
    ]);
    const committed = tab.answers.at(-1)!;

    release();
    const late = await original!;
    expect(late.status).toBe(200);
    const lateText = await late.text();
    expect(lateText).toBe(committed.replace('"status":"committed"', '"status":"duplicate"'));
    // The answer finds the row already gone from the queue: nothing to acknowledge again.
    expect(await outcomeToEvents(commitOutcomeFrom(200, JSON.parse(lateText)), verification(work, row, revision), {
      sent: row,
      pending: [],
    })).toEqual([]);
    // Two writes of the same immutable object, one revision, one receipt, one signature.
    expect(counts).toEqual({ puts: 2, signs: 1, attaches: 1 });
    expect(await stored()).toMatchObject({
      revision: String(revision),
      receipts: String(Number(before.receipts) + 1),
      signed: String(Number(before.signed) + 1),
    });
    const revisions = await admin.query("SELECT 1 FROM evidence.document_revision WHERE document_id = $1 AND revision > $2", [
      documentId,
      chain.revision,
    ]);
    expect(revisions.rowCount).toBe(1);
    advance();
  });
});

describe("evidence routes (B-8 step 5)", () => {
  it("opens the same work again with its current state and the registered receipt key", async () => {
    const response = await handleEvidenceOpenRequest(post("/api/evidence/open", { assignmentId }), {
      withActor,
      expectedOrigin: ORIGIN,
      sessionToken: token,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    const key = await signerFor(join(dir, "seed")).publicVerificationKey();
    expect(body).toMatchObject({
      status: "opened",
      documentId,
      evidenceProfileId: context.evidenceProfileId,
      currentRevision: chain.revision,
      documentHash: chain.documentHash,
      headSegmentHash: chain.head,
      lastSequenceTo: chain.sequence,
      receiptKeys: [expect.objectContaining({ keyId: key.keyId, purpose: "receipt" })],
      // The real app.work_submitted answers through the route: nothing is submitted here (DAN-289 O2).
      submitted: false,
    });
    expect(sha256(Buffer.from(body.document, "base64").toString("utf8"))).toBe(chain.documentHash);
  });

  it("answers a lost response's retry with 200 duplicate, byte for byte, and no object, revision or signature (T1, T3)", async () => {
    const { body, advance } = nextEnvelope(`tx-${suffix}-route-1`);
    const { deps, counts } = countedDeps();
    const first = await handleEvidenceCommitRequest(post("/api/evidence/commit", body), deps);
    expect(first.status).toBe(200);
    const firstText = await first.text();
    expect(JSON.parse(firstText)).toMatchObject({ status: "committed", revision: chain.revision + 1, receipt: { status: "signed" } });
    expect(counts).toEqual({ puts: 1, signs: 1, attaches: 1 });
    const after = await stored();
    advance();

    const again = await handleEvidenceCommitRequest(post("/api/evidence/commit", body), deps);
    expect(again.status).toBe(200);
    expect(await again.text()).toBe(firstText.replace('"status":"committed"', '"status":"duplicate"'));
    expect(counts).toEqual({ puts: 1, signs: 1, attaches: 1 });
    expect(await stored()).toEqual(after);
  });

  it("answers an expired session with 401 before a single body byte is read (F-098)", async () => {
    const { deps, counts } = countedDeps();
    let read = false;
    const body = new ReadableStream<Uint8Array>({
      pull() {
        read = true;
        throw new Error("read before the session");
      },
    }, { highWaterMark: 0 });
    const request = new Request(`${ORIGIN}/api/evidence/commit`, {
      method: "POST",
      headers: { origin: ORIGIN, "sec-fetch-site": "same-origin", "ductus-protocol": "1", "content-type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit);
    const before = await stored();
    const response = await handleEvidenceCommitRequest(request, { ...deps, sessionToken: expiredToken });
    expect([response.status, await response.json()]).toEqual([401, { status: "unauthenticated" }]);
    expect(read).toBe(false);
    expect(counts).toEqual({ puts: 0, signs: 0, attaches: 0 });
    expect(await stored()).toEqual(before);
  });

  it("refuses a stale base and a package that accepts no evidence before any object is stored (F-099)", async () => {
    const { body } = nextEnvelope(`tx-${suffix}-route-f099`);
    const { deps, counts } = countedDeps();
    const before = await stored();
    const stale = await handleEvidenceCommitRequest(post("/api/evidence/commit", { ...body, baseRevision: chain.revision + 1 }), deps);
    expect([stale.status, (await stale.json()).status]).toEqual([409, "stale_base"]);
    await admin.query("UPDATE evidence.package SET accepts_evidence = false WHERE id = $1", [context.evidencePackageId]);
    try {
      const closed = await handleEvidenceCommitRequest(post("/api/evidence/commit", body), deps);
      expect([closed.status, await closed.json()]).toEqual([409, { status: "not_accepting" }]);
    } finally {
      await admin.query("UPDATE evidence.package SET accepts_evidence = true WHERE id = $1", [context.evidencePackageId]);
    }
    expect(counts).toEqual({ puts: 0, signs: 0, attaches: 0 });
    expect(await stored()).toEqual(before);
  });

  it("answers a student removed between the context and the transaction as a document that does not exist", async () => {
    const { body } = nextEnvelope(`tx-${suffix}-route-2`);
    const { deps } = countedDeps();
    const missing = await handleEvidenceCommitRequest(post("/api/evidence/commit", { ...body, documentId: randomUUID() }), deps);
    const before = await stored();
    const removing = {
      ...deps,
      payloads: {
        ...deps.payloads,
        putImmutable: async (input: Parameters<typeof deps.payloads.putImmutable>[0]) => {
          await admin.query(
            `UPDATE institution.course_member SET member_to = greatest(now(), member_from), removed_by = $3
              WHERE course_id = $1 AND user_id = $2 AND member_to IS NULL`,
            [courseId, studentId, teacherId],
          );
          return deps.payloads.putImmutable(input);
        },
      },
    };
    const removed = await handleEvidenceCommitRequest(post("/api/evidence/commit", body), removing);
    expect([removed.status, await removed.text()]).toEqual([missing.status, await missing.text()]);
    expect(removed.status).toBe(404);
    expect(await stored()).toEqual(before);
  });
});
