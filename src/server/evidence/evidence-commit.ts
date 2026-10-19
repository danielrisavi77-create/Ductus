import {
  isEvidencePackageId,
  isSha256Hex,
  type EvidenceSegmentDescriptorV2,
} from "@/application/ports/evidence-ingest";
import { isInstitutionId } from "@/application/ports/evidence-object-key";
import type { SigningKeyProvider } from "@/application/ports/signing-key-provider";
import {
  digestEvidenceReceiptPayloadV2,
  isEvidenceDomainId,
  isEvidenceReceiptPayloadV2,
  type EvidenceReceiptPayloadV2,
  type SignedEvidenceReceiptV2,
} from "@/domain/forensics/evidence-receipt";
import {
  verifySignedEvidenceReceiptV2,
  type EvidenceReceiptExpectationV2,
} from "@/domain/forensics/evidence-receipt-verifier";
import { canonicalizeJcs } from "@/domain/forensics/jcs";
import { isSignatureEnvelope, type SignatureEnvelope } from "@/domain/forensics/signature";
import type { ActorTransaction, WithActor } from "@/server/db/with-actor";

import { readEvidenceDomainKeys } from "./evidence-domain-keys";

/**
 * B-8 step 4c (docs/BACKEND.md 4.13 t. 3.2, 3.6, 4 and 7): the database side
 * of the ingest route. The context is the cheap check before any expensive
 * work; the commit is one withActor transaction in which the acceptance RPC,
 * the signature over its receipt and the RPC that attaches it either all
 * happen or none does (ADR 2026-10-11, owner decision 6). A retry gets the
 * stored receipt only after it verifies under a key from the registry, and
 * never a new signature. Every fault is a closed code, never a message.
 */

export type EvidenceCommitContext = {
  evidencePackageId: string;
  institutionId: string;
  evidenceDomainId: string;
  evidenceProfileId: string;
  maxPayloadBytes: number;
  transactionKnown: boolean;
  /** The chain as the context read it, unlocked: the acceptance checks it again (F-099). */
  state: EvidenceCommitState;
};

export type EvidenceCommitContextResult =
  | { status: "ok"; context: EvidenceCommitContext }
  | { status: "unauthenticated" | "not_found" | "invalid" | "not_accepting" }
  | { status: "unavailable"; stage: "context"; code: "context_failed" | "context_malformed" };

const CONTEXT_SQL = `SELECT outcome, evidence_package_id, institution_id, evidence_domain_id, evidence_profile_id,
       max_payload_bytes, transaction_known, current_revision, document_hash, head_segment_hash, last_sequence_to
  FROM app.evidence_commit_context($1, $2)`;

type ContextRow = Record<
  | "outcome"
  | "evidence_package_id"
  | "institution_id"
  | "evidence_domain_id"
  | "evidence_profile_id"
  | "max_payload_bytes"
  | "transaction_known"
  | "current_revision"
  | "document_hash"
  | "head_segment_hash"
  | "last_sequence_to",
  unknown
>;

export async function readEvidenceCommitContext(
  withActor: WithActor,
  token: string | null,
  documentId: string,
  clientTransactionId: string,
): Promise<EvidenceCommitContextResult> {
  let rows: ContextRow[];
  try {
    ({ rows } = await withActor(token, (tx) => tx.query<ContextRow>(CONTEXT_SQL, [documentId, clientTransactionId])));
  } catch {
    return { status: "unavailable", stage: "context", code: "context_failed" };
  }
  const row = rows.length === 1 ? rows[0] : undefined;
  if (
    row?.outcome === "unauthenticated" ||
    row?.outcome === "not_found" ||
    row?.outcome === "invalid" ||
    row?.outcome === "not_accepting"
  ) {
    return { status: row.outcome };
  }
  if (
    row?.outcome !== "ok" ||
    !isEvidencePackageId(row.evidence_package_id) ||
    !isInstitutionId(row.institution_id) ||
    !isEvidenceDomainId(row.evidence_domain_id) ||
    typeof row.evidence_profile_id !== "string" ||
    row.evidence_profile_id === "" ||
    !Number.isSafeInteger(row.max_payload_bytes) ||
    Number(row.max_payload_bytes) < 1 ||
    typeof row.transaction_known !== "boolean"
  ) {
    return { status: "unavailable", stage: "context", code: "context_malformed" };
  }
  const currentRevision = count(row.current_revision);
  const lastSequenceTo = count(row.last_sequence_to);
  const documentHash = row.document_hash;
  const head = row.head_segment_hash;
  if (currentRevision === null || lastSequenceTo === null || !isSha256Hex(documentHash) || !(head === null || isSha256Hex(head))) {
    return { status: "unavailable", stage: "context", code: "context_malformed" };
  }
  return {
    status: "ok",
    context: {
      evidencePackageId: row.evidence_package_id,
      institutionId: row.institution_id,
      evidenceDomainId: row.evidence_domain_id,
      evidenceProfileId: row.evidence_profile_id,
      maxPayloadBytes: Number(row.max_payload_bytes),
      transactionKnown: row.transaction_known,
      state: { currentRevision, documentHash, headSegmentHash: head, lastSequenceTo },
    },
  };
}

