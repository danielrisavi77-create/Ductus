import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type {
  ScanPage,
  StorageOrphanScanSummary,
  StorageReferenceEntry,
  StoredObjectEntry,
} from "@/application/ports/storage-orphan-scan";

import { countStorageOrphans } from "./count-storage-orphans";

// Every value here is invented for the test.
const DOMAIN = "test-domain";
const INSTS = ["00000000-0000-4000-8000-0000000000a1", "00000000-0000-4000-8000-0000000000b2"];
const PACKAGES = ["pkg-a", "pkg-b", "p_1"];
const HOUR = 3_600_000;
const THRESHOLD = 24 * HOUR;
const T0 = Date.parse("2026-11-01T12:00:00.000Z");
const OLD = new Date(T0 - 48 * HOUR).toISOString();
const FRESH = new Date(T0 - HOUR).toISOString();
// Just inside the threshold: young, though far older than a payload of this pass.
const NEAR = new Date(T0 - THRESHOLD + 1000).toISOString();
const TIMES = [OLD, FRESH, NEAR, "not a time"] as const;
const isOld = (t: string) => t === OLD;

// The oracle of the form, written apart from the code under test.
const IN_PREFIX = /^v2\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[a-z0-9][a-z0-9_-]{0,127}\/[0-9a-f]{64}\.json$/;
const utf8Order = (a: string, b: string) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));

const inKey = fc
  .record({ inst: fc.constantFrom(...INSTS), pkg: fc.constantFrom(...PACKAGES), n: fc.nat(40) })
  .map(({ inst, pkg, n }) => `v2/${inst}/${pkg}/${n.toString(16).padStart(64, "0")}.json`);
const outKey = fc
  .oneof(
    fc.constantFrom(
      "ductus-storage-identity.json",
      `v2/${INSTS[0]!.toUpperCase()}/pkg-a/${"0".repeat(64)}.json`,
      `v2/${INSTS[0]}/Pkg/${"0".repeat(64)}.json`,
      `v2/${INSTS[0]}/pkg-a/${"A".repeat(64)}.json`,
      `v2/${INSTS[0]}/pkg-a/${"0".repeat(64)}.json/`,
      `v3/${INSTS[0]}/pkg-a/${"0".repeat(64)}.json`,
    ),
    fc.string({ unit: "grapheme", minLength: 1, maxLength: 12 }),
  )
  .filter((k) => !IN_PREFIX.test(k));
const time = fc.constantFrom(...TIMES);
const slot = fc.record({ inStore: fc.boolean(), inDb: fc.boolean(), objectAt: time, refAt: time });

const world = fc.record({
  slots: fc.dictionary(inKey, slot, { maxKeys: 30 }),
  outObjects: fc.uniqueArray(outKey, { maxLength: 6 }),
  outRefs: fc.uniqueArray(
    fc.tuple(fc.constantFrom(`${DOMAIN}:`, "other:", "", `${DOMAIN}x:`), outKey).map(([p, k]) => p + k),
    { maxLength: 6 },
  ),
  pageSize: fc.integer({ min: 1, max: 6 }),
  objectCuts: fc.array(fc.nat(6), { maxLength: 40 }),
  refCuts: fc.array(fc.nat(6), { maxLength: 40 }),
});

/** Splits sorted entries into pages of the given sizes (capped at the page size; zero gives an empty page). */
function paged<T>(entries: T[], cuts: number[], pageSize: number): (cursor: string | null) => ScanPage<T> {
  const pages: T[][] = [];
  let i = 0;
  for (const cut of cuts) {
    if (i >= entries.length) break;
    const size = Math.min(cut, pageSize);
    pages.push(entries.slice(i, i + size));
    i += size;
  }
  while (i < entries.length) {
    pages.push(entries.slice(i, i + pageSize));
    i += pageSize;
  }
  if (pages.length === 0) pages.push([]);
  return (cursor) => {
    const n = cursor === null ? 0 : Number(cursor);
    return { status: "ok", entries: pages[n] ?? [], next: n + 1 < pages.length ? String(n + 1) : null };
  };
}

