import { describe, expect, it } from "vitest";

import { DevelopmentEd25519SigningKeyProvider } from "@/adapters/crypto/development-ed25519-signer";
import { InMemoryEvidenceAcceptanceRepository } from "@/adapters/evidence/in-memory-evidence-acceptance-repository";
import { InMemoryEvidenceContextPort } from "@/adapters/evidence/in-memory-evidence-context";
import { InMemoryEvidencePayloadStore } from "@/adapters/evidence/in-memory-evidence-payload-store";
import type { AuthorizationPort } from "@/application/ports/authorization";
import type {
  AcceptedEvidenceSegment,
  EvidenceChainReader,
  EvidencePayloadReader,
} from "@/application/ports/evidence-reconstruction";
import type { SigningKeyProvider } from "@/application/ports/signing-key-provider";
import { sha256WebCrypto } from "@/domain/forensics/crypto";
import { MAX_EVIDENCE_SEGMENT_BYTES } from "@/domain/forensics/evidence-chain-v2";
import { digestEvidenceReceiptPayload } from "@/domain/forensics/evidence-receipt";
import {
  digestCanonicalDocumentV2,
  type EvidenceStepReplayerV2,
} from "@/domain/forensics/evidence-replay-v2";
import {
  canonicalEvidenceSegmentV2,
  EVIDENCE_CANONICALIZATION_V2,
  EVIDENCE_HASH_ALGORITHM_V2,
  EVIDENCE_SEGMENT_SCHEMA_V2,
  type EvidenceEventV2,
  type EvidenceSegmentV2,
} from "@/domain/forensics/evidence-segment-v2";
import { canonicalizeJcs, type JcsJsonValue } from "@/domain/forensics/jcs";
import { createForensicEvent } from "@/domain/forensics/ledger";
import { applyForensicEvent, type ReplayDocument } from "@/domain/forensics/replay";
import { EvidenceGateway } from "./evidence-gateway";
import { buildEvidenceIngestCommandV2 } from "./evidence-outbox";
import { reconstructAndCompareEvidence } from "./evidence-reconstruction";

// B-14 (D-98 t. 1): ingest -> signed receipt -> reconstruction -> JCS comparison
// over the in-memory adapters and the development signer. All data is invented.
const PACKAGE = "paket-izmisljeni-1";
const DOCUMENT = "dokument-izmisljeni-1";
const STUDENT = "student-izmisljeni-1";
const STRANGER = "stranac-izmisljeni-1";
const NODE = "odlomak-1";
const FORMAT = "ductus-test-insert-text-v0";
const EMPTY: ReplayDocument = { nodes: [{ id: NODE, text: "" }] };
const THREE = ["Prvi izmišljeni odlomak. ", "Drugi dio teksta. ", "Završna rečenica."];
const utf8 = (text: string) => new TextEncoder().encode(text);
const paragraph = (text: string): ReplayDocument => ({ nodes: [{ id: NODE, text }] });

/**
 * Stand-in for the editor's step code (ProseMirror in Node arrives with B-12):
 * one step is one `insert-text` payload of the existing replay domain. Strict
 * on purpose, so an unknown step kind or field fails the replay.
 */
const textReplayer: EvidenceStepReplayerV2<ReplayDocument> = {
  transactionFormat: FORMAT,
  load: (canonical) => structuredClone(canonical as unknown as ReplayDocument),
  apply: (document, event) =>
    event.steps.reduce((current, step, index) => {
      const { kind, nodeId, offset, text, ...unknown } = step;
      if (
        kind !== "insert-text" ||
        typeof nodeId !== "string" ||
        typeof offset !== "number" ||
        typeof text !== "string" ||
        Object.keys(unknown).length > 0
      ) {
        throw new Error("unsupported step");
      }
      const payload = { kind, nodeId, offset, text } as const;
      return applyForensicEvent(
        current,
        createForensicEvent({
          schemaVersion: 1,
          id: `${event.sequence}:${index}`,
          documentId: DOCUMENT,
          sequence: event.sequence,
          revision: 0,
          occurredAt: event.occurredAt,
          actorId: STUDENT,
          actorRole: "student",
          payload,
        }),
      );
    }, document),
  toCanonical: (document) => ({
    nodes: document.nodes.map((node) => ({ id: node.id, text: node.text })),
  }),
};

