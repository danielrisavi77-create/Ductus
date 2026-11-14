import { describe, expect, it, vi } from "vitest";

import type {
  ScanPage,
  StorageKeyLister,
  StorageOrphanAudit,
  StorageOrphanScanSummary,
  StorageReferenceEntry,
  StorageReferenceReader,
  StoredObjectEntry,
} from "@/application/ports/storage-orphan-scan";

import { countStorageOrphans, type CountStorageOrphansInput } from "./count-storage-orphans";

// Every value here is invented for the test.
const DOMAIN = "test-domain";
const INST = "00000000-0000-4000-8000-0000000000a1";
const HOUR = 3_600_000;
const T0 = Date.parse("2026-11-01T12:00:00.000Z");
const OLD = new Date(T0 - 48 * HOUR).toISOString();
const FRESH = new Date(T0 + 1000).toISOString();

const hash = (n: number) => n.toString(16).padStart(64, "0");
const key = (n: number) => `v2/${INST}/pkg-a/${hash(n)}.json`;
const obj = (k: string, lastModified = OLD): StoredObjectEntry => ({ key: k, lastModified });
const ref = (k: string, acceptedAt = OLD): StorageReferenceEntry => ({ storageRef: `${DOMAIN}:${k}`, acceptedAt });

type Pager<T> = (cursor: string | null) => ScanPage<T>;
const fromPages =
  <T>(pages: T[][]): Pager<T> =>
  (cursor) => {
    const i = cursor === null ? 0 : Number(cursor);
    return { status: "ok", entries: pages[i] ?? [], next: i + 1 < pages.length ? String(i + 1) : null };
  };
const onePage = <T>(entries: T[]) => fromPages([entries]);

function run(objects: Pager<StoredObjectEntry>, references: Pager<StorageReferenceEntry>, over: Partial<CountStorageOrphansInput> = {}) {
  const records: StorageOrphanScanSummary[] = [];
  const audit: StorageOrphanAudit = {
    record: async (s) => {
      records.push(s);
      return { status: "recorded" };
    },
  };
  const store: StorageKeyLister = { listKeys: async ({ cursor }) => objects(cursor) };
  const reader: StorageReferenceReader = { listReferences: async ({ cursor }) => references(cursor) };
  return countStorageOrphans({
    storageDomain: DOMAIN,
    store,
    references: reader,
    audit,
    now: () => T0,
    thresholdMs: 24 * HOUR,
    pageSize: 100,
    maxPages: 50,
    ...over,
  }).then((result) => ({ result, records }));
}

const counts = (c: Partial<NonNullable<StorageOrphanScanSummary["counts"]>>) => ({
  paired: 0,
  objectsWithoutReference: 0,
  referencesWithoutObject: 0,
  youngObjectsWithoutReference: 0,
  youngReferencesWithoutObject: 0,
  objectsOutsidePrefix: 0,
  referencesOutsidePrefix: 0,
  ...c,
});

