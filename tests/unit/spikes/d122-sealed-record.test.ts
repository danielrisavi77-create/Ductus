// @vitest-environment node
// D-122 spike (DAN-99): input classes and concurrency of the sealed local
// record prototype. Synthetic text only; nothing here is product code.
import { afterEach, describe, expect, it } from "vitest";
import fc from "fast-check";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import {
  FakeKeyService, SpikeStore, contextFor, freshness, newRecordKey, openSealed, seal, serverKey,
  type Policy, type Sealed,
} from "../../../spikes/d122-local-record/sealed-record";

const idb = { indexedDB, IDBKeyRange };
const SCOPE = "a".repeat(64);
const DOC = "11111111-1111-4111-8111-111111111111";
const CTX = contextFor(SCOPE, DOC);
const NOW = Date.UTC(2026, 10, 2, 9, 0, 0);
const DAY = 86_400_000;
const POLICY: Policy = { syncedTtlMs: 1 * DAY, unsyncedTtlMs: 14 * DAY, maxSkewMs: 5 * 60_000 };
const opened: SpikeStore[] = [];
let serial = 0;

function store(name: string): SpikeStore {
  const s = new SpikeStore(name, idb);
  opened.push(s);
  return s;
}
function freshName(): string {
  serial += 1;
  return `spike-d122-${serial}`;
}
afterEach(async () => {
  for (const s of opened.splice(0)) s.close();
});

describe("openSealed: input classes", () => {
  it("1. opens what it sealed for any text, empty and large included", async () => {
    const key = await newRecordKey();
    await fc.assert(fc.asyncProperty(fc.string({ unit: "grapheme", maxLength: 300 }), async (text) => {
      const result = await openSealed(key, await seal(key, text, CTX, NOW), CTX);
      expect(result).toEqual({ ok: true, text });
    }), { numRuns: 50 });
    const large = "Izmišljena rečenica sintetičkog rada. ".repeat(30_000);
    expect(await openSealed(key, await seal(key, large, CTX, NOW), CTX)).toEqual({ ok: true, text: large });
  });

  it("2. refuses another key", async () => {
    const sealed = await seal(await newRecordKey(), "tekst", CTX, NOW);
    expect(await openSealed(await newRecordKey(), sealed, CTX)).toEqual({ ok: false, reason: "auth" });
  });

  it("3. refuses any single changed byte of ciphertext, tag or IV", async () => {
    const key = await newRecordKey();
    const sealed = await seal(key, "izmišljeni odlomak", CTX, NOW);
    const total = sealed.iv.length + sealed.ct.length;
    await fc.assert(fc.asyncProperty(fc.nat({ max: total - 1 }), fc.integer({ min: 1, max: 255 }), async (at, flip) => {
      const iv = sealed.iv.slice();
      const ct = sealed.ct.slice();
      if (at < iv.length) iv[at] ^= flip; else ct[at - iv.length] ^= flip;
      expect(await openSealed(key, { ...sealed, iv, ct }, CTX)).toEqual({ ok: false, reason: "auth" });
    }), { numRuns: 60 });
  });

  it("4. refuses a record moved to another document or scope, or with a changed write time", async () => {
    const key = await newRecordKey();
    const sealed = await seal(key, "tekst", CTX, NOW);
    for (const other of [contextFor(SCOPE, "22222222-2222-4222-8222-222222222222"), contextFor("b".repeat(64), DOC)]) {
      expect(await openSealed(key, sealed, other)).toEqual({ ok: false, reason: "auth" });
    }
    for (const at of [NOW - 1, NOW + 1, 0]) {
      expect(await openSealed(key, { ...sealed, at }, CTX)).toEqual({ ok: false, reason: "auth" });
    }
  });

  it("5-7. classifies malformed and unknown-version envelopes without decrypting", async () => {
    const key = await newRecordKey();
    const good = await seal(key, "tekst", CTX, NOW);
    const inherited = Object.create(good) as Sealed;
    const cases: [unknown, string][] = [
      [{ ...good, ct: good.ct.slice(0, 15) }, "malformed"],
      [{ ...good, iv: good.iv.slice(0, 11) }, "malformed"],
      [{ ...good, v: 2 }, "version"],
      [{ ...good, v: "1" }, "version"],
      [null, "malformed"], ["sealed", "malformed"], [[good.iv, good.ct], "malformed"],
      [{ v: 1, iv: good.iv, at: NOW }, "malformed"],
      [{ ...good, iv: Array.from(good.iv) }, "malformed"],
      [{ ...good, ct: "abc" }, "malformed"],
      [inherited, "malformed"],
    ];
    for (const [raw, reason] of cases) {
      expect(await openSealed(key, raw, CTX), JSON.stringify(reason)).toEqual({ ok: false, reason });
    }
  });

  it("8. a malformed write time is malformed, never expired", async () => {
    const key = await newRecordKey();
    const good = await seal(key, "tekst", CTX, NOW);
    for (const at of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, "1", null, undefined]) {
      expect(await openSealed(key, { ...good, at }, CTX)).toEqual({ ok: false, reason: "malformed" });
      expect(freshness(at, true, NOW, POLICY)).toBe("malformed");
    }
  });

  it("9. deadline: live before, expired at and after, future beyond allowed clock skew", () => {
    const cases: [number, boolean, string][] = [
      [NOW - DAY + 1, true, "live"], [NOW - DAY, true, "expired"], [NOW - 2 * DAY, true, "expired"],
      [NOW - DAY, false, "live"], [NOW - 14 * DAY + 1, false, "live"], [NOW - 14 * DAY, false, "expired"],
      [NOW + POLICY.maxSkewMs, true, "live"], [NOW + POLICY.maxSkewMs + 1, true, "future"],
    ];
    for (const [at, synced, expected] of cases) expect(freshness(at, synced, NOW, POLICY), `${at}/${synced}`).toBe(expected);
  });

  it("10. a shredded device key leaves the record unreadable", async () => {
    const s = store(freshName());
    const key = await s.deviceKey();
    await s.put({ documentId: DOC, synced: false, body: await seal(key, "tekst", CTX, NOW) });
    await s.shredKey();
    const reader = store(s.name);
    expect(await reader.read(DOC, CTX, await reader.existingKey())).toEqual({ ok: false, reason: "no_key" });
  });

  it("11. server-wrapped key: the same student unwraps, another cannot, a lost KEK loses the record", async () => {
    const service = new FakeKeyService();
    await service.issue("student-b");
    const wrapped = await service.issue("student-a");
    const key = await serverKey(service, "student-a", wrapped);
    const sealed = await seal(key!, "tekst", CTX, NOW);
    expect(await openSealed(await serverKey(service, "student-a", wrapped), sealed, CTX)).toEqual({ ok: true, text: "tekst" });
    expect(await serverKey(service, "student-b", wrapped)).toBeNull();
    service.loseKek("student-a");
    expect(await openSealed(await serverKey(service, "student-a", wrapped), sealed, CTX)).toEqual({ ok: false, reason: "no_key" });
  });
});

