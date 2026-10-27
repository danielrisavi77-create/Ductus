import { describe, expect, it, vi } from "vitest";

import type { SigningKeyProvider } from "@/application/ports/signing-key-provider";
import { MAX_DOCUMENT_SNAPSHOT_BYTES } from "@/domain/document/snapshot";
import { MAX_EVIDENCE_SEGMENT_BYTES } from "@/domain/forensics/evidence-chain-v2";
import { loadGoldenVectors } from "@/domain/forensics/golden-vectors/load";
import { sha256WebCrypto } from "@/domain/forensics/crypto";
import { MAX_EVIDENCE_TIMING_BYTES } from "@/domain/forensics/evidence-timing-v1";
import { canonicalizeJcs } from "@/domain/forensics/jcs";
import type { ActorTransaction, WithActor } from "@/server/db/with-actor";

import { commitEvidenceRequest, type EvidenceCommitRequest } from "./evidence-commit-request";

// The invented first segment of the golden chain and the document it ends in.
const chain = loadGoldenVectors().chain;
const golden = chain.segments[0];
const SEGMENT = Buffer.from(golden.canonicalUtf8Hex, "hex");
const final = chain.documentStates.find((state) => state.afterSequence === golden.segment.sequenceTo);
const DOCUMENT = new TextEncoder().encode(canonicalizeJcs(final?.value));
const INSTITUTION = "00000000-0000-4000-8000-0000000000a1";
const CONTEXT_ROW = {
  outcome: "ok",
  evidence_package_id: "paket-iz-baze-1",
  institution_id: INSTITUTION,
  evidence_domain_id: "00000000-0000-4000-8000-0000000000d1",
  evidence_profile_id: golden.segment.evidenceProfileId,
  max_payload_bytes: 262144,
  transaction_known: false,
  // The chain the golden segment continues: base revision 3 of REQUEST.
  current_revision: "3",
  document_hash: golden.segment.initialDocumentHash,
  head_segment_hash: golden.segment.predecessorSegmentHash,
  last_sequence_to: String(golden.segment.sequenceFrom - 1),
};
// The acceptance answers a stale base, so these tests stop before any signature.
const STALE = { outcome: "stale_base", current_revision: "4", document_hash: "e".repeat(64), head_segment_hash: null, last_sequence_to: "8" };
const REQUEST: EvidenceCommitRequest = {
  documentId: golden.segment.documentId,
  clientTransactionId: "tx-izmisljeni-1",
  baseRevision: 3,
  segment: SEGMENT,
  document: DOCUMENT,
};
const refusingSigner: SigningKeyProvider = {
  sign: () => Promise.reject(new Error("never")),
  verify: () => Promise.reject(new Error("never")),
  publicVerificationKey: () => Promise.reject(new Error("never")),
};

function setup(contextRow: Record<string, unknown> = CONTEXT_ROW) {
  const queries: { kind: string; values: readonly unknown[] }[] = [];
  const withActor: WithActor = async (_token, fn) => {
    const tx: ActorTransaction = {
      async query(text, values = []) {
        const kind = text.includes("evidence_commit_context") ? "context" : "commit";
        queries.push({ kind, values });
        const rows = [kind === "context" ? contextRow : STALE] as never[];
        return { rows, rowCount: 1 };
      },
    };
    return fn(tx);
  };
  const payloads = {
    putImmutable: vi.fn(async () => ({ status: "stored" as const, storageRef: "memory:put-ref" })),
    storageRefFor: vi.fn(async () => ({ status: "ok" as const, storageRef: "memory:known-ref" })),
  };
  const log = vi.fn();
  const run = (request: Partial<EvidenceCommitRequest> = {}) =>
    commitEvidenceRequest({ withActor, signer: refusingSigner, payloads, log }, "t", { ...REQUEST, ...request });
  return { run, queries, payloads, log };
}

const segmentWith = (change: Record<string, unknown>) =>
  new TextEncoder().encode(canonicalizeJcs({ ...golden.segment, ...change }));

