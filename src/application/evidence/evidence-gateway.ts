import {
  requiredAuthorizationConsistency,
  type AuthorizationPort,
} from "@/application/ports/authorization";
import {
  evidencePayloadExceedsLimit,
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
  decideEvidenceRetry,
  verifyCanonicalEvidencePayloadV2,
} from "@/domain/forensics/evidence-chain-v2";
import {
  digestEvidenceReceiptPayload,
  isEvidenceReceiptPayloadV1,
  isSignedEvidenceReceipt,
  type SignedEvidenceReceipt,
} from "@/domain/forensics/evidence-receipt";
import type { EvidenceSegmentV2 } from "@/domain/forensics/evidence-segment-v2";
import { isSignatureEnvelope } from "@/domain/forensics/signature";
import { isPlainObject } from "@/domain/json";

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

/** What the repository returned is not an acceptance this code may act on. */
function malformedRecord(): EvidenceIngestOutcome {
  return {
    status: "unavailable",
    stage: "repository",
    reason: "stored acceptance is malformed",
  };
}

/** A stored receipt leaves only if it is still a well-formed signed receipt. */
function storedReceiptOutcome(receipt: unknown): EvidenceIngestOutcome {
  return isSignedEvidenceReceipt(receipt)
    ? { status: "duplicate", receipt }
    : malformedRecord();
}

export class EvidenceGateway implements EvidenceIngestPort {
  constructor(private readonly dependencies: GatewayDependencies) {}

  private async signAcceptedRecord(
    record: EvidenceAcceptanceRecord,
  ): Promise<EvidenceIngestOutcome> {
    // Never sign a payload with a field nobody validated, or one that has no
    // canonical form to take a digest of.
    if (!isEvidenceReceiptPayloadV1(record.receiptPayload)) {
      return malformedRecord();
    }
    const receiptDigest = await digestEvidenceReceiptPayload(
      record.receiptPayload,
    ).catch(() => null);
    if (receiptDigest === null) {
      return malformedRecord();
    }

    let signedReceipt: SignedEvidenceReceipt;
    try {
      const signature = await this.dependencies.signer.sign(
        receiptDigest.bytes,
      );
      if (!isSignatureEnvelope(signature)) {
        throw new Error("signer returned a malformed signature");
      }
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
      return storedReceiptOutcome(attached.receipt);
    }

    return { status: "accepted", receipt: signedReceipt };
  }

  /**
   * Order of the checks, each before the next one touches any state:
   *
   * 1. a principal from the session (never from the command);
   * 2. the one size limit (D-96) and the shape of the command, both without
   *    reading any state, so they say nothing about what exists;
   * 3. authorization, for the package id the client named. Until it allows,
   *    nothing about the package is looked up, so a package that does not
   *    exist, one bound to another document and one that is simply not the
   *    caller's all answer `unauthorized`;
   * 4. the package context (document and profile);
   * 5. a retry under the same idempotency key, decided by the received bytes;
   * 6. only for a new acceptance: closed package, package limit, verification
   *    of the bytes, storage and `reserve`.
   */
  async ingest(
    request: EvidenceIngestRequestV2,
  ): Promise<EvidenceIngestOutcome> {
    if (
      typeof request.principalId !== "string" ||
      !request.principalId.trim()
    ) {
      return { status: "unauthorized" };
    }

    const command: unknown = request.command;
    const received = isPlainObject(command)
      ? command.canonicalPayload
      : undefined;
    if (typeof received === "string" && evidencePayloadExceedsLimit(received)) {
      return { status: "too_large" };
    }
    if (!validateEvidenceIngestCommandV2(request.command)) {
      return { status: "invalid" };
    }
    const { clientRequestId, descriptor, canonicalPayload } = request.command;
    const evidencePackageId = descriptor.evidencePackageId;

    const authz = await this.dependencies.authorization.check({
      principalId: request.principalId,
      action: "append_evidence",
      resource: {
        type: "evidence_package",
        id: evidencePackageId,
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
    // Anything but an explicit allow is a refusal.
    if (authz.status !== "allow") {
      return { status: "unauthorized" };
    }

    const contextResult =
      await this.dependencies.contexts.resolve(evidencePackageId);
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
      context.evidencePackageId !== evidencePackageId ||
      context.documentId !== descriptor.documentId ||
      context.evidenceProfileId !== descriptor.evidenceProfileId
    ) {
      return { status: "invalid" };
    }

    const lookup = await this.dependencies.repository.lookup({
      principalId: request.principalId,
      evidencePackageId,
      clientRequestId,
      descriptor,
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
    if (
      lookup.status === "duplicate_signed" ||
      lookup.status === "duplicate_pending"
    ) {
      // The same descriptor is not yet the same submission (DAN-46): the
      // original acceptance is confirmed only for the bytes it was given for.
      const resent = await verifyCanonicalEvidencePayloadV2(canonicalPayload);
      if (!resent.ok) {
        return { status: resent.reason };
      }
      let decision: ReturnType<typeof decideEvidenceRetry>;
      try {
        decision = decideEvidenceRetry({
          acceptedSegmentHash: lookup.record.descriptor.segmentHash,
          // A different descriptor is `idempotency_conflict` above.
          descriptorMatches: true,
          receivedPayloadSha256: resent.sha256,
        });
      } catch {
        return malformedRecord();
      }
      if (decision !== "duplicate") {
        return { status: "invalid" };
      }
      return lookup.status === "duplicate_signed"
        ? storedReceiptOutcome(lookup.record.signedReceipt)
        : this.signAcceptedRecord(lookup.record);
    }

    if (!context.acceptsEvidence) {
      return { status: "not_accepting" };
    }
    if (descriptor.payloadBytes > context.maxPayloadBytes) {
      return { status: "too_large" };
    }

    // Canonicalizing and hashing the payload is the expensive step, so it runs
    // only after authorization and the size limits. The hash is the one of the
    // received bytes; the declared one only has to agree with it.
    const verified = await verifyCanonicalEvidencePayloadV2(canonicalPayload);
    if (!verified.ok) {
      return { status: verified.reason };
    }
    if (
      verified.sha256 !== descriptor.segmentHash ||
      verified.byteLength !== descriptor.payloadBytes ||
      !descriptorMatchesSegment(request.command, verified.segment)
    ) {
      return { status: "invalid" };
    }

    const stored = await this.dependencies.payloadStore.putImmutable({
      evidencePackageId,
      segmentHash: verified.sha256,
      canonicalPayload,
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
      clientRequestId,
      principalId: request.principalId,
      storageRef: stored.storageRef,
      descriptor,
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
      // Same key and descriptor as a concurrent request; the bytes were
      // verified against that descriptor's hash just above.
      return storedReceiptOutcome(reserved.record.signedReceipt);
    }

    return this.signAcceptedRecord(reserved.record);
  }
}
