import type { EvidenceDomainKey } from "@/domain/forensics/evidence-receipt-verifier";
import type { SignatureEnvelope } from "@/domain/forensics/signature";

/**
 * One row of `app.worker_pending_receipts`: a v2 receipt with no signature
 * yet, as the text the database stores. The text, not a parsed copy, is what
 * the database hashes when it checks the digest of a signature.
 */
export type PendingReceiptRow = {
  receiptId: string;
  receiptPayloadText: string;
};

export type ReceiptKeysRead =
  | { status: "ok"; keys: readonly EvidenceDomainKey[] }
  | { status: "unavailable"; reason: string };

export type AttachReceiptSignatureCommand = {
  receiptId: string;
  payloadDigestSha256: string;
  signature: SignatureEnvelope;
};

/**
 * The outcomes of `app.worker_attach_receipt_signature`. The row is locked
 * (`FOR UPDATE`), so of two concurrent attaches one is `signed` and the other
 * `already_signed` with the signature that was stored first. `unavailable`
 * is the adapter's: the call did not complete and nothing is known of it.
 */
export type AttachReceiptSignatureOutcome =
  | { outcome: "signed"; signature: unknown }
  | { outcome: "already_signed"; signature: unknown }
  | {
      outcome:
        | "invalid"
        | "not_found"
        | "unsupported_schema"
        | "digest_mismatch"
        | "key_unknown"
        | "key_scope"
        | "key_revoked"
        | "key_not_valid";
    }
  | { outcome: "unavailable"; reason: string };

/**
 * The worker's side of the receipt store (D-71, D-102): only the worker
 * process holds it, and the web process has neither this port nor a key.
 */
export interface PendingReceiptStore {
  /** Every receipt key of the domain, revoked and retired ones included. */
  receiptKeys(evidenceDomainId: string): Promise<ReceiptKeysRead>;
  attachSignature(
    command: AttachReceiptSignatureCommand,
  ): Promise<AttachReceiptSignatureOutcome>;
}

/**
 * One row of `app.worker_pending_backlog`: how many receipts of one domain
 * wait for a signature, and since when by the database clock (ISO 8601).
 * No receipt id or payload is in it (plan #1021 P-10, P-20).
 */
export type PendingBacklogRow = {
  evidenceDomainId: string;
  pendingCount: number;
  oldestCreatedAt: string;
};

export type PendingBacklogRead =
  | { status: "ok"; rows: readonly PendingBacklogRow[] }
  | { status: "unavailable"; reason: string };

export type PendingReceiptsRead =
  | { status: "ok"; rows: readonly PendingReceiptRow[] }
  | { status: "unavailable"; reason: string };

/**
 * The worker's read side of the pending receipts: the backlog per domain and
 * at most 100 pending v2 receipts of one domain, oldest first
 * (`app.worker_pending_receipts`). With `afterReceiptId` the list starts
 * after that receipt in the same order (created_at, id); null, or a receipt
 * of another domain, starts at the oldest. Only the worker process holds it
 * (D-71, D-102).
 */
export interface PendingReceiptQueue {
  backlog(): Promise<PendingBacklogRead>;
  pendingReceipts(evidenceDomainId: string, limit: number, afterReceiptId: string | null): Promise<PendingReceiptsRead>;
}