describe("commitEvidenceRequest", () => {
  it("builds the descriptor from the received bytes and the package from the context, then commits", async () => {
    const { run, queries, payloads } = setup();
    expect(await run()).toEqual({
      status: "stale_base",
      state: { currentRevision: 4, documentHash: "e".repeat(64), headSegmentHash: null, lastSequenceTo: 8 },
    });
    expect(payloads.putImmutable).toHaveBeenCalledExactlyOnceWith({
      institutionId: INSTITUTION,
      evidencePackageId: "paket-iz-baze-1",
      segmentHash: golden.segmentHash,
      canonicalPayload: SEGMENT.toString("utf8"),
    });
    expect(payloads.storageRefFor).not.toHaveBeenCalled();
    const commit = queries.find((q) => q.kind === "commit");
    expect(commit?.values).toEqual([
      "paket-iz-baze-1",
      "tx-izmisljeni-1",
      3,
      golden.segment.initialDocumentHash,
      golden.segment.finalDocumentHash,
      JSON.stringify({ ...golden.descriptor, evidencePackageId: "paket-iz-baze-1" }),
      golden.segmentHash,
      "memory:put-ref",
      new TextDecoder().decode(DOCUMENT),
      // Attack 16: a commit without timing names none.
      null,
    ]);
  });

  it("writes nothing for a known idempotency key and names the object it stored before", async () => {
    const { run, queries, payloads } = setup({ ...CONTEXT_ROW, transaction_known: true });
    await run();
    expect(payloads.putImmutable).not.toHaveBeenCalled();
    expect(payloads.storageRefFor).toHaveBeenCalledExactlyOnceWith({
      institutionId: INSTITUTION,
      evidencePackageId: "paket-iz-baze-1",
      segmentHash: golden.segmentHash,
    });
    expect(queries.find((q) => q.kind === "commit")?.values[7]).toBe("memory:known-ref");
  });

  // F-099: for a new key, what the acceptance would refuse is refused before storage.
  const read = (row: Record<string, unknown>) => ({
    currentRevision: Number(row.current_revision),
    documentHash: row.document_hash,
    headSegmentHash: row.head_segment_hash,
    lastSequenceTo: Number(row.last_sequence_to),
  });
  it.each<[string, Record<string, unknown>, (row: Record<string, unknown>) => unknown]>([
    ["a stale base", { current_revision: "4" }, (row) => ({ status: "stale_base", state: read(row) })],
    ["another head segment", { head_segment_hash: "a".repeat(64) }, (row) => ({ status: "chain_conflict", state: read(row) })],
    ["a sequence that goes back", { last_sequence_to: String(golden.segment.sequenceFrom) }, () => ({ status: "invalid" })],
    ["another document state", { document_hash: "c".repeat(64) }, (row) => ({ status: "not_continuous", state: read(row) })],
  ])("refuses %s from the context's state without storing or committing", async (_, change, expected) => {
    const row = { ...CONTEXT_ROW, ...change };
    const { run, queries, payloads } = setup(row);
    expect(await run()).toEqual(expected(row));
    expect(payloads.putImmutable).not.toHaveBeenCalled();
    expect(queries.map((q) => q.kind)).toEqual(["context"]);
  });

  it("answers not_accepting from the context without storing or committing", async () => {
    const { run, queries, payloads } = setup({ outcome: "not_accepting" });
    expect(await run()).toEqual({ status: "not_accepting" });
    expect(payloads.putImmutable).not.toHaveBeenCalled();
    expect(queries.map((q) => q.kind)).toEqual(["context"]);
  });

  it("lets a known key past a changed chain to its receipt: the acceptance decides, nothing is stored", async () => {
    const { run, queries, payloads } = setup({ ...CONTEXT_ROW, transaction_known: true, current_revision: "9" });
    await run();
    expect(payloads.putImmutable).not.toHaveBeenCalled();
    expect(queries.map((q) => q.kind)).toEqual(["context", "commit"]);
  });

  it.each([
    ["no revision", { current_revision: null }],
    ["a revision as a fraction", { current_revision: "1.5" }],
    ["a document hash in capitals", { document_hash: "E".repeat(64) }],
    ["a head that is no hash", { head_segment_hash: "x" }],
    ["no sequence", { last_sequence_to: undefined }],
  ])("is unavailable when the context's state has %s", async (_, change) => {
    const { run, payloads } = setup({ ...CONTEXT_ROW, ...change });
    expect(await run()).toEqual({ status: "unavailable", stage: "context", code: "context_malformed" });
    expect(payloads.putImmutable).not.toHaveBeenCalled();
  });

  it.each([
    ["a transaction id with a control character", { clientTransactionId: "tx\n1" }],
    ["an empty transaction id", { clientTransactionId: "" }],
    ["a base revision that is not whole (qa467a)", { baseRevision: 0.5 }],
    ["a negative base revision", { baseRevision: -1 }],
    ["a base revision with no next revision", { baseRevision: Number.MAX_SAFE_INTEGER }],
    ["a segment that is no byte array", { segment: "{}" as unknown as Uint8Array }],
    ["a document id that is no text", { documentId: 7 as unknown as string }],
  ])("refuses %s as invalid before reading any state", async (_, change) => {
    const { run, queries } = setup();
    expect(await run(change)).toEqual({ status: "invalid" });
    expect(queries).toEqual([]);
  });

  it.each([
    ["a segment over D-96", { segment: new Uint8Array(MAX_EVIDENCE_SEGMENT_BYTES + 1) }],
    ["a snapshot over 2 MiB", { document: new Uint8Array(MAX_DOCUMENT_SNAPSHOT_BYTES + 1) }],
  ])("refuses %s as too large before reading any state", async (_, change) => {
    const { run, queries } = setup();
    expect(await run(change)).toEqual({ status: "too_large" });
    expect(queries).toEqual([]);
  });

  it.each(["unauthenticated", "not_found", "invalid"])("answers context %s and does nothing else", async (outcome) => {
    const { run, queries, payloads } = setup({ outcome });
    expect(await run({ segment: new TextEncoder().encode("no segment") })).toEqual({ status: outcome });
    expect(queries.map((q) => q.kind)).toEqual(["context"]);
    expect(payloads.putImmutable).not.toHaveBeenCalled();
  });

  it.each([
    ["a segment that is not JCS", { segment: new TextEncoder().encode(` ${SEGMENT.toString("utf8")}`) }, "invalid"],
    ["a segment with a byte order mark", { segment: new Uint8Array([0xef, 0xbb, 0xbf, ...SEGMENT]) }, "invalid"],
    ["a segment of another document", { segment: segmentWith({ documentId: "dokument-drugi" }) }, "invalid"],
    ["a segment of another profile", { segment: segmentWith({ evidenceProfileId: "drugi-profil" }) }, "invalid"],
    ["a snapshot that is not JCS", { document: new TextEncoder().encode(` ${new TextDecoder().decode(DOCUMENT)}`) }, "invalid"],
    ["a snapshot of another document", { document: new TextEncoder().encode(canonicalizeJcs(chain.documentStates[0].value)) }, "document_mismatch"],
  ])("refuses %s and stores nothing", async (_, change, status) => {
    const { run, queries, payloads } = setup();
    expect(await run(change)).toEqual({ status });
    expect(queries.map((q) => q.kind)).toEqual(["context"]);
    expect(payloads.putImmutable).not.toHaveBeenCalled();
  });

  it("refuses a segment over the package's own limit as too large", async () => {
    const { run, payloads } = setup({ ...CONTEXT_ROW, max_payload_bytes: SEGMENT.byteLength - 1 });
    expect(await run()).toEqual({ status: "too_large" });
    expect(payloads.putImmutable).not.toHaveBeenCalled();
  });

  it.each([
    ["unavailable", { status: "unavailable", reason: "storage_unavailable" }, { status: "unavailable", stage: "storage", code: "storage_unavailable" }],
    // A fault of the store, never of the client: a retry, not a refusal (review468a 1).
    ["conflict", { status: "conflict" }, { status: "unavailable", stage: "storage", code: "storage_conflict" }],
    ["invalid", { status: "invalid" }, { status: "unavailable", stage: "storage", code: "storage_refused" }],
  ])("maps a store answering %s and commits nothing", async (_, answer, expected) => {
    const { run, queries, payloads } = setup();
    payloads.putImmutable.mockResolvedValueOnce(answer as never);
    expect(await run()).toEqual(expected);
    expect(queries.map((q) => q.kind)).toEqual(["context"]);
  });

  it("is unavailable when a known key's object cannot be named", async () => {
    const { run, queries, payloads } = setup({ ...CONTEXT_ROW, transaction_known: true });
    payloads.storageRefFor.mockResolvedValueOnce({ status: "unavailable", reason: "x" } as never);
    expect(await run()).toEqual({ status: "unavailable", stage: "storage", code: "storage_unavailable" });
    expect(queries.map((q) => q.kind)).toEqual(["context"]);
  });

  it("gives a closed code, never a message, when a dependency throws", async () => {
    const { run, payloads } = setup();
    payloads.putImmutable.mockRejectedValueOnce(new Error("bucket ductus-evidence-x secret detail"));
    expect(await run()).toEqual({ status: "unavailable", stage: "repository", code: "prepare_failed" });
  });
});

