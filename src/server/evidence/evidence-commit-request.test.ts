import { describe, expect, it, vi } from "vitest";

import type { SigningKeyProvider } from "@/application/ports/signing-key-provider";
import { MAX_DOCUMENT_SNAPSHOT_BYTES } from "@/domain/document/snapshot";
import { MAX_EVIDENCE_SEGMENT_BYTES } from "@/domain/forensics/evidence-chain-v2";
import { loadGoldenVectors } from "@/domain/forensics/golden-vectors/load";
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
  const run = (request: Partial<EvidenceCommitRequest> = {}) =>
    commitEvidenceRequest({ withActor, signer: refusingSigner, payloads }, "t", { ...REQUEST, ...request });
  return { run, queries, payloads };
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