describe("countStorageOrphans: input classes", () => {
  it.each([
    ["empty store and database", [], [], counts({})],
    ["all paired", [1, 2, 3].map((n) => obj(key(n))), [1, 2, 3].map((n) => ref(key(n))), counts({ paired: 3 })],
    ["only objects without a reference", [1, 2].map((n) => obj(key(n))), [], counts({ objectsWithoutReference: 2 })],
    ["only references without an object", [], [4, 5].map((n) => ref(key(n))), counts({ referencesWithoutObject: 2 })],
    [
      "mixed",
      [1, 2, 4].map((n) => obj(key(n))),
      [2, 3, 4, 5].map((n) => ref(key(n))),
      counts({ paired: 2, objectsWithoutReference: 1, referencesWithoutObject: 2 }),
    ],
    [
      "keys outside the expected prefix",
      [
        obj("ductus-storage-identity.json"),
        obj(key(1)),
        obj(`v2/${INST}/pkg-a/${hash(2).toUpperCase().replace(/^0/, "A")}.json`),
        obj(`v2/${INST}/pkg-a/${hash(3)}.json/x`),
        obj(`v2/${INST.toUpperCase()}/pkg-a/${hash(4)}.json`),
        obj(`v3/${INST}/pkg-a/${hash(5)}.json`),
      ].sort((a, b) => (a.key < b.key ? -1 : 1)),
      [ref(key(1)), { storageRef: `${DOMAIN}:junk`, acceptedAt: OLD }, { storageRef: `other:${key(9)}`, acceptedAt: OLD }].sort(
        (a, b) => (a.storageRef < b.storageRef ? -1 : 1),
      ),
      counts({ paired: 1, objectsOutsidePrefix: 5, referencesOutsidePrefix: 2 }),
    ],
  ])("%s", async (_name, objects, references, expected) => {
    const { result, records } = await run(onePage(objects), onePage(references));
    expect(result.summary.status).toBe("completed");
    expect(result.summary.counts).toEqual(expected);
    expect(records).toEqual([result.summary]);
    expect(result.audit).toBe("recorded");
  });

  it("pairs an object and a reference that sit on different pages, across empty pages", async () => {
    const { result } = await run(
      fromPages([[obj(key(1))], [], [obj(key(2)), obj(key(3))], [obj(key(5))]]),
      fromPages([[], [ref(key(2))], [ref(key(3)), ref(key(4))], [ref(key(5))]]),
    );
    expect(result.summary.counts).toEqual(counts({ paired: 3, objectsWithoutReference: 1, referencesWithoutObject: 1 }));
    expect(result.summary.pages).toEqual({ storage: 4, references: 4 });
  });

  it.each([
    ["storage", "out of order", onePage([obj(key(2)), obj(key(1))]), onePage<StorageReferenceEntry>([])],
    ["storage", "a repeated key across pages", fromPages([[obj(key(1))], [obj(key(1))]]), onePage<StorageReferenceEntry>([])],
    ["references", "out of order", onePage<StoredObjectEntry>([]), onePage([ref(key(3)), ref(key(1))])],
    ["references", "a repeated reference", onePage<StoredObjectEntry>([]), onePage([ref(key(1)), ref(key(1))])],
    ["storage", "an entry that is not an object entry", onePage([{ key: 7 } as unknown as StoredObjectEntry]), onePage<StorageReferenceEntry>([])],
    ["storage", "more entries than the page size", onePage([obj(key(1)), obj(key(2))]), onePage<StorageReferenceEntry>([])],
    ["references", "an entry that is not a reference entry", onePage<StoredObjectEntry>([]), onePage([42 as unknown as StorageReferenceEntry])],
    ["references", "an empty cursor", onePage<StoredObjectEntry>([]), () => ({ status: "ok", entries: [], next: "" }) as ScanPage<StorageReferenceEntry>],
    [
      "references",
      "a page without a cursor",
      onePage<StoredObjectEntry>([]),
      () => ({ status: "ok", entries: [] }) as unknown as ScanPage<StorageReferenceEntry>,
    ],
    [
      "references",
      "a reference longer than 2048 characters",
      onePage<StoredObjectEntry>([]),
      onePage([{ storageRef: `${DOMAIN}:${"a".repeat(2048)}`, acceptedAt: OLD }]),
    ],
  ] as const)("stops as malformed without counts on %s %s", async (side, _what, objects, references) => {
    const { result, records } = await run(objects, references, { pageSize: 1 });
    expect(result.summary).toMatchObject({ status: "malformed", stoppedAt: side, counts: null });
    expect(records).toHaveLength(1);
  });

  it("is unavailable, still audited once, when a port refuses or throws", async () => {
    const down = await run(() => ({ status: "unavailable", reason: `cannot read ${key(1)}` }), onePage([]));
    expect(down.result.summary).toMatchObject({ status: "unavailable", stoppedAt: "storage", counts: null });
    expect(JSON.stringify(down.records)).not.toContain(INST);
    const thrown = await run(onePage([obj(key(1))]), () => {
      throw new Error(key(1));
    });
    expect(thrown.result.summary).toMatchObject({ status: "unavailable", stoppedAt: "references", counts: null });
    expect(thrown.records).toHaveLength(1);
  });

  it("is unavailable, without the counts so far, when a later page fails", async () => {
    const pages = fromPages([[obj(key(1))], [obj(key(2))]]);
    const down = await run((c) => (c === null ? pages(c) : { status: "unavailable", reason: "x" }), onePage([]), { pageSize: 1 });
    expect(down.result.summary).toMatchObject({ status: "unavailable", stoppedAt: "storage", counts: null });
    expect(down.result.summary.pages.storage).toBe(2);
    const refs = fromPages([[ref(key(1))], [ref(key(2))]]);
    const thrown = await run(onePage([]), (c) => {
      if (c !== null) throw new Error("down");
      return refs(c);
    }, { pageSize: 1 });
    expect(thrown.result.summary).toMatchObject({ status: "unavailable", stoppedAt: "references", counts: null });
    expect(thrown.records).toHaveLength(1);
  });

  it("counts a reference by its characters, as the database does, not by UTF-16 units", async () => {
    // 1 + 11 + 1100 characters, which the database accepts; 2212 UTF-16 units.
    const { result } = await run(onePage([]), onePage([{ storageRef: `${DOMAIN}:${"\u{1F600}".repeat(1100)}`, acceptedAt: OLD }]));
    expect(result.summary.status).toBe("completed");
    expect(result.summary.counts).toEqual(counts({ referencesOutsidePrefix: 1 }));
  });

  it("stops at the page limit when a store never ends its listing", async () => {
    const { result } = await run(() => ({ status: "ok", entries: [], next: "again" }), onePage([]), { maxPages: 3 });
    expect(result.summary).toMatchObject({ status: "page_limit", stoppedAt: "storage", counts: null });
    expect(result.summary.pages.storage).toBe(3);
  });

  it("reports an audit that could not be written without losing the summary", async () => {
    const result = await countStorageOrphans({
      storageDomain: DOMAIN,
      store: { listKeys: async () => ({ status: "ok", entries: [obj(key(1))], next: null }) },
      references: { listReferences: async () => ({ status: "ok", entries: [], next: null }) },
      audit: { record: () => Promise.reject(new Error("down")) },
      now: () => T0,
      thresholdMs: 24 * HOUR,
      pageSize: 10,
      maxPages: 5,
    });
    expect(result.audit).toBe("unavailable");
    expect(result.summary.counts?.objectsWithoutReference).toBe(1);
  });

  it("keeps keys, hashes, packages and institutions out of the summary", async () => {
    const { records } = await run(onePage([obj(key(1)), obj(key(2))]), onePage([ref(key(3))]));
    const text = JSON.stringify(records);
    for (const secret of [INST, hash(1), hash(3), "pkg-a", ".json"]) expect(text).not.toContain(secret);
  });

  it("refuses a bad configuration before any read", async () => {
    const listKeys = vi.fn();
    for (const over of [
      { storageDomain: "Bad Domain" },
      { thresholdMs: HOUR - 1 },
      { thresholdMs: 30 * 24 * HOUR + 1 },
      { pageSize: 0 },
      { pageSize: 1001 },
      { maxPages: 0 },
    ]) {
      await expect(run(listKeys, onePage([]), over)).rejects.toThrow(TypeError);
    }
    expect(listKeys).not.toHaveBeenCalled();
  });
});

