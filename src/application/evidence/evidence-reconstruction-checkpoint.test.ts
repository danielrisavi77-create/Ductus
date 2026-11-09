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
import {
  reconstructAndCompareEvidence,
  reconstructEvidenceFromCheckpoint,
  type EvidenceReceiptCheck,
  type EvidenceResumedReconstructionOutcome,
} from "./evidence-reconstruction";
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
    observedStartedAt: `2026-10-12T08:${String(ordinal).padStart(2, "0")}:00.000Z`,
    observedEndedAt: `2026-10-12T08:${String(ordinal).padStart(2, "0")}:00.000Z`,
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
    const text = TEXTS[index] ?? `Izmišljeni dodatak ${index}. `;
    const built = await buildSegment(index + 1, from, text, hashes.at(-1) ?? null, spec.sequence);
    const canonicalSegment = canonicalEvidenceSegmentV2(built.segment);
    bytes.push(utf8(canonicalSegment));
    hashes.push(await sha256WebCrypto(canonicalSegment));
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

// DAN-293, M3.3-P02: the same pass started at the newest checkpoint the chain
// vouches for. Positions are segment indexes; the checkpoint of position `k`
// is the document segment `k` starts from, under `initialDocumentHash`.
const CONTINUOUS: Spec[] = [{ sequence: 1 }, { sequence: 2 }, { sequence: 3 }];
const GAPPED: Spec[] = [{ sequence: 1 }, { sequence: 5 }, { sequence: 6 }];

function resume(
  record: Record,
  checkpoints: EvidenceCheckpointReader,
  expected: Doc = record.target,
  steps: EvidenceStepReplayerV2<Doc> = replayer,
) {
  return reconstructEvidenceFromCheckpoint(
    { ...readers(record), receipts: verifiedReceipts, replayer: steps, checkpoints },
    {
      evidencePackageId: PACKAGE,
      initialDocument: canonical(EMPTY),
      expectedDocument: canonical(expected) as JcsJsonValue,
    },
  );
}

/** The replayer, except that the event numbered `sequence` does not apply. */
const failingAt = (sequence: number): EvidenceStepReplayerV2<Doc> => ({
  ...replayer,
  apply: (document, event) => {
    if (event.sequence === sequence) throw new Error("izmisljeni korak koji se ne primjenjuje");
    return replayer.apply(document, event);
  },
});

async function resumedMatch(record: Record, resumedAt: number, breaks: object[] = []) {
  return {
    status: "match_from_checkpoint",
    head: { segmentHash: record.hashes.at(-1)!, segmentCount: record.hashes.length },
    documentSha256: await documentHash(record.target),
    breaks,
    resumedAt,
  };
}

