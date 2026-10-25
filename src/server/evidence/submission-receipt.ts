import type { SigningKeyProvider } from "@/application/ports/signing-key-provider";
import { isSignatureEnvelope } from "@/domain/forensics/signature";
import {
  digestSubmissionReceiptPayloadV2,
  isSignedSubmissionReceiptV2,
  isSubmissionReceiptPayloadV2,
  type SignedSubmissionReceiptV2,
} from "@/domain/forensics/submission-receipt-v2";
import type { SubmissionReceiptExpectationV2 } from "@/domain/forensics/submission-receipt-verifier-v2";
import type { WithActor } from "@/server/db/with-actor";

/**
 * DAN-291 (#746, 291b): the submission receipt v2 is signed and bound once,
 * then returned unchanged (docs/contracts/submission-receipt-v2.md). A bound
 * receipt is read first and returned without the signer. Otherwise the
 * database freezes an attempt in a short transaction, the web process checks
 * the frozen text against the submission, signs and verifies it outside any
 * transaction, and binds it in a new one. Every success hands out the row the
 * database stored, never the signature made here, so the first answer equals
 * every later one, also when two tabs race (R2). Anything else fails closed.
 */

export type SubmissionReceiptIssue =
  | { status: "signed"; receipt: SignedSubmissionReceiptV2 }
  | { status: "unavailable"; code: string };

export type SubmissionReceiptDependencies = { withActor: WithActor; signer: SigningKeyProvider };

const READ_SQL = `SELECT outcome, receipt_payload, payload_digest_sha256, signature
  FROM app.read_submission_receipt($1::uuid)`;
const PREPARE_SQL = `SELECT outcome, issuance_id::text AS issuance_id, receipt_payload, payload_digest_sha256
  FROM app.prepare_submission_receipt($1::uuid, $2, $3)`;
const ATTACH_SQL = `SELECT outcome, receipt_payload, payload_digest_sha256, signature
  FROM app.attach_submission_receipt($1::uuid, $2, $3::jsonb)`;

type ReceiptRow = Record<"outcome" | "receipt_payload" | "payload_digest_sha256" | "signature", unknown>;
type PreparedRow = Record<"outcome" | "issuance_id" | "receipt_payload" | "payload_digest_sha256", unknown>;

const fail = (code: string): SubmissionReceiptIssue => ({ status: "unavailable", code });
const single = <T>(rows: T[]): T | undefined => (rows.length === 1 ? rows[0] : undefined);

/** The database text must be v2, byte for byte its own JCS, hash to the stored digest and name this submission. */
async function checkedPayload(text: unknown, digest: unknown, expected: SubmissionReceiptExpectationV2) {
  if (typeof text !== "string" || typeof digest !== "string") return null;
  try {
    const payload: unknown = JSON.parse(text);
    if (!isSubmissionReceiptPayloadV2(payload)) return null;
    const computed = await digestSubmissionReceiptPayloadV2(payload);
    if (computed.canonical !== text || computed.sha256 !== digest) return null;
    const named = payload as Record<string, unknown>;
    if (Object.entries(expected).some(([field, value]) => named[field] !== value)) return null;
    return { payload, ...computed };
  } catch {
    return null;
  }
}

/** A stored row as the receipt on the wire, or null when any part is not what this submission needs. */
async function storedReceipt(row: ReceiptRow, expected: SubmissionReceiptExpectationV2) {
  const checked = await checkedPayload(row.receipt_payload, row.payload_digest_sha256, expected);
  if (!checked) return null;
  const receipt = { payload: checked.payload, payloadDigestSha256: checked.sha256, signature: row.signature };
  return isSignedSubmissionReceiptV2(receipt) ? receipt : null;
}

export async function issueSubmissionReceiptV2(
  deps: SubmissionReceiptDependencies,
  token: string,
  expected: SubmissionReceiptExpectationV2,
): Promise<SubmissionReceiptIssue> {
  try {
    const { rows } = await deps.withActor(token, (tx) => tx.query<ReceiptRow>(READ_SQL, [expected.submissionId]));
    const read = single(rows);
    if (read?.outcome === "found") {
      const receipt = await storedReceipt(read, expected);
      return receipt ? { status: "signed", receipt } : fail("receipt_stored_malformed");
    }
    if (read?.outcome !== "none") return fail("receipt_read_outcome");
  } catch {
    return fail("receipt_read_failed");
  }

  let prepared: PreparedRow | undefined;
  let keyId: string;
  let keyVersion: string;
  try {
    ({ keyId, keyVersion } = await deps.signer.publicVerificationKey());
    const { rows } = await deps.withActor(token, (tx) =>
      tx.query<PreparedRow>(PREPARE_SQL, [expected.submissionId, keyId, keyVersion]),
    );
    prepared = single(rows);
  } catch {
    return fail("receipt_prepare_failed");
  }
  if (prepared?.outcome !== "prepared" || typeof prepared.issuance_id !== "string") return fail("receipt_prepare_outcome");
  const issuanceId = prepared.issuance_id;
  const checked = await checkedPayload(prepared.receipt_payload, prepared.payload_digest_sha256, expected);
  if (!checked) return fail("receipt_payload_mismatch");

  let signature: unknown;
  try {
    signature = await deps.signer.sign(checked.signingInput);
    if (
      !isSignatureEnvelope(signature) ||
      signature.algorithm !== "Ed25519" ||
      signature.keyId !== keyId ||
      signature.keyVersion !== keyVersion ||
      (await deps.signer.verify(checked.signingInput, signature)) !== true
    ) {
      return fail("signing");
    }
  } catch {
    return fail("signing");
  }

  try {
    const { rows } = await deps.withActor(token, (tx) =>
      tx.query<ReceiptRow>(ATTACH_SQL, [issuanceId, checked.sha256, JSON.stringify(signature)]),
    );
    const bound = single(rows);
    if (bound?.outcome !== "attached" && bound?.outcome !== "existing") return fail("receipt_attach_outcome");
    const receipt = await storedReceipt(bound, expected);
    return receipt ? { status: "signed", receipt } : fail("receipt_attached_malformed");
  } catch {
    return fail("receipt_attach_failed");
  }
}
