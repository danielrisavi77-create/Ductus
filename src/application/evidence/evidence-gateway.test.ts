import { describe, expect, it, vi } from "vitest";

import type {
  AuthorizationCheck,
  AuthorizationDecision,
  AuthorizationPort,
} from "@/application/ports/authorization";
import type { EvidenceAcceptanceRecord } from "@/application/ports/evidence-trust";
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
import { MAX_EVIDENCE_SEGMENT_BYTES } from "@/domain/forensics/evidence-chain-v2";
import { buildEvidenceIngestCommandV2 } from "./evidence-outbox";
import { EvidenceGateway } from "./evidence-gateway";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);

class FakeAuthorization implements AuthorizationPort {
  decision: AuthorizationDecision = { status: "allow" };
  /** When set, decides per request instead of `decision`. */
  decide: ((request: AuthorizationCheck) => AuthorizationDecision) | null =
    null;
  readonly requests: AuthorizationCheck[] = [];

  async check(request: AuthorizationCheck): Promise<AuthorizationDecision> {
    this.requests.push(structuredClone(request));
    return structuredClone(this.decide?.(request) ?? this.decision);
  }
}

class ToggleSigner implements SigningKeyProvider {
  readonly inner = new DevelopmentEd25519SigningKeyProvider(
    "test-evidence-key",
    "v1",
  );
  fail = false;
  verifyFail = false;
  /** Returns the signature with a field the envelope does not define. */
  extraField = false;
  signCalls = 0;