const documentHash = async (document: ReplayDocument) =>
  (await digestCanonicalDocumentV2(textReplayer.toCanonical(document))).sha256;

/** Segment number `ordinal` that appends `texts` to the paragraph, one event per text. */
async function buildSegment(
  ordinal: number,
  from: ReplayDocument,
  texts: readonly string[],
  predecessor: string | null,
  sequenceFrom = ordinal,
): Promise<{ segment: EvidenceSegmentV2; document: ReplayDocument }> {
  const minute = String(ordinal).padStart(2, "0");
  const initialDocumentHash = await documentHash(from);
  let document = from;
  let hash = initialDocumentHash;
  const events: EvidenceEventV2[] = [];
  for (const [index, text] of texts.entries()) {
    const event: EvidenceEventV2 = {
      sequence: sequenceFrom + index,
      occurredAt: `2026-10-12T08:${minute}:0${index + 1}.000Z`,
      elapsedMs: (index + 1) * 400,
      source: "editor",
      steps: [{ kind: "insert-text", nodeId: NODE, offset: document.nodes[0].text.length, text }],
      touchedNodeIds: [NODE],
      beforeDocumentHash: hash,
      afterDocumentHash: hash,
    };
    document = textReplayer.apply(document, event);
    hash = event.afterDocumentHash = await documentHash(document);
    events.push(event);
  }
  const segment: EvidenceSegmentV2 = {
    evidenceSchema: EVIDENCE_SEGMENT_SCHEMA_V2,
    canonicalization: EVIDENCE_CANONICALIZATION_V2,
    hashAlgorithm: EVIDENCE_HASH_ALGORITHM_V2,
    documentId: DOCUMENT,
    sessionId: "sesija-izmisljena-1",
    segmentId: `odsjecak-${ordinal}`,
    sequenceFrom,
    sequenceTo: sequenceFrom + events.length - 1,
    observedStartedAt: `2026-10-12T08:${minute}:00.000Z`,
    observedEndedAt: `2026-10-12T08:${minute}:30.000Z`,
    initialDocumentHash,
    finalDocumentHash: hash,
    predecessorSegmentHash: predecessor,
    events,
    captureContext: { editorModel: "test-text-nodes", transactionFormat: FORMAT },
    evidenceProfileId: "standard-v1",
  };
  return { segment, document };
}

function setup() {
  // The principal comes from the server-side session; this object stands for it.
  const session = { principalId: STUDENT };
  const authorization: AuthorizationPort = {
    check: async ({ principalId, action, resource }) => ({
      status:
        principalId === STUDENT && action === "append_evidence" && resource.id === PACKAGE
          ? "allow"
          : "deny",
    }),
  };
  const contexts = new InMemoryEvidenceContextPort([
    {
      evidencePackageId: PACKAGE,
      documentId: DOCUMENT,
      evidenceProfileId: "standard-v1",
      maxPayloadBytes: MAX_EVIDENCE_SEGMENT_BYTES,
      acceptsEvidence: true,
    },
  ]);
  const payloadStore = new InMemoryEvidencePayloadStore();
  let receipts = 0;
  const repository = new InMemoryEvidenceAcceptanceRepository({
    clock: () => "2026-10-12T08:45:00.000Z",
    idFactory: () => `potvrda-${++receipts}`,
  });
  const signer = new DevelopmentEd25519SigningKeyProvider("b14-test-key", "v1");
  const gateway = new EvidenceGateway({ authorization, contexts, payloadStore, repository, signer });
  return { session, payloadStore, repository, signer, gateway };
}
type Env = ReturnType<typeof setup>;

async function ingestSegment(env: Env, segment: EvidenceSegmentV2, principalId = env.session.principalId) {
  const command = await buildEvidenceIngestCommandV2({
    evidencePackageId: PACKAGE,
    clientRequestId: `zahtjev-${segment.segmentId}`,
    segment,
  });
  return { command, outcome: await env.gateway.ingest({ principalId, command }) };
}

