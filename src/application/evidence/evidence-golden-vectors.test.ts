import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { DevelopmentEd25519SigningKeyProvider } from "@/adapters/crypto/development-ed25519-signer";
import { InMemoryEvidenceAcceptanceRepository } from "@/adapters/evidence/in-memory-evidence-acceptance-repository";
import { InMemoryEvidenceContextPort } from "@/adapters/evidence/in-memory-evidence-context";
import { InMemoryEvidencePayloadStore } from "@/adapters/evidence/in-memory-evidence-payload-store";
import type { AuthorizationPort } from "@/application/ports/authorization";
import type { EvidenceSegmentDescriptorV2 } from "@/application/ports/evidence-ingest";
import type {
  EvidenceChainReader,
  EvidencePayloadReader,
} from "@/application/ports/evidence-reconstruction";
import { MAX_EVIDENCE_SEGMENT_BYTES } from "@/domain/forensics/evidence-chain-v2";
import type { SignedEvidenceReceipt } from "@/domain/forensics/evidence-receipt";
import type { EvidenceStepReplayerV2 } from "@/domain/forensics/evidence-replay-v2";
import {
  applyPayloadEdit,
  fromHex,
  goldenKeyVerifier,
  loadGoldenVectors,
  toHex,
  type GoldenSegmentVector,
} from "@/domain/forensics/golden-vectors/load";
import { EvidenceGateway } from "./evidence-gateway";
import { buildEvidenceIngestCommandV2 } from "./evidence-outbox";
import { reconstructAndCompareEvidence } from "./evidence-reconstruction";

/**
 * Golden vectors (DAN-127) through the application layer. The client side
 * (outbox) and the server side (gateway, reconstruction) read the same file
 * as the domain test, so neither can drift from the other unnoticed. All data
 * is invented.
 */
const vectors = loadGoldenVectors();
const { chain } = vectors;
const utf8 = new TextEncoder();
const goldenKey = goldenKeyVerifier(chain.verificationKey);
const emptyDocument = chain.documentStates[0];
const finalDocument = chain.documentStates[chain.documentStates.length - 1];

type TextDocument = { nodes: { id: string; text: string }[] };

/** The invented step format of the vectors: insert text at a UTF-16 offset of one node. */
const replayer: EvidenceStepReplayerV2<TextDocument> = {
  transactionFormat: chain.segments[0].segment.captureContext.transactionFormat,
  load: (canonical) => structuredClone(canonical as TextDocument),
  apply: (document, event) =>
    event.steps.reduce<TextDocument>((current, step) => {
      const { kind, nodeId, offset, text, ...unknown } = step;
      const node = current.nodes.find((candidate) => candidate.id === nodeId);
      if (
        kind !== "insert-text" ||
        node === undefined ||
        typeof offset !== "number" ||
        !Number.isInteger(offset) ||
        offset < 0 ||
        offset > node.text.length ||
        typeof text !== "string" ||
        Object.keys(unknown).length > 0
      ) {
        throw new Error("unsupported step");
      }
      return {
        nodes: current.nodes.map((other) =>
          other === node
            ? { id: node.id, text: node.text.slice(0, offset) + text + node.text.slice(offset) }
            : other,
        ),
      };
    }, document),
  toCanonical: (document) => document,
};

const commandOf = (vector: GoldenSegmentVector) =>
  buildEvidenceIngestCommandV2({
    evidencePackageId: chain.evidencePackageId,
    clientRequestId: vector.clientRequestId,
    segment: vector.segment,
  });

const signedReceiptOf = ({ receipt }: GoldenSegmentVector): SignedEvidenceReceipt => ({
  payload: receipt.payload,
  payloadDigestSha256: receipt.payloadDigestSha256,
  signature: receipt.signature,
});

/** Readers that serve the record exactly as the vector file stores it. */
function storedRecord(receiptOf = signedReceiptOf): {
  chain: EvidenceChainReader;
  payloads: EvidencePayloadReader;
} {
  return {
    chain: {
      readChain: async () => ({
        status: "found",
        head: chain.head,
        segments: chain.segments.map((vector) => ({
          segmentHash: vector.segmentHash,
          receipt: receiptOf(vector),
        })),
      }),
    },
    payloads: {
      readImmutable: async ({ segmentHash }) => {
        const vector = chain.segments.find((candidate) => candidate.segmentHash === segmentHash);
        return vector
          ? { status: "found", bytes: fromHex(vector.canonicalUtf8Hex) }
          : { status: "not_found" };
      },
    },
  };
}