  async sign(message: Uint8Array): Promise<SignatureEnvelope> {
    this.signCalls++;
    if (this.fail) throw new Error("synthetic signer outage");
    const signature = await this.inner.sign(message);
    return this.extraField
      ? ({ ...signature, issuedTo: "student-2" } as SignatureEnvelope)
      : signature;
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

/** The real in-memory repository, able to hand back a record someone edited. */
class EditableRepository extends InMemoryEvidenceAcceptanceRepository {
  edit: ((record: EvidenceAcceptanceRecord) => void) | null = null;

  override async lookup(
    ...args: Parameters<InMemoryEvidenceAcceptanceRepository["lookup"]>
  ) {
    const result = await super.lookup(...args);
    if ("record" in result) this.edit?.(result.record);
    return result;
  }

  override async reserve(
    ...args: Parameters<InMemoryEvidenceAcceptanceRepository["reserve"]>
  ) {
    const result = await super.reserve(...args);
    if ("record" in result) this.edit?.(result.record);
    return result;
  }
}

/** A canonical segment of exactly `bytes` UTF-8 bytes, mostly two-byte characters. */
async function segmentOfSize(bytes: number): Promise<EvidenceSegmentV2> {
  const sized = (text: string): EvidenceSegmentV2 => {
    const value = segment();
    value.events[0].steps = [{ stepType: "replace", from: 1, to: 1, text }];
    return value;
  };
  const empty = (await buildEvidenceIngestCommandV2({
    evidencePackageId: "evidence-1",
    clientRequestId: "sizing",
    segment: sized(""),
  })).descriptor.payloadBytes;
  const room = bytes - empty;
  return sized("č".repeat(Math.floor(room / 2)) + "a".repeat(room % 2));
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
  const repository = new EditableRepository({
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

  describe("authorization before anything is looked up (#132)", () => {
    it("tells an unauthorized principal nothing about whether a package exists or what it is bound to", async () => {
      const s = setup();
      s.authorization.decision = { status: "deny" };
      const resolve = vi.spyOn(s.contexts, "resolve");
      const lookup = vi.spyOn(s.repository, "lookup");
      const put = vi.spyOn(s.payloadStore, "putImmutable");
      const asIntruder = (cmd: Awaited<ReturnType<typeof command>>) =>
        s.gateway.ingest({ principalId: "intruder", command: cmd });

      const probes = [
        // Exists, with the right document and profile.
        await command(),
        // Does not exist.
        await buildEvidenceIngestCommandV2({
          evidencePackageId: "evidence-404",
          clientRequestId: "request-404",
          segment: segment(),
        }),
        // Exists, bound to another document.
        await command({ ...segment(), documentId: "doc-2" }),
        // Exists, with another profile.
        await command(segment({ profile: "strict-v1" })),
      ];
      for (const probe of probes) {
        expect(await asIntruder(probe)).toEqual({ status: "unauthorized" });
      }

      // An outage behind the authorization does not show through either.
      s.contexts.unavailableReason = "synthetic db down";
      s.repository.lookupUnavailableReason = "synthetic db down";
      s.payloadStore.unavailableReason = "synthetic store down";
      expect(await asIntruder(probes[0])).toEqual({ status: "unauthorized" });

      // Authorization is asked for the id the client named, every time.
      expect(
        s.authorization.requests.map((r) => [r.principalId, r.resource.id]),
      ).toEqual([
        ["intruder", "evidence-1"],
        ["intruder", "evidence-404"],
        ["intruder", "evidence-1"],
        ["intruder", "evidence-1"],
        ["intruder", "evidence-1"],
      ]);
      expect(resolve).not.toHaveBeenCalled();
      expect(lookup).not.toHaveBeenCalled();
      expect(put).not.toHaveBeenCalled();
      expect(s.signer.signCalls).toBe(0);
      expect(s.repository.records()).toHaveLength(0);
    });

    it("looks nothing up while authorization is unavailable or answers anything but allow", async () => {
      for (const decision of [
        { status: "unavailable", reason: "authz down" },
        { status: "maybe" },
        {},
      ] as AuthorizationDecision[]) {
        const s = setup();
        s.authorization.decision = decision;
        const resolve = vi.spyOn(s.contexts, "resolve");
        const lookup = vi.spyOn(s.repository, "lookup");

        expect((await ingest(s)).status).toBe(
          decision.status === "unavailable" ? "unavailable" : "unauthorized",
        );
        expect(resolve).not.toHaveBeenCalled();
        expect(lookup).not.toHaveBeenCalled();
        expect(s.payloadStore.size).toBe(0);
      }
    });

    it("never answers one principal with a receipt issued to another", async () => {
      const s = setup();
      const cmd = await command();
      const first = await s.gateway.ingest({ principalId: "ana", command: cmd });
      expect(first.status).toBe("accepted");

      // Boris may not write to Ana's package: no duplicate, no receipt.
      s.authorization.decide = (request) => ({
        status: request.principalId === "ana" ? "allow" : "deny",
      });
      expect(
        await s.gateway.ingest({ principalId: "boris", command: cmd }),
      ).toEqual({ status: "unauthorized" });

      // Even a second principal allowed on the package gets no receipt of
      // Ana's: the idempotency key is hers.
      s.authorization.decide = null;
      const second = await s.gateway.ingest({
        principalId: "boris",
        command: cmd,
      });
      expect(second.status).toBe("chain_conflict");
      expect(s.repository.records()).toHaveLength(1);
      expect(s.repository.records()[0].principalId).toBe("ana");
      expect(s.signer.signCalls).toBe(1);
    });

    it("refuses a context that is not the one of the package the client named", async () => {
      const s = setup();
      vi.spyOn(s.contexts, "resolve").mockResolvedValue({
        status: "found",
        context: {
          evidencePackageId: "evidence-2",
          documentId: "doc-1",
          evidenceProfileId: "standard-v1",
          maxPayloadBytes: MAX_EVIDENCE_SEGMENT_BYTES,
          acceptsEvidence: true,
        },
      });

      expect(await ingest(s)).toEqual({ status: "invalid" });
      expect(s.payloadStore.size).toBe(0);
      expect(s.repository.records()).toHaveLength(0);
    });
  });

  it.each(["principalId", "author", "actor"])(
    "refuses a command that names its own %s, before authorization is asked",
    async (field) => {
      const s = setup();
      const forged = { ...(await command()), [field]: "student-2" };

      expect(await ingest(s, forged)).toEqual({ status: "invalid" });
      expect(s.authorization.requests).toHaveLength(0);
      expect(s.payloadStore.size).toBe(0);
      expect(s.repository.records()).toHaveLength(0);
    },
  );

  it.each([undefined, null, "", "   ", 7, { id: "student-1" }])(
    "answers unauthorized and asks nobody when the session yields principal %j",
    async (principalId) => {
      const s = setup();

      expect(
        await s.gateway.ingest({
          principalId: principalId as unknown as string,
          command: await command(),
        }),
      ).toEqual({ status: "unauthorized" });
      expect(s.authorization.requests).toHaveLength(0);
      expect(s.payloadStore.size).toBe(0);
      expect(s.repository.records()).toHaveLength(0);
    },
  );

  it("leaves an object already stored under the same hash as it is when the bytes differ", async () => {
    const s = setup();
    const cmd = await command();
    const planted = '{"planted":true}';
    await s.payloadStore.putImmutable({
      evidencePackageId: "evidence-1",
      segmentHash: cmd.descriptor.segmentHash,
      canonicalPayload: planted,
    });

    expect(await ingest(s, cmd)).toEqual({ status: "invalid" });
    expect(
      s.payloadStore.get("evidence-1", cmd.descriptor.segmentHash)
        ?.canonicalPayload,
    ).toBe(planted);
    expect(s.repository.records()).toHaveLength(0);
    expect(s.signer.signCalls).toBe(0);
  });

  describe("retry under one idempotency key (DAN-46)", () => {
    type Command = Awaited<ReturnType<typeof command>>;
    /** Canonical bytes of another valid segment, of the same length. */
    const otherSegmentSameLength = (cmd: Command): Command => ({
      ...cmd,
      canonicalPayload: cmd.canonicalPayload.replace(
        '"segmentId":"segment-1"',
        '"segmentId":"segment-9"',
      ),
    });
    /** The same content with two members swapped: same length, not canonical. */
    const sameContentReordered = (cmd: Command): Command => ({
      ...cmd,
      canonicalPayload: cmd.canonicalPayload.replace(
        '"sequenceFrom":1,"sequenceTo":1',
        '"sequenceTo":1,"sequenceFrom":1',
      ),
    });

    it("stores, reserves and signs nothing again for the same bytes", async () => {
      const s = setup();
      const cmd = await command();
      const first = await ingest(s, cmd);
      if (first.status !== "accepted") throw new Error("first failed");

      const put = vi.spyOn(s.payloadStore, "putImmutable");
      const reserve = vi.spyOn(s.repository, "reserve");
      const attach = vi.spyOn(s.repository, "attachSignature");
      expect(await ingest(s, cmd)).toEqual({
        status: "duplicate",
        receipt: first.receipt,
      });
      expect(put).not.toHaveBeenCalled();
      expect(reserve).not.toHaveBeenCalled();
      expect(attach).not.toHaveBeenCalled();
      expect(s.signer.signCalls).toBe(1);
    });

    it("confirms a signed acceptance only for the bytes it was given for", async () => {
      const s = setup();
      const cmd = await command();
      const first = await ingest(s, cmd);
      if (first.status !== "accepted") throw new Error("first failed");
      const storedBefore = s.payloadStore.get(
        "evidence-1",
        cmd.descriptor.segmentHash,
      );

      for (const changed of [
        otherSegmentSameLength(cmd),
        sameContentReordered(cmd),
      ]) {
        // Same key, same descriptor, same length: only the bytes differ.
        expect(changed.descriptor).toEqual(cmd.descriptor);
        expect(changed.canonicalPayload).not.toBe(cmd.canonicalPayload);
        expect(changed.canonicalPayload.length).toBe(
          cmd.canonicalPayload.length,
        );
        expect(await ingest(s, changed)).toEqual({ status: "invalid" });
      }

      // The original acceptance is untouched and still answers its own bytes.
      expect(s.payloadStore.size).toBe(1);
      expect(
        s.payloadStore.get("evidence-1", cmd.descriptor.segmentHash),
      ).toEqual(storedBefore);
      expect(s.repository.records()).toHaveLength(1);
      expect(s.signer.signCalls).toBe(1);
      expect(await ingest(s, cmd)).toEqual({
        status: "duplicate",
        receipt: first.receipt,
      });
    });

    it("does not sign a pending acceptance for other bytes, and still recovers it for its own", async () => {
      const s = setup();
      const cmd = await command();
      s.signer.fail = true;
      expect((await ingest(s, cmd)).status).toBe("unavailable");
      s.signer.fail = false;
      expect(s.signer.signCalls).toBe(1);

      for (const changed of [
        otherSegmentSameLength(cmd),
        sameContentReordered(cmd),
      ]) {
        expect(await ingest(s, changed)).toEqual({ status: "invalid" });
      }
      expect(s.signer.signCalls).toBe(1);
      expect(s.repository.records()[0].status).toBe("pending_signature");

      const recovered = await ingest(s, cmd);
      if (recovered.status !== "accepted") throw new Error("recovery failed");
      expect(recovered.receipt.payload.receiptId).toBe("receipt-1");
      expect(s.repository.records()).toHaveLength(1);
      expect(s.payloadStore.size).toBe(1);
    });
  });

  describe("segment size limit (D-96)", () => {
    it("accepts a segment of exactly the limit and refuses one byte more before authorizing or parsing", async () => {
      const s = setup();
      const atLimit = await command(
        await segmentOfSize(MAX_EVIDENCE_SEGMENT_BYTES),
      );
      expect(atLimit.descriptor.payloadBytes).toBe(MAX_EVIDENCE_SEGMENT_BYTES);
      // Fewer characters than the limit: the limit counts bytes.
      expect(atLimit.canonicalPayload.length).toBeLessThan(
        MAX_EVIDENCE_SEGMENT_BYTES,
      );
      expect((await ingest(s, atLimit)).status).toBe("accepted");

      const over = setup();
      const overLimit = await command(
        await segmentOfSize(MAX_EVIDENCE_SEGMENT_BYTES + 1),
      );
      expect(overLimit.descriptor.payloadBytes).toBe(
        MAX_EVIDENCE_SEGMENT_BYTES + 1,
      );
      expect(overLimit.canonicalPayload.length).toBeLessThan(
        MAX_EVIDENCE_SEGMENT_BYTES,
      );
      expect(await ingest(over, overLimit)).toEqual({ status: "too_large" });
      expect(over.authorization.requests).toHaveLength(0);
      expect(over.payloadStore.size).toBe(0);
      expect(over.repository.records()).toHaveLength(0);
    }, 60_000);

    it("judges the received payload, not the size the descriptor declares", async () => {
      const s = setup();
      const cmd = await command();
      const oversized = "x".repeat(MAX_EVIDENCE_SEGMENT_BYTES + 1);

      // Not even JSON, and declared small: refused for its size, unparsed.
      expect(
        await ingest(s, { ...cmd, canonicalPayload: oversized }),
      ).toEqual({ status: "too_large" });
      // Small, but declared over the limit: the declaration is simply wrong.
      expect(
        await ingest(s, {
          ...cmd,
          descriptor: {
            ...cmd.descriptor,
            payloadBytes: MAX_EVIDENCE_SEGMENT_BYTES + 1,
          },
        }),
      ).toEqual({ status: "invalid" });
      expect(s.authorization.requests).toHaveLength(0);
      expect(s.payloadStore.size).toBe(0);
    });
  });

  describe("receipts with a field nobody validated", () => {
    const malformed = {
      status: "unavailable",
      stage: "repository",
      reason: "stored acceptance is malformed",
    };

    it("never signs a reserved receipt payload that carries an unknown field", async () => {
      const s = setup();
      s.repository.edit = (record) => {
        Object.assign(record.receiptPayload, { grade: "A" });
      };

      expect(await ingest(s)).toEqual(malformed);
      expect(s.signer.signCalls).toBe(0);
      expect(s.repository.records()[0].status).toBe("pending_signature");
    });

    it("neither attaches nor returns a signature that carries an unknown field", async () => {
      const s = setup();
      s.signer.extraField = true;
      const attach = vi.spyOn(s.repository, "attachSignature");

      expect(await ingest(s)).toEqual({
        status: "unavailable",
        stage: "signing",
        reason: "signer returned a malformed signature",
      });
      expect(attach).not.toHaveBeenCalled();
      expect(s.repository.records()[0].status).toBe("pending_signature");
    });

    it("does not hand out a stored acceptance that is no longer well-formed", async () => {
      const edits: ((record: EvidenceAcceptanceRecord) => void)[] = [
        (record) => Object.assign(record.signedReceipt ?? {}, { note: "x" }),
        (record) =>
          Object.assign(record.signedReceipt?.payload ?? {}, { note: "x" }),
        (record) =>
          Object.assign(record.signedReceipt?.signature ?? {}, { note: "x" }),
        (record) => {
          delete record.signedReceipt;
        },
        (record) => {
          record.descriptor.segmentHash = "not-a-hash";
        },
      ];
      for (const edit of edits) {
        const s = setup();
        const cmd = await command();
        expect((await ingest(s, cmd)).status).toBe("accepted");

        s.repository.edit = edit;
        expect(await ingest(s, cmd)).toEqual(malformed);
      }
    });
  });
});
