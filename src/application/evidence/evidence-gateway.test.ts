import { describe, expect, it } from "vitest";

import type {
  AuthorizationCheck,
  AuthorizationDecision,
  AuthorizationPort,
} from "@/application/ports/authorization";
import type {
  PublicVerificationKey,
  SignatureEnvelope,
  SigningKeyProvider,
} from "@/application/ports/signing-key-provider";
import { DevelopmentEd25519SigningKeyProvider } from "@/adapters/crypto/development-ed25519-signer";
import { InMemoryEvidenceAcceptanceRepository } from "@/adapters/evidence/in-memory-evidence-acceptance-repository";
import { InMemoryEvidenceContextPort } from "@/adapters/evidence/in-memory-evidence-context";
import { InMemoryEvidencePayloadStore } from "@/adapters/evidence/in-memory-evidence-payload-store";
import {
  digestEvidenceReceiptPayload,
} from "@/domain/forensics/evidence-receipt";
import {
  EVIDENCE_CANONICALIZATION_V2,
  EVIDENCE_HASH_ALGORITHM_V2,
  EVIDENCE_SEGMENT_SCHEMA_V2,
  type EvidenceSegmentV2,
} from "@/domain/forensics/evidence-segment-v2";
import { sha256WebCrypto } from "@/domain/forensics/crypto";
import { buildEvidenceIngestCommandV2 } from "./evidence-outbox";
import { EvidenceGateway } from "./evidence-gateway";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);

class FakeAuthorization implements AuthorizationPort {
  decision: AuthorizationDecision = { status: "allow" };
  readonly requests: AuthorizationCheck[] = [];

  async check(request: AuthorizationCheck): Promise<AuthorizationDecision> {
    this.requests.push(structuredClone(request));
    return structuredClone(this.decision);
  }
}

class ToggleSigner implements SigningKeyProvider {
  readonly inner = new DevelopmentEd25519SigningKeyProvider(
    "test-evidence-key",
    "v1",
  );
  fail = false;
  verifyFail = false;

  async sign(message: Uint8Array): Promise<SignatureEnvelope> {
    if (this.fail) throw new Error("synthetic signer outage");
    return this.inner.sign(message);
  }

  async publicVerificationKey(): Promise<PublicVerificationKey> {
    return this.inner.publicVerificationKey();
  }

  async verify(
    message: Uint8Array,
    signature: SignatureEnvelope,
  ): Promise<boolean> {
    if (this.verifyFail) return false;
    return this.inner.verify(message, signature);
  }
}

function segment(input: {
  segmentId?: string;
  sequence?: number;
  before?: string;
  after?: string;
  predecessor?: string | null;
  profile?: string;
  start?: string;
  eventAt?: string;
  end?: string;
} = {}): EvidenceSegmentV2 {
  const sequence = input.sequence ?? 1;
  const before = input.before ?? A;
  const after = input.after ?? B;
  return {
    evidenceSchema: EVIDENCE_SEGMENT_SCHEMA_V2,
    canonicalization: EVIDENCE_CANONICALIZATION_V2,
    hashAlgorithm: EVIDENCE_HASH_ALGORITHM_V2,
    documentId: "doc-1",
    sessionId: "session-1",
    segmentId: input.segmentId ?? "segment-1",
    sequenceFrom: sequence,
    sequenceTo: sequence,
    observedStartedAt:
      input.start ?? "2026-10-03T06:00:00.000Z",
    observedEndedAt:
      input.end ?? "2026-10-03T06:00:01.000Z",
    initialDocumentHash: before,
    finalDocumentHash: after,
    predecessorSegmentHash: input.predecessor ?? null,
    events: [
      {
        sequence,
        occurredAt:
          input.eventAt ?? "2026-10-03T06:00:00.500Z",
        elapsedMs: sequence * 500,
        source: "editor",
        steps: [{ stepType: "replace", from: 1, to: 1 }],
        touchedNodeIds: ["p1"],
        beforeDocumentHash: before,
        afterDocumentHash: after,
      },
    ],
    captureContext: {
      editorModel: "prosemirror",
      transactionFormat: "prosemirror-step-json-v1",
    },
    evidenceProfileId: input.profile ?? "standard-v1",
  };
}

