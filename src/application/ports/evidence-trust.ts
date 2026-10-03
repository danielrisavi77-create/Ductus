import type { EvidenceSegmentDescriptorV2 } from "./evidence-ingest";
import type {
  EvidenceReceiptPayloadV1,
  SignedEvidenceReceipt,
} from "@/domain/forensics/evidence-receipt";

export type EvidencePackageContext = {
  evidencePackageId: string;
  documentId: string;
  evidenceProfileId: string;
  maxPayloadBytes: number;
  acceptsEvidence: boolean;
};

export type EvidenceContextResolution =
  | { status: "found"; context: EvidencePackageContext }
  | { status: "not_found" }
  | { status: "unavailable"; reason: string };

export interface EvidenceContextPort {
  resolve(evidencePackageId: string): Promise<EvidenceContextResolution>;
}

export type EvidencePayloadPutResult =
  | { status: "stored"; storageRef: string }
  | { status: "existing"; storageRef: string }
  | { status: "conflict" }
  | { status: "unavailable"; reason: string };

export interface EvidencePayloadStore {
  /**
   * Stores exact canonical bytes immutably. Repeating the same package/hash
   * with identical bytes is idempotent; different bytes at that key conflict.
   */
  putImmutable(input: {
    evidencePackageId: string;
    segmentHash: string;
    canonicalPayload: string;
  }): Promise<EvidencePayloadPutResult>;
}

export type EvidenceAcceptanceRecord = {
  clientRequestId: string;
  principalId: string;
  storageRef: string;
  descriptor: EvidenceSegmentDescriptorV2;
  receiptPayload: EvidenceReceiptPayloadV1;
  status: "pending_signature" | "signed";
  signedReceipt?: SignedEvidenceReceipt;
};

export type EvidenceAcceptanceIdentity = {
  clientRequestId: string;
  principalId: string;
  evidencePackageId: string;
  descriptor: EvidenceSegmentDescriptorV2;
};

export type LookupEvidenceAcceptanceResult =
  | { status: "not_found" }
  | { status: "duplicate_pending"; record: EvidenceAcceptanceRecord }
  | { status: "duplicate_signed"; record: EvidenceAcceptanceRecord }
  | { status: "idempotency_conflict" }
  | { status: "unavailable"; reason: string };

export type ReserveEvidenceAcceptanceInput = {
  clientRequestId: string;
  principalId: string;
  storageRef: string;
  descriptor: EvidenceSegmentDescriptorV2;
};

export type ReserveEvidenceAcceptanceResult =
  | { status: "reserved"; record: EvidenceAcceptanceRecord }
  | { status: "duplicate_pending"; record: EvidenceAcceptanceRecord }
  | { status: "duplicate_signed"; record: EvidenceAcceptanceRecord }
  | { status: "idempotency_conflict" }
  | { status: "invalid" }
  | { status: "unauthorized" }
  | { status: "not_accepting" }
  | { status: "too_large" }
  | { status: "context_mismatch" }
  | { status: "concurrent_conflict" }
  | {
      status: "chain_conflict";
      expectedPreviousSegmentHash: string | null;
    }
  | { status: "unavailable"; reason: string };

/**
 * Canonical metadata boundary.
 *
 * reserve() must atomically enforce:
 * - idempotency key uniqueness in its scope;
 * - predecessor/hash-chain head;
 * - one accepted segment transition at a time for an evidence package.
 *
 * It mints receiptId + acceptedAt inside the canonical reserve transaction,
 * then advances metadata to pending_signature before the signing call. A retry
 * of the same command must return duplicate_pending so the exact same receipt
 * payload can be signed later without minting a new acceptance time/id.
 */
export interface EvidenceAcceptanceRepository {
  lookup(
    input: EvidenceAcceptanceIdentity,
  ): Promise<LookupEvidenceAcceptanceResult>;

  reserve(
    input: ReserveEvidenceAcceptanceInput,
  ): Promise<ReserveEvidenceAcceptanceResult>;

  attachSignature(input: {
    receiptId: string;
    signedReceipt: SignedEvidenceReceipt;
  }): Promise<
    | { status: "attached" }
    | { status: "already_attached"; receipt: SignedEvidenceReceipt }
    | { status: "conflict" }
    | { status: "not_found" }
    | { status: "unavailable"; reason: string }
  >;
}