/** Everything the commit needs; checked before this point (4d), and again by the RPC. */
export type EvidenceCommitInput = {
  context: EvidenceCommitContext;
  documentId: string;
  clientTransactionId: string;
  baseRevision: number;
  initialDocumentHash: string;
  finalDocumentHash: string;
  descriptor: EvidenceSegmentDescriptorV2;
  storageRef: string;
  /** Exact JCS bytes of the document after the segment (4.10 t. 2). */
  snapshot: string;
};

export type EvidenceCommitState = {
  currentRevision: number;
  documentHash: string;
  headSegmentHash: string | null;
  lastSequenceTo: number;
};

export type EvidenceCommitFault =
  | "commit_failed"
  | "commit_rows"
  | "outcome_unknown"
  | "duplicate_pending"
  | "state_malformed"
  | "receipt_malformed"
  | "receipt_mismatch"
  | "domain_keys_unavailable"
  | "signing_failed"
  | "signature_unverified"
  | "attach_refused"
  | "stored_receipt_unverified";

export type EvidenceCommitOutcome =
  | { status: "committed" | "duplicate"; revision: number; signedReceipt: SignedEvidenceReceiptV2 }
  | { status: "stale_base" | "chain_conflict" | "not_continuous"; state: EvidenceCommitState }
  | { status: "txid_reused" | "invalid" | "too_large" | "not_accepting" | "not_found" }
  | { status: "unavailable"; stage: "signing" | "repository"; code: EvidenceCommitFault };

export type EvidenceCommitDependencies = { withActor: WithActor; signer: SigningKeyProvider };

const COMMIT_SQL = `SELECT outcome, committed_revision, receipt_payload, receipt_id, signature,
       current_revision, document_hash, head_segment_hash, last_sequence_to
  FROM app.commit_evidence_segment($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)`;
const ATTACH_SQL = "SELECT outcome FROM app.attach_receipt_signature($1::uuid, $2, $3::jsonb)";

type CommitRow = Record<
  | "outcome"
  | "committed_revision"
  | "receipt_payload"
  | "receipt_id"
  | "signature"
  | "current_revision"
  | "document_hash"
  | "head_segment_hash"
  | "last_sequence_to",
  unknown
>;

/** Thrown inside the transaction, so withActor rolls all of it back. */
class CommitFault extends Error {
  constructor(
    readonly stage: "signing" | "repository",
    readonly code: EvidenceCommitFault,
  ) {
    super(code);
  }
}

function fault(stage: "signing" | "repository", code: EvidenceCommitFault): never {
  throw new CommitFault(stage, code);
}

/** A bigint column as the driver gives it (text), or a number; null for anything else. */
function count(value: unknown): number | null {
  const n = typeof value === "string" && /^(0|[1-9][0-9]{0,15})$/.test(value) ? Number(value) : value;
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null;
}

function conflictState(row: CommitRow): EvidenceCommitState {
  const currentRevision = count(row.current_revision);
  const lastSequenceTo = count(row.last_sequence_to);
  if (
    currentRevision === null ||
    lastSequenceTo === null ||
    !isSha256Hex(row.document_hash) ||
    !(row.head_segment_hash === null || isSha256Hex(row.head_segment_hash))
  ) {
    fault("repository", "state_malformed");
  }
  return { currentRevision, documentHash: row.document_hash, headSegmentHash: row.head_segment_hash, lastSequenceTo };
}

/** The signature in one fixed key order, so a duplicate repeats the bytes of the first answer. */
function envelope(value: unknown): SignatureEnvelope | null {
  if (!isSignatureEnvelope(value)) return null;
  const { algorithm, keyId, keyVersion, signatureEncoding, signatureBase64Url } = value;
  return { algorithm, keyId, keyVersion, signatureEncoding, signatureBase64Url };
}

/**
 * The receipt payload the RPC returned: a valid v2 payload whose JCS is the
 * returned text byte for byte, for this request's document, transaction,
 * package, domain, segment and the revision after its base.
 */
async function returnedReceipt(row: CommitRow, input: EvidenceCommitInput) {
  let payload: EvidenceReceiptPayloadV2;
  let digest: Awaited<ReturnType<typeof digestEvidenceReceiptPayloadV2>>;
  try {
    const parsed: unknown = typeof row.receipt_payload === "string" ? JSON.parse(row.receipt_payload) : null;
    if (!isEvidenceReceiptPayloadV2(parsed) || canonicalizeJcs(parsed) !== row.receipt_payload) throw new Error();
    payload = parsed;
    digest = await digestEvidenceReceiptPayloadV2(payload);
  } catch {
    fault("repository", "receipt_malformed");
  }
  const revision = input.baseRevision + 1;
  if (
    payload.documentId !== input.documentId ||
    payload.clientTransactionId !== input.clientTransactionId ||
    payload.segmentHash !== input.descriptor.segmentHash ||
    payload.segmentId !== input.descriptor.segmentId ||
    payload.evidencePackageId !== input.context.evidencePackageId ||
    payload.evidenceDomainId !== input.context.evidenceDomainId ||
    payload.revision !== revision ||
    count(row.committed_revision) !== revision ||
    row.receipt_id !== payload.receiptId
  ) {
    fault("repository", "receipt_mismatch");
  }
  return { payload, digest };
}

