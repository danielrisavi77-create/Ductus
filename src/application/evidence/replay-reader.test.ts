import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

import { InMemoryEvidencePayloadStore } from "@/adapters/evidence/in-memory-evidence-payload-store";
import type {
  EvidencePayloadReadResult,
  InstitutionEvidencePayloadReader,
} from "@/application/ports/evidence-reconstruction";
import type { ReplayCheckpointsResult, ReplaySource, ReplaySourceResult } from "@/application/ports/replay-source";
import { EDIT_STEP_FORMAT_V1 } from "@/domain/document/edit-step";
import { REVISION_ZERO_JCS, REVISION_ZERO_SHA256 } from "@/domain/document/revision-zero";
import { sha256WebCrypto } from "@/domain/forensics/crypto";
import type { EvidenceChainHeadV2 } from "@/domain/forensics/evidence-chain-v2";
import {
  canonicalEvidenceSegmentV2,
  EVIDENCE_CANONICALIZATION_V2,
  EVIDENCE_HASH_ALGORITHM_V2,
  EVIDENCE_SEGMENT_SCHEMA_V2,
} from "@/domain/forensics/evidence-segment-v2";

import {
  MAX_REPLAY_CHECKPOINT_BYTES,
  MAX_REPLAY_PAGE_SEGMENTS,
  readReplayPage,
  type ReplayPage,
} from "./replay-reader";

// Synthetic only: invented ids, people (Ana, Vesna) and Lorem ipsum.
const INSTITUTION = "11111111-1111-4111-8111-111111111111";
const PACKAGE = "pkg-ana-z1";
const DOCUMENT = "doc-ana-z1";
const CHECKPOINT_TEXT = '{"nodes":[{"children":[],"id":"00000000-0000-4000-8000-0000000000aa","type":"paragraph"}],"schemaVersion":1}';

type Stored = { payloads: string[]; hashes: string[] };
const docHash = (n: number) => n.toString(16).padStart(64, "0");

/**
 * One segment per entry, chained. A segment starts from the document the one
 * before it ended with, unless `initial` names another hash (a break); the
 * first starts from revision 0 unless `initial` says otherwise.
 */
async function buildRecord(
  segments: { initial?: string; text?: string }[],
  documentId = DOCUMENT,
): Promise<Stored> {
  const payloads: string[] = [];
  const hashes: string[] = [];
  let previousFinal = REVISION_ZERO_SHA256;
  for (const [index, segment] of segments.entries()) {
    const sequence = index + 1;
    const initial = segment.initial ?? previousFinal;
    const final = docHash(sequence);
    const canonical = canonicalEvidenceSegmentV2({
      evidenceSchema: EVIDENCE_SEGMENT_SCHEMA_V2,
      canonicalization: EVIDENCE_CANONICALIZATION_V2,
      hashAlgorithm: EVIDENCE_HASH_ALGORITHM_V2,
      documentId,
      sessionId: "session-ana",
      segmentId: `segment-${sequence}`,
      sequenceFrom: sequence,
      sequenceTo: sequence,
      observedStartedAt: "2026-10-20T10:00:00.000Z",
      observedEndedAt: "2026-10-20T10:00:00.000Z",
      initialDocumentHash: initial,
      finalDocumentHash: final,
      predecessorSegmentHash: hashes.at(-1) ?? null,
      events: [
        {
          sequence,
          source: "editor",
          steps: [{ stepType: "replace", from: 1, to: 1, slice: { content: [{ type: "text", text: segment.text ?? "Lorem" }] } }],
          beforeDocumentHash: initial,
          afterDocumentHash: final,
        },
      ],
      captureContext: { editorModel: "prosemirror", transactionFormat: EDIT_STEP_FORMAT_V1 },
      evidenceProfileId: "standard-v1",
    });
    payloads.push(canonical);
    hashes.push(await sha256WebCrypto(canonical));
    previousFinal = final;
  }
  return { payloads, hashes };
}

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

const headOf = (hashes: readonly string[]): EvidenceChainHeadV2 => ({
  segmentHash: hashes[hashes.length - 1],
  segmentCount: hashes.length,
});

