import {
  requiredAuthorizationConsistency,
  type AuthorizationPort,
} from "@/application/ports/authorization";
import {
  validateEvidenceIngestCommandV2,
  type EvidenceIngestCommandV2,
  type EvidenceIngestOutcome,
  type EvidenceIngestPort,
  type EvidenceIngestRequestV2,
} from "@/application/ports/evidence-ingest";
import type {
  EvidenceAcceptanceRecord,
  EvidenceAcceptanceRepository,
  EvidenceContextPort,
  EvidencePayloadStore,
} from "@/application/ports/evidence-trust";
import type { SigningKeyProvider } from "@/application/ports/signing-key-provider";
import {
  digestEvidenceReceiptPayload,
  type SignedEvidenceReceipt,
} from "@/domain/forensics/evidence-receipt";
import {
  canonicalEvidenceSegmentV2,
  digestEvidenceSegmentV2,
  isEvidenceSegmentV2,
  type EvidenceSegmentV2,
} from "@/domain/forensics/evidence-segment-v2";

type GatewayDependencies = {
  authorization: AuthorizationPort;
  contexts: EvidenceContextPort;
  payloadStore: EvidencePayloadStore;
  repository: EvidenceAcceptanceRepository;
  signer: SigningKeyProvider;
};

function descriptorMatchesSegment(
  command: EvidenceIngestCommandV2,
  segment: EvidenceSegmentV2,
): boolean {
  const d = command.descriptor;
  return (
    d.documentId === segment.documentId &&
    d.sessionId === segment.sessionId &&
    d.segmentId === segment.segmentId &&
    d.evidenceSchema === segment.evidenceSchema &&
    d.canonicalization === segment.canonicalization &&
    d.hashAlgorithm === segment.hashAlgorithm &&
    d.evidenceProfileId === segment.evidenceProfileId &&
    d.sequenceFrom === segment.sequenceFrom &&
    d.sequenceTo === segment.sequenceTo &&
    d.eventCount === segment.events.length &&
    d.observedStartedAt === segment.observedStartedAt &&
    d.observedEndedAt === segment.observedEndedAt &&
    d.predecessorSegmentHash === segment.predecessorSegmentHash
  );
}

async function parseAndVerifyCanonicalPayload(
  command: EvidenceIngestCommandV2,
): Promise<
  | { ok: true; segment: EvidenceSegmentV2 }
  | { ok: false; reason: "invalid" | "too_large" }
> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(command.canonicalPayload);
  } catch {
    return { ok: false, reason: "invalid" };
  }

  if (!isEvidenceSegmentV2(parsed)) {
    return { ok: false, reason: "invalid" };
  }

  const canonical = canonicalEvidenceSegmentV2(parsed);
  if (canonical !== command.canonicalPayload) {
    return { ok: false, reason: "invalid" };
  }

  const digest = await digestEvidenceSegmentV2(parsed);
  if (
    digest.sha256 !== command.descriptor.segmentHash ||
    digest.byteLength !== command.descriptor.payloadBytes ||
    !descriptorMatchesSegment(command, parsed)
  ) {
    return { ok: false, reason: "invalid" };
  }

  return { ok: true, segment: parsed };
}

export class EvidenceGateway implements EvidenceIngestPort {
  constructor(private readonly dependencies: GatewayDependencies) {}

  private async signAcceptedRecord(
    record: EvidenceAcceptanceRecord,
  ): Promise<EvidenceIngestOutcome> {
    const receiptDigest = await digestEvidenceReceiptPayload(
      record.receiptPayload,
    );

    let signedReceipt: SignedEvidenceReceipt;
    try {
      const signature = await this.dependencies.signer.sign(
        receiptDigest.bytes,
      );
      if (
        !(await this.dependencies.signer.verify(
          receiptDigest.bytes,
          signature,
        ))
      ) {
        throw new Error("signer returned unverifiable signature");
      }
      signedReceipt = {
        payload: record.receiptPayload,
        payloadDigestSha256: receiptDigest.sha256,
        signature,
      };
    } catch (error) {
      return {
        status: "unavailable",
        stage: "signing",
        reason:
          error instanceof Error ? error.message : "signing failed",
      };
    }

    const attached = await this.dependencies.repository.attachSignature({
      receiptId: record.receiptPayload.receiptId,
      signedReceipt,
    });

    if (attached.status === "unavailable") {
      return {
        status: "unavailable",
        stage: "repository",
        reason: attached.reason,
      };
    }
    if (attached.status === "not_found" || attached.status === "conflict") {
      return {
        status: "unavailable",
        stage: "repository",
        reason: "receipt signature persistence conflict",
      };
    }
    if (attached.status === "already_attached") {
      return { status: "duplicate", receipt: attached.receipt };
    }

    return { status: "accepted", receipt: signedReceipt };
  }