describe("Istodobnost", () => {
  it("two tabs creating the device key at once: a naive put diverges, a checked add agrees", async () => {
    for (const mode of ["naive", "checked"] as const) {
      const a = store(freshName());
      const b = store(a.name);
      let arrived = 0;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const barrier = async () => { arrived += 1; if (arrived === 2) release(); await gate; };
      const [keyA, keyB] = await Promise.all([a.deviceKey(mode, barrier), b.deviceKey(mode, barrier)]);
      const sealed = await seal(keyA, "tekst", CTX, NOW);
      const fromB = await openSealed(keyB, sealed, CTX);
      if (mode === "naive") expect(fromB).toEqual({ ok: false, reason: "auth" });
      else expect(fromB).toEqual({ ok: true, text: "tekst" });
    }
  });

  it("sweep: two transactions delete a record rewritten in between, one transaction keeps the rewrite", async () => {
    for (const mode of ["naive", "single"] as const) {
      const s = store(freshName());
      const key = await s.deviceKey();
      await s.put({ documentId: DOC, synced: true, body: await seal(key, "staro", CTX, NOW - 2 * DAY) });
      const rewrite = async () => {
        await s.put({ documentId: DOC, synced: true, body: await seal(key, "novo", CTX, NOW) });
      };
      const removed = await s.sweep(NOW, POLICY, mode, rewrite);
      const after = await s.read(DOC, CTX, key);
      if (mode === "naive") {
        expect(removed).toEqual([DOC]);
        expect(after).toEqual({ ok: false, reason: "missing" });
      } else {
        // Either order of the two transactions is allowed; the fresh write survives.
        expect(removed.length).toBeLessThanOrEqual(1);
        expect(after).toEqual({ ok: true, text: "novo" });
      }
    }
  });

  it("sign-out during a write: a key held in memory still writes, a guarded write refuses", async () => {
    const tabA = store(freshName());
    const tabB = store(tabA.name);
    const keyB = await tabB.deviceKey();
    await tabA.shredKey();
    const late = await seal(keyB, "kasni upis", CTX, NOW);
    await tabB.put({ documentId: DOC, synced: false, body: late });
    const reader = store(tabA.name);
    expect(await reader.read(DOC, CTX, await reader.existingKey())).toEqual({ ok: false, reason: "no_key" });
    await expect(tabB.putGuarded({ documentId: DOC, synced: false, body: late })).rejects.toThrow("logout");
  });

  it("a shred while another tab keeps the database open still makes the record unreadable", async () => {
    const a = store(freshName());
    const holder = store(a.name);
    const key = await a.deviceKey();
    await a.put({ documentId: DOC, synced: false, body: await seal(key, "tekst", CTX, NOW) });
    await holder.existingKey();
    await a.shredKey();
    expect((await indexedDB.databases()).some((db) => db.name === a.name)).toBe(true);
    expect(await holder.read(DOC, CTX, await holder.existingKey())).toEqual({ ok: false, reason: "no_key" });
  });
});