function found(hashes: string[]): ReplaySourceResult {
  return {
    status: "found",
    institutionId: INSTITUTION,
    evidencePackageId: PACKAGE,
    head: hashes.length === 0 ? null : { segmentHash: hashes[hashes.length - 1], segmentCount: hashes.length },
    segmentHashes: [...hashes],
  };
}

function sourceOf(answer: ReplaySourceResult, texts: Record<string, string> = {}, checkpoints?: ReplayCheckpointsResult) {
  return {
    readSource: vi.fn(async (documentId: string) =>
      documentId === DOCUMENT ? structuredClone(answer) : ({ status: "not_found" } as const)),
    readCheckpoints: vi.fn(async (_documentId: string, hashes: readonly string[]): Promise<ReplayCheckpointsResult> =>
      checkpoints ?? { status: "found", texts: new Map(hashes.filter((h) => h in texts).map((h) => [h, texts[h]])) }),
  } satisfies ReplaySource;
}

async function page(
  source: ReplaySource,
  payloads: InstitutionEvidencePayloadReader,
  from = 0,
  pin: EvidenceChainHeadV2 | null = null,
) {
  const result = await readReplayPage({ source, payloads }, DOCUMENT, from, pin);
  return result.status === "ok" ? { ...result, page: JSON.parse(result.body) as ReplayPage } : result;
}

