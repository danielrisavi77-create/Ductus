import {
  decideSubmission,
  issueSubmissionReceipt,
  type SubmissionBlockReason,
} from "@/application/evidence/submission-decision";
import type { InstitutionEvidencePayloadReader } from "@/application/ports/evidence-reconstruction";
import type { SigningKeyProvider } from "@/application/ports/signing-key-provider";
import {
  isSubmissionInstant,
  SUBMISSION_RECEIPT_SCHEMA_V1,
  type SignedSubmissionReceiptV1,
} from "@/domain/forensics/submission-receipt";
import type { WithActor } from "@/server/db/with-actor";

import { reconstructSubmissionRecord } from "./submission-record";

/**
 * B-12 step 4b2 (docs/BACKEND.md 4.6; contract on #385): a student's
 * submission. The request is written first, with the database clock at the
 * click, in its own transaction; the record of its revision is then
 * reconstructed and only a `submit` decision lets `record_submission` run,
 * with the hash of the reconstructed document, never a value of the request.
 * The receipt is signed from the stored submission on every answer (P4).
 */

export type SubmissionStage = "request" | "record" | "chain" | "storage" | "verification" | "submission" | "signing";

export type SubmissionOutcome =
  | { status: "submitted"; receipt: SignedSubmissionReceiptV1 }
  | { status: "blocked"; reason: SubmissionBlockReason }
  | { status: "stale_revision"; currentRevision: number }
  | { status: "already_requested"; revision: number }
  | { status: "not_acknowledged" | "not_open" | "not_found" | "unauthenticated" | "invalid" }
  | { status: "unavailable"; stage: SubmissionStage; code: string };

export type SubmissionDependencies = {
  withActor: WithActor;
  payloads: InstitutionEvidencePayloadReader;
  signer: SigningKeyProvider;
};

// Times as the database writes them, with microseconds, in UTC (#460 limit 6).
const US = (column: string) => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const REQUEST_SQL = `SELECT outcome, submission_request_id, revision
  FROM app.request_submission($1, $2)`;
const ACTOR_SQL = "SELECT app.current_user_id() AS user_id";
const RECORD_SQL ="SELECT outcome, submission_id FROM app.record_submission($1::uuid, $2)";
const STORED_SQL = `SELECT id::text, assignment_id::text, assignment_version, revision::text, artifact_hash,
       ${US("requested_at")} AS requested_at, ${US("due_at")} AS due_at, after_deadline
  FROM evidence.submission WHERE id = $1::uuid`;

const unavailable = (stage: SubmissionStage, code: string): SubmissionOutcome => ({ status: "unavailable", stage, code });

type RequestRow = { outcome: unknown; submission_request_id: unknown; revision: unknown };

/** The click: a session, then `request_submission`. Committed before any reconstruction. */
async function request(deps: SubmissionDependencies, token: string, documentId: string, revision: number) {
  return deps.withActor(token, async (tx): Promise<SubmissionOutcome | { status: "requested"; id: string }> => {
    // A missing or ended session is told apart from a refusal (401, not 404).
    const actor = await tx.query<{ user_id: unknown }>(ACTOR_SQL);
    if (typeof actor.rows[0]?.user_id !== "string") return { status: "unauthenticated" };
    const { rows } = await tx.query<RequestRow>(REQUEST_SQL, [documentId, revision]);
    const row = rows.length === 1 ? rows[0] : undefined;
    switch (row?.outcome) {
      case "requested":
      case "existing": {
        if (typeof row.submission_request_id !== "string") return unavailable("request", "request_malformed");
        // The first click binds (P5, P8); a click naming another revision is told
        // which one was requested, never answered about it (owner, #87 6264259216).
        if (row.outcome === "existing") {
          const requested = Number(row.revision);
          if (row.revision === null || !Number.isSafeInteger(requested) || requested < 1) {
            return unavailable("request", "request_malformed");
          }
          if (requested !== revision) return { status: "already_requested", revision: requested };
        }
        return { status: "requested", id: row.submission_request_id };
      }
      case "unauthorized":
        return { status: "not_found" };
      case "invalid":
      case "not_acknowledged":
      case "not_open":
        return { status: row.outcome };
      case "no_evidence":
        return { status: "blocked", reason: "no_evidence" };
      case "stale_revision": {
        const current = Number(row.revision);
        return Number.isSafeInteger(current) && current >= 0
          ? { status: "stale_revision", currentRevision: current }
          : unavailable("request", "request_malformed");
      }
      default:
        return unavailable("request", "request_outcome_unknown");
    }
  });
}