describe("reconstruction resumed at a checkpoint (DAN-293, M3.3-P02)", () => {
  it("starts at the newest checkpoint the chain vouches for, in one sorted read, and says where", async () => {
    const record = await buildRecord(CONTINUOUS);
    const { reader, calls } = checkpointStore(await checkpointsAt(record, [0, 1, 2]));
    expect(await resume(record, reader)).toEqual(await resumedMatch(record, 2));
    const asked = [record.segments[1].initialDocumentHash, record.segments[2].initialDocumentHash].sort();
    expect(calls).toEqual([{ evidencePackageId: PACKAGE, documentHashes: asked }]);
  });

  it("passes over a checkpoint the chain does not vouch for and starts at an older one, or at the beginning", async () => {
    const record = await buildRecord(CONTINUOUS);
    const key = record.segments[2].initialDocumentHash;
    const rejected: [string, Uint8Array][] = [
      ["another valid document", checkpointBytes(paragraph("Podmetnuti izmišljeni tekst. "))],
      ["the checkpoint of another position of the same chain", checkpointBytes(record.starts[1])],
      ["the right document not in canonical form", utf8(JSON.stringify(canonical(record.starts[2]), null, 1))],
      ["damaged bytes", Uint8Array.of(0xff, 0xfe, 0x7b)],
      ["cut bytes", checkpointBytes(record.starts[2]).slice(0, 9)],
      ["no bytes", new Uint8Array()],
    ];
    const full = await reconstruct(record);
    expect(full.status).toBe("match");
    for (const [name, bytes] of rejected) {
      const older = new Map([...(await checkpointsAt(record, [1])), [key, bytes]]);
      expect(await resume(record, checkpointStore(older).reader), name).toEqual(await resumedMatch(record, 1));
      expect(await resume(record, checkpointStore(new Map([[key, bytes]])).reader), name).toEqual(full);
    }
  });

  it("with no checkpoint is the full pass, and never asks when there is no position to start at", async () => {
    const record = await buildRecord(CONTINUOUS);
    const empty = checkpointStore(new Map());
    expect(await resume(record, empty.reader)).toEqual(await reconstruct(record));
    expect(empty.calls).toHaveLength(1);

    const single = await buildRecord([{ sequence: 1 }]);
    const offered = checkpointStore(await checkpointsAt(single, [0]));
    expect(await resume(single, offered.reader)).toEqual(await reconstruct(single));
    expect(offered.calls).toEqual([]);
  });

  it("asks for the gap and the newest 32 positions only, sorted, however long the record", async () => {
    // A gap at position 1 and 34 segments after it: the gap is older than the
    // 32 newest positions (4 to 35), and so is position 3.
    const later = Array.from({ length: 34 }, (_, index) => ({ sequence: 6 + index }));
    const record = await buildRecord([{ sequence: 1 }, { sequence: 5 }, ...later]);
    const { reader, calls } = checkpointStore(await checkpointsAt(record, [1, 3]));
    // Position 3 is stored but never asked for, so the start is the gap.
    expect(await resume(record, reader)).toEqual(await resumedMatch(record, 1, [gapAt(1, 1, 5)]));
    const asked = [1, ...Array.from({ length: 32 }, (_, index) => 4 + index)];
    const documentHashes = asked.map((index) => record.segments[index].initialDocumentHash).sort();
    expect(calls).toEqual([{ evidencePackageId: PACKAGE, documentHashes }]);
    // The hash of the gap is not the smallest one, so the order above is the sort's doing.
    expect(documentHashes[0]).not.toBe(record.segments[1].initialDocumentHash);
  });

  it("keeps every gap in the outcome, also the ones before the start", async () => {
    const record = await buildRecord(GAPPED);
    const gap = gapAt(1, 1, 5);
    const atGap = checkpointStore(await checkpointsAt(record, [1]));
    expect(await resume(record, atGap.reader)).toEqual(await resumedMatch(record, 1, [gap]));
    const afterGap = checkpointStore(await checkpointsAt(record, [1, 2]));
    expect(await resume(record, afterGap.reader)).toEqual(await resumedMatch(record, 2, [gap]));
  });

  it("needs the checkpoint of a gap at the very start of the record too", async () => {
    const record = await buildRecord([{ sequence: 3 }, { sequence: 4 }, { sequence: 5 }]);
    const start = gapAt(0, 0, 3);
    const both = checkpointStore(await checkpointsAt(record, [0, 2]));
    expect(await resume(record, both.reader)).toEqual(await resumedMatch(record, 2, [start]));
    expect(both.calls[0].documentHashes).toContain(record.segments[0].initialDocumentHash);

    const later = checkpointStore(await checkpointsAt(record, [2]));
    expect(await resume(record, later.reader)).toEqual({ status: "discontinuity", discontinuity: start });
    expect(await resume(record, later.reader)).toEqual(await reconstruct(record, later.reader));
  });

  it("does not start behind a gap the full pass cannot cross, or behind a regression", async () => {
    const record = await buildRecord(GAPPED);
    const behindGap = checkpointStore(await checkpointsAt(record, [2]));
    expect(await resume(record, behindGap.reader)).toEqual({ status: "discontinuity", discontinuity: gapAt(1, 1, 5) });
    expect(await resume(record, behindGap.reader)).toEqual(await reconstruct(record, behindGap.reader));

    const regressed = await buildRecord([{ sequence: 1 }, { sequence: 5 }, { sequence: 3 }]);
    const all = checkpointStore(await checkpointsAt(regressed, [1, 2]));
    const outcome = await resume(regressed, all.reader);
    expect(outcome).toMatchObject({ status: "discontinuity", discontinuity: { index: 2, sequence: "regression" } });
    expect(outcome).toEqual(await reconstruct(regressed, all.reader));
    // The checkpoint behind the regression is never asked for.
    expect(all.calls[0].documentHashes).toEqual([regressed.segments[1].initialDocumentHash]);
  });

  it("reports a step that does not apply at or after the start as the full pass does", async () => {
    const record = await buildRecord(CONTINUOUS);
    const { reader } = checkpointStore(await checkpointsAt(record, [1]));
    for (const sequence of [2, 3]) {
      const outcome = await resume(record, reader, record.target, failingAt(sequence));
      expect(outcome).toMatchObject({ status: "mismatch", index: sequence - 1 });
      expect(outcome).toEqual(
        await reconstructAndCompareEvidence(
          { ...readers(record), receipts: verifiedReceipts, replayer: failingAt(sequence) },
          { evidencePackageId: PACKAGE, initialDocument: canonical(EMPTY), expectedDocument: canonical(record.target) },
        ),
      );
    }
  });

  // The known limit, pinned: this is why the outcome is not `match` and why
  // no submission is decided on it.
  it("does not see a step that does not apply before the start", async () => {
    const record = await buildRecord(CONTINUOUS);
    const { reader } = checkpointStore(await checkpointsAt(record, [1]));
    expect(await resume(record, reader, record.target, failingAt(1))).toEqual(await resumedMatch(record, 1));
    const full = await reconstructAndCompareEvidence(
      { ...readers(record), receipts: verifiedReceipts, replayer: failingAt(1) },
      { evidencePackageId: PACKAGE, initialDocument: canonical(EMPTY), expectedDocument: canonical(record.target) },
    );
    expect(full).toMatchObject({ status: "mismatch", index: 0 });
  });

  it("is not an outcome a submission is decided on", async () => {
    const record = await buildRecord(CONTINUOUS);
    const { reader } = checkpointStore(await checkpointsAt(record, [2]));
    const outcome: EvidenceResumedReconstructionOutcome = await resume(record, reader);
    expect(outcome.status).toBe("match_from_checkpoint");
    // @ts-expect-error a resumed outcome is not accepted where a submission is decided
    const decision = decideSubmission(outcome);
    expect(decision?.decision).not.toBe("submit");
  });

  it("compares the target after a resumed replay, by document and by hash", async () => {
    const record = await buildRecord(CONTINUOUS);
    const { reader } = checkpointStore(await checkpointsAt(record, [2]));
    const fault = { status: "mismatch", reason: "target_mismatch", index: null };
    expect(await resume(record, reader, paragraph("Drugi izmišljeni cilj."))).toEqual(fault);
    const byHash = (expectedDocumentSha256: string) =>
      reconstructEvidenceFromCheckpoint(
        { ...readers(record), receipts: verifiedReceipts, replayer, checkpoints: reader },
        { evidencePackageId: PACKAGE, initialDocument: canonical(EMPTY), expectedDocumentSha256 },
      );
    expect(await byHash("0".repeat(64))).toEqual(fault);
    expect(await byHash(await documentHash(record.target))).toEqual(await resumedMatch(record, 2));
  });

  it("reports a reader that throws or is unavailable as storage, also on a record without a gap", async () => {
    const record = await buildRecord(CONTINUOUS);
    const failing: EvidenceCheckpointReader = {
      readCheckpoints: async () => {
        throw new Error("izmisljeni kvar");
      },
    };
    const unavailable: EvidenceCheckpointReader = {
      readCheckpoints: async (): Promise<EvidenceCheckpointReadResult> => ({ status: "unavailable", reason: "timeout" }),
    };
    expect(await resume(record, failing)).toMatchObject({ status: "unavailable", stage: "storage" });
    expect(await resume(record, unavailable)).toEqual({ status: "unavailable", stage: "storage", reason: "timeout" });
  });

  it("gives two jobs on the same record, one after the other or at once, the same outcome", async () => {
    const record = await buildRecord(GAPPED);
    const { reader, calls } = checkpointStore(await checkpointsAt(record, [1, 2]));
    const first = await resume(record, reader);
    const [second, third] = await Promise.all([resume(record, reader), resume(record, reader)]);
    expect(first).toEqual(await resumedMatch(record, 2, [gapAt(1, 1, 5)]));
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(calls).toHaveLength(3);
  });

  it("reads the checkpoints once, so a store that changes between two reads cannot split one pass", async () => {
    const record = await buildRecord(CONTINUOUS);
    const key = record.segments[2].initialDocumentHash;
    const answers = [
      new Map<string, Uint8Array>(),
      await checkpointsAt(record, [2]),
      new Map([[key, checkpointBytes(paragraph("Podmetnuti izmišljeni tekst. "))]]),
    ];
    let reads = 0;
    const changing: EvidenceCheckpointReader = {
      readCheckpoints: async () => ({ status: "found", checkpoints: answers[Math.min(reads++, answers.length - 1)] }),
    };
    const outcomes = [await resume(record, changing), await resume(record, changing), await resume(record, changing)];
    expect(reads).toBe(3);
    // Before the checkpoint is written, with it, and after it is replaced by
    // bytes the chain does not vouch for: the start moves, the document does not.
    expect(outcomes.map((outcome) => outcome.status)).toEqual(["match", "match_from_checkpoint", "match"]);
    const target = await documentHash(record.target);
    for (const outcome of outcomes) expect(outcome).toMatchObject({ documentSha256: target });
  });
});
