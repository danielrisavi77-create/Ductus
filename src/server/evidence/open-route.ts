import { isSha256Hex } from "@/application/ports/evidence-ingest";
import type { EvidenceDomainKey } from "@/domain/forensics/evidence-receipt-verifier";
import type { ActorTransaction, WithActor } from "@/server/db/with-actor";

import { readEvidenceDomainKeys } from "./evidence-domain-keys";
import { consoleLog, parseClosedObject, readGuardedBody, reply, unavailable, type Log } from "./ingest-http";

/**
 * B-8 step 5 (docs/BACKEND.md 4.13 t. 6): `POST /api/evidence/open`. The
 * student's work for one assignment, made on the first call, with its
 * current state, the snapshot of the current revision and the public receipt
 * keys of its evidence domain, all read in one transaction. Package and
 * institution never leave the server.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPEN_SQL = `SELECT outcome, document_id, evidence_profile_id, current_revision, document_hash,
       head_segment_hash, last_sequence_to, snapshot
  FROM app.open_student_work($1::uuid)`;
// DAN-289 O2: whether the caller's own work for the assignment is submitted (true or false, nothing else).
const SUBMITTED_SQL = `SELECT app.work_submitted($1::uuid) AS submitted`;
// Under RLS the session sees only its own packages; the first one, as the open RPC picks it.
const DOMAIN_SQL = `SELECT evidence_domain_id::text AS evidence_domain_id FROM evidence.package
 WHERE document_id = $1 ORDER BY created_at, id LIMIT 1`;

export type EvidenceOpenRouteDeps = {
  withActor: WithActor;
  expectedOrigin: string | null;
  sessionToken?: string;
  log?: Log;
};

type OpenRow = Record<
  | "outcome"
  | "document_id"
  | "evidence_profile_id"
  | "current_revision"
  | "document_hash"
  | "head_segment_hash"
  | "last_sequence_to"
  | "snapshot",
  unknown
>;

type Opened =
  | { status: "unauthenticated" | "not_found" | "not_accepting" }
  | { status: "unavailable"; code: string }
  | { status: "opened"; body: Record<string, unknown> };

function count(value: unknown): number | null {
  const n = typeof value === "string" && /^(0|[1-9][0-9]{0,15})$/.test(value) ? Number(value) : value;
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null;
}

async function open(tx: ActorTransaction, assignmentId: string): Promise<Opened> {
  const { rows } = await tx.query<OpenRow>(OPEN_SQL, [assignmentId]);
  const row = rows.length === 1 ? rows[0] : undefined;
  if (row?.outcome === "unauthenticated" || row?.outcome === "not_found" || row?.outcome === "not_accepting") {
    return { status: row.outcome };
  }
  if (row?.outcome === "not_configured") return { status: "unavailable", code: "work_not_configured" };
  const currentRevision = count(row?.current_revision);
  const lastSequenceTo = count(row?.last_sequence_to);
  if (
    row?.outcome !== "opened" ||
    typeof row.document_id !== "string" ||
    row.document_id === "" ||
    typeof row.evidence_profile_id !== "string" ||
    row.evidence_profile_id === "" ||
    currentRevision === null ||
    lastSequenceTo === null ||
    !isSha256Hex(row.document_hash) ||
    !(row.head_segment_hash === null || isSha256Hex(row.head_segment_hash)) ||
    typeof row.snapshot !== "string"
  ) {
    return { status: "unavailable", code: "work_malformed" };
  }
  // Never false by assumption: an answer that is not a boolean is no answer.
  const submittedRows = await tx.query<{ submitted: unknown }>(SUBMITTED_SQL, [assignmentId]);
  const submitted = submittedRows.rows.length === 1 ? submittedRows.rows[0]?.submitted : undefined;
  if (typeof submitted !== "boolean") return { status: "unavailable", code: "work_malformed" };
  const domain = await tx.query<{ evidence_domain_id: unknown }>(DOMAIN_SQL, [row.document_id]);
  const domainId = domain.rows[0]?.evidence_domain_id;
  if (typeof domainId !== "string") return { status: "unavailable", code: "work_malformed" };
  const keys = await readEvidenceDomainKeys(tx, domainId);
  if (keys.status !== "ok") return { status: "unavailable", code: keys.reason };
  const receiptKeys: EvidenceDomainKey[] = keys.keys.filter((key) => key.purpose === "receipt");
  return {
    status: "opened",
    body: {
      status: "opened",
      documentId: row.document_id,
      evidenceProfileId: row.evidence_profile_id,
      currentRevision,
      documentHash: row.document_hash,
      headSegmentHash: row.head_segment_hash,
      lastSequenceTo,
      document: Buffer.from(row.snapshot, "utf8").toString("base64"),
      receiptKeys,
      submitted,
    },
  };
}

export async function handleEvidenceOpenRequest(request: Request, deps: EvidenceOpenRouteDeps): Promise<Response> {
  const log = deps.log ?? consoleLog;
  const read = await readGuardedBody(request, deps.expectedOrigin, deps.sessionToken, { maxBytes: 1024, timeoutMs: 5_000 });
  if (!read.ok) return read.response;
  const body = parseClosedObject(read.bytes, ["assignmentId"]);
  const assignmentId = body?.assignmentId;
  if (typeof assignmentId !== "string" || !UUID.test(assignmentId)) return reply(422, { status: "invalid" });

  let opened: Opened;
  try {
    opened = await deps.withActor(read.token, (tx) => open(tx, assignmentId));
  } catch {
    opened = { status: "unavailable", code: "work_failed" };
  }
  switch (opened.status) {
    case "opened":
      return reply(200, opened.body);
    case "unauthenticated":
      return reply(401, { status: "unauthenticated" });
    case "not_found":
      return reply(404, { status: "not_found" });
    case "not_accepting":
      log("evidence open", opened.status);
      return reply(409, { status: "not_accepting" });
    default:
      log("evidence open", "unavailable", "context", opened.code);
      return unavailable("context");
  }
}