describe("countStorageOrphans: never writes to the store", () => {
  it("touches nothing on the store but the listing", async () => {
    const touched: PropertyKey[] = [];
    const target = {
      listKeys: async () => ({ status: "ok", entries: [obj(key(1)), obj(key(2))], next: null }),
      putImmutable: vi.fn(),
      deleteObject: vi.fn(),
      copyObject: vi.fn(),
    };
    const store = new Proxy(target, {
      get(t, p, r) {
        touched.push(p);
        return Reflect.get(t, p, r) as unknown;
      },
    }) as unknown as StorageKeyLister;
    const result = await countStorageOrphans({
      storageDomain: DOMAIN,
      store,
      references: { listReferences: async () => ({ status: "ok", entries: [ref(key(2))], next: null }) },
      audit: { record: async () => ({ status: "recorded" }) },
      now: () => T0,
      thresholdMs: 24 * HOUR,
      pageSize: 10,
      maxPages: 5,
    });
    expect(result.summary.counts?.objectsWithoutReference).toBe(1);
    expect(new Set(touched)).toEqual(new Set(["listKeys"]));
    expect(target.putImmutable).not.toHaveBeenCalled();
    expect(target.deleteObject).not.toHaveBeenCalled();
    expect(target.copyObject).not.toHaveBeenCalled();
  });
});