const reconstruction = { evidencePackageId: chain.evidencePackageId, initialDocument: emptyDocument.value };
const matched = { status: "match", head: chain.head, documentSha256: finalDocument.sha256 };

describe("golden vectors: client side (outbox)", () => {
  it.each(chain.segments)("builds the command of $segment.segmentId byte for byte", async (vector) => {
    const command = await commandOf(vector);
    expect(command.clientRequestId).toBe(vector.clientRequestId);
    expect(command.descriptor).toEqual(vector.descriptor);
    expect(toHex(utf8.encode(command.canonicalPayload))).toBe(vector.canonicalUtf8Hex);
  });
});

describe("golden vectors: server side (gateway and reconstruction)", () => {
  it("accepts the client commands, stores their bytes and issues the stored receipts", async () => {
    let current = 0;
    const authorization: AuthorizationPort = {
      check: async ({ principalId, action, resource }) => ({
        status:
          principalId === chain.principalId &&
          action === "append_evidence" &&
          resource.id === chain.evidencePackageId
            ? "allow"
            : "deny",
      }),
    };
    const contexts = new InMemoryEvidenceContextPort([
      {
        evidencePackageId: chain.evidencePackageId,
        documentId: chain.segments[0].segment.documentId,
        evidenceProfileId: chain.segments[0].segment.evidenceProfileId,
        maxPayloadBytes: MAX_EVIDENCE_SEGMENT_BYTES,
        acceptsEvidence: true,
      },
    ]);
    const payloadStore = new InMemoryEvidencePayloadStore();
    // Time and receipt id are the two inputs the server adds; the file fixes them.
    const repository = new InMemoryEvidenceAcceptanceRepository({
      clock: () => chain.segments[current].receipt.payload.acceptedAt,
      idFactory: () => chain.segments[current].receipt.payload.receiptId,
    });
    const signer = new DevelopmentEd25519SigningKeyProvider("zlatni-vektori-dev", "v1");
    const sign = vi.spyOn(signer, "sign");
    const gateway = new EvidenceGateway({ authorization, contexts, payloadStore, repository, signer });

    for (const [index, vector] of chain.segments.entries()) {
      current = index;
      const outcome = await gateway.ingest({
        principalId: chain.principalId,
        command: await commandOf(vector),
      });
      if (outcome.status !== "accepted") throw new Error(`segment ${index}: ${outcome.status}`);
      expect(outcome.receipt.payload).toEqual(vector.receipt.payload);
      expect(outcome.receipt.payloadDigestSha256).toBe(vector.receipt.payloadDigestSha256);

      // The development key is new on every run, so its signature cannot be
      // pinned. What is pinned are the bytes the gateway hands to the signer:
      // they are the bytes the stored signature was made over.
      const signedBytes = sign.mock.calls[index][0];
      expect(toHex(signedBytes)).toBe(vector.receipt.canonicalUtf8Hex);
      expect(await goldenKey.verify(signedBytes, vector.receipt.signature)).toBe(true);

      const stored = await payloadStore.readImmutable({
        evidencePackageId: chain.evidencePackageId,
        segmentHash: vector.segmentHash,
      });
      if (stored.status !== "found") throw new Error(`segment ${index}: bytes ${stored.status}`);
      expect(toHex(stored.bytes)).toBe(vector.canonicalUtf8Hex);
    }

    const accepted = await repository.readChain(chain.evidencePackageId);
    expect(accepted).toMatchObject({ status: "found", head: chain.head });
    expect(
      await reconstructAndCompareEvidence(
        { chain: repository, payloads: payloadStore, signer, replayer },
        { ...reconstruction, expectedDocument: finalDocument.value },
      ),
    ).toEqual(matched);
  });

  it("leaves no object, no record and no signature for a segment that carries time (D-24, D-56)", async () => {
    const [base] = chain.segments;
    // The first former segment only: like the base it is the first of its chain.
    const cases = [
      { name: "control", accepted: true, bytes: fromHex(base.canonicalUtf8Hex) },
      ...vectors.segmentPayloads.rejected
        .filter((edit) => edit.canonicalJcs)
        .map((edit) => ({
          name: edit.name,
          accepted: false,
          bytes: applyPayloadEdit(fromHex(chain.segments[edit.base].canonicalUtf8Hex), edit),
        })),
      ...vectors.eventTime.formerSegments
        .slice(0, 1)
        .map((former) => ({ name: former.name, accepted: false, bytes: fromHex(former.canonicalUtf8Hex) })),
    ];
    expect(cases.map((entry) => entry.name)).toEqual(
      expect.arrayContaining([
        "event-time-elapsed-ms",
        "event-time-occurred-at",
        "time-precision-start-seconds",
        "time-precision-end-last-millisecond",
        "time-form-other-zone",
        "time-in-capture-context",
        "former-odsjecak-zv-1",
      ]),
    );

    // `faithful` copies ids and times from the bytes into the descriptor, as an
    // honest client does; otherwise the descriptor keeps the valid ones of the
    // base segment, so that only the check of the bytes can refuse.
    for (const faithful of [true, false]) {
      for (const { name, accepted, bytes } of cases) {
        const canonicalPayload = new TextDecoder().decode(bytes);
        const sent = JSON.parse(canonicalPayload) as Record<string, string>;
        const descriptor = {
          ...base.descriptor,
          ...(faithful
            ? {
                documentId: sent.documentId,
                sessionId: sent.sessionId,
                segmentId: sent.segmentId,
                observedStartedAt: sent.observedStartedAt,
                observedEndedAt: sent.observedEndedAt,
              }
            : {}),
          segmentHash: createHash("sha256").update(bytes).digest("hex"),
          payloadBytes: bytes.byteLength,
        } as EvidenceSegmentDescriptorV2;
        const payloadStore = new InMemoryEvidencePayloadStore();
        const repository = new InMemoryEvidenceAcceptanceRepository();
        const signer = new DevelopmentEd25519SigningKeyProvider("zlatni-vektori-dev", "v1");
        const sign = vi.spyOn(signer, "sign");
        const gateway = new EvidenceGateway({
          authorization: { check: async () => ({ status: "allow" }) },
          contexts: new InMemoryEvidenceContextPort([
            {
              evidencePackageId: chain.evidencePackageId,
              documentId: descriptor.documentId,
              evidenceProfileId: descriptor.evidenceProfileId,
              maxPayloadBytes: MAX_EVIDENCE_SEGMENT_BYTES,
              acceptsEvidence: true,
            },
          ]),
          payloadStore,
          repository,
          signer,
        });

        const outcome = await gateway.ingest({
          principalId: chain.principalId,
          command: { clientRequestId: "zahtjev-zv-odbijen", descriptor, canonicalPayload },
        });
        const label = `${name}, ${faithful ? "faithful" : "base"} descriptor`;
        expect(outcome.status, label).toBe(accepted ? "accepted" : "invalid");
        expect(payloadStore.size, label).toBe(accepted ? 1 : 0);
        expect(repository.records(), label).toHaveLength(accepted ? 1 : 0);
        expect(sign, label).toHaveBeenCalledTimes(accepted ? 1 : 0);
      }
    }
  });

  it("reconstructs the stored record under the stored signatures", async () => {
    const dependencies = { ...storedRecord(), signer: goldenKey, replayer };
    expect(
      await reconstructAndCompareEvidence(dependencies, {
        ...reconstruction,
        expectedDocument: finalDocument.value,
      }),
    ).toEqual(matched);
    // The same document with its keys in another order is the same document.
    expect(
      await reconstructAndCompareEvidence(dependencies, {
        ...reconstruction,
        expectedDocument: chain.expectedDocumentReordered,
      }),
    ).toEqual(matched);
    // Every earlier state is a different document.
    expect(
      await reconstructAndCompareEvidence(dependencies, {
        ...reconstruction,
        expectedDocument: chain.documentStates[2].value,
      }),
    ).toEqual({ status: "mismatch", reason: "target_mismatch", index: null });
  });

  it("does not accept a stored signature moved to the other receipt", async () => {
    const [first, second] = chain.segments;
    const swapped = storedRecord((vector) => ({
      ...signedReceiptOf(vector),
      signature: (vector === first ? second : first).receipt.signature,
    }));
    expect(
      await reconstructAndCompareEvidence(
        { ...swapped, signer: goldenKey, replayer },
        { ...reconstruction, expectedDocument: finalDocument.value },
      ),
    ).toEqual({ status: "mismatch", reason: "receipt_signature_invalid", index: 0 });
  });
});