/** Ingests one segment per text; returns each segment hash and the document after it. */
async function ingestChain(env: Env, texts: readonly string[] = THREE) {
  const hashes: string[] = [];
  const documents: ReplayDocument[] = [];
  for (const [index, text] of texts.entries()) {
    const built = await buildSegment(index + 1, documents.at(-1) ?? EMPTY, [text], hashes.at(-1) ?? null);
    const { command, outcome } = await ingestSegment(env, built.segment);
    expect(outcome.status).toBe("accepted");
    hashes.push(command.descriptor.segmentHash);
    documents.push(built.document);
  }
  return { hashes, documents, target: documents.at(-1) ?? EMPTY };
}
type Chain = Awaited<ReturnType<typeof ingestChain>>;

type Overrides = {
  chain?: EvidenceChainReader;
  payloads?: EvidencePayloadReader;
  signer?: Pick<SigningKeyProvider, "verify">;
  initial?: ReplayDocument;
};

/** `expected` is passed as given, so its key order is the caller's, not the replayer's. */
function reconstruct(env: Env, expected: ReplayDocument, { initial = EMPTY, ...ports }: Overrides = {}) {
  return reconstructAndCompareEvidence(
    { chain: env.repository, payloads: env.payloadStore, signer: env.signer, replayer: textReplayer, ...ports },
    {
      evidencePackageId: PACKAGE,
      initialDocument: textReplayer.toCanonical(initial),
      expectedDocument: expected as unknown as JcsJsonValue,
    },
  );
}

/** What a reader returns after someone edited the stored chain listing. */
function chainWith(
  env: Env,
  change: (segments: AcceptedEvidenceSegment[]) => AcceptedEvidenceSegment[],
): Overrides {
  return {
    chain: {
      async readChain(id) {
        const chain = await env.repository.readChain(id);
        return chain.status === "found" ? { ...chain, segments: change(chain.segments) } : chain;
      },
    },
  };
}

/** What a reader returns after the object at `segmentHash` was replaced or deleted. */
function payloadWith(env: Env, segmentHash: string, bytes: Uint8Array | null): Overrides {
  return {
    payloads: {
      async readImmutable(input) {
        if (input.segmentHash !== segmentHash) return env.payloadStore.readImmutable(input);
        return bytes ? { status: "found", bytes } : { status: "not_found" };
      },
    },
  };
}

/** Canonical bytes of a valid segment that says something else at chain position `at`. */
async function forgedBytes({ hashes, documents }: Chain, at: number, text: string) {
  const forged = await buildSegment(at + 1, documents[at - 1], [text], hashes[at - 1]);
  return utf8(canonicalEvidenceSegmentV2(forged.segment));
}

async function rewrittenReceipt(env: Env) {
  const original = env.repository.records()[0].signedReceipt;
  if (!original) throw new Error("fixture: receipt not signed");
  const payload = { ...original.payload, acceptedAt: "2026-10-11T08:45:00.000Z" };
  return { ...original, payload, payloadDigestSha256: (await digestEvidenceReceiptPayload(payload)).sha256 };
}

