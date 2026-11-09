import { describe, expect, it } from "vitest";

import type {
  EvidenceChainReader,
  EvidenceCheckpointReader,
  EvidenceCheckpointReadResult,
  EvidencePayloadReader,
} from "@/application/ports/evidence-reconstruction";
import { EDIT_STEP_FORMAT_V1, parseEditSteps } from "@/domain/document/edit-step";
import { sha256WebCrypto } from "@/domain/forensics/crypto";
import { digestCanonicalDocumentV2, type EvidenceStepReplayerV2 } from "@/domain/forensics/evidence-replay-v2";
import {
  canonicalEvidenceSegmentV2,
  EVIDENCE_CANONICALIZATION_V2,
  EVIDENCE_HASH_ALGORITHM_V2,
  EVIDENCE_SEGMENT_SCHEMA_V2,
  type EvidenceEventV2,
  type EvidenceSegmentV2,
} from "@/domain/forensics/evidence-segment-v2";
import { canonicalizeJcs, type JcsJsonValue } from "@/domain/forensics/jcs";
import { reconstructAndCompareEvidence, type EvidenceReceiptCheck } from "./evidence-reconstruction";
import { decideSubmission } from "./submission-decision";

// DAN-293 (B-12, D-191 t. 4): reconstruction across a gap from a checkpoint the
// chain vouches for. Readers are in-memory fakes and every receipt checks out,
// so the gap and the checkpoint are the only things under test. All data is invented.
const PACKAGE = "paket-izmisljeni-7";
const NODE = "odlomak-1";
const TEXT_START = 1;
const TEXTS = ["Prvi izmišljeni odlomak. ", "Drugi dio teksta. ", "Završna rečenica."];

type Doc = { nodes: { id: string; text: string }[] };
const paragraph = (text: string): Doc => ({ nodes: [{ id: NODE, text }] });
const EMPTY = paragraph("");
const utf8 = (text: string) => new TextEncoder().encode(text);

/** Appends plain text to the one paragraph; any other step fails the replay. */
const replayer: EvidenceStepReplayerV2<Doc> = {
  transactionFormat: EDIT_STEP_FORMAT_V1,
  load: (canonical) => {
    const document = structuredClone(canonical as unknown as Doc);
    if (!Array.isArray(document?.nodes) || document.nodes.length !== 1) throw new Error("invalid document");
    return document;
  },
  apply: (document, event) => {
    const parsed = parseEditSteps(EDIT_STEP_FORMAT_V1, event.steps);
    if (!parsed.ok) throw new Error("unsupported step");
    return parsed.steps.reduce((current, step) => {
      const node = step.stepType === "replace" ? step.slice?.content[0] : undefined;
      const offset = step.stepType === "replace" ? step.from - TEXT_START : -1;
      if (node?.type !== "text" || offset !== current.nodes[0].text.length) throw new Error("unsupported step");
      return paragraph(current.nodes[0].text + node.text);
    }, document);
  },
  toCanonical: (document) => ({ nodes: document.nodes.map(({ id, text }) => ({ id, text })) }),
};

const canonical = (document: Doc) => replayer.toCanonical(document);
const documentHash = async (document: Doc) => (await digestCanonicalDocumentV2(canonical(document))).sha256;
/** The bytes a checkpoint store holds for `document`. */
const checkpointBytes = (document: Doc) => utf8(canonicalizeJcs(canonical(document)));