async function command(
  value: EvidenceSegmentV2 = segment(),
  clientRequestId = "request-1",
) {
  return buildEvidenceIngestCommandV2({
    evidencePackageId: "evidence-1",
    clientRequestId,
    segment: value,
  });
}

function setup() {
  const authorization = new FakeAuthorization();
  const contexts = new InMemoryEvidenceContextPort([
    {
      evidencePackageId: "evidence-1",
      documentId: "doc-1",
      evidenceProfileId: "standard-v1",
      maxPayloadBytes: 2 * 1024 * 1024,
      acceptsEvidence: true,
    },
  ]);
  const payloadStore = new InMemoryEvidencePayloadStore();
  let now = "2026-10-03T06:05:00.000Z";
  let receiptSequence = 0;
  const repository = new InMemoryEvidenceAcceptanceRepository({
    clock: () => now,
    idFactory: () => `receipt-${++receiptSequence}`,
  });
  const signer = new ToggleSigner();

  const gateway = new EvidenceGateway({
    authorization,
    contexts,
    payloadStore,
    repository,
    signer,
  });

  return {
    gateway,
    authorization,
    contexts,
    payloadStore,
    repository,
    signer,
    setNow(value: string) {
      now = value;
    },
  };
}

async function ingest(
  setupResult: ReturnType<typeof setup>,
  commandValue?: Awaited<ReturnType<typeof command>>,
) {
  const actualCommand = commandValue ?? (await command());
  return setupResult.gateway.ingest({
    principalId: "student-1",
    command: actualCommand,
  });
}