type Tamper = (env: Env, chain: Chain) => Overrides | Promise<Overrides>;
const TAMPERING: [name: string, reason: string, index: number | null, tamper: Tamper][] = [
  [
    "a changed segment in the middle",
    "predecessor_mismatch",
    2,
    async (env, c) => payloadWith(env, c.hashes[1], await forgedBytes(c, 1, "Naknadno izmijenjen dio. ")),
  ],
  [
    "a changed last segment",
    "head_mismatch",
    null,
    async (env, c) => payloadWith(env, c.hashes[2], await forgedBytes(c, 2, "Drugačiji završetak.")),
  ],
  [
    "stored bytes that are no longer canonical",
    "invalid_segment",
    1,
    (env, c) =>
      payloadWith(env, c.hashes[1], utf8(`${env.payloadStore.get(PACKAGE, c.hashes[1])?.canonicalPayload} `)),
  ],
  ["a payload deleted from storage", "missing_payload", 0, (env, c) => payloadWith(env, c.hashes[0], null)],
  ["a segment removed from the middle", "predecessor_mismatch", 1, (env) => chainWith(env, (s) => [s[0], s[2]])],
  ["the last segment removed", "head_mismatch", null, (env) => chainWith(env, (s) => s.slice(0, 2))],
  ["reordered segments", "predecessor_mismatch", 1, (env) => chainWith(env, (s) => [s[0], s[2], s[1]])],
  [
    "a receipt that is still unsigned",
    "receipt_missing",
    1,
    (env) => chainWith(env, (s) => [s[0], { ...s[1], receipt: null }, s[2]]),
  ],
  [
    "a receipt that belongs to another segment",
    "receipt_mismatch",
    1,
    (env) => chainWith(env, (s) => [s[0], { ...s[1], receipt: s[2].receipt }, s[2]]),
  ],
  [
    "a receipt whose acceptance time was rewritten",
    "receipt_signature_invalid",
    0,
    async (env) => {
      const receipt = await rewrittenReceipt(env);
      return chainWith(env, (s) => [{ ...s[0], receipt }, s[1], s[2]]);
    },
  ],
  [
    "receipts signed by another key",
    "receipt_signature_invalid",
    0,
    () => ({ signer: new DevelopmentEd25519SigningKeyProvider("b14-test-key", "v1") }),
  ],
  [
    "a starting document other than the one the record began from",
    "document_hash_mismatch",
    0,
    () => ({ initial: paragraph("Ranije dopisan tekst. ") }),
  ],
];