describe("countStorageOrphans: property over all input classes", () => {
  it("counts each class as the set differences say, whatever the paging", async () => {
    await fc.assert(
      fc.asyncProperty(world, async (w) => {
        const objects: StoredObjectEntry[] = [];
        const refs: StorageReferenceEntry[] = [];
        const expected = {
          paired: 0,
          objectsWithoutReference: 0,
          referencesWithoutObject: 0,
          youngObjectsWithoutReference: 0,
          youngReferencesWithoutObject: 0,
          objectsOutsidePrefix: w.outObjects.length,
          referencesOutsidePrefix: w.outRefs.length,
        };
        for (const [k, s] of Object.entries(w.slots)) {
          if (s.inStore) objects.push({ key: k, lastModified: s.objectAt });
          if (s.inDb) refs.push({ storageRef: `${DOMAIN}:${k}`, acceptedAt: s.refAt });
          if (s.inStore && s.inDb) expected.paired += 1;
          else if (s.inStore) expected[isOld(s.objectAt) ? "objectsWithoutReference" : "youngObjectsWithoutReference"] += 1;
          else if (s.inDb) expected[isOld(s.refAt) ? "referencesWithoutObject" : "youngReferencesWithoutObject"] += 1;
        }
        for (const k of w.outObjects) objects.push({ key: k, lastModified: OLD });
        for (const r of w.outRefs) refs.push({ storageRef: r, acceptedAt: OLD });
        objects.sort((a, b) => utf8Order(a.key, b.key));
        refs.sort((a, b) => utf8Order(a.storageRef, b.storageRef));

        const records: StorageOrphanScanSummary[] = [];
        const objectPages = paged(objects, w.objectCuts, w.pageSize);
        const refPages = paged(refs, w.refCuts, w.pageSize);
        const { summary } = await countStorageOrphans({
          storageDomain: DOMAIN,
          store: { listKeys: async ({ cursor }) => objectPages(cursor) },
          references: { listReferences: async ({ cursor }) => refPages(cursor) },
          audit: {
            record: async (s) => {
              records.push(s);
              return { status: "recorded" };
            },
          },
          now: () => T0,
          thresholdMs: THRESHOLD,
          pageSize: w.pageSize,
          maxPages: 1000,
        });

        expect(summary.status).toBe("completed");
        expect(summary.counts).toEqual(expected);
        expect(records).toEqual([summary]);
        const text = JSON.stringify(records);
        for (const k of Object.keys(w.slots)) expect(text).not.toContain(k.split("/")[3]!.slice(0, 64));
      }),
      { numRuns: 300 },
    );
  });

  it("stops as malformed, without counts, when one entry is listed twice", async () => {
    await fc.assert(
      fc.asyncProperty(fc.uniqueArray(inKey, { minLength: 1, maxLength: 20 }), fc.nat(), async (keys, pick) => {
        keys.sort(utf8Order);
        const dup = keys[pick % keys.length]!;
        const entries = [...keys, dup].sort(utf8Order).map((k) => ({ key: k, lastModified: OLD }));
        const records: StorageOrphanScanSummary[] = [];
        const { summary } = await countStorageOrphans({
          storageDomain: DOMAIN,
          store: { listKeys: async () => ({ status: "ok", entries, next: null }) },
          references: { listReferences: async () => ({ status: "ok", entries: [], next: null }) },
          audit: {
            record: async (s) => {
              records.push(s);
              return { status: "recorded" };
            },
          },
          now: () => T0,
          thresholdMs: THRESHOLD,
          pageSize: 1000,
          maxPages: 10,
        });
        expect(summary).toMatchObject({ status: "malformed", stoppedAt: "storage", counts: null });
        expect(records).toHaveLength(1);
      }),
      { numRuns: 100 },
    );
  });
});
