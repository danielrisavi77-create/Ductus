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
import {
  MAX_EVIDENCE_SEGMENT_BYTES,
  type EvidenceChainHeadV2,
} from "@/domain/forensics/evidence-chain-v2";
import { digestEvidenceReceiptPayload } from "@/domain/forensics/evidence-receipt";
import {
  digestCanonicalDocumentV2,
  replayEvidenceSegmentsV2,
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
/** Text that was written before the first event the record holds. */
const LOST = paragraph("Izgubljeni početak. ");
/** What a record reconstructs to when its first segment does not continue the starting document. */
const startBreak = (sequenceFrom: number, documentHashBreak: boolean) => ({
  status: "discontinuity",
  discontinuity: {
    index: 0,
    previousSequenceTo: 0,
    sequenceFrom,
    sequence: sequenceFrom === 1 ? "continuous" : "gap",
    documentHashBreak,
  },
});

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
          // An event of a segment has no time; the older replay domain asks for one.
          occurredAt: "2026-10-12T08:00:00.000Z",
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
    observedEndedAt: `2026-10-12T08:${minute}:00.000Z`,
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

/**
 * Ingests one segment per text; returns each segment hash and the document after it.
 * From `breakAt` on, three event numbers are skipped: a break in the sequence. The
 * record up to there must reconstruct first, so the break is its only irregularity.
 * `startAt` and `from` move the start of the record: its first event number and the
 * document its first segment starts from.
 */
async function ingestChain(
  env: Env,
  texts: readonly string[] = THREE,
  breakAt = texts.length,
  { startAt = 1, from = EMPTY }: RecordStart = {},
) {
  const hashes: string[] = [];
  const documents: ReplayDocument[] = [];
  for (const [index, text] of texts.entries()) {
    if (index === breakAt) {
      const before = await reconstruct(env, documents[index - 1], { initial: from });
      if (startAt === 1) expect(before.status).toBe("match");
      else expect(before).toEqual(startBreak(startAt, false));
    }
    const sequenceFrom = startAt + index + (index < breakAt ? 0 : 3);
    const predecessor = hashes.at(-1) ?? null;
    const built = await buildSegment(index + 1, documents.at(-1) ?? from, [text], predecessor, sequenceFrom);
    const { command, outcome } = await ingestSegment(env, built.segment);
    expect(outcome.status).toBe("accepted");
    hashes.push(command.descriptor.segmentHash);
    documents.push(built.document);
  }
  return { hashes, documents, target: documents.at(-1) ?? from };
}
type RecordStart = { startAt?: number; from?: ReplayDocument };
type Chain = Awaited<ReturnType<typeof ingestChain>>;

type Overrides = {
  chain?: EvidenceChainReader;
  payloads?: EvidencePayloadReader;
  signer?: Pick<SigningKeyProvider, "verify">;
  replayer?: EvidenceStepReplayerV2<ReplayDocument>;
  initial?: ReplayDocument;
  packageId?: string;
};

/** `expected` is passed as given, so its key order is the caller's, not the replayer's. */
function reconstruct(
  env: Env,
  expected: ReplayDocument,
  { initial = EMPTY, packageId = PACKAGE, ...ports }: Overrides = {},
) {
  return reconstructAndCompareEvidence(
    { chain: env.repository, payloads: env.payloadStore, signer: env.signer, replayer: textReplayer, ...ports },
    {
      evidencePackageId: packageId,
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

async function rewrittenReceipt(env: Env, at = 0) {
  const original = env.repository.records()[at].signedReceipt;
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
  ["the first segment removed", "predecessor_mismatch", 0, (env) => chainWith(env, (s) => s.slice(1))],
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
    "a receipt that has no canonical form",
    "receipt_mismatch",
    1,
    (env) =>
      chainWith(env, (s) =>
        s.map((entry, at) =>
          at === 1 && entry.receipt
            ? { ...entry, receipt: { ...entry.receipt, payload: { ...entry.receipt.payload, acceptedAt: "\ud800" } } }
            : entry,
        ),
      ),
  ],
  [
    "receipts signed by another key",
    "receipt_signature_invalid",
    0,
    () => ({ signer: new DevelopmentEd25519SigningKeyProvider("b14-test-key", "v1") }),
  ],
  // "a starting document other than the one the record began from" is no longer a
  // `mismatch`: it is a break at the start, with the other start cases further down.
];

const broken = (reason: string, index: number | null) => ({ status: "mismatch", reason, index });
const otherKey = () => new DevelopmentEd25519SigningKeyProvider("b14-test-key", "v1");
const outage = { verify: () => Promise.reject(new Error("synthetic signer outage")) };
const SIX = ["Jedan. ", "Dva. ", "Tri. ", "Četiri. ", "Pet. ", "Šest."];
/** What `ingestChain(env, SIX, 4)` reconstructs to while nothing else is wrong. */
const BREAK = {
  status: "discontinuity",
  discontinuity: { index: 4, previousSequenceTo: 4, sequenceFrom: 8, sequence: "gap", documentHashBreak: false },
};

/** One fault of the attack table. Faults address segments by hash, so any two can be planted together. */
type Fault = {
  listing?: (segments: AcceptedEvidenceSegment[]) => AcceptedEvidenceSegment[];
  stored?: [segmentHash: string, bytes: Uint8Array | null];
  signer?: Overrides["signer"];
  replayer?: Overrides["replayer"];
  initial?: ReplayDocument;
  target?: ReplayDocument;
  packageId?: string;
  /** The port throws this instead of answering, for every call. */
  chainError?: Error;
  storageError?: Error;
};
type FaultRow = {
  name: string;
  /** Outcome while this is the only fault, and while only faults below it are added. */
  outcome: object;
  /** The record itself has a break in the event sequence. */
  sequenceBreak?: true;
  /** The record itself does not start at event 1 on top of the empty document. */
  record?: RecordStart;
  /**
   * A fault at the start: first event number and whether the document hash breaks. Two
   * of them are one break at index 0 that carries both.
   */
  start?: [sequenceFrom: number, documentHashBreak: boolean];
  plant?: (env: Env, chain: Chain) => Fault | Promise<Fault>;
};
/** Applies the step of segment 1 as another text, so the replay misses the recorded hash. */
const driftedReplayer: EvidenceStepReplayerV2<ReplayDocument> = {
  ...textReplayer,
  apply: (document, event) => {
    const [step] = event.steps;
    const changed = step.text === SIX[1] ? { ...event, steps: [{ ...step, text: "Drugo. " }] } : event;
    return textReplayer.apply(document, changed);
  },
};
const receiptOf =
  (segmentHash: string, receipt: AcceptedEvidenceSegment["receipt"]): Fault["listing"] =>
  (segments) => segments.map((entry) => (entry.segmentHash === segmentHash ? { ...entry, receipt } : entry));

/** Order of precedence: a fault decides the outcome against every fault below it. */
const FAULTS: FaultRow[] = [
  {
    name: "a chain port that rejects",
    outcome: { status: "unavailable", stage: "chain", reason: "synthetic chain rejection" },
    plant: () => ({ chainError: new Error("synthetic chain rejection") }),
  },
  {
    name: "an empty package",
    outcome: { status: "no_evidence" },
    // The target equals the starting document: the one case that used to read as a match.
    plant: () => ({ packageId: "paket-izmisljeni-prazan", target: EMPTY }),
  },
  {
    name: "a storage port that rejects",
    outcome: { status: "unavailable", stage: "storage", reason: "synthetic storage rejection" },
    plant: () => ({ storageError: new Error("synthetic storage rejection") }),
  },
  {
    name: "a payload deleted from storage",
    outcome: broken("missing_payload", 0),
    plant: (_env, c) => ({ stored: [c.hashes[0], null] }),
  },
  {
    name: "a changed segment",
    outcome: broken("predecessor_mismatch", 2),
    plant: async (_env, c) => ({ stored: [c.hashes[1], await forgedBytes(c, 1, "Naknadno izmijenjen dio. ")] }),
  },
  {
    name: "a removed segment",
    outcome: broken("predecessor_mismatch", 3),
    plant: (_env, c) => ({ listing: (s) => s.filter((entry) => entry.segmentHash !== c.hashes[3]) }),
  },
  {
    name: "reordered segments",
    outcome: broken("predecessor_mismatch", 4),
    plant: (_env, c) => ({
      listing: (s) => {
        const [fifth, sixth] = [c.hashes[4], c.hashes[5]].map((hash) => s.find((e) => e.segmentHash === hash));
        return s.map((entry) => (entry === fifth ? sixth : entry === sixth ? fifth : entry) ?? entry);
      },
    }),
  },
  {
    name: "a missing receipt",
    outcome: broken("receipt_missing", 0),
    plant: (_env, c) => ({ listing: receiptOf(c.hashes[0], null) }),
  },
  { name: "another key", outcome: broken("receipt_signature_invalid", 0), plant: () => ({ signer: otherKey() }) },
  {
    name: "a wrong signature",
    outcome: broken("receipt_signature_invalid", 2),
    plant: async (env, c) => ({ listing: receiptOf(c.hashes[2], await rewrittenReceipt(env, 2)) }),
  },
  { name: "a gap at the start", outcome: startBreak(7, false), record: { startAt: 7 }, start: [7, false] },
  {
    name: "a first segment that starts from another document",
    outcome: startBreak(1, true),
    record: { from: LOST },
    start: [1, true],
  },
  {
    // Was `document_hash_mismatch` / 0 until the start became a break like any other.
    name: "a wrong starting document",
    outcome: startBreak(1, true),
    start: [1, true],
    plant: () => ({ initial: paragraph("Ranije dopisan tekst. ") }),
  },
  {
    name: "steps that do not produce the recorded hash",
    outcome: broken("document_hash_mismatch", 1),
    plant: () => ({ replayer: driftedReplayer }),
  },
  { name: "a break in the sequence", outcome: BREAK, sequenceBreak: true },
  {
    name: "an invalid target",
    outcome: broken("invalid_target", null),
    plant: () => ({ target: paragraph("\ud800") }),
  },
  {
    name: "a target that differs",
    outcome: broken("target_mismatch", null),
    plant: () => ({ target: paragraph(`${SIX.join("")}!`) }),
  },
];
const FAULT_PAIRS = FAULTS.flatMap((stronger, at) =>
  FAULTS.slice(at + 1).map((weaker) => [stronger.name, weaker.name, stronger, weaker] as const),
);

/** Ingests a six-segment record, confirms its untouched outcome, then plants every fault at once. */
async function attack(...rows: FaultRow[]) {
  const env = setup();
  const withBreak = rows.some((row) => row.sequenceBreak);
  const start: RecordStart = Object.assign({}, ...rows.map((row) => row.record));
  const movedStart = start.startAt !== undefined || start.from !== undefined;
  if (movedStart) {
    // A record with a moved start has no match of its own: the same texts from event 1 do.
    const control = setup();
    expect((await reconstruct(control, (await ingestChain(control, SIX)).target)).status).toBe("match");
  }
  const chain = await ingestChain(env, SIX, withBreak ? 4 : SIX.length, start);
  // With a break, `ingestChain` already saw `match` on the record before it.
  const untouched = await reconstruct(env, chain.target);
  expect(untouched).toEqual(
    movedStart
      ? startBreak(start.startAt ?? 1, start.from !== undefined)
      : withBreak
        ? BREAK
        : expect.objectContaining({ status: "match" }),
  );

  const faults = await Promise.all(rows.map((row) => row.plant?.(env, chain) ?? {}));
  const first = <K extends keyof Fault>(key: K) => faults.find((fault) => fault[key] !== undefined)?.[key];
  const listed = chainWith(env, (segments) => faults.reduce((list, fault) => fault.listing?.(list) ?? list, segments));
  const [chainError, storageError] = [first("chainError"), first("storageError")];
  return reconstruct(env, first("target") ?? chain.target, {
    chain: {
      async readChain(id) {
        if (chainError) throw chainError;
        return (listed.chain ?? env.repository).readChain(id);
      },
    },
    payloads: {
      async readImmutable(input) {
        if (storageError) throw storageError;
        const stored = faults.find((fault) => fault.stored?.[0] === input.segmentHash)?.stored;
        if (!stored) return env.payloadStore.readImmutable(input);
        return stored[1] ? { status: "found", bytes: stored[1] } : { status: "not_found" };
      },
    },
    signer: first("signer") ?? env.signer,
    replayer: first("replayer") ?? textReplayer,
    initial: first("initial"),
    packageId: first("packageId"),
  });
}

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

  it.each<[string, object, (env: Env) => Overrides]>([
    ["a signature that does not verify", broken("receipt_signature_invalid", 0), () => ({ signer: { verify: async () => false } })],
    ["receipts signed by another key", broken("receipt_signature_invalid", 0), () => ({ signer: otherKey() })],
    [
      "no receipts at all",
      broken("receipt_missing", 0),
      (env) => chainWith(env, (s) => s.map((entry) => ({ ...entry, receipt: null }))),
    ],
    [
      "an unsigned receipt after the break",
      broken("receipt_missing", 5),
      (env) => chainWith(env, (s) => s.map((entry, at) => (at === 5 ? { ...entry, receipt: null } : entry))),
    ],
    [
      "a signer outage",
      { status: "unavailable", stage: "verification", reason: "synthetic signer outage" },
      () => ({ signer: outage }),
    ],
  ])("reports %s on a record with a sequence break, not the break", async (_name, outcome, tamper) => {
    const env = setup();
    // `ingestChain` confirms `match` on the record before the break is ingested.
    const chain = await ingestChain(env, SIX, 4);
    expect(await reconstruct(env, chain.target)).toEqual(BREAK);
    expect(await reconstruct(env, chain.target, tamper(env))).toEqual(outcome);
  });

  it("never reports a match for a package with no accepted evidence", async () => {
    const env = setup();
    // A known package with nothing accepted: the empty target equals the starting document.
    for (const target of [EMPTY, paragraph("Tekst bez zapisa.")]) {
      expect(await reconstruct(env, target)).toEqual({ status: "no_evidence" });
    }

    const chain = await ingestChain(env);
    expect((await reconstruct(env, chain.target)).status).toBe("match");
    // A package the store has never seen, next to one whose record reconstructs.
    for (const target of [EMPTY, chain.target]) {
      expect(await reconstruct(env, target, { packageId: "paket-izmisljeni-nepostojeci" })).toEqual({
        status: "no_evidence",
      });
    }
    // A listing emptied behind a recorded head, or a head erased over a listing, is a broken record.
    const headless: Overrides = {
      chain: {
        async readChain(id) {
          const read = await env.repository.readChain(id);
          return read.status === "found" ? { ...read, head: null } : read;
        },
      },
    };
    for (const [target, tampered] of [[EMPTY, chainWith(env, () => [])], [chain.target, headless]] as const) {
      expect(await reconstruct(env, target, tampered)).toEqual(broken("head_mismatch", null));
    }
  });

  it.each(FAULTS)("attack table: $name alone", async (row) => {
    expect(await attack(row)).toEqual(row.outcome);
  });

  it.each(FAULT_PAIRS)("attack table: %s decides over %s", async (_stronger, _weaker, stronger, weaker) => {
    const outcome = await attack(stronger, weaker);
    expect(outcome.status).not.toBe("match");
    const [from, to] = [stronger.start, weaker.start];
    expect(outcome).toEqual(from && to ? startBreak(Math.max(from[0], to[0]), from[1] || to[1]) : stronger.outcome);
  });

  it.each<[string, number, ReplayDocument, ReplayDocument, boolean]>([
    // name, first event, document the record starts from, document the caller starts from, hash break
    ["A: events 1 to 6 lost, the text as it was", 7, EMPTY, EMPTY, false],
    ["B: events 1 to 6 lost together with their text", 7, LOST, EMPTY, true],
    ["a start after event 1, even on top of the document the caller starts from", 7, LOST, LOST, false],
    ["a first event that starts from another document", 1, LOST, EMPTY, true],
    ["a caller that starts from another document", 1, EMPTY, LOST, true],
  ])("reports %s as a break at the start, never a match", async (_name, startAt, from, initial, hashBreak) => {
    const ONE = ["Tekst nakon početka."];
    // Untouched: the same one-segment record from event 1 on the empty document reconstructs.
    const control = setup();
    const sound = await ingestChain(control, ONE);
    expect(await reconstruct(control, sound.target)).toMatchObject({ status: "match", head: { segmentCount: 1 } });

    const env = setup();
    const chain = await ingestChain(env, ONE, ONE.length, { startAt, from });
    // The only irregularity is the start: from event 1 the record matches from its own document.
    expect(await reconstruct(env, chain.target, { initial: from })).toEqual(
      startAt === 1 ? expect.objectContaining({ status: "match" }) : startBreak(startAt, false),
    );
    for (const target of [chain.target, sound.target, from, EMPTY]) {
      expect(await reconstruct(env, target, { initial })).toEqual(startBreak(startAt, hashBreak));
    }
    // A break at the start waits for the receipts like any other break.
    expect(await reconstruct(env, chain.target, { initial, signer: { verify: async () => false } })).toEqual(
      broken("receipt_signature_invalid", 0),
    );
    expect(await reconstruct(env, chain.target, { initial, signer: outage })).toMatchObject({ status: "unavailable" });
  });

  it("keeps the replay itself closed for a first segment that starts from another document", async () => {
    // The use case reports this as a break at the start; the pure replay still refuses it.
    const built = await buildSegment(1, EMPTY, ["Tekst."], null);
    expect(await replayEvidenceSegmentsV2(textReplayer.toCanonical(EMPTY), [built.segment], textReplayer)).toMatchObject({
      ok: true,
    });
    expect(await replayEvidenceSegmentsV2(textReplayer.toCanonical(LOST), [built.segment], textReplayer)).toEqual({
      ok: false,
      reason: "document_hash_mismatch",
      segmentIndex: 0,
      sequence: null,
    });
  });

  it.each<[string, (head: EvidenceChainHeadV2, chain: Chain) => EvidenceChainHeadV2]>([
    ["behind the last segment", (_head, c) => ({ segmentHash: c.hashes[1], segmentCount: 2 })],
    ["ahead of the last segment", (head) => ({ ...head, segmentCount: 4 })],
    ["at the last hash with an earlier count", (head) => ({ ...head, segmentCount: 2 })],
    ["at an earlier hash with the full count", (head, c) => ({ ...head, segmentHash: c.hashes[1] })],
    ["at a hash that was never accepted", (head) => ({ ...head, segmentHash: "0".repeat(64) })],
  ])("blocks a head that points %s", async (_name, move) => {
    const env = setup();
    const chain = await ingestChain(env);
    expect((await reconstruct(env, chain.target)).status).toBe("match");
    const moved: Overrides = {
      chain: {
        async readChain(id) {
          const read = await env.repository.readChain(id);
          return read.status === "found" && read.head ? { ...read, head: move(read.head, chain) } : read;
        },
      },
    };
    for (const target of [chain.target, chain.documents[1]]) {
      expect(await reconstruct(env, target, moved)).toEqual(broken("head_mismatch", null));
    }
  });

  it.each<[string, unknown]>([
    ["a number that is not finite", Number.NaN],
    ["a lone surrogate", "\ud800"],
    ["an undefined value", undefined],
  ])("reports %s in the target or the starting document as a mismatch, without throwing", async (_name, text) => {
    const env = setup();
    const invalid = { nodes: [{ id: NODE, text }] } as unknown as ReplayDocument;
    // The record is judged before the target: with nothing accepted there is nothing to compare.
    expect(await reconstruct(env, invalid)).toEqual({ status: "no_evidence" });

    const chain = await ingestChain(env);
    expect((await reconstruct(env, chain.target)).status).toBe("match");
    expect(await reconstruct(env, invalid)).toEqual(broken("invalid_target", null));
    expect(await reconstruct(env, undefined as unknown as ReplayDocument)).toEqual(broken("invalid_target", null));
    expect(await reconstruct(env, chain.target, { initial: invalid })).toEqual(broken("invalid_document", null));
    // A fault of the record is not hidden by a target that cannot be compared.
    expect(await reconstruct(env, invalid, { signer: { verify: async () => false } })).toEqual(
      broken("receipt_signature_invalid", 0),
    );
  });

  it("reports a port that throws or rejects as unavailable, never as an exception", async () => {
    const env = setup();
    const { target } = await ingestChain(env);
    expect((await reconstruct(env, target)).status).toBe("match");

    const rejects = () => Promise.reject(new Error("synthetic rejection"));
    const throws = () => {
      throw new Error("synthetic throw");
    };
    const unavailable = (stage: string, reason: string) => ({ status: "unavailable", stage, reason });
    expect(await reconstruct(env, target, { chain: { readChain: rejects } })).toEqual(
      unavailable("chain", "synthetic rejection"),
    );
    expect(await reconstruct(env, target, { chain: { readChain: throws } })).toEqual(
      unavailable("chain", "synthetic throw"),
    );
    expect(await reconstruct(env, target, { payloads: { readImmutable: rejects } })).toEqual(
      unavailable("storage", "synthetic rejection"),
    );
    expect(await reconstruct(env, target, { payloads: { readImmutable: throws } })).toEqual(
      unavailable("storage", "synthetic throw"),
    );
    // A rejection that is not an `Error` still names where it came from.
    const bare = () => Promise.reject("synthetic bare rejection");
    expect(await reconstruct(env, target, { chain: { readChain: bare } })).toEqual(unavailable("chain", "chain failed"));
    expect(await reconstruct(env, target, { payloads: { readImmutable: bare } })).toEqual(
      unavailable("storage", "storage failed"),
    );
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