describe("countStorageOrphans: concurrency with commit+reserve (B-8)", () => {
  // A live world: the gateway stores the object, then reserves the reference.
  // The pass lists the store first and reads the database after it.
  function world(lateAt: string) {
    const objects: StoredObjectEntry[] = [obj(key(1))];
    const refs: StorageReferenceEntry[] = [ref(key(1))];
    const store: StorageKeyLister = {
      listKeys: async () => {
        const page = { status: "ok" as const, entries: [...objects], next: null };
        // After the listing: a new payload is stored and reserved before the database is read.
        objects.push(obj(key(2), lateAt));
        refs.push(ref(key(2), lateAt));
        // A payload stored before the listing whose reserve lands after the database is read.
        return page;
      },
    };
    objects.push(obj(key(3), lateAt));
    const references: StorageReferenceReader = {
      listReferences: async () => {
        const page = { status: "ok" as const, entries: [...refs], next: null };
        refs.push(ref(key(3), lateAt));
        return page;
      },
    };
    return { store, references };
  }
  const go = (lateAt: string) =>
    countStorageOrphans({
      ...world(lateAt),
      storageDomain: DOMAIN,
      audit: { record: async () => ({ status: "recorded" }) },
      now: () => T0,
      thresholdMs: 24 * HOUR,
      pageSize: 10,
      maxPages: 5,
    });

  it("does not count a payload written during the pass as an orphan of either kind", async () => {
    const { summary } = await go(FRESH);
    expect(summary.counts).toEqual(
      counts({ paired: 1, youngObjectsWithoutReference: 1, youngReferencesWithoutObject: 1 }),
    );
  });

  it("does count the same shapes as orphans once they are older than the threshold (control)", async () => {
    const { summary } = await go(OLD);
    expect(summary.counts).toEqual(counts({ paired: 1, objectsWithoutReference: 1, referencesWithoutObject: 1 }));
  });

  it("counts an entry whose time cannot be read as young, never as an orphan", async () => {
    const { result } = await run(onePage([obj(key(1), "yesterday")]), onePage([ref(key(2), "2026-02-30T00:00:00Z")]));
    expect(result.summary.counts).toEqual(counts({ youngObjectsWithoutReference: 1, youngReferencesWithoutObject: 1 }));
  });
});

describe("countStorageOrphans: threshold and clock", () => {
  const cutoff = T0 - 24 * HOUR;
  it.each([
    ["one millisecond before the cutoff", cutoff - 1, false],
    ["exactly at the cutoff", cutoff, false],
    ["one millisecond after the cutoff", cutoff + 1, true],
    ["one hour younger than the threshold", cutoff + HOUR, true],
  ] as const)("an unpaired entry stamped %s", async (_name, t, young) => {
    const at = new Date(t).toISOString();
    const { result } = await run(onePage([obj(key(1), at)]), onePage([ref(key(2), at)]));
    expect(result.summary.counts).toEqual(
      young
        ? counts({ youngObjectsWithoutReference: 1, youngReferencesWithoutObject: 1 })
        : counts({ objectsWithoutReference: 1, referencesWithoutObject: 1 }),
    );
  });

  it.each([
    ["one microsecond after the cutoff", "2026-10-31T12:00:00.000001Z", true],
    ["a fraction of a millisecond after the cutoff, with an offset", "2026-10-31T13:00:00.0009+01:00", true],
    ["at the cutoff with trailing zero digits", "2026-10-31T12:00:00.000000Z", false],
    ["one microsecond before the cutoff", "2026-10-31T11:59:59.999999Z", false],
  ] as const)("an unpaired entry stamped %s keeps its sub-millisecond time", async (_name, at, young) => {
    const { result } = await run(onePage([obj(key(1), at)]), onePage([ref(key(2), at)]));
    expect(result.summary.counts).toEqual(
      young
        ? counts({ youngObjectsWithoutReference: 1, youngReferencesWithoutObject: 1 })
        : counts({ objectsWithoutReference: 1, referencesWithoutObject: 1 }),
    );
  });

  it("takes the cutoff before the first read, however long the pass runs", async () => {
    let t = T0;
    const late = new Date(T0 + 1000).toISOString();
    const { result } = await run(
      () => {
        t += 48 * HOUR;
        return { status: "ok", entries: [obj(key(1), late)], next: null };
      },
      () => {
        t += 48 * HOUR;
        return { status: "ok", entries: [ref(key(2), late)], next: null };
      },
      { now: () => t },
    );
    expect(result.summary.counts).toEqual(counts({ youngObjectsWithoutReference: 1, youngReferencesWithoutObject: 1 }));
    expect(result.summary.startedAt).toBe(new Date(T0).toISOString());
  });

  it("counts an entry with no time at all as young", async () => {
    const { result } = await run(
      onePage([{ key: key(1) } as unknown as StoredObjectEntry]),
      onePage([{ storageRef: `${DOMAIN}:${key(2)}`, acceptedAt: null } as unknown as StorageReferenceEntry]),
    );
    expect(result.summary.status).toBe("completed");
    expect(result.summary.counts).toEqual(counts({ youngObjectsWithoutReference: 1, youngReferencesWithoutObject: 1 }));
  });

  it("never records an end before the start when the clock steps back", async () => {
    const times = [T0, T0 - HOUR];
    const { result } = await run(onePage([]), onePage([]), { now: () => times.shift() ?? T0 });
    expect(result.summary.finishedAt).toBe(result.summary.startedAt);
  });
});