type StoredRow = Record<
  "id" | "assignment_id" | "assignment_version" | "revision" | "artifact_hash" | "requested_at" | "due_at" | "after_deadline",
  unknown
>;

export async function submitWork(
  deps: SubmissionDependencies,
  token: string,
  input: { documentId: string; revision: number },
): Promise<SubmissionOutcome> {
  let requested: Awaited<ReturnType<typeof request>>;
  try {
    requested = await request(deps, token, input.documentId, input.revision);
  } catch {
    return unavailable("request", "request_failed");
  }
  if (requested.status !== "requested") return requested;

  const read = await reconstructSubmissionRecord(deps, token, requested.id);
  if (read.status === "unavailable") return unavailable("record", read.code);
  if (read.status !== "reconstructed") return { status: read.status };
  const decision = decideSubmission(read.outcome);
  if (decision.decision === "blocked") return { status: "blocked", reason: decision.reason };
  if (decision.decision === "retry") return unavailable(decision.stage, "reconstruction_unavailable");

  let stored: StoredRow | SubmissionOutcome;
  try {
    stored = await deps.withActor(token, async (tx) => {
      // The session can end while the record is read (logout in another tab): 401, as in step 1.
      const actor = await tx.query<{ user_id: unknown }>(ACTOR_SQL);
      if (typeof actor.rows[0]?.user_id !== "string") return { status: "unauthenticated" } as const;
      const recorded = await tx.query<{ outcome: unknown; submission_id: unknown }>(RECORD_SQL, [
        requested.id,
        decision.artifactSha256,
      ]);
      const outcome = recorded.rows.length === 1 ? recorded.rows[0].outcome : undefined;
      if (outcome === "unauthorized") return { status: "not_found" } as const;
      // The stored revision's hash is not the reconstructed one: never a success.
      if (outcome === "artifact_mismatch") return { status: "blocked", reason: "record_mismatch" } as const;
      if (outcome !== "recorded" && outcome !== "existing") return unavailable("submission", "submission_outcome_unknown");
      const { rows } = await tx.query<StoredRow>(STORED_SQL, [recorded.rows[0].submission_id]);
      return rows.length === 1 ? rows[0] : unavailable("submission", "submission_malformed");
    });
  } catch {
    return unavailable("submission", "submission_failed");
  }
  if ("status" in stored) return stored;

  const { record } = read;
  if (
    typeof stored.id !== "string" ||
    typeof stored.assignment_id !== "string" ||
    typeof stored.assignment_version !== "number" ||
    stored.revision !== String(record.revision) ||
    stored.artifact_hash !== decision.artifactSha256 ||
    !isSubmissionInstant(stored.requested_at) ||
    !isSubmissionInstant(stored.due_at) ||
    typeof stored.after_deadline !== "boolean"
  ) {
    return unavailable("submission", "submission_malformed");
  }
  const issued = await issueSubmissionReceipt(deps.signer, {
    receiptSchema: SUBMISSION_RECEIPT_SCHEMA_V1,
    submissionId: stored.id,
    evidenceDomainId: record.evidenceDomainId,
    principalId: record.principalId,
    assignmentId: stored.assignment_id,
    assignmentVersion: stored.assignment_version,
    documentId: record.documentId,
    evidencePackageId: record.evidencePackageId,
    revision: record.revision,
    artifactSha256: decision.artifactSha256,
    evidenceHeadSegmentHash: decision.evidenceHeadSegmentHash,
    evidenceRecord: decision.evidenceRecord,
    requestedAt: stored.requested_at,
    dueAt: stored.due_at,
    afterDeadline: stored.after_deadline,
  });
  return issued.status === "signed"
    ? { status: "submitted", receipt: issued.receipt }
    : unavailable("signing", issued.reason);
}