/** One segment that appends `text` to `from` as event `sequence`. */
async function buildSegment(ordinal: number, from: Doc, text: string, predecessor: string | null, sequence: number) {
  const initialDocumentHash = await documentHash(from);
  const document = paragraph(from.nodes[0].text + text);
  const finalDocumentHash = await documentHash(document);
  const event: EvidenceEventV2 = {
    sequence,
    source: "editor",
    steps: [
      {
        stepType: "replace",
        from: TEXT_START + from.nodes[0].text.length,
        to: TEXT_START + from.nodes[0].text.length,
        slice: { content: [{ type: "text", text }] },
      },
    ],
    touchedNodeIds: [NODE],
    beforeDocumentHash: initialDocumentHash,
    afterDocumentHash: finalDocumentHash,
  };
  const segment: EvidenceSegmentV2 = {
    evidenceSchema: EVIDENCE_SEGMENT_SCHEMA_V2,
    canonicalization: EVIDENCE_CANONICALIZATION_V2,
    hashAlgorithm: EVIDENCE_HASH_ALGORITHM_V2,
    documentId: "dokument-izmisljeni-7",
    sessionId: "sesija-izmisljena-7",
    segmentId: `odsjecak-${ordinal}`,
    sequenceFrom: sequence,
    sequenceTo: sequence,
    observedStartedAt: `2026-10-12T08:0${ordinal}:00.000Z`,
    observedEndedAt: `2026-10-12T08:0${ordinal}:00.000Z`,
    initialDocumentHash,
    finalDocumentHash,
    predecessorSegmentHash: predecessor,
    events: [event],
    captureContext: { editorModel: "prosemirror", transactionFormat: EDIT_STEP_FORMAT_V1 },
    evidenceProfileId: "standard-v1",
  };
  return { segment, document };
}

type Spec = { sequence: number; from?: Doc };

/**
 * A record of one segment per text. `specs[i].sequence` is the event number of
 * segment `i`; `specs[i].from` replaces the document it starts from (a break
 * in the document). Returns the documents each segment starts from and ends in.
 */
async function buildRecord(specs: readonly Spec[], start: Doc = EMPTY) {
  const bytes: Uint8Array[] = [];
  const hashes: string[] = [];
  const starts: Doc[] = [];
  const segments: EvidenceSegmentV2[] = [];
  let document = start;
  for (const [index, spec] of specs.entries()) {
    const from = spec.from ?? document;
    const built = await buildSegment(index + 1, from, TEXTS[index], hashes.at(-1) ?? null, spec.sequence);
    const text = canonicalEvidenceSegmentV2(built.segment);
    bytes.push(utf8(text));
    hashes.push(await sha256WebCrypto(text));
    starts.push(from);
    segments.push(built.segment);
    document = built.document;
  }
  return { bytes, hashes, starts, segments, target: document };
}
type Record = Awaited<ReturnType<typeof buildRecord>>;

const verifiedReceipts: EvidenceReceiptCheck = async ({ index }) => ({
  status: "verified",
  receiptId: `potvrda-${index}`,
});

function readers(record: Record): { chain: EvidenceChainReader<unknown>; payloads: EvidencePayloadReader } {
  return {
    chain: {
      readChain: async () => ({
        status: "found",
        head: { segmentHash: record.hashes.at(-1)!, segmentCount: record.hashes.length },
        segments: record.hashes.map((segmentHash) => ({ segmentHash, receipt: { izmisljena: true } })),
      }),
    },
    payloads: {
      readImmutable: async ({ segmentHash }) => ({
        status: "found",
        bytes: record.bytes[record.hashes.indexOf(segmentHash)],
      }),
    },
  };
}

/** A reader over `stored`, recording every call it gets. */
function checkpointStore(stored: ReadonlyMap<string, Uint8Array>) {
  const calls: { evidencePackageId: string; documentHashes: readonly string[] }[] = [];
  const reader: EvidenceCheckpointReader = {
    readCheckpoints: async (input) => {
      calls.push({ evidencePackageId: input.evidencePackageId, documentHashes: [...input.documentHashes] });
      const checkpoints = new Map<string, Uint8Array>();
      for (const hash of input.documentHashes) {
        const bytes = stored.get(hash);
        if (bytes) checkpoints.set(hash, bytes);
      }
      return { status: "found", checkpoints };
    },
  };
  return { reader, calls };
}

/** Checkpoints of the documents the segments at `indexes` start from, under their hashes. */
async function checkpointsAt(record: Record, indexes: readonly number[]) {
  const stored = new Map<string, Uint8Array>();
  for (const index of indexes) {
    stored.set(record.segments[index].initialDocumentHash, checkpointBytes(record.starts[index]));
  }
  return stored;
}

