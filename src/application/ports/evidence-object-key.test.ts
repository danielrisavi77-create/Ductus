import { describe, expect, it } from "vitest";

import { InMemoryEvidencePayloadStore } from "@/adapters/evidence/in-memory-evidence-payload-store";

import {
  evidenceObjectKey,
  evidenceStorageRef,
  isInstitutionId,
  isStorageDomainLabel,
} from "./evidence-object-key";
import { bindPayloadReader } from "./evidence-reconstruction";

// Synthetic ids only.
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const HASH = "a".repeat(64);

describe("evidence object key", () => {
  it("takes an institution id only as a lowercase UUID", () => {
    expect(isInstitutionId(A)).toBe(true);
    expect(isInstitutionId("123e4567-e89b-12d3-a456-426614174000")).toBe(true);
    for (const id of [
      "",
      A.toUpperCase(),
      `{${A}}`,
      A.replace(/-/g, ""),
      `${A} `,
      `${A}\n`,
      `${A}/x`,
      `../${A}`,
      "00000000-0000-4000-8000-00000000000g",
      "０0000000-0000-4000-8000-00000000000a",
      A.slice(0, -1),
      `${A}0`,
      7,
      null,
      undefined,
    ]) {
      expect(isInstitutionId(id)).toBe(false);
    }
  });

  it("builds v2/<institution>/<package>/<hash>.json and nothing else", () => {
    expect(
      evidenceObjectKey({ institutionId: A, evidencePackageId: "paket-1", segmentHash: HASH }),
    ).toEqual(["v2", A, "paket-1", `${HASH}.json`]);

    for (const bad of [
      { institutionId: A.toUpperCase() },
      { institutionId: undefined },
      { evidencePackageId: "Paket-1" },
      { evidencePackageId: "a/b" },
      { evidencePackageId: ".." },
      { segmentHash: HASH.toUpperCase() },
      { segmentHash: `${HASH}0` },
    ]) {
      expect(
        evidenceObjectKey({
          institutionId: A,
          evidencePackageId: "paket-1",
          segmentHash: HASH,
          ...bad,
        }),
      ).toBeNull();
    }
  });

  it("keeps the storage domain label and the key in storageRef, never an endpoint", () => {
    const key = ["v2", A, "paket-1", `${HASH}.json`];
    expect(evidenceStorageRef("hr-zg-fpzg", key)).toBe(`hr-zg-fpzg:v2/${A}/paket-1/${HASH}.json`);
    expect(isStorageDomainLabel("a")).toBe(true);
    for (const label of ["", "-a", "A", "a.b", "a:b", "https://s3", "a/b", "a".repeat(64)]) {
      expect(isStorageDomainLabel(label)).toBe(false);
      expect(() => evidenceStorageRef(label, key)).toThrow(TypeError);
    }
  });
});

describe("in-memory payload store keyed by institution", () => {
  const payload = '{"x":1}';

  it("stores the same hash again in another institution, never answering existing across them (P5)", async () => {
    const store = new InMemoryEvidencePayloadStore();
    const inA = await store.putImmutable({
      institutionId: A,
      evidencePackageId: "paket-a",
      segmentHash: HASH,
      canonicalPayload: payload,
    });
    const inB = await store.putImmutable({
      institutionId: B,
      evidencePackageId: "paket-b",
      segmentHash: HASH,
      canonicalPayload: payload,
    });

    expect(inA).toEqual({ status: "stored", storageRef: `memory:v2/${A}/paket-a/${HASH}.json` });
    expect(inB).toEqual({ status: "stored", storageRef: `memory:v2/${B}/paket-b/${HASH}.json` });
    expect(store.size).toBe(2);
  });

  it("refuses a package under a second institution and an invalid key, storing nothing", async () => {
    const store = new InMemoryEvidencePayloadStore();
    await store.putImmutable({
      institutionId: A,
      evidencePackageId: "paket-a",
      segmentHash: HASH,
      canonicalPayload: payload,
    });

    for (const input of [
      { institutionId: B, evidencePackageId: "paket-a" },
      { institutionId: A.toUpperCase(), evidencePackageId: "paket-c" },
      { institutionId: A, evidencePackageId: "Paket-C" },
    ]) {
      expect(
        await store.putImmutable({ ...input, segmentHash: HASH, canonicalPayload: payload }),
      ).toEqual({ status: "invalid" });
    }
    expect(store.size).toBe(1);
    expect(await store.readImmutable({ evidencePackageId: "paket-a", segmentHash: HASH })).toEqual({
      status: "found",
      bytes: new TextEncoder().encode(payload),
    });
  });

  it("reads a package through its own institution only, also through a bound reader (B2)", async () => {
    const store = new InMemoryEvidencePayloadStore();
    await store.putImmutable({ institutionId: A, evidencePackageId: "paket-a", segmentHash: HASH, canonicalPayload: payload });
    const read = { evidencePackageId: "paket-a", segmentHash: HASH };

    await expect(bindPayloadReader(store, A).readImmutable(read)).resolves.toEqual({
      status: "found",
      bytes: new TextEncoder().encode(payload),
    });
    await expect(bindPayloadReader(store, B).readImmutable(read)).resolves.toEqual({ status: "not_found" });
    await expect(store.readImmutable({ ...read, institutionId: B })).resolves.toEqual({ status: "not_found" });
  });
});
