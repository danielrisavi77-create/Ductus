import { createEditStepsV1Replayer } from "@/adapters/evidence/edit-steps-v1-replayer";
import type { EvidenceReconstructionOutcome } from "@/application/evidence/evidence-reconstruction";
import {
  reconstructSubmission,
  type SubmissionRecord,
} from "@/application/evidence/submission-reconstruction";
import { isEvidencePackageId, isSha256Hex } from "@/application/ports/evidence-ingest";
import { isInstitutionId } from "@/application/ports/evidence-object-key";
import {
  bindPayloadReader,
  type InstitutionEvidencePayloadReader,
} from "@/application/ports/evidence-reconstruction";
import { isEvidenceDomainId, isReceiptPrincipalId } from "@/domain/forensics/evidence-receipt";
import type { EvidenceDomainKey } from "@/domain/forensics/evidence-receipt-verifier";
import type { WithActor } from "@/server/db/with-actor";

import { readEvidenceDomainKeys } from "./evidence-domain-keys";

/**
 * B-12 step 4b1 (docs/BACKEND.md 4.6; contract on #385): the record of a
 * submission request and the receipt keys of its domain, read in one
 * withActor transaction, then the reconstruction outside it, so no lock or
 * transaction is held while payloads are read from storage. Every fault is a
 * closed code; nothing from the record or the request reaches a message.
 */

export type SubmissionRecordFault = "record_failed" | "record_malformed" | "record_unavailable" | "domain_keys_unavailable";

export type SubmissionReconstruction =
  | { status: "reconstructed"; record: SubmissionRecord; outcome: EvidenceReconstructionOutcome }
  | { status: "unauthenticated" | "not_found" }
  | { status: "unavailable"; stage: "record"; code: SubmissionRecordFault };

export type SubmissionRecordDependencies = {
  withActor: WithActor;
  /** The storage domains (`evidencePayloadReader()`); bound here to the record's institution. */
  payloads: InstitutionEvidencePayloadReader;
};

const RECORD_SQL = `SELECT outcome, institution_id, evidence_package_id, evidence_domain_id, document_id, principal_id,
       revision, content_hash, head_segment_hash, segment_count, segments
  FROM app.read_submission_record($1::uuid)`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type RecordRow = Record<
  | "outcome"
  | "institution_id"
  | "evidence_package_id"
  | "evidence_domain_id"
  | "document_id"
  | "principal_id"
  | "revision"
  | "content_hash"
  | "head_segment_hash"
  | "segment_count"
  | "segments",
  unknown
>;

/** A bigint column as the driver gives it (text), or a number, from 1; null for anything else. */
function positive(value: unknown): number | null {
  const n = typeof value === "string" && /^[1-9][0-9]{0,15}$/.test(value) ? Number(value) : value;
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 1 ? n : null;
}

const plain = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** One listed segment, exactly the three keys the RPC builds; null for any other form. */
function listedSegment(value: unknown): SubmissionRecord["segments"][number] | null {
  if (!plain(value) || Object.keys(value).sort().join() !== "receiptPayload,segmentHash,signature") return null;
  const { segmentHash, receiptPayload, signature } = value;
  if (!isSha256Hex(segmentHash) || typeof receiptPayload !== "string") return null;
  if (signature === null) return { segmentHash, receipt: null };
  return plain(signature) ? { segmentHash, receipt: { receiptPayload, signature } } : null;
}

/** The `found` row as a record, or null when any field has another form. */
function recordFrom(row: RecordRow): SubmissionRecord | null {
  const revision = positive(row.revision);
  const segmentCount = positive(row.segment_count);
  const segments = Array.isArray(row.segments) ? row.segments.map(listedSegment) : null;
  if (
    !isInstitutionId(row.institution_id) ||
    !isEvidencePackageId(row.evidence_package_id) ||
    !isEvidenceDomainId(row.evidence_domain_id) ||
    typeof row.document_id !== "string" ||
    row.document_id === "" ||
    !isReceiptPrincipalId(row.principal_id) ||
    revision === null ||
    !isSha256Hex(row.content_hash) ||
    !isSha256Hex(row.head_segment_hash) ||
    segmentCount === null ||
    segments === null ||
    segments.length !== segmentCount ||
    !segments.every((segment) => segment !== null)
  ) {
    return null;
  }
  return {
    institutionId: row.institution_id,
    evidencePackageId: row.evidence_package_id,
    evidenceDomainId: row.evidence_domain_id,
    documentId: row.document_id,
    principalId: row.principal_id,
    revision,
    contentHash: row.content_hash,
    head: { segmentHash: row.head_segment_hash, segmentCount },
    segments: segments as SubmissionRecord["segments"],
  };
}

type Read =
  | { status: "found"; record: SubmissionRecord; keys: EvidenceDomainKey[] }
  | Exclude<SubmissionReconstruction, { status: "reconstructed" }>;

async function readRecord(
  withActor: WithActor,
  token: string | null,
  submissionRequestId: string,
): Promise<Read> {
  try {
    return await withActor(token, async (tx): Promise<Read> => {
      const { rows } = await tx.query<RecordRow>(RECORD_SQL, [submissionRequestId]);
      const row = rows.length === 1 ? rows[0] : undefined;
      if (row?.outcome === "unauthenticated" || row?.outcome === "not_found") return { status: row.outcome };
      if (row?.outcome === "unavailable") return { status: "unavailable", stage: "record", code: "record_unavailable" };
      const record = row?.outcome === "found" ? recordFrom(row) : null;
      if (record === null) return { status: "unavailable", stage: "record", code: "record_malformed" };
      const keys = await readEvidenceDomainKeys(tx, record.evidenceDomainId);
      if (keys.status !== "ok") return { status: "unavailable", stage: "record", code: "domain_keys_unavailable" };
      return { status: "found", record, keys: keys.keys };
    });
  } catch {
    return { status: "unavailable", stage: "record", code: "record_failed" };
  }
}

/**
 * The reconstruction of the revision a submission request names, for the
 * session behind `token` only. The request id comes from the server's own
 * `request_submission` answer; a value that is not a UUID is `not_found`.
 */
export async function reconstructSubmissionRecord(
  dependencies: SubmissionRecordDependencies,
  token: string | null,
  submissionRequestId: string,
): Promise<SubmissionReconstruction> {
  if (!UUID.test(submissionRequestId)) return { status: "not_found" };
  const read = await readRecord(dependencies.withActor, token, submissionRequestId);
  if (read.status !== "found") return read;
  const outcome = await reconstructSubmission(
    {
      payloads: bindPayloadReader(dependencies.payloads, read.record.institutionId),
      replayer: createEditStepsV1Replayer(),
      keys: read.keys,
    },
    read.record,
  );
  return { status: "reconstructed", record: read.record, outcome };
}
