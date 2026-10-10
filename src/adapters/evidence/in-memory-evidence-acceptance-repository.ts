import type {
  EvidenceChainReadResult,
  EvidenceChainReader,
} from "@/application/ports/evidence-reconstruction";
import type {
  EvidenceAcceptanceIdentity,
  EvidenceAcceptanceRecord,
  EvidenceAcceptanceRepository,
  LookupEvidenceAcceptanceResult,
  ReserveEvidenceAcceptanceInput,
  ReserveEvidenceAcceptanceResult,
} from "@/application/ports/evidence-trust";
import {
  digestEvidenceReceiptPayload,
  EVIDENCE_RECEIPT_SCHEMA_V1,
} from "@/domain/forensics/evidence-receipt";
import { canonicalizeJcs } from "@/domain/forensics/jcs";

type ChainHead = {
  segmentHash: string;
  receiptId: string;
  /** Number of segments accepted into the package so far. */
  segmentCount: number;
};

function cloneRecord(record: EvidenceAcceptanceRecord): EvidenceAcceptanceRecord {
  return structuredClone(record);
}

function requestKey(input: {
  principalId: string;
  descriptor: { evidencePackageId: string };
  clientRequestId: string;
}): string {
  return canonicalizeJcs([
    input.principalId,
    input.descriptor.evidencePackageId,
    input.clientRequestId,
  ]);
}