function reconstruct(record: Record, checkpoints?: EvidenceCheckpointReader, expected: Doc = record.target) {
  return reconstructAndCompareEvidence(
    { ...readers(record), receipts: verifiedReceipts, replayer, checkpoints },
    {
      evidencePackageId: PACKAGE,
      initialDocument: canonical(EMPTY),
      expectedDocument: canonical(expected) as JcsJsonValue,
    },
  );
}

const gapAt = (index: number, previousSequenceTo: number, sequenceFrom: number, documentHashBreak = false) => ({
  index,
  previousSequenceTo,
  sequenceFrom,
  sequence: "gap" as const,
  documentHashBreak,
});

describe("reconstruction across gaps (DAN-293)", () => {
  it("without a checkpoint reader the first gap is the outcome, as before", async () => {
    const record = await buildRecord([{ sequence: 1 }, { sequence: 5 }, { sequence: 6 }]);
    expect(await reconstruct(record)).toEqual({ status: "discontinuity", discontinuity: gapAt(1, 1, 5) });
  });

  it("continues past a gap from its checkpoint and keeps the gap in the outcome", async () => {
    const record = await buildRecord([{ sequence: 1 }, { sequence: 5 }, { sequence: 6 }]);
    const { reader, calls } = checkpointStore(await checkpointsAt(record, [1]));
    expect(await reconstruct(record, reader)).toEqual({
      status: "match_across_gaps",
      head: { segmentHash: record.hashes[2], segmentCount: 3 },
      documentSha256: await documentHash(record.target),
      breaks: [gapAt(1, 1, 5)],
    });
    expect(calls).toEqual([{ evidencePackageId: PACKAGE, documentHashes: [record.segments[1].initialDocumentHash] }]);
  });

  it("crosses a gap at the start of the record and a gap with a break in the document", async () => {
    const elsewhere = paragraph("Izmišljeni tekst napisan izvan zapisa. ");
    const record = await buildRecord([{ sequence: 4 }, { sequence: 9, from: elsewhere }, { sequence: 10 }]);
    const { reader } = checkpointStore(await checkpointsAt(record, [0, 1]));
    const outcome = await reconstruct(record, reader);
    expect(outcome).toMatchObject({
      status: "match_across_gaps",
      breaks: [gapAt(0, 0, 4), gapAt(1, 4, 9, true)],
    });
  });

  it("asks once, for the checkpoints at the gaps only, sorted and without repeats", async () => {
    const record = await buildRecord([{ sequence: 1 }, { sequence: 5 }, { sequence: 9 }]);
    const stored = await checkpointsAt(record, [0, 1, 2]);
    const { reader, calls } = checkpointStore(stored);
    expect((await reconstruct(record, reader)).status).toBe("match_across_gaps");
    const asked = [record.segments[1].initialDocumentHash, record.segments[2].initialDocumentHash].sort();
    expect(calls).toEqual([{ evidencePackageId: PACKAGE, documentHashes: asked }]);
    // The checkpoint of the start is offered but never asked for: there is no gap there.
    expect(calls[0].documentHashes).not.toContain(record.segments[0].initialDocumentHash);
  });

  it("rejects a checkpoint that is another valid document, or the right one not in canonical form", async () => {
    const record = await buildRecord([{ sequence: 1 }, { sequence: 5 }, { sequence: 6 }]);
    const key = record.segments[1].initialDocumentHash;
    const forged = checkpointBytes(paragraph("Podmetnuti izmišljeni tekst. "));
    const spaced = utf8(JSON.stringify(canonical(record.starts[1]), null, 1));
    for (const bytes of [forged, spaced]) {
      const { reader } = checkpointStore(new Map([[key, bytes]]));
      expect(await reconstruct(record, reader)).toEqual({
        status: "mismatch",
        reason: "checkpoint_invalid",
        index: 1,
      });
    }
  });

  it("rejects the bytes of another gap's checkpoint returned under the asked hash", async () => {
    const record = await buildRecord([{ sequence: 1 }, { sequence: 5 }, { sequence: 9 }]);
    const [first, second] = [1, 2].map((index) => record.segments[index].initialDocumentHash);
    const { reader } = checkpointStore(
      new Map([
        [first, checkpointBytes(record.starts[2])],
        [second, checkpointBytes(record.starts[1])],
      ]),
    );
    expect(await reconstruct(record, reader)).toEqual({ status: "mismatch", reason: "checkpoint_invalid", index: 1 });
  });

  it("stops at a gap whose checkpoint is missing, even after an earlier gap was crossed", async () => {
    const record = await buildRecord([{ sequence: 1 }, { sequence: 5 }, { sequence: 9 }]);
    const { reader } = checkpointStore(await checkpointsAt(record, [1]));
    expect(await reconstruct(record, reader)).toEqual({ status: "discontinuity", discontinuity: gapAt(2, 5, 9) });
  });

  it("never asks for a checkpoint when the first break is a regression or a document break alone", async () => {
    const elsewhere = paragraph("Izmišljeni tekst napisan izvan zapisa. ");
    const cases: [Spec[], object][] = [
      [
        [{ sequence: 1 }, { sequence: 1 }, { sequence: 5 }],
        { index: 1, previousSequenceTo: 1, sequenceFrom: 1, sequence: "regression", documentHashBreak: false },
      ],
      [
        [{ sequence: 1 }, { sequence: 2, from: elsewhere }, { sequence: 3 }],
        { index: 1, previousSequenceTo: 1, sequenceFrom: 2, sequence: "continuous", documentHashBreak: true },
      ],
    ];
    for (const [specs, discontinuity] of cases) {
      const record = await buildRecord(specs);
      const { reader, calls } = checkpointStore(await checkpointsAt(record, [0, 1, 2]));
      expect(await reconstruct(record, reader)).toEqual({ status: "discontinuity", discontinuity });
      expect(calls).toEqual([]);
    }
  });

  it("stops at a regression after a crossed gap", async () => {
    const record = await buildRecord([{ sequence: 1 }, { sequence: 5 }, { sequence: 3 }]);
    const { reader } = checkpointStore(await checkpointsAt(record, [1, 2]));
    expect(await reconstruct(record, reader)).toEqual({
      status: "discontinuity",
      discontinuity: { index: 2, previousSequenceTo: 5, sequenceFrom: 3, sequence: "regression", documentHashBreak: false },
    });
  });

  it("reports a reader that throws or is unavailable as storage, not as a word on the record", async () => {
    const record = await buildRecord([{ sequence: 1 }, { sequence: 5 }, { sequence: 6 }]);
    const failing: EvidenceCheckpointReader = {
      readCheckpoints: async () => {
        throw new Error("izmisljeni kvar");
      },
    };
    const unavailable: EvidenceCheckpointReader = {
      readCheckpoints: async (): Promise<EvidenceCheckpointReadResult> => ({ status: "unavailable", reason: "timeout" }),
    };
    expect(await reconstruct(record, failing)).toMatchObject({ status: "unavailable", stage: "storage" });
    expect(await reconstruct(record, unavailable)).toEqual({ status: "unavailable", stage: "storage", reason: "timeout" });
  });

  it("compares the target after the gaps, by document and by hash", async () => {
    const record = await buildRecord([{ sequence: 1 }, { sequence: 5 }, { sequence: 6 }]);
    const { reader } = checkpointStore(await checkpointsAt(record, [1]));
    expect(await reconstruct(record, reader, paragraph("Drugi izmišljeni cilj."))).toEqual({
      status: "mismatch",
      reason: "target_mismatch",
      index: null,
    });
    const byHash = await reconstructAndCompareEvidence(
      { ...readers(record), receipts: verifiedReceipts, replayer, checkpoints: reader },
      { evidencePackageId: PACKAGE, initialDocument: canonical(EMPTY), expectedDocumentSha256: "0".repeat(64) },
    );
    expect(byHash).toEqual({ status: "mismatch", reason: "target_mismatch", index: null });
  });

  it("blocks submission of a record reconstructed across gaps", async () => {
    const record = await buildRecord([{ sequence: 1 }, { sequence: 5 }, { sequence: 6 }]);
    const { reader } = checkpointStore(await checkpointsAt(record, [1]));
    const outcome = await reconstruct(record, reader);
    expect(outcome.status).toBe("match_across_gaps");
    expect(decideSubmission(outcome)).toEqual({ decision: "blocked", reason: "record_discontinuous" });
  });
});
