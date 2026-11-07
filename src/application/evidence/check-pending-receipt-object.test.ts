import { createHash } from "node:crypto";

import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

import { InMemoryEvidencePayloadStore } from "@/adapters/evidence/in-memory-evidence-payload-store";
import type { EvidencePayloadLocator } from "@/application/ports/evidence-trust";
import type {
  EvidencePayloadPresence,
  PendingReceiptObjectSource,
} from "@/application/ports/pending-receipt-object";
import type { EvidenceReceiptPayloadV2 } from "@/domain/forensics/evidence-receipt";
import { MAX_EVIDENCE_SEGMENT_BYTES } from "@/domain/forensics/evidence-chain-v2";

import {
  createCheckPendingReceiptObject,
  type PendingReceiptObjectCheck,
} from "./check-pending-receipt-object";

// Every value here is invented for the test.
const INSTITUTION = "00000000-0000-4000-8000-0000000000a1";
const OTHER_INSTITUTION = "00000000-0000-4000-8000-0000000000a2";
const DOMAIN = "00000000-0000-4000-8000-0000000000d1";
const RECEIPT = "00000000-0000-4000-8000-0000000000c1";
const SEGMENT_TEXT = '{"synthetic":"segment"}';
const HASH = createHash("sha256").update(SEGMENT_TEXT, "utf8").digest("hex");
const BYTES = Buffer.byteLength(SEGMENT_TEXT, "utf8");
const PAYLOAD = {
  receiptSchema: "ductus-evidence-receipt-v2",
  receiptId: RECEIPT,
  evidenceDomainId: DOMAIN,
  evidencePackageId: "pkg-1",
  segmentHash: HASH,
  payloadBytes: BYTES,
} as EvidenceReceiptPayloadV2;
const REF = `memory:v2/${INSTITUTION}/pkg-1/${HASH}.json`;
const ROW = {
  institutionId: INSTITUTION,
  evidencePackageId: "pkg-1",
  segmentHash: HASH,
  payloadBytes: BYTES,
  storageRef: REF,
};

async function storeWithObject(institutionId = INSTITUTION, text = SEGMENT_TEXT) {
  const store = new InMemoryEvidencePayloadStore();
  const put = await store.putImmutable({
    institutionId,
    evidencePackageId: "pkg-1",
    segmentHash: HASH,
    canonicalPayload: text,
  });
  expect(put.status).toBe("stored");
  return store;
}

function sourceOf(answer: () => unknown): PendingReceiptObjectSource & {
  receiptObject: ReturnType<typeof vi.fn>;
} {
  return { receiptObject: vi.fn(async () => answer()) } as never;
}

const ok = (row: unknown = ROW) => sourceOf(() => ({ status: "ok", object: row }));

