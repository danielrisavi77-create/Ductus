import { describe, expect, it, vi } from "vitest";

import { InMemoryEvidencePayloadStore } from "@/adapters/evidence/in-memory-evidence-payload-store";
import type {
  EvidencePayloadReader,
  EvidencePayloadReadResult,
} from "@/application/ports/evidence-reconstruction";
import type {
  ProcessSummarySource,
  ProcessSummarySourceResult,
} from "@/application/ports/process-summary-source";
import { EDIT_STEP_FORMAT_V1 } from "@/domain/document/edit-step";
import { sha256WebCrypto } from "@/domain/forensics/crypto";
import {
  canonicalEvidenceSegmentV2,
  EVIDENCE_CANONICALIZATION_V2,
  EVIDENCE_HASH_ALGORITHM_V2,
  EVIDENCE_SEGMENT_SCHEMA_V2,
  type EvidenceSourceV2,
} from "@/domain/forensics/evidence-segment-v2";
import { canonicalizeJcs } from "@/domain/forensics/jcs";
import { projectProcessSummary } from "@/domain/projection/process-summary";

import { readProcessSummary, type ProcessSummaryReaderDeps } from "./process-summary-reader";

// Synthetic only: invented ids, people (Ana, Vesna, Boris, Iva) and Lorem ipsum.
const INSTITUTION = "11111111-1111-4111-8111-111111111111";
const PACKAGE = "pkg-ana-z1";
const DOCUMENT = "doc-ana-z1";
const THRESHOLDS = { sessionBreakAboveMinutes: 30, pasteListedAboveCharacters: 200 };
const LONG_PASTE = "Lorem ipsum dolor sit amet. ".repeat(10);

type Segment = { from: string; to: string; source: EvidenceSourceV2; text: string; skip?: number };
type Stored = { payloads: string[]; hashes: string[] };

const at = (time: string) => `2026-10-20T${time}:00.000Z`;
const docHash = (n: number) => n.toString(16).padStart(64, "0");

async function buildRecord(segments: Segment[], documentId = DOCUMENT): Promise<Stored> {
  const payloads: string[] = [];
  const hashes: string[] = [];
  let sequence = 0;
  let documentHash = 1;
  for (const [index, segment] of segments.entries()) {
    sequence += 1 + (segment.skip ?? 0);
    const before = documentHash;
    documentHash += 1;
    const canonical = canonicalEvidenceSegmentV2({
      evidenceSchema: EVIDENCE_SEGMENT_SCHEMA_V2,
      canonicalization: EVIDENCE_CANONICALIZATION_V2,
      hashAlgorithm: EVIDENCE_HASH_ALGORITHM_V2,
      documentId,
      sessionId: "session-ana",
      segmentId: `segment-${index + 1}`,
      sequenceFrom: sequence,
      sequenceTo: sequence,
      observedStartedAt: segment.from,
      observedEndedAt: segment.to,
      initialDocumentHash: docHash(before),
      finalDocumentHash: docHash(documentHash),
      predecessorSegmentHash: hashes.at(-1) ?? null,
      events: [
        {
          sequence,
          source: segment.source,
          steps: [{ stepType: "replace", from: 1, to: 1, slice: { content: [{ type: "text", text: segment.text }] } }],
          beforeDocumentHash: docHash(before),
          afterDocumentHash: docHash(documentHash),
        },
      ],
      captureContext: { editorModel: "prosemirror", transactionFormat: EDIT_STEP_FORMAT_V1 },
      evidenceProfileId: "standard-v1",
    });
    payloads.push(canonical);
    hashes.push(await sha256WebCrypto(canonical));
  }
  return { payloads, hashes };
}

const WORK: Segment[] = [
  { from: at("10:00"), to: at("10:05"), source: "editor", text: "Lorem ipsum" },
  { from: at("10:20"), to: at("10:21"), source: "paste", text: LONG_PASTE },
  { from: at("11:30"), to: at("11:32"), source: "paste", text: "dolor" },
];

async function storeOf(record: Stored): Promise<InMemoryEvidencePayloadStore> {
  const store = new InMemoryEvidencePayloadStore();
  for (const [index, canonicalPayload] of record.payloads.entries()) {
    await store.putImmutable({
      institutionId: INSTITUTION,
      evidencePackageId: PACKAGE,
      segmentHash: record.hashes[index],
      canonicalPayload,
    });
  }
  return store;
}

type Found = Extract<ProcessSummarySourceResult, { status: "found" }>;

function found(record: Stored, count = record.hashes.length): Found {
  const segmentHashes = record.hashes.slice(0, count);
  return {
    status: "found",
    evidencePackageId: PACKAGE,
    head: count === 0 ? null : { segmentHash: segmentHashes[count - 1], segmentCount: count },
    segmentHashes,
  };
}