describe("readReplayPage (DAN-344 R3)", () => {
  it("gives the exact verified bytes in chain order from revision 0, without reading a checkpoint", async () => {
    const record = await buildRecord([{}, {}, {}]);
    const source = sourceOf(found(record.hashes));
    const result = await page(source, await storeOf(record));
    expect(result).toMatchObject({ status: "ok" });
    if (result.status !== "ok") return;
    expect(result.page).toStrictEqual({
      replayFormat: "ductus-evidence-replay-v1",
      segmentCount: 3,
      head: { segmentHash: record.hashes[2], segmentCount: 3 },
      from: 0,
      next: null,
      startDocument: REVISION_ZERO_JCS,
      segments: record.payloads,
      resumeDocuments: {},
    });
    expect(source.readCheckpoints).not.toHaveBeenCalled();
    // No institution, package, receipt or reader in the page.
    expect(result.body).not.toContain(INSTITUTION);
    expect(result.body).not.toContain(PACKAGE);
  });

  it("gives the same bytes on every read of the same record, whoever the source is bound to", async () => {
    const record = await buildRecord([{}, { initial: docHash(9) }]);
    const store = await storeOf(record);
    const texts = { [docHash(9)]: "unused" };
    const first = await readReplayPage({ source: sourceOf(found(record.hashes), texts), payloads: store }, DOCUMENT, 0, null);
    const second = await readReplayPage({ source: sourceOf(found(record.hashes), texts), payloads: store }, DOCUMENT, 0, null);
    expect(first).toStrictEqual(second);
  });

  it("starts from the checkpoint whose text hashes to the first segment's start, and is unavailable without one", async () => {
    const start = await sha256WebCrypto(CHECKPOINT_TEXT);
    const record = await buildRecord([{ initial: start }, {}]);
    const store = await storeOf(record);
    const withText = sourceOf(found(record.hashes), { [start]: CHECKPOINT_TEXT });
    const result = await page(withText, store);
    expect(result.status === "ok" && result.page.startDocument).toBe(CHECKPOINT_TEXT);
    expect(withText.readCheckpoints).toHaveBeenCalledWith(DOCUMENT, [start]);

    expect(await page(sourceOf(found(record.hashes)), store)).toStrictEqual({
      status: "unavailable",
      reason: "start_missing",
    });
    // Text that does not hash to the hash asked for is no checkpoint.
    expect(await page(sourceOf(found(record.hashes), { [start]: `${CHECKPOINT_TEXT} ` }), store)).toStrictEqual({
      status: "unavailable",
      reason: "start_missing",
    });
  });

  it("names the resume text of a break when a checkpoint has it, and leaves the break without one otherwise", async () => {
    const resume = await sha256WebCrypto(CHECKPOINT_TEXT);
    const record = await buildRecord([{}, { initial: resume }, { initial: docHash(77) }]);
    const store = await storeOf(record);
    const result = await page(sourceOf(found(record.hashes), { [resume]: CHECKPOINT_TEXT }), store);
    expect(result.status === "ok" && result.page.resumeDocuments).toStrictEqual({ [resume]: CHECKPOINT_TEXT });
    expect(result.status === "ok" && result.page.segments).toStrictEqual(record.payloads);

    // A break back to revision 0 needs no checkpoint.
    const toZero = await buildRecord([{}, { initial: REVISION_ZERO_SHA256 }]);
    const zero = await page(sourceOf(found(toZero.hashes)), await storeOf(toZero));
    expect(zero.status === "ok" && zero.page.resumeDocuments).toStrictEqual({ [REVISION_ZERO_SHA256]: REVISION_ZERO_JCS });
  });

  it("sees a break at the first segment of a later page, which carries no start document", async () => {
    const resume = await sha256WebCrypto(CHECKPOINT_TEXT);
    const record = await buildRecord([{}, {}, { initial: resume }, {}]);
    const result = await page(
      sourceOf(found(record.hashes), { [resume]: CHECKPOINT_TEXT }), await storeOf(record), 2, headOf(record.hashes));
    expect(result.status === "ok" && result.page).toMatchObject({
      from: 2,
      next: null,
      startDocument: null,
      segments: record.payloads.slice(2),
      resumeDocuments: { [resume]: CHECKPOINT_TEXT },
    });
  });

  it("answers an index outside the record like a document that does not exist", async () => {
    const record = await buildRecord([{}, {}]);
    const store = await storeOf(record);
    for (const from of [2, 3, -1, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(await page(sourceOf(found(record.hashes)), store, from, headOf(record.hashes))).toStrictEqual({ status: "not_found" });
    }
    const empty = await page(sourceOf(found([])), store, 0);
    expect(empty.status === "ok" && empty.page).toMatchObject({ segmentCount: 0, head: null, segments: [], next: null, startDocument: null });
    expect(await page(sourceOf(found([])), store, 1)).toStrictEqual({ status: "not_found" });
    expect(await readReplayPage({ source: sourceOf(found(record.hashes)), payloads: store }, " doc", 0, null)).toStrictEqual({
      status: "not_found",
    });
  });

  it("joins pages into the whole chain, without a gap or a repeated segment, at the segment limit", async () => {
    const record = await buildRecord(Array.from({ length: MAX_REPLAY_PAGE_SEGMENTS + 3 }, () => ({})));
    const store = await storeOf(record);
    const joined: string[] = [];
    let from: number | null = 0;
    let pin: EvidenceChainHeadV2 | null = null;
    let pages = 0;
    while (from !== null) {
      const result = await page(sourceOf(found(record.hashes)), store, from, pin);
      if (result.status !== "ok") throw new Error(result.status);
      joined.push(...result.page.segments);
      from = result.page.next;
      pin = result.page.head;
      pages++;
    }
    expect(pages).toBe(2);
    expect(joined).toStrictEqual(record.payloads);
  });

  it("stops a page before 8 MiB of segment bytes, always with at least one segment", async () => {
    const large = "Lorem ipsum ".repeat(170_000); // about 2 MB per segment
    const record = await buildRecord([{ text: large }, { text: large }, { text: large }, { text: large }, { text: large }]);
    const store = await storeOf(record);
    const first = await page(sourceOf(found(record.hashes)), store, 0);
    expect(first.status === "ok" && first.page.next).toBe(4);
    const last = await page(sourceOf(found(record.hashes)), store, 4, headOf(record.hashes));
    expect(last.status === "ok" && last.page).toMatchObject({ next: null, segments: [record.payloads[4]] });
  });

  it("counts 2 MiB for every checkpoint text a page asks for, and takes no longer text", async () => {
    const breaks = Array.from({ length: 6 }, (_, i) => ({ initial: docHash(100 + i) }));
    const record = await buildRecord([{}, ...breaks]);
    const store = await storeOf(record);
    const source = sourceOf(found(record.hashes));
    const first = await page(source, store, 0);
    // Three resumes are 6 MiB; a fourth would pass 8 MiB, so the page ends before it.
    expect(first.status === "ok" && first.page.next).toBe(4);
    expect(source.readCheckpoints.mock.calls[0][1]).toHaveLength(3);
    // A later page that starts at a break counts its resume too, and still holds a segment.
    const later = await page(sourceOf(found(record.hashes)), store, 4, headOf(record.hashes));
    expect(later.status === "ok" && later.page).toMatchObject({ from: 4, next: null, segments: record.payloads.slice(4) });

    const long = "x".repeat(MAX_REPLAY_CHECKPOINT_BYTES + 1);
    const resume = await sha256WebCrypto(long);
    const withLong = await buildRecord([{}, { initial: resume }]);
    const result = await page(sourceOf(found(withLong.hashes), { [resume]: long }), await storeOf(withLong));
    expect(result.status === "ok" && result.page.resumeDocuments).toStrictEqual({});
  });

  it("is unavailable, never a partial page, when stored bytes are not the listed record", async () => {
    const record = await buildRecord([{}, {}, {}]);
    const other = await buildRecord([{}, {}, {}], "doc-other");
    const store = await storeOf(record);
    const cases: [string, ReplaySourceResult, InstitutionEvidencePayloadReader][] = [
      ["a listing out of chain order", found([record.hashes[1], record.hashes[0], record.hashes[2]]), store],
      ["segments of another document", found(other.hashes), await storeOf(other)],
      ["a missing segment", found(record.hashes), await storeOf({ payloads: record.payloads.slice(0, 2), hashes: record.hashes.slice(0, 2) })],
    ];
    for (const [, answer, payloads] of cases) {
      expect((await page(sourceOf(answer), payloads)).status).toBe("unavailable");
    }
    const wrongBytes: InstitutionEvidencePayloadReader = {
      readImmutable: async ({ segmentHash }): Promise<EvidencePayloadReadResult> => ({
        status: "found",
        bytes: new TextEncoder().encode(record.payloads[segmentHash === record.hashes[1] ? 0 : record.hashes.indexOf(segmentHash)]),
      }),
    };
    expect(await page(sourceOf(found(record.hashes)), wrongBytes)).toStrictEqual({
      status: "unavailable",
      reason: "segment_mismatch",
    });
    const notCanonical: InstitutionEvidencePayloadReader = {
      readImmutable: async () => ({ status: "found", bytes: new TextEncoder().encode(`${record.payloads[0]} `) }),
    };
    expect(await page(sourceOf(found(record.hashes)), notCanonical)).toStrictEqual({
      status: "unavailable",
      reason: "invalid_segment",
    });
    const failing: InstitutionEvidencePayloadReader = { readImmutable: async () => { throw new Error("storage detail"); } };
    expect(await page(sourceOf(found(record.hashes)), failing)).toStrictEqual({
      status: "unavailable",
      reason: "payload_unavailable",
    });
  });

  it("passes the source's refusals through and turns a failing adapter into unavailable", async () => {
    const start = await sha256WebCrypto(CHECKPOINT_TEXT);
    const record = await buildRecord([{ initial: start }]);
    const store = await storeOf(record);
    expect(await page(sourceOf({ status: "not_found" }), store)).toStrictEqual({ status: "not_found" });
    expect(await page(sourceOf({ status: "unauthenticated" }), store)).toStrictEqual({ status: "unauthenticated" });
    expect(await page(sourceOf({ status: "unavailable", reason: "x" }), store)).toStrictEqual({
      status: "unavailable",
      reason: "source_unavailable",
    });
    expect(await page(sourceOf(found(record.hashes), {}, { status: "unauthenticated" }), store)).toStrictEqual({
      status: "unauthenticated",
    });
    expect(await page(sourceOf(found(record.hashes), {}, { status: "unavailable", reason: "x" }), store)).toStrictEqual({
      status: "unavailable",
      reason: "checkpoints_unavailable",
    });
    const throwing = { ...sourceOf(found(record.hashes)), readSource: async () => { throw new Error("db detail"); } };
    expect(await page(throwing, store)).toStrictEqual({ status: "unavailable", reason: "source_unavailable" });
  });
});

/** A source whose listing changes between reads: answer `n` for the n-th read, the last one after that. */
function changingSource(answers: ReplaySourceResult[], texts: Record<string, string> = {}) {
  const base = sourceOf(answers[0], texts);
  let reads = 0;
  return {
    ...base,
    readSource: vi.fn(async () => structuredClone(answers[Math.min(reads++, answers.length - 1)])),
  } satisfies ReplaySource;
}

describe("readReplayPage pinned to the head of the first page (DAN-537)", () => {
  it("serves the same later page whether the record is unchanged or has grown past the head", async () => {
    const record = await buildRecord([{}, {}, {}, {}, {}]);
    const store = await storeOf(record);
    const pin = headOf(record.hashes.slice(0, 3));
    const atPin = await page(sourceOf(found(record.hashes.slice(0, 3))), store, 1, pin);
    const grown = await page(sourceOf(found(record.hashes)), store, 1, pin);
    expect(atPin.status).toBe("ok");
    expect(grown).toStrictEqual(atPin);
    expect(grown.status === "ok" && grown.page).toMatchObject({
      segmentCount: 3,
      head: pin,
      from: 1,
      next: null,
      segments: record.payloads.slice(1, 3),
    });
    // At the head's end there is no later page, however long the record has grown.
    expect(await page(sourceOf(found(record.hashes)), store, 3, pin)).toStrictEqual({ status: "not_found" });
  });

  it("answers record_changed, never a page, when the record no longer holds the head", async () => {
    const record = await buildRecord([{}, {}, {}]);
    const other = await buildRecord([{}, {}, {}], "doc-other");
    const store = await storeOf(record);
    const head = headOf(record.hashes);
    const cases: [string, string[], EvidenceChainHeadV2][] = [
      ["cut below the head", record.hashes.slice(0, 2), head],
      ["empty", [], head],
      ["another segment at the head's place", [...record.hashes.slice(0, 2), other.hashes[2]], head],
      ["a head past the end", record.hashes, { segmentHash: head.segmentHash, segmentCount: 4 }],
      ["a head hash at another place", record.hashes, { segmentHash: record.hashes[2], segmentCount: 2 }],
    ];
    for (const [name, listing, pin] of cases) {
      const source = sourceOf(found(listing));
      expect([name, await page(source, store, 1, pin)]).toStrictEqual([name, { status: "record_changed" }]);
      // Decided from the listing alone: no stored segment and no checkpoint is read for it.
      expect(source.readCheckpoints).not.toHaveBeenCalled();
    }
  });

  it("decides access before the head, so a reader who may not see the document learns nothing of it", async () => {
    const record = await buildRecord([{}, {}]);
    const store = await storeOf(record);
    const wrong = { segmentHash: docHash(9), segmentCount: 9 };
    expect(await page(sourceOf({ status: "not_found" }), store, 1, wrong)).toStrictEqual({ status: "not_found" });
    expect(await page(sourceOf({ status: "unauthenticated" }), store, 1, wrong)).toStrictEqual({ status: "unauthenticated" });
    // Access revoked between pages: the later page is not_found, as for any document the reader may not see.
    const revoked = changingSource([{ status: "not_found" }]);
    expect(await page(revoked, store, 1, headOf(record.hashes))).toStrictEqual({ status: "not_found" });
  });

  it("takes the head only with a later page and a later page only with a head", async () => {
    const record = await buildRecord([{}, {}]);
    const store = await storeOf(record);
    const source = sourceOf(found(record.hashes));
    expect(await page(source, store, 1, null)).toStrictEqual({ status: "not_found" });
    expect(await page(source, store, 0, headOf(record.hashes))).toStrictEqual({ status: "not_found" });
    expect(source.readSource).not.toHaveBeenCalled();
  });

  it("serves a page exactly when the listing holds the head, and then only the pinned prefix", async () => {
    const record = await buildRecord([{}, {}, {}, {}, {}, {}]);
    const store = await storeOf(record);
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 6 }),
        fc.integer({ min: 1, max: 7 }),
        fc.integer({ min: 0, max: 6 }),
        fc.integer({ min: 1, max: 6 }),
        async (listed, count, hashAt, from) => {
          const pin = { segmentHash: record.hashes[hashAt], segmentCount: count };
          const result = await page(sourceOf(found(record.hashes.slice(0, listed))), store, from, pin);
          const holds = count <= listed && hashAt === count - 1;
          if (!holds) {
            expect(result).toStrictEqual({ status: "record_changed" });
          } else if (from >= count) {
            expect(result).toStrictEqual({ status: "not_found" });
          } else {
            expect(result.status === "ok" && result.page).toMatchObject({
              segmentCount: count,
              head: pin,
              from,
              next: null,
              segments: record.payloads.slice(from, count),
            });
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("answers record_changed when a checkpoint goes missing because a submission cut the record mid-read", async () => {
    const resume = await sha256WebCrypto(CHECKPOINT_TEXT);
    // A break on a later page: the cut hides its resume text between the listing and the checkpoint read.
    const record = await buildRecord([{}, {}, { initial: resume }]);
    const store = await storeOf(record);
    const head = headOf(record.hashes);
    const cut = changingSource([found(record.hashes), found(record.hashes.slice(0, 1))]);
    expect(await page(cut, store, 1, head)).toStrictEqual({ status: "record_changed" });
    expect(cut.readSource).toHaveBeenCalledTimes(2);

    // The first page: the start text hidden by the cut is record_changed, not start_missing.
    const start = await sha256WebCrypto(CHECKPOINT_TEXT);
    const fromCheckpoint = await buildRecord([{ initial: start }, {}]);
    const firstCut = changingSource([found(fromCheckpoint.hashes), found([])]);
    expect(await page(firstCut, await storeOf(fromCheckpoint), 0)).toStrictEqual({ status: "record_changed" });
  });

  it("keeps a missing checkpoint as before when the record still holds the head, and passes refusals of the re-read through", async () => {
    const resume = await sha256WebCrypto(CHECKPOINT_TEXT);
    const record = await buildRecord([{}, {}, { initial: resume }]);
    const store = await storeOf(record);
    const head = headOf(record.hashes);
    // Still held (even grown): a break without a resume, as without a pin.
    const intact = changingSource([found(record.hashes), found([...record.hashes, docHash(5)])]);
    const kept = await page(intact, store, 1, head);
    expect(kept.status === "ok" && kept.page).toMatchObject({ segments: record.payloads.slice(1), resumeDocuments: {} });
    expect(intact.readSource).toHaveBeenCalledTimes(2);

    const refusals: [ReplaySourceResult, unknown][] = [
      [{ status: "not_found" }, { status: "not_found" }],
      [{ status: "unauthenticated" }, { status: "unauthenticated" }],
      [{ status: "unavailable", reason: "x" }, { status: "unavailable", reason: "source_unavailable" }],
    ];
    for (const [again, expected] of refusals) {
      expect(await page(changingSource([found(record.hashes), again]), store, 1, head)).toStrictEqual(expected);
    }

    // A start checkpoint missing while the record holds: start_missing, as before.
    const start = await sha256WebCrypto(CHECKPOINT_TEXT);
    const fromCheckpoint = await buildRecord([{ initial: start }]);
    expect(await page(sourceOf(found(fromCheckpoint.hashes)), await storeOf(fromCheckpoint), 0)).toStrictEqual({
      status: "unavailable",
      reason: "start_missing",
    });
    // With every text present the listing is read once.
    const whole = sourceOf(found(record.hashes), { [resume]: CHECKPOINT_TEXT });
    expect((await page(whole, store, 1, head)).status).toBe("ok");
    expect(whole.readSource).toHaveBeenCalledTimes(1);
  });
});