describe("checkPendingReceiptObject", () => {
  it("O1 answers present for the object of the locator row and asks for exactly its key", async () => {
    const store = await storeWithObject();
    const head = vi.spyOn(store, "headImmutable");
    const source = ok();
    const check = createCheckPendingReceiptObject({ source, locator: store, presence: store });
    expect(await check(PAYLOAD)).toEqual({ status: "present" });
    expect(source.receiptObject).toHaveBeenCalledWith(DOMAIN, RECEIPT);
    expect(head).toHaveBeenCalledWith({
      institutionId: INSTITUTION,
      evidencePackageId: "pkg-1",
      segmentHash: HASH,
      payloadBytes: BYTES,
    });
  });

  it("O2 a missing object is held as object_absent", async () => {
    const store = new InMemoryEvidencePayloadStore();
    const check = createCheckPendingReceiptObject({ source: ok(), locator: store, presence: store });
    expect(await check(PAYLOAD)).toEqual({ status: "held", reason: "object_absent" });
  });

  it("O3 another institution's object under the same package and hash is not this one", async () => {
    const store = await storeWithObject(OTHER_INSTITUTION);
    const check = createCheckPendingReceiptObject({ source: ok(), locator: store, presence: store });
    expect(await check(PAYLOAD)).toEqual({ status: "held", reason: "object_absent" });
  });

  it("O4 other bytes under the key are held as object_mismatch", async () => {
    const store = await storeWithObject(INSTITUTION, '{"synthetic":"other!!"}');
    const check = createCheckPendingReceiptObject({ source: ok(), locator: store, presence: store });
    expect(await check(PAYLOAD)).toEqual({ status: "held", reason: "object_mismatch" });
  });

  const reads: [string, () => unknown, PendingReceiptObjectCheck][] = [
    ["not_found", () => ({ status: "not_found" }), { status: "held", reason: "not_pending" }],
    ["unavailable", () => ({ status: "unavailable", reason: "x" }), { status: "unavailable", reason: "locator_unavailable" }],
    ["an unknown status", () => ({ status: "found" }), { status: "unavailable", reason: "locator_unavailable" }],
    ["null", () => null, { status: "unavailable", reason: "locator_unavailable" }],
    ["a string", () => "ok", { status: "unavailable", reason: "locator_unavailable" }],
    ["a throw", () => { throw new Error("down"); }, { status: "unavailable", reason: "locator_unavailable" }],
    ["ok without a row", () => ({ status: "ok" }), { status: "unavailable", reason: "locator_malformed" }],
  ];
  it.each(reads)("O5 a locator read of %s never asks the store", async (_, answer, expected) => {
    const store = await storeWithObject();
    const head = vi.spyOn(store, "headImmutable");
    const check = createCheckPendingReceiptObject({ source: sourceOf(answer), locator: store, presence: store });
    expect(await check(PAYLOAD)).toEqual(expected);
    expect(head).not.toHaveBeenCalled();
  });

  const malformed: [string, unknown][] = [
    ["an array", [ROW]],
    ["an uppercase institution", { ...ROW, institutionId: INSTITUTION.toUpperCase() }],
    ["no institution", { ...ROW, institutionId: undefined }],
    ["a package id with a slash", { ...ROW, evidencePackageId: "pkg/1" }],
    ["an uppercase hash", { ...ROW, segmentHash: HASH.toUpperCase() }],
    ["zero bytes", { ...ROW, payloadBytes: 0 }],
    ["bytes over the limit", { ...ROW, payloadBytes: MAX_EVIDENCE_SEGMENT_BYTES + 1 }],
    ["fractional bytes", { ...ROW, payloadBytes: 1.5 }],
    ["bytes as a string", { ...ROW, payloadBytes: String(BYTES) }],
    ["no storage reference", { ...ROW, storageRef: null }],
  ];
  it.each(malformed)("O6 a row with %s is malformed and never asks the store", async (_, row) => {
    const store = await storeWithObject();
    const head = vi.spyOn(store, "headImmutable");
    const check = createCheckPendingReceiptObject({ source: ok(row), locator: store, presence: store });
    expect(await check(PAYLOAD)).toEqual({ status: "unavailable", reason: "locator_malformed" });
    expect(head).not.toHaveBeenCalled();
  });

  const mismatched: [string, unknown][] = [
    ["another package", { ...ROW, evidencePackageId: "pkg-2" }],
    ["another hash", { ...ROW, segmentHash: "c".repeat(64) }],
    ["another byte count", { ...ROW, payloadBytes: BYTES + 1 }],
    ["another stored reference", { ...ROW, storageRef: `other:v2/${INSTITUTION}/pkg-1/${HASH}.json` }],
    ["the reference of another institution", { ...ROW, storageRef: `memory:v2/${OTHER_INSTITUTION}/pkg-1/${HASH}.json` }],
    ["another institution with this one's reference", { ...ROW, institutionId: OTHER_INSTITUTION }],
  ];
  it.each(mismatched)("O7 a row with %s is held as locator_mismatch before any HEAD", async (_, row) => {
    const store = await storeWithObject();
    const head = vi.spyOn(store, "headImmutable");
    const check = createCheckPendingReceiptObject({ source: ok(row), locator: store, presence: store });
    expect(await check(PAYLOAD)).toEqual({ status: "held", reason: "locator_mismatch" });
    expect(head).not.toHaveBeenCalled();
  });

  const refs: [string, EvidencePayloadLocator["storageRefFor"]][] = [
    ["unavailable", async () => ({ status: "unavailable", reason: "x" })],
    ["a reply without a reference", async () => ({ status: "ok" }) as never],
    ["null", async () => null as never],
    ["a throw", async () => { throw new Error("down"); }],
  ];
  it.each(refs)("O8 a locator reference that is %s never asks the store", async (_, storageRefFor) => {
    const store = await storeWithObject();
    const head = vi.spyOn(store, "headImmutable");
    const check = createCheckPendingReceiptObject({ source: ok(), locator: { storageRefFor }, presence: store });
    expect(await check(PAYLOAD)).toEqual({ status: "unavailable", reason: "storage_ref_unavailable" });
    expect(head).not.toHaveBeenCalled();
  });

  const heads: [string, () => unknown][] = [
    ["unavailable", () => ({ status: "unavailable", reason: "storage_timeout" })],
    ["an unknown status", () => ({ status: "found" })],
    ["present as a string", () => "present"],
    ["null", () => null],
    ["a throw", () => { throw new Error("reset"); }],
  ];
  it.each(heads)("O9 a HEAD answer of %s is unavailable, never present", async (_, answer) => {
    const store = await storeWithObject();
    const presence: EvidencePayloadPresence = { headImmutable: async () => answer() as never };
    const check = createCheckPendingReceiptObject({ source: ok(), locator: store, presence });
    expect(await check(PAYLOAD)).toEqual({ status: "unavailable", reason: "presence_unavailable" });
  });

  it("O11 the institution is the row's: a consistent row of another institution asks the store under that one", async () => {
    const store = await storeWithObject();
    const head = vi.spyOn(store, "headImmutable");
    const row = { ...ROW, institutionId: OTHER_INSTITUTION, storageRef: `memory:v2/${OTHER_INSTITUTION}/pkg-1/${HASH}.json` };
    const check = createCheckPendingReceiptObject({ source: ok(row), locator: store, presence: store });
    expect(await check(PAYLOAD)).toEqual({ status: "held", reason: "object_absent" });
    expect(head).toHaveBeenCalledWith({
      institutionId: OTHER_INSTITUTION,
      evidencePackageId: "pkg-1",
      segmentHash: HASH,
      payloadBytes: BYTES,
    });
  });

  it("O10 present only with a valid row that agrees with the payload and a present HEAD", async () => {
    const store = await storeWithObject();
    const row = fc.record({
      institutionId: fc.constantFrom(INSTITUTION, OTHER_INSTITUTION, INSTITUTION.toUpperCase(), ""),
      evidencePackageId: fc.constantFrom("pkg-1", "pkg-2", "PKG-1"),
      segmentHash: fc.constantFrom(HASH, "c".repeat(64), HASH.toUpperCase()),
      payloadBytes: fc.constantFrom(BYTES, BYTES + 1, 0, -1, 1.5),
      storageRef: fc.constantFrom(REF, `memory:v2/${OTHER_INSTITUTION}/pkg-1/${HASH}.json`, ""),
    });
    const head = fc.constantFrom("present", "absent", "mismatch", "unavailable", "other");
    await fc.assert(
      fc.asyncProperty(row, head, async (r, h) => {
        const presence: EvidencePayloadPresence = { headImmutable: async () => ({ status: h }) as never };
        const check = createCheckPendingReceiptObject({ source: ok(r), locator: store, presence });
        const out = await check(PAYLOAD);
        // The payload names no institution: the row's own, in canonical
        // form, keys the reference and the HEAD (see O11).
        const matches =
          (r.institutionId === INSTITUTION || r.institutionId === OTHER_INSTITUTION) &&
          r.evidencePackageId === "pkg-1" &&
          r.segmentHash === HASH &&
          r.payloadBytes === BYTES &&
          r.storageRef === `memory:v2/${r.institutionId}/pkg-1/${HASH}.json`;
        expect(out.status === "present").toBe(matches && h === "present");
      }),
      { numRuns: 1000 },
    );
  });
});