/** A source as the adapter binds it to one viewer: the viewer is fixed outside the reader. */
function sourceFor(answer: ProcessSummarySourceResult) {
  const readSource = vi.fn(async (documentId: string) =>
    documentId === DOCUMENT ? structuredClone(answer) : ({ status: "not_found" } as const),
  );
  return { readSource } satisfies ProcessSummarySource;
}

function deps(source: ProcessSummarySource, payloads: EvidencePayloadReader, thresholds = THRESHOLDS): ProcessSummaryReaderDeps {
  return { source, payloads, thresholds };
}

describe("readProcessSummary: one answer for the owner and the teacher (B-13, D-80 point 6)", () => {
  it("gives Ana and Vesna byte-identical bodies, the JCS text of the one projection", async () => {
    const record = await buildRecord(WORK);
    const store = await storeOf(record);
    const ana = await readProcessSummary(deps(sourceFor(found(record)), store), DOCUMENT);
    const vesna = await readProcessSummary(deps(sourceFor(found(record)), store), DOCUMENT);

    expect(ana.status).toBe("ok");
    expect(vesna).toStrictEqual(ana);
    const direct = await projectProcessSummary({ payloads: record.payloads, head: found(record).head, thresholds: THRESHOLDS });
    if (!direct.ok || ana.status !== "ok") throw new Error("expected a summary");
    expect(ana.body).toBe(canonicalizeJcs(direct.summary));
    expect(JSON.parse(ana.body)).toMatchObject({
      sessions: { count: 2, breakAboveMinutes: 30 },
      pastes: { listedAboveCharacters: 200, smallerCount: 1 },
      recordState: "complete",
    });
  });

  it("takes only the document id from the request; thresholds come from configuration", async () => {
    expect(readProcessSummary.length).toBe(2);
    const record = await buildRecord(WORK);
    const store = await storeOf(record);
    const strict = await readProcessSummary(deps(sourceFor(found(record)), store, { ...THRESHOLDS, sessionBreakAboveMinutes: 120 }), DOCUMENT);
    if (strict.status !== "ok") throw new Error("expected a summary");
    expect(JSON.parse(strict.body).sessions).toMatchObject({ count: 1, breakAboveMinutes: 120 });

    const source = sourceFor(found(record));
    const smuggled = { documentId: DOCUMENT, thresholds: { sessionBreakAboveMinutes: 1 }, asRole: "teacher" };
    expect(await readProcessSummary(deps(source, store), smuggled as never)).toStrictEqual({ status: "not_found" });
    expect(source.readSource).not.toHaveBeenCalled();
  });

  it("answers refused, foreign, missing and malformed ids the same way, before reading any payload", async () => {
    const record = await buildRecord(WORK);
    const store = await storeOf(record);
    const read = vi.spyOn(store, "readImmutable");
    const refused = sourceFor({ status: "not_found" }); // Boris asks for Ana's work, Iva from another institution
    // A malformed id never reaches the source, even one that would answer anything.
    const lenient = { readSource: vi.fn(async () => found(record)) } satisfies ProcessSummarySource;
    const answers = [
      await readProcessSummary(deps(refused, store), DOCUMENT),
      await readProcessSummary(deps(sourceFor(found(record)), store), "doc-nobody"),
      ...[" doc-ana-z1", "", "doc\u0000ana", "x".repeat(257)].map((id) => readProcessSummary(deps(lenient, store), id)),
    ];
    for (const answer of await Promise.all(answers)) expect(answer).toStrictEqual({ status: "not_found" });
    expect(lenient.readSource).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it("reads only the segments the source lists, never past its head", async () => {
    const record = await buildRecord(WORK);
    const store = await storeOf(record);
    const read = vi.spyOn(store, "readImmutable");
    const cut = await readProcessSummary(deps(sourceFor(found(record, 2)), store), DOCUMENT);
    if (cut.status !== "ok") throw new Error("expected a summary");
    expect(read.mock.calls.map(([input]) => input.segmentHash)).toStrictEqual(record.hashes.slice(0, 2));
    expect(JSON.parse(cut.body)).toMatchObject({ sessions: { count: 1 }, pastes: { smallerCount: 0 } });

    const empty = await readProcessSummary(deps(sourceFor(found(record, 0)), store), DOCUMENT);
    if (empty.status !== "ok") throw new Error("expected a summary");
    expect(JSON.parse(empty.body)).toMatchObject({ sessions: { count: 0 }, recordState: "complete" });
  });

  it("shows a gap in the record to both viewers alike", async () => {
    const record = await buildRecord([WORK[0], { ...WORK[1], skip: 3 }]);
    const store = await storeOf(record);
    const ana = await readProcessSummary(deps(sourceFor(found(record)), store), DOCUMENT);
    const vesna = await readProcessSummary(deps(sourceFor(found(record)), store), DOCUMENT);
    expect(vesna).toStrictEqual(ana);
    if (ana.status !== "ok") throw new Error("expected a summary");
    expect(JSON.parse(ana.body)).toMatchObject({ recordState: "has_gaps", gaps: { items: [{ previousEndedAt: at("10:05") }] } });
  });
});

describe("readProcessSummary fails whole, never with a partial summary", () => {
  const unavailable = (reason: string) => ({ status: "unavailable", reason });

  it("refuses a missing or unreadable payload", async () => {
    const record = await buildRecord(WORK);
    const partial = await storeOf({ payloads: record.payloads.slice(0, 2), hashes: record.hashes.slice(0, 2) });
    expect(await readProcessSummary(deps(sourceFor(found(record)), partial), DOCUMENT)).toStrictEqual(unavailable("payload_missing"));

    const down = await storeOf(record);
    down.unavailableReason = "bucket down: Lorem ipsum";
    expect(await readProcessSummary(deps(sourceFor(found(record)), down), DOCUMENT)).toStrictEqual(unavailable("payload_unavailable"));
  });

  it("passes no adapter text through when the source is unavailable", async () => {
    const source = sourceFor({ status: "unavailable", reason: "relation evidence.segment: Lorem ipsum" });
    const answer = await readProcessSummary(deps(source, await storeOf(await buildRecord(WORK))), DOCUMENT);
    expect(answer).toStrictEqual(unavailable("source_unavailable"));
  });

  it("refuses bytes a store returns for another hash, a head cut short and a reordered list", async () => {
    const record = await buildRecord(WORK);
    const store = await storeOf(record);
    const swapped: EvidencePayloadReader = {
      async readImmutable(input): Promise<EvidencePayloadReadResult> {
        const index = record.hashes.indexOf(input.segmentHash);
        return { status: "found", bytes: new TextEncoder().encode(record.payloads[index === 1 ? 2 : index]) };
      },
    };
    const cases: [ProcessSummarySourceResult, EvidencePayloadReader][] = [
      [found(record), swapped],
      [{ ...found(record), head: found(record, 2).head }, store],
      [{ ...found(record), segmentHashes: [record.hashes[1], record.hashes[0], record.hashes[2]] }, store],
      [{ ...found(record), segmentHashes: record.hashes.slice(0, 2) }, store],
    ];
    for (const [answer, payloads] of cases) {
      const result = await readProcessSummary(deps(sourceFor(answer), payloads), DOCUMENT);
      expect(result.status).toBe("unavailable");
      expect(result).not.toHaveProperty("body");
    }
  });

  // QA #450 MANJE 1: an adapter that throws gives the same closed outcome as one that answers.
  it("turns a source or store that throws into unavailable, without its message", async () => {
    const record = await buildRecord(WORK);
    const throwingSource = { readSource: vi.fn(async () => Promise.reject(new Error("pg: relation x Lorem"))) };
    expect(await readProcessSummary(deps(throwingSource, await storeOf(record)), DOCUMENT)).toStrictEqual(
      unavailable("source_unavailable"),
    );
    const syncThrow: EvidencePayloadReader = {
      readImmutable() {
        throw new Error("s3 Lorem");
      },
    };
    expect(await readProcessSummary(deps(sourceFor(found(record)), syncThrow), DOCUMENT)).toStrictEqual(
      unavailable("payload_unavailable"),
    );
  });

  // QA #450 MANJE 2: thresholds the projection refuses are a closed outcome, never a throw.
  it("answers thresholds the projection refuses with unavailable", async () => {
    const record = await buildRecord(WORK);
    const store = await storeOf(record);
    for (const sessionBreakAboveMinutes of [0, Number.NaN]) {
      const thresholds = { ...THRESHOLDS, sessionBreakAboveMinutes };
      expect(await readProcessSummary(deps(sourceFor(found(record)), store, thresholds), DOCUMENT)).toStrictEqual(
        unavailable("projection_failed"),
      );
    }
  });

  // Review #450 MANJE 1: a source bound to another document's package does not pass.
  it("refuses a verified record of another document", async () => {
    const record = await buildRecord(WORK, "doc-boris-z1");
    const answer = await readProcessSummary(deps(sourceFor(found(record)), await storeOf(record)), DOCUMENT);
    expect(answer).toStrictEqual(unavailable("document_mismatch"));
  });
});