export class InMemoryEvidenceAcceptanceRepository
  implements EvidenceAcceptanceRepository, EvidenceChainReader
{
  private readonly clock: () => string;
  private readonly idFactory: () => string;
  private readonly byRequest = new Map<string, EvidenceAcceptanceRecord>();
  private readonly byReceipt = new Map<string, EvidenceAcceptanceRecord>();
  private readonly heads = new Map<string, ChainHead>();

  lookupUnavailableReason: string | null = null;
  reserveUnavailableReason: string | null = null;
  attachUnavailableReason: string | null = null;

  constructor(options: {
    clock?: () => string;
    idFactory?: () => string;
  } = {}) {
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.idFactory =
      options.idFactory ?? (() => globalThis.crypto.randomUUID());
  }

  async lookup(
    input: EvidenceAcceptanceIdentity,
  ): Promise<LookupEvidenceAcceptanceResult> {
    if (this.lookupUnavailableReason) {
      return {
        status: "unavailable",
        reason: this.lookupUnavailableReason,
      };
    }

    const key = canonicalizeJcs([
      input.principalId,
      input.evidencePackageId,
      input.clientRequestId,
    ]);
    const existing = this.byRequest.get(key);
    if (!existing) return { status: "not_found" };

    const same =
      canonicalizeJcs(existing.descriptor) ===
      canonicalizeJcs(input.descriptor);
    if (!same) return { status: "idempotency_conflict" };

    return {
      status:
        existing.status === "signed"
          ? "duplicate_signed"
          : "duplicate_pending",
      record: cloneRecord(existing),
    };
  }

  async reserve(
    input: ReserveEvidenceAcceptanceInput,
  ): Promise<ReserveEvidenceAcceptanceResult> {
    if (this.reserveUnavailableReason) {
      return {
        status: "unavailable",
        reason: this.reserveUnavailableReason,
      };
    }

    const key = requestKey(input);
    const existing = this.byRequest.get(key);
    if (existing) {
      const same =
        canonicalizeJcs(existing.descriptor) ===
        canonicalizeJcs(input.descriptor);
      if (!same) return { status: "idempotency_conflict" };
      return {
        status:
          existing.status === "signed"
            ? "duplicate_signed"
            : "duplicate_pending",
        record: cloneRecord(existing),
      };
    }

    const head =
      this.heads.get(input.descriptor.evidencePackageId) ?? null;
    const expectedPreviousSegmentHash = head?.segmentHash ?? null;
    if (
      input.descriptor.predecessorSegmentHash !==
      expectedPreviousSegmentHash
    ) {
      return {
        status: "chain_conflict",
        expectedPreviousSegmentHash,
      };
    }

    const acceptedAt = this.clock();
    const receiptId = this.idFactory();
    if (
      !receiptId.trim() ||
      !Number.isFinite(Date.parse(acceptedAt)) ||
      new Date(Date.parse(acceptedAt)).toISOString() !== acceptedAt
    ) {
      return {
        status: "unavailable",
        reason: "acceptance identity/time unavailable",
      };
    }

    const record: EvidenceAcceptanceRecord = {
      clientRequestId: input.clientRequestId,
      principalId: input.principalId,
      storageRef: input.storageRef,
      descriptor: structuredClone(input.descriptor),
      receiptPayload: {
        receiptSchema: EVIDENCE_RECEIPT_SCHEMA_V1,
        receiptId,
        evidencePackageId: input.descriptor.evidencePackageId,
        documentId: input.descriptor.documentId,
        sessionId: input.descriptor.sessionId,
        segmentId: input.descriptor.segmentId,
        segmentHash: input.descriptor.segmentHash,
        predecessorSegmentHash:
          input.descriptor.predecessorSegmentHash,
        previousReceiptId: head?.receiptId ?? null,
        evidenceSchema: input.descriptor.evidenceSchema,
        evidenceProfileId: input.descriptor.evidenceProfileId,
        sequenceFrom: input.descriptor.sequenceFrom,
        sequenceTo: input.descriptor.sequenceTo,
        eventCount: input.descriptor.eventCount,
        payloadBytes: input.descriptor.payloadBytes,
        acceptedAt,
      },
      status: "pending_signature",
    };

    this.byRequest.set(key, record);
    this.byReceipt.set(record.receiptPayload.receiptId, record);
    this.heads.set(input.descriptor.evidencePackageId, {
      segmentHash: input.descriptor.segmentHash,
      receiptId: record.receiptPayload.receiptId,
      segmentCount: (head?.segmentCount ?? 0) + 1,
    });

    return { status: "reserved", record: cloneRecord(record) };
  }

  async attachSignature(
    input: Parameters<EvidenceAcceptanceRepository["attachSignature"]>[0],
  ): ReturnType<EvidenceAcceptanceRepository["attachSignature"]> {
    if (this.attachUnavailableReason) {
      return {
        status: "unavailable",
        reason: this.attachUnavailableReason,
      };
    }

    const record = this.byReceipt.get(input.receiptId);
    if (!record) return { status: "not_found" };

    const digest = await digestEvidenceReceiptPayload(
      input.signedReceipt.payload,
    );
    if (
      digest.sha256 !== input.signedReceipt.payloadDigestSha256 ||
      !input.signedReceipt.signature.keyId.trim() ||
      !input.signedReceipt.signature.keyVersion.trim() ||
      !input.signedReceipt.signature.signatureEncoding ||
      !input.signedReceipt.signature.signatureBase64Url.trim()
    ) {
      return { status: "conflict" };
    }

    if (
      input.signedReceipt.payload.receiptId !==
        record.receiptPayload.receiptId ||
      canonicalizeJcs(input.signedReceipt.payload) !==
        canonicalizeJcs(record.receiptPayload)
    ) {
      return { status: "conflict" };
    }

    if (record.status === "signed") {
      if (!record.signedReceipt) {
        return { status: "conflict" };
      }
      return {
        status: "already_attached",
        receipt: structuredClone(record.signedReceipt),
      };
    }

    record.status = "signed";
    record.signedReceipt = structuredClone(input.signedReceipt);
    return { status: "attached" };
  }

  async readChain(evidencePackageId: string): Promise<EvidenceChainReadResult> {
    if (this.lookupUnavailableReason) {
      return { status: "unavailable", reason: this.lookupUnavailableReason };
    }
    const head = this.heads.get(evidencePackageId);
    // byReceipt keeps insertion order, which is the order of acceptance.
    const segments = [...this.byReceipt.values()]
      .filter((record) => record.descriptor.evidencePackageId === evidencePackageId)
      .map((record) => ({
        segmentHash: record.descriptor.segmentHash,
        receipt: record.signedReceipt
          ? structuredClone(record.signedReceipt)
          : null,
      }));
    return {
      status: "found",
      head: head
        ? { segmentHash: head.segmentHash, segmentCount: head.segmentCount }
        : null,
      segments,
    };
  }

  records(): readonly EvidenceAcceptanceRecord[] {
    return [...this.byReceipt.values()].map(cloneRecord);
  }

  head(evidencePackageId: string): ChainHead | null {
    const head = this.heads.get(evidencePackageId);
    return head ? { ...head } : null;
  }
}