  async ingest(
    request: EvidenceIngestRequestV2,
  ): Promise<EvidenceIngestOutcome> {
    if (!request.principalId?.trim()) {
      return { status: "unauthorized" };
    }
    if (!validateEvidenceIngestCommandV2(request.command)) {
      return { status: "invalid" };
    }

    const contextResult = await this.dependencies.contexts.resolve(
      request.command.descriptor.evidencePackageId,
    );
    if (contextResult.status === "unavailable") {
      return {
        status: "unavailable",
        stage: "context",
        reason: contextResult.reason,
      };
    }
    if (contextResult.status === "not_found") {
      return { status: "invalid" };
    }

    const context = contextResult.context;
    if (
      context.documentId !== request.command.descriptor.documentId ||
      context.evidenceProfileId !== request.command.descriptor.evidenceProfileId
    ) {
      return { status: "invalid" };
    }

    const authz = await this.dependencies.authorization.check({
      principalId: request.principalId,
      action: "append_evidence",
      resource: {
        type: "evidence_package",
        id: context.evidencePackageId,
      },
      consistency: requiredAuthorizationConsistency("append_evidence"),
      context: request.authorizationContext,
    });
    if (authz.status === "unavailable") {
      return {
        status: "unavailable",
        stage: "authorization",
        reason: authz.reason,
      };
    }
    if (authz.status === "deny") {
      return { status: "unauthorized" };
    }

    const lookup = await this.dependencies.repository.lookup({
      principalId: request.principalId,
      evidencePackageId: context.evidencePackageId,
      clientRequestId: request.command.clientRequestId,
      descriptor: request.command.descriptor,
    });

    if (lookup.status === "unavailable") {
      return {
        status: "unavailable",
        stage: "repository",
        reason: lookup.reason,
      };
    }
    if (lookup.status === "idempotency_conflict") {
      return { status: "idempotency_conflict" };
    }
    if (lookup.status === "duplicate_signed") {
      if (!lookup.record.signedReceipt) {
        return {
          status: "unavailable",
          stage: "repository",
          reason: "signed record missing receipt",
        };
      }
      return { status: "duplicate", receipt: lookup.record.signedReceipt };
    }
    if (lookup.status === "duplicate_pending") {
      return this.signAcceptedRecord(lookup.record);
    }

    if (!context.acceptsEvidence) {
      return { status: "not_accepting" };
    }
    if (request.command.descriptor.payloadBytes > context.maxPayloadBytes) {
      return { status: "too_large" };
    }

    // Canonicalizing and hashing the payload is the expensive step, so it runs
    // only after authorization and the size limit; descriptorMatchesSegment
    // ties the descriptor fields used above to the verified segment.
    const verified = await parseAndVerifyCanonicalPayload(request.command);
    if (!verified.ok) {
      return { status: verified.reason };
    }

    const stored = await this.dependencies.payloadStore.putImmutable({
      evidencePackageId: context.evidencePackageId,
      segmentHash: request.command.descriptor.segmentHash,
      canonicalPayload: request.command.canonicalPayload,
    });
    if (stored.status === "unavailable") {
      return {
        status: "unavailable",
        stage: "storage",
        reason: stored.reason,
      };
    }
    if (stored.status === "conflict") {
      return { status: "invalid" };
    }

    const reserved = await this.dependencies.repository.reserve({
      clientRequestId: request.command.clientRequestId,
      principalId: request.principalId,
      storageRef: stored.storageRef,
      descriptor: request.command.descriptor,
    });

    if (reserved.status === "unavailable") {
      return {
        status: "unavailable",
        stage: "repository",
        reason: reserved.reason,
      };
    }
    if (reserved.status === "idempotency_conflict") {
      return { status: "idempotency_conflict" };
    }
    if (
      reserved.status === "invalid" ||
      reserved.status === "context_mismatch"
    ) {
      return { status: "invalid" };
    }
    if (reserved.status === "unauthorized") {
      return { status: "unauthorized" };
    }
    if (reserved.status === "not_accepting") {
      return { status: "not_accepting" };
    }
    if (reserved.status === "too_large") {
      return { status: "too_large" };
    }
    if (reserved.status === "concurrent_conflict") {
      return {
        status: "unavailable",
        stage: "repository",
        reason: "concurrent acceptance conflict",
      };
    }
    if (reserved.status === "chain_conflict") {
      return {
        status: "chain_conflict",
        expectedPreviousSegmentHash:
          reserved.expectedPreviousSegmentHash,
      };
    }
    if (reserved.status === "duplicate_signed") {
      if (!reserved.record.signedReceipt) {
        return {
          status: "unavailable",
          stage: "repository",
          reason: "signed record missing receipt",
        };
      }
      return { status: "duplicate", receipt: reserved.record.signedReceipt };
    }

    return this.signAcceptedRecord(reserved.record);
  }
}