describe("EvidenceGateway", () => {
  it("accepts exact JCS bytes, re-hashes them, authorizes strongly and returns a verifiable signed receipt", async () => {
    const s = setup();
    const outcome = await ingest(s);

    if (outcome.status !== "accepted") {
      throw new Error(`unexpected outcome ${outcome.status}`);
    }

    const digest = await digestEvidenceReceiptPayload(
      outcome.receipt.payload,
    );
    expect(outcome.receipt.payloadDigestSha256).toBe(digest.sha256);
    expect(
      await s.signer.verify(digest.bytes, outcome.receipt.signature),
    ).toBe(true);

    expect(outcome.receipt.payload).toMatchObject({
      receiptSchema: "ductus-evidence-receipt-v1",
      receiptId: "receipt-1",
      evidencePackageId: "evidence-1",
      documentId: "doc-1",
      segmentId: "segment-1",
      previousReceiptId: null,
      evidenceProfileId: "standard-v1",
      acceptedAt: "2026-10-03T06:05:00.000Z",
    });
    expect("principalId" in outcome.receipt.payload).toBe(false);

    expect(s.authorization.requests).toEqual([
      {
        principalId: "student-1",
        action: "append_evidence",
        resource: { type: "evidence_package", id: "evidence-1" },
        consistency: "higher-consistency",
        context: undefined,
      },
    ]);
    expect(s.payloadStore.size).toBe(1);
    expect(s.repository.records()).toHaveLength(1);
    expect(s.repository.records()[0]).toMatchObject({
      principalId: "student-1",
      status: "signed",
    });
  });

  it("returns the exact same signed receipt for an idempotent retry", async () => {
    const s = setup();
    const cmd = await command();
    const first = await ingest(s, cmd);
    s.setNow("2026-10-03T06:10:00.000Z");
    const second = await ingest(s, cmd);

    expect(first.status).toBe("accepted");
    expect(second.status).toBe("duplicate");
    if (
      first.status !== "accepted" ||
      second.status !== "duplicate"
    ) {
      throw new Error("unexpected outcome");
    }
    expect(second.receipt).toEqual(first.receipt);
    expect(second.receipt.payload.receiptId).toBe("receipt-1");
    expect(second.receipt.payload.acceptedAt).toBe(
      "2026-10-03T06:05:00.000Z",
    );
    expect(s.payloadStore.size).toBe(1);
    expect(s.repository.records()).toHaveLength(1);
  });

  it("rejects reuse of one idempotency key for different evidence", async () => {
    const s = setup();
    const firstCommand = await command();
    const first = await ingest(s, firstCommand);
    expect(first.status).toBe("accepted");
    if (first.status !== "accepted") throw new Error("first failed");

    const second = segment({
      segmentId: "segment-2",
      sequence: 2,
      before: B,
      after: C,
      predecessor: firstCommand.descriptor.segmentHash,
      start: "2026-10-03T06:01:00.000Z",
      eventAt: "2026-10-03T06:01:00.500Z",
      end: "2026-10-03T06:01:01.000Z",
    });
    const conflicting = await command(second, "request-1");
    expect((await ingest(s, conflicting)).status).toBe(
      "idempotency_conflict",
    );
    expect(s.repository.records()).toHaveLength(1);
  });

  it("enforces the package-wide predecessor chain atomically", async () => {
    const s = setup();
    const firstCommand = await command();
    expect((await ingest(s, firstCommand)).status).toBe("accepted");

    const wrong = await command(
      segment({
        segmentId: "segment-2",
        sequence: 2,
        before: B,
        after: C,
        predecessor: null,
        start: "2026-10-03T06:01:00.000Z",
        eventAt: "2026-10-03T06:01:00.500Z",
        end: "2026-10-03T06:01:01.000Z",
      }),
      "request-2",
    );

    expect(await ingest(s, wrong)).toEqual({
      status: "chain_conflict",
      expectedPreviousSegmentHash:
        firstCommand.descriptor.segmentHash,
    });
    expect(s.repository.records()).toHaveLength(1);
  });

  it("links a valid next segment to the previous receipt", async () => {
    const s = setup();
    const firstCommand = await command();
    const first = await ingest(s, firstCommand);
    if (first.status !== "accepted") throw new Error("first failed");

    const secondCommand = await command(
      segment({
        segmentId: "segment-2",
        sequence: 2,
        before: B,
        after: C,
        predecessor: firstCommand.descriptor.segmentHash,
        start: "2026-10-03T06:01:00.000Z",
        eventAt: "2026-10-03T06:01:00.500Z",
        end: "2026-10-03T06:01:01.000Z",
      }),
      "request-2",
    );
    s.setNow("2026-10-03T06:06:00.000Z");
    const second = await ingest(s, secondCommand);
    if (second.status !== "accepted") throw new Error("second failed");

    expect(second.receipt.payload.previousReceiptId).toBe(
      first.receipt.payload.receiptId,
    );
    expect(second.receipt.payload.predecessorSegmentHash).toBe(
      firstCommand.descriptor.segmentHash,
    );
    expect(s.repository.records()).toHaveLength(2);
  });

  it("rejects non-canonical wire bytes even when their own hash and byte count are supplied", async () => {
    const s = setup();
    const cmd = await command();
    const nonCanonical = cmd.canonicalPayload + "\n";
    const tampered = {
      ...cmd,
      canonicalPayload: nonCanonical,
      descriptor: {
        ...cmd.descriptor,
        payloadBytes: new TextEncoder().encode(nonCanonical).byteLength,
        segmentHash: await sha256WebCrypto(nonCanonical),
      },
    };

    expect((await ingest(s, tampered)).status).toBe("invalid");
    expect(s.payloadStore.size).toBe(0);
    expect(s.repository.records()).toHaveLength(0);
  });

  it("rejects a canonical payload whose descriptor claims a different hash", async () => {
    const s = setup();
    const cmd = await command();
    const wrongHash = {
      ...cmd,
      descriptor: { ...cmd.descriptor, segmentHash: "0".repeat(64) },
    };

    expect((await ingest(s, wrongHash)).status).toBe("invalid");
    expect(s.payloadStore.size).toBe(0);
    expect(s.repository.records()).toHaveLength(0);
  });

  it("rejects descriptor/segment semantic drift", async () => {
    const s = setup();
    const cmd = await command();
    const drifted = {
      ...cmd,
      descriptor: {
        ...cmd.descriptor,
        evidenceProfileId: "other-profile",
      },
    };
    expect((await ingest(s, drifted)).status).toBe("invalid");
    expect(s.payloadStore.size).toBe(0);
  });

  it("uses server package context as the document/profile authority", async () => {
    const s = setup();
    const otherProfile = await command(
      segment({ profile: "other-profile" }),
    );
    expect((await ingest(s, otherProfile)).status).toBe("invalid");

    s.contexts.set({
      evidencePackageId: "evidence-1",
      documentId: "different-doc",
      evidenceProfileId: "standard-v1",
      maxPayloadBytes: 2 * 1024 * 1024,
      acceptsEvidence: true,
    });
    expect((await ingest(s)).status).toBe("invalid");
    expect(s.payloadStore.size).toBe(0);
  });

  it("fails closed when authorization denies or is unavailable", async () => {
    const denied = setup();
    denied.authorization.decision = { status: "deny" };
    expect((await ingest(denied)).status).toBe("unauthorized");
    expect(denied.payloadStore.size).toBe(0);

    const unavailable = setup();
    unavailable.authorization.decision = {
      status: "unavailable",
      reason: "authz down",
    };
    expect(await ingest(unavailable)).toEqual({
      status: "unavailable",
      stage: "authorization",
      reason: "authz down",
    });
    expect(unavailable.payloadStore.size).toBe(0);
  });

  it("checks authorization before verifying the payload", async () => {
    const denied = setup();
    denied.authorization.decision = { status: "deny" };
    const cmd = await command();
    const wrongHash = {
      ...cmd,
      descriptor: { ...cmd.descriptor, segmentHash: "0".repeat(64) },
    };
    // A payload that would fail verification still gets "unauthorized".
    expect((await ingest(denied, wrongHash)).status).toBe("unauthorized");
  });

  it("distinguishes context, size and closed-package failures before storage", async () => {
    const missing = setup();
    expect(
      await missing.gateway.ingest({
        principalId: "student-1",
        command: {
          ...(await command()),
          descriptor: {
            ...(await command()).descriptor,
            evidencePackageId: "missing-package",
          },
        },
      }),
    ).toEqual({ status: "invalid" });

    const contextUnavailable = setup();
    contextUnavailable.contexts.unavailableReason = "context store down";
    expect(await ingest(contextUnavailable)).toEqual({
      status: "unavailable",
      stage: "context",
      reason: "context store down",
    });

    const tooLarge = setup();
    tooLarge.contexts.set({
      evidencePackageId: "evidence-1",
      documentId: "doc-1",
      evidenceProfileId: "standard-v1",
      maxPayloadBytes: 1,
      acceptsEvidence: true,
    });
    expect((await ingest(tooLarge)).status).toBe("too_large");

    const closed = setup();
    closed.contexts.set({
      evidencePackageId: "evidence-1",
      documentId: "doc-1",
      evidenceProfileId: "standard-v1",
      maxPayloadBytes: 2 * 1024 * 1024,
      acceptsEvidence: false,
    });
    expect((await ingest(closed)).status).toBe("not_accepting");
  });

  it("fails before object storage when the idempotency lookup is unavailable", async () => {
    const s = setup();
    s.repository.lookupUnavailableReason = "lookup down";

    expect(await ingest(s)).toEqual({
      status: "unavailable",
      stage: "repository",
      reason: "lookup down",
    });
    expect(s.payloadStore.size).toBe(0);
    expect(s.repository.records()).toHaveLength(0);
  });

  it("does not mint metadata or a receipt when payload storage is unavailable", async () => {
    const s = setup();
    s.payloadStore.unavailableReason = "object store down";

    expect(await ingest(s)).toEqual({
      status: "unavailable",
      stage: "storage",
      reason: "object store down",
    });
    expect(s.repository.records()).toHaveLength(0);
  });

  it("allows an orphan payload but never a receipt when metadata reservation fails", async () => {
    const s = setup();
    s.repository.reserveUnavailableReason = "metadata down";

    expect(await ingest(s)).toEqual({
      status: "unavailable",
      stage: "repository",
      reason: "metadata down",
    });
    expect(s.payloadStore.size).toBe(1);
    expect(s.repository.records()).toHaveLength(0);
  });

  it("refuses to persist a signer response that cannot be verified", async () => {
    const s = setup();
    s.signer.verifyFail = true;

    expect(await ingest(s)).toEqual({
      status: "unavailable",
      stage: "signing",
      reason: "signer returned unverifiable signature",
    });
    expect(s.repository.records()).toHaveLength(1);
    expect(s.repository.records()[0].status).toBe("pending_signature");
    expect(s.repository.records()[0].signedReceipt).toBeUndefined();
  });

  it("recovers signer failure by signing the same reserved receipt on retry", async () => {
    const s = setup();
    const cmd = await command();
    s.signer.fail = true;

    expect(await ingest(s, cmd)).toEqual({
      status: "unavailable",
      stage: "signing",
      reason: "synthetic signer outage",
    });
    const pending = s.repository.records()[0];
    expect(pending.status).toBe("pending_signature");
    expect(pending.receiptPayload.receiptId).toBe("receipt-1");
    expect(pending.receiptPayload.acceptedAt).toBe(
      "2026-10-03T06:05:00.000Z",
    );

    s.signer.fail = false;
    s.setNow("2026-10-03T07:00:00.000Z");
    const recovered = await ingest(s, cmd);
    if (recovered.status !== "accepted") {
      throw new Error("recovery failed");
    }
    expect(recovered.receipt.payload.receiptId).toBe("receipt-1");
    expect(recovered.receipt.payload.acceptedAt).toBe(
      "2026-10-03T06:05:00.000Z",
    );
    expect(s.repository.records()).toHaveLength(1);
    expect(s.repository.records()[0].status).toBe("signed");
  });

  it("recovers an already accepted pending receipt even after the package closes", async () => {
    const s = setup();
    const cmd = await command();
    s.signer.fail = true;

    expect((await ingest(s, cmd)).status).toBe("unavailable");
    expect(s.repository.records()[0].status).toBe("pending_signature");
    expect(s.payloadStore.size).toBe(1);

    s.contexts.set({
      evidencePackageId: "evidence-1",
      documentId: "doc-1",
      evidenceProfileId: "standard-v1",
      maxPayloadBytes: 1,
      acceptsEvidence: false,
    });
    s.signer.fail = false;

    const recovered = await ingest(s, cmd);
    expect(recovered.status).toBe("accepted");
    if (recovered.status !== "accepted") {
      throw new Error("recovery failed");
    }
    expect(recovered.receipt.payload.receiptId).toBe("receipt-1");
    expect(recovered.receipt.payload.acceptedAt).toBe(
      "2026-10-03T06:05:00.000Z",
    );
    expect(s.payloadStore.size).toBe(1);
    expect(s.repository.records()).toHaveLength(1);
  });

  it("recovers signature-persistence failure without changing acceptance history", async () => {
    const s = setup();
    const cmd = await command();
    s.repository.attachUnavailableReason = "metadata write down";

    expect(await ingest(s, cmd)).toEqual({
      status: "unavailable",
      stage: "repository",
      reason: "metadata write down",
    });
    const pending = s.repository.records()[0];
    expect(pending.status).toBe("pending_signature");
    expect(pending.receiptPayload.receiptId).toBe("receipt-1");

    s.repository.attachUnavailableReason = null;
    s.setNow("2026-10-03T07:00:00.000Z");
    const recovered = await ingest(s, cmd);
    if (recovered.status !== "accepted") {
      throw new Error("recovery failed");
    }
    expect(recovered.receipt.payload.receiptId).toBe("receipt-1");
    expect(recovered.receipt.payload.acceptedAt).toBe(
      "2026-10-03T06:05:00.000Z",
    );
  });
});