/** Verified only under a receipt key of the package's domain read from the registry. */
async function verifyUnderRegistry(
  tx: ActorTransaction,
  signedReceipt: SignedEvidenceReceiptV2,
  input: EvidenceCommitInput,
): Promise<boolean> {
  const keys = await readEvidenceDomainKeys(tx, input.context.evidenceDomainId);
  if (keys.status !== "ok") fault("repository", "domain_keys_unavailable");
  const expected: EvidenceReceiptExpectationV2 = {
    documentId: input.documentId,
    clientTransactionId: input.clientTransactionId,
    revision: input.baseRevision + 1,
    evidenceDomainId: input.context.evidenceDomainId,
  };
  return (await verifySignedEvidenceReceiptV2(signedReceipt, expected, keys.keys)).ok;
}

async function signReserved(
  tx: ActorTransaction,
  signer: SigningKeyProvider,
  row: CommitRow,
  input: EvidenceCommitInput,
): Promise<EvidenceCommitOutcome> {
  const { payload, digest } = await returnedReceipt(row, input);
  let signature: SignatureEnvelope | null;
  try {
    signature = envelope(await signer.sign(digest.signingInput));
  } catch {
    fault("signing", "signing_failed");
  }
  if (signature === null) fault("signing", "signing_failed");
  const signedReceipt = { payload, payloadDigestSha256: digest.sha256, signature };
  if (!(await verifyUnderRegistry(tx, signedReceipt, input))) fault("signing", "signature_unverified");
  const attached = await tx.query<{ outcome: unknown }>(ATTACH_SQL, [
    payload.receiptId,
    digest.sha256,
    JSON.stringify(signature),
  ]);
  if (attached.rows.length !== 1 || attached.rows[0].outcome !== "signed") fault("repository", "attach_refused");
  return { status: "committed", revision: payload.revision, signedReceipt };
}

/** The stored receipt of a retry, rebuilt and verified; never signed again. */
async function storedReceipt(
  tx: ActorTransaction,
  row: CommitRow,
  input: EvidenceCommitInput,
): Promise<EvidenceCommitOutcome> {
  const { payload, digest } = await returnedReceipt(row, input);
  const signature = envelope(row.signature);
  if (signature === null) fault("repository", "stored_receipt_unverified");
  const signedReceipt = { payload, payloadDigestSha256: digest.sha256, signature };
  if (!(await verifyUnderRegistry(tx, signedReceipt, input))) fault("repository", "stored_receipt_unverified");
  return { status: "duplicate", revision: payload.revision, signedReceipt };
}

async function runCommit(
  tx: ActorTransaction,
  signer: SigningKeyProvider,
  input: EvidenceCommitInput,
): Promise<EvidenceCommitOutcome> {
  const { rows } = await tx.query<CommitRow>(COMMIT_SQL, [
    input.context.evidencePackageId,
    input.clientTransactionId,
    input.baseRevision,
    input.initialDocumentHash,
    input.finalDocumentHash,
    JSON.stringify(input.descriptor),
    input.descriptor.segmentHash,
    input.storageRef,
    input.snapshot,
  ]);
  if (rows.length !== 1) fault("repository", "commit_rows");
  const row = rows[0];
  // The closed mapping of 4.13 t. 4; an outcome not named here is never a success.
  switch (row.outcome) {
    case "reserved":
      return signReserved(tx, signer, row, input);
    case "duplicate_signed":
      return storedReceipt(tx, row, input);
    case "unauthorized":
      return { status: "not_found" };
    case "context_mismatch":
    case "invalid":
      return { status: "invalid" };
    case "idempotency_conflict":
      return { status: "txid_reused" };
    case "not_accepting":
    case "too_large":
      return { status: row.outcome };
    case "stale_base":
    case "chain_conflict":
    case "not_continuous":
      return { status: row.outcome, state: conflictState(row) };
    case "duplicate_pending":
      // Cannot exist in the demo (ADR decision 6); never signed here.
      return fault("repository", "duplicate_pending");
    default:
      return fault("repository", "outcome_unknown");
  }
}

/**
 * One transaction under the session behind `token`. A thrown fault, a failed
 * query or a failed COMMIT rolls back everything the RPC wrote, so there is
 * no revision, segment, snapshot or receipt without its signature.
 */
export async function commitEvidenceSegment(
  dependencies: EvidenceCommitDependencies,
  token: string | null,
  input: EvidenceCommitInput,
): Promise<EvidenceCommitOutcome> {
  try {
    return await dependencies.withActor(token, (tx) => runCommit(tx, dependencies.signer, input));
  } catch (error) {
    return error instanceof CommitFault
      ? { status: "unavailable", stage: error.stage, code: error.code }
      : { status: "unavailable", stage: "repository", code: "commit_failed" };
  }
}