// DAN-344 P1-b: the timing of the golden segment, every step at 0 ms unless changed.
const goldenTiming = (change: (events: { sequence: number; stepOffsetsMs: number[] }[]) => unknown = (e) => e) =>
  canonicalizeJcs({
    events: change(golden.segment.events.map((event) => ({ sequence: event.sequence, stepOffsetsMs: event.steps.map(() => 0) }))),
    segmentHash: golden.segmentHash,
    timingFormat: "ductus-evidence-timing-v1",
  });
const bytesOf = (text: string) => new TextEncoder().encode(text);

describe("commitEvidenceRequest timing (DAN-344 P1-b)", () => {
  it("stores a timing that fits the segment under its own hash and names it in the commit", async () => {
    const { run, queries, payloads, log } = setup();
    const timing = goldenTiming();
    await run({ timing: bytesOf(timing) });
    expect(payloads.putImmutable).toHaveBeenCalledTimes(2);
    expect(payloads.putImmutable).toHaveBeenLastCalledWith({
      institutionId: INSTITUTION,
      evidencePackageId: "paket-iz-baze-1",
      segmentHash: await sha256WebCrypto(timing),
      kind: "timing-v1",
      canonicalPayload: timing,
    });
    expect(queries.find((q) => q.kind === "commit")?.values[9]).toBe(await sha256WebCrypto(timing));
    expect(log).not.toHaveBeenCalled();
  });

  // Attack 11: the segment goes on to the commit, and no timing is stored or named.
  it.each<[string, Uint8Array | null, string]>([
    ["timing that did not decode", null, "timing_malformed"],
    ["timing of another segment", bytesOf(goldenTiming().replace(golden.segmentHash, "0".repeat(64))), "timing_other_segment"],
    ["a missing offset", bytesOf(goldenTiming((e) => e.map((x, i) => (i === 0 ? { ...x, stepOffsetsMs: x.stepOffsetsMs.slice(1) } : x)))), "timing_wrong_shape"],
    ["a falling offset", bytesOf(goldenTiming((e) => [{ ...e[0], stepOffsetsMs: [100, ...e[0].stepOffsetsMs.slice(1).map(() => 0)] }, ...e.slice(1)])), "timing_wrong_offset"],
    ["an offset past the segment's minutes", bytesOf(goldenTiming((e) => e.map((x) => ({ ...x, stepOffsetsMs: x.stepOffsetsMs.map(() => 3_600_000) })))), "timing_wrong_offset"],
    ["an offset that is no multiple of 100", bytesOf(goldenTiming((e) => e.map((x) => ({ ...x, stepOffsetsMs: x.stepOffsetsMs.map(() => 150) })))), "timing_wrong_offset"],
    ["a negative offset", bytesOf(goldenTiming((e) => e.map((x) => ({ ...x, stepOffsetsMs: x.stepOffsetsMs.map(() => -100) })))), "timing_wrong_offset"],
    ["a fractional offset", bytesOf(goldenTiming((e) => e.map((x) => ({ ...x, stepOffsetsMs: x.stepOffsetsMs.map(() => 0.5) })))), "timing_wrong_shape"],
    ["an unknown field", bytesOf(canonicalizeJcs({ ...JSON.parse(goldenTiming()), durationMs: 0 })), "timing_wrong_shape"],
    ["bytes that are not JCS", bytesOf(` ${goldenTiming()}`), "timing_not_canonical"],
    ["more than 1 MiB", new Uint8Array(MAX_EVIDENCE_TIMING_BYTES + 1), "timing_too_large"],
  ])("accepts the segment without %s", async (_, timing, code) => {
    const { run, queries, payloads, log } = setup();
    expect(await run({ timing })).toEqual(expect.objectContaining({ status: "stale_base" }));
    expect(payloads.putImmutable).toHaveBeenCalledOnce();
    expect(queries.find((q) => q.kind === "commit")?.values[9]).toBeNull();
    expect(log).toHaveBeenCalledExactlyOnceWith("evidence timing", code);
  });

  it.each<[string, () => unknown, string]>([
    ["a conflict", () => ({ status: "conflict" }), "timing_storage"],
    ["an outage", () => ({ status: "unavailable", reason: "x" }), "timing_storage"],
    ["a throw", () => { throw new Error("bucket detail"); }, "timing_failed"],
  ])("accepts the segment without its timing when storing the timing ends in %s", async (_, answer, code) => {
    const { run, queries, payloads, log } = setup();
    payloads.putImmutable
      .mockResolvedValueOnce({ status: "stored", storageRef: "memory:put-ref" })
      .mockImplementationOnce(async () => answer() as never);
    await run({ timing: bytesOf(goldenTiming()) });
    expect(queries.find((q) => q.kind === "commit")?.values[9]).toBeNull();
    expect(log).toHaveBeenCalledExactlyOnceWith("evidence timing", code);
  });

  it("stores no timing for a known key: the retry gets the first row", async () => {
    const { run, queries, payloads } = setup({ ...CONTEXT_ROW, transaction_known: true });
    await run({ timing: bytesOf(goldenTiming()) });
    expect(payloads.putImmutable).not.toHaveBeenCalled();
    expect(queries.find((q) => q.kind === "commit")?.values[9]).toBeNull();
  });

  it("keeps the segment when the logger throws", async () => {
    const { run, queries, log } = setup();
    log.mockImplementation(() => { throw new Error("logger down"); });
    await run({ timing: null });
    expect(queries.map((q) => q.kind)).toEqual(["context", "commit"]);
  });
});