describe("thin critical path: ingest, signed receipt, reconstruction, JCS comparison (B-14)", () => {
  it("ingests one segment, signs its receipt, reconstructs the text and matches the target", async () => {
    const env = setup();
    const built = await buildSegment(1, EMPTY, ["Izmišljeni tekst ", "za provjeru prolaza."], null);
    const { command, outcome } = await ingestSegment(env, built.segment);
    if (outcome.status !== "accepted") throw new Error(`unexpected outcome ${outcome.status}`);

    const receiptDigest = await digestEvidenceReceiptPayload(outcome.receipt.payload);
    expect(outcome.receipt.payload.segmentHash).toBe(command.descriptor.segmentHash);
    expect(outcome.receipt.signature).toMatchObject({ algorithm: "Ed25519", keyId: "b14-test-key" });
    expect(await env.signer.verify(receiptDigest.bytes, outcome.receipt.signature)).toBe(true);

    expect(built.document.nodes[0].text).toBe("Izmišljeni tekst za provjeru prolaza.");
    // Same document with another key order: the comparison is canonical, not textual.
    const target = { nodes: [{ text: "Izmišljeni tekst za provjeru prolaza.", id: NODE }] };
    expect(await reconstruct(env, target)).toEqual({
      status: "match",
      head: { segmentHash: command.descriptor.segmentHash, segmentCount: 1 },
      documentSha256: await sha256WebCrypto(canonicalizeJcs(target)),
    });
  });

  it("reconstructs a chain of segments and blocks a target that differs", async () => {
    const env = setup();
    const { target, hashes } = await ingestChain(env);
    expect(target.nodes[0].text).toBe(THREE.join(""));
    expect(await reconstruct(env, target)).toMatchObject({
      status: "match",
      head: { segmentHash: hashes[2], segmentCount: 3 },
    });
    expect(await reconstruct(env, paragraph(`${THREE.join("")}!`))).toEqual({
      status: "mismatch",
      reason: "target_mismatch",
      index: null,
    });
  });

  it.each(TAMPERING)("fails verification for %s", async (_name, reason, index, tamper) => {
    const env = setup();
    const chain = await ingestChain(env);
    expect((await reconstruct(env, chain.target)).status).toBe("match");
    expect(await reconstruct(env, chain.target, await tamper(env, chain))).toEqual({
      status: "mismatch",
      reason,
      index,
    });
  });

  it("fails replay when the steps do not produce the recorded document hash", async () => {
    const env = setup();
    const built = await buildSegment(1, EMPTY, ["Izvorni tekst."], null);
    built.segment.events[0].steps[0].text = "Podmetnuti tekst.";
    // Ingest does not replay steps, so the segment is accepted and signed.
    expect((await ingestSegment(env, built.segment)).outcome.status).toBe("accepted");
    for (const text of ["Izvorni tekst.", "Podmetnuti tekst."]) {
      expect(await reconstruct(env, paragraph(text))).toEqual({
        status: "mismatch",
        reason: "document_hash_mismatch",
        index: 0,
      });
    }
  });

  it.each<[string, string, (segment: EvidenceSegmentV2) => void]>([
    ["a step with an unknown field", "step_failed", (s) => void (s.events[0].steps[0].authorId = STRANGER)],
    ["a step outside the text", "step_failed", (s) => void (s.events[0].steps[0].offset = 99)],
    [
      "a transaction format without a replayer",
      "unsupported_format",
      (s) => void (s.captureContext.transactionFormat = "prosemirror-step-json-v1"),
    ],
  ])("fails closed for %s", async (_name, reason, spoil) => {
    const env = setup();
    const built = await buildSegment(1, EMPTY, ["Tekst."], null);
    spoil(built.segment);
    expect((await ingestSegment(env, built.segment)).outcome.status).toBe("accepted");
    expect(await reconstruct(env, built.document)).toEqual({ status: "mismatch", reason, index: 0 });
  });

  it("reports a break in the event sequence instead of replaying across it", async () => {
    const env = setup();
    const first = await buildSegment(1, EMPTY, ["Prvi dio. "], null);
    const { command } = await ingestSegment(env, first.segment);
    // Events 2 to 4 never reached the server; the client continued from its head.
    const later = await buildSegment(2, first.document, ["Nastavak."], command.descriptor.segmentHash, 5);
    expect((await ingestSegment(env, later.segment)).outcome.status).toBe("accepted");
    expect(await reconstruct(env, later.document)).toEqual({
      status: "discontinuity",
      discontinuity: { index: 1, previousSequenceTo: 1, sequenceFrom: 5, sequence: "gap", documentHashBreak: false },
    });
  });

  it("never reports a match while a dependency is unavailable", async () => {
    const env = setup();
    const { target } = await ingestChain(env);
    const signer = { verify: () => Promise.reject(new Error("synthetic signer outage")) };
    expect(await reconstruct(env, target, { signer })).toEqual({
      status: "unavailable",
      stage: "verification",
      reason: "synthetic signer outage",
    });
    env.payloadStore.unavailableReason = "synthetic storage outage";
    expect(await reconstruct(env, target)).toMatchObject({ status: "unavailable", stage: "storage" });
    env.repository.lookupUnavailableReason = "synthetic database outage";
    expect(await reconstruct(env, target)).toMatchObject({ status: "unavailable", stage: "chain" });
  });

  it("takes the author from the server-side context, never from what the client sent", async () => {
    const env = setup();
    const built = await buildSegment(1, EMPTY, ["Tekst."], null);

    const stranger = await ingestSegment(env, built.segment, STRANGER);
    expect(stranger.outcome.status).toBe("unauthorized");

    // An identity smuggled into the segment is an unknown field and is refused.
    const canonicalPayload = canonicalizeJcs({ ...built.segment, authorId: STRANGER });
    const smuggled = await env.gateway.ingest({
      principalId: env.session.principalId,
      command: {
        clientRequestId: "zahtjev-podmetnut",
        canonicalPayload,
        descriptor: {
          ...stranger.command.descriptor,
          segmentHash: await sha256WebCrypto(canonicalPayload),
          payloadBytes: utf8(canonicalPayload).byteLength,
        },
      },
    });
    expect(smuggled.status).toBe("invalid");
    expect(env.payloadStore.size).toBe(0);

    expect((await ingestSegment(env, built.segment)).outcome.status).toBe("accepted");
    expect(env.repository.records().map((record) => record.principalId)).toEqual([STUDENT]);
  });
});
