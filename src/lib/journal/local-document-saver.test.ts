// @vitest-environment node
/**
 * Local saving of one document (F-3 step 1a, plan #197). Numbers in test names
 * are the attacks of #197; attacks 1, 4, 11, 14, 15 and the editor half of
 * 5/6/9 are E2E in step 1b. All text here is synthetic.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import Dexie from "dexie";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import {
  documentsEqual, emptyDocument, newNodeId, paragraphNode, textNode, type CanonicalDocument,
} from "../../domain/document";
import type { SyncState } from "../../domain/sync/states";
import { storableText } from "../../editor/storable-text";
import { AtomicDexieJournal, JournalError } from "./atomic-dexie-journal";
import {
  failureOf, LocalDocumentSaver, type SaverDeps, type SaverSnapshot,
} from "./local-document-saver";

const DOC = "local-demo-document";
const P1 = newNodeId(() => "aaaaaaaa-0000-4000-8000-000000000001");
const idb = { indexedDB, IDBKeyRange };
let serial = 0x5a00;
const opened: AtomicDexieJournal[] = [];
const scopes: string[] = [];

function scope(): string {
  serial += 1;
  const value = serial.toString(16).padStart(64, "0");
  scopes.push(value);
  return value;
}
function journal(at: string): AtomicDexieJournal {
  const instance = new AtomicDexieJournal(at, idb);
  opened.push(instance);
  return instance;
}
function text(value: string): CanonicalDocument {
  return { schemaVersion: 1, nodes: [paragraphNode(P1, value === "" ? [] : [textNode(value)])] };
}
function words(count: number): string {
  return Array.from({ length: count }, (_, i) => `riječ${i % 97}`).join(" ");
}
let txSerial = 0;
const deps: SaverDeps = {
  now: () => new Date("2026-10-10T20:00:00.000Z"),
  newTransactionId: () => `tx-${(txSerial += 1)}`,
};
function saver(on: AtomicDexieJournal, extra: SaverDeps = {}): LocalDocumentSaver {
  return new LocalDocumentSaver(on, DOC, { ...deps, ...extra });
}
function record(target: LocalDocumentSaver): SaverSnapshot[] {
  const seen: SaverSnapshot[] = [];
  target.subscribe((s) => seen.push(s));
  return seen;
}
/** The real journal with some methods replaced. */
function patched(real: AtomicDexieJournal, over: Partial<AtomicDexieJournal>): AtomicDexieJournal {
  return Object.assign(Object.create(real) as AtomicDexieJournal, over);
}
async function type(target: LocalDocumentSaver, value: string): Promise<void> {
  target.edit();
  await target.propose(text(value));
}

afterEach(async () => {
  for (const instance of opened.splice(0)) instance.close();
  for (const at of scopes.splice(0)) await new Dexie(`ductus-journal-v1-${at}`, idb).delete();
});

describe("LocalDocumentSaver: normal path and reload (controls)", () => {
  it("an empty journal loads as an empty document without writing", async () => {
    const at = scope();
    const target = saver(journal(at));
    const loaded = await target.load();
    expect(loaded.kind).toBe("ready");
    expect(loaded.kind === "ready" && loaded.document.nodes).toHaveLength(1);
    expect(target.snapshot()).toEqual({ state: "EDITING", failure: null, capacity: "ok" });
    expect(await journal(at).read(DOC)).toEqual({ snapshot: null, pending: [], meta: null });
  });

  it("9, 16: EDITING → SAVING_LOCAL → LOCAL_DURABLE only after the write; reload gives the same document", async () => {
    const at = scope();
    const target = saver(journal(at));
    await target.load();
    const states = record(target);
    await type(target, "Uvod: čćžšđ 😀");
    expect(states.map((s) => s.state)).toEqual(["SAVING_LOCAL", "LOCAL_DURABLE"]);
    const after = saver(journal(at));
    const loaded = await after.load();
    expect(loaded.kind === "ready" && documentsEqual(loaded.document, text("Uvod: čćžšđ 😀"))).toBe(true);
    // 16: a reload never resumes in a transient state.
    expect(after.snapshot().state).toBe("LOCAL_DURABLE");
  });

  it("16: a journal whose meta says SYNCED still shows only LOCAL_DURABLE", async () => {
    const real = journal(scope());
    const fake = patched(real, {
      read: async () => ({
        snapshot: { documentId: DOC, revision: 3, document: text("a"), savedAt: "2026-10-10T20:00:00.000Z" },
        pending: [],
        meta: { documentId: DOC, localSeq: 4, state: "SYNCED" },
      }),
    });
    const target = saver(fake);
    expect((await target.load()).kind).toBe("ready");
    expect(target.snapshot().state).toBe("LOCAL_DURABLE");
  });

  it("two documents in one scope both save", async () => {
    const at = scope();
    const a = new LocalDocumentSaver(journal(at), "doc-a", deps);
    const b = new LocalDocumentSaver(journal(at), "doc-b", deps);
    await Promise.all([a.load(), b.load()]);
    a.edit(); b.edit();
    await Promise.all([a.propose(text("A")), b.propose(text("B"))]);
    expect([a.snapshot().state, b.snapshot().state]).toEqual(["LOCAL_DURABLE", "LOCAL_DURABLE"]);
  });
});

describe("LocalDocumentSaver: ordering (#197 attacks 2, 3, 9)", () => {
  it("2, 3: a burst of saves never races its own sequence, and the newest text wins", async () => {
    const at = scope();
    const target = saver(journal(at));
    await target.load();
    const pending: Promise<void>[] = [];
    for (let i = 1; i <= 25; i += 1) {
      target.edit();
      pending.push(target.propose(text(`verzija ${i}`)));
    }
    await Promise.all(pending);
    await target.settled();
    expect(target.snapshot()).toMatchObject({ state: "LOCAL_DURABLE", failure: null });
    const stored = await journal(at).read(DOC);
    const seqs = stored.pending.map((r) => r.localSeq);
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(stored.meta?.localSeq).toBe(seqs.at(-1));
    expect(documentsEqual(stored.snapshot!.document, text("verzija 25"))).toBe(true);
    // Each stored row is newer text than the one before it: never back to older text.
    const order = stored.pending.map((r) => Number(r.tx.document.nodes[0]!.children[0]!.text.split(" ")[1]));
    expect(order).toEqual([...order].sort((x, y) => x - y));
  });

  it("9: the chip never claims the device holds text typed after the save started", async () => {
    const target = saver(journal(scope()));
    await target.load();
    target.edit();
    const flight = target.propose(text("prvo"));
    target.edit();
    await flight;
    expect(target.snapshot().state).toBe("EDITING");
    await target.propose(text("drugo"));
    expect(target.snapshot().state).toBe("LOCAL_DURABLE");
  });

  it("9: a save superseded by a queued newer candidate never shows LOCAL_DURABLE", async () => {
    const real = journal(scope());
    let written = "";
    const target = saver(patched(real, {
      saveLocal: async (...args: Parameters<AtomicDexieJournal["saveLocal"]>) => {
        const result = await real.saveLocal(...args);
        written = args[1].document.nodes[0]!.children[0]!.text;
        return result;
      },
    }));
    await target.load();
    const claimed: string[] = [];
    target.subscribe((s) => { if (s.state === "LOCAL_DURABLE") claimed.push(written); });
    target.edit();
    const flight = target.propose(text("starije"));
    void target.propose(text("novije"));
    await flight;
    await target.settled();
    expect(claimed).toEqual(["novije"]);
  });

  it("an unchanged candidate is confirmed without a new row", async () => {
    const at = scope();
    const target = saver(journal(at));
    await target.load();
    await type(target, "isto");
    await type(target, "isto");
    expect(target.snapshot().state).toBe("LOCAL_DURABLE");
    expect((await journal(at).read(DOC)).pending).toHaveLength(1);
  });
});

describe("LocalDocumentSaver: failures (#197 attacks 5, 6, 7, 4, 17, 13)", () => {
  it("5: a full quota is ERROR, stays visible while typing on, and a later save recovers", async () => {
    const real = journal(scope());
    let quota = true;
    const fake = patched(real, {
      saveLocal: (...args: Parameters<AtomicDexieJournal["saveLocal"]>) => quota
        ? Promise.reject(Object.assign(new Error("full"), { name: "AbortError", inner: { name: "QuotaExceededError" } }))
        : real.saveLocal(...args),
    });
    const target = saver(fake);
    await target.load();
    await type(target, "tekst");
    expect(target.snapshot()).toMatchObject({ state: "ERROR", failure: "quota" });
    target.edit();
    expect(target.snapshot()).toMatchObject({ state: "EDITING", failure: "quota" });
    quota = false;
    await target.propose(text("tekst 2"));
    expect(target.snapshot()).toMatchObject({ state: "LOCAL_DURABLE", failure: null });
  });

  it("5: a failure is shown even when the author typed on during the write", async () => {
    const real = journal(scope());
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fake = patched(real, {
      saveLocal: async () => { await gate; throw Object.assign(new Error("x"), { name: "QuotaExceededError" }); },
    });
    const target = saver(fake);
    await target.load();
    target.edit();
    const flight = target.propose(text("a"));
    target.edit();
    release();
    await flight;
    expect(target.snapshot()).toMatchObject({ state: "ERROR", failure: "quota" });
  });

  it("6: IndexedDB unavailable at load leaves the saver inert, never writing", async () => {
    const real = journal(scope());
    let writes = 0;
    const fake = patched(real, {
      read: () => Promise.reject(Object.assign(new Error("no idb"), { name: "MissingAPIError" })),
      saveLocal: async () => { writes += 1; throw new Error("unreachable"); },
    });
    const target = saver(fake);
    expect(await target.load()).toEqual({ kind: "unavailable" });
    expect(target.snapshot()).toMatchObject({ state: "ERROR", failure: "unavailable" });
    await type(target, "x");
    expect(target.snapshot()).toMatchObject({ state: "ERROR", failure: "unavailable" });
    expect(writes).toBe(0);
  });

  it("7: the queue stops fail-closed at its bound and says so before it gets there", async () => {
    const at = scope();
    const target = saver(journal(at), { limits: { maxPendingRows: 5, maxPendingChars: 1e9 } });
    await target.load();
    for (let i = 1; i <= 3; i += 1) await type(target, `r${i}`);
    expect(target.snapshot().capacity).toBe("ok");
    await type(target, "r4");
    expect(target.snapshot().capacity).toBe("near");
    await type(target, "r5");
    expect(target.snapshot()).toMatchObject({ state: "LOCAL_DURABLE", capacity: "full" });
    await type(target, "r6");
    expect(target.snapshot()).toMatchObject({ state: "ERROR", failure: "limit" });
    const stored = await journal(at).read(DOC);
    expect(stored.pending).toHaveLength(5);
    expect(documentsEqual(stored.snapshot!.document, text("r5"))).toBe(true);
    // The bound holds after a reload too: rows are counted from the journal.
    const again = saver(journal(at), { limits: { maxPendingRows: 5, maxPendingChars: 1e9 } });
    await again.load();
    expect(again.snapshot().capacity).toBe("full");
    await type(again, "r7");
    expect(again.snapshot().failure).toBe("limit");
  });

  it("7: the character bound stops a single oversized write", async () => {
    const at = scope();
    const target = saver(journal(at), { limits: { maxPendingRows: 100, maxPendingChars: 2_000 } });
    await target.load();
    await type(target, words(1_000));
    expect(target.snapshot()).toMatchObject({ state: "ERROR", failure: "limit" });
    expect((await journal(at).read(DOC)).snapshot).toBeNull();
  });

  it("4: a second writer moved the journal: stale halts this saver without overwriting", async () => {
    const at = scope();
    const first = saver(journal(at));
    const second = saver(journal(at));
    await Promise.all([first.load(), second.load()]);
    await type(first, "prva kartica");
    await type(second, "druga kartica");
    expect(second.snapshot()).toMatchObject({ state: "ERROR", failure: "stale" });
    // Typing on must not turn the chip back to "Uređivanje" while nothing saves.
    await type(second, "druga kartica opet");
    expect(second.snapshot()).toMatchObject({ state: "ERROR", failure: "stale" });
    second.edit();
    expect(second.snapshot()).toMatchObject({ state: "ERROR", failure: "stale" });
    const stored = await journal(at).read(DOC);
    expect(documentsEqual(stored.snapshot!.document, text("prva kartica"))).toBe(true);
    expect(stored.pending).toHaveLength(1);
  });

  it("17: an unreadable journal is recovery, and an empty editor is never written over it", async () => {
    const real = journal(scope());
    let writes = 0;
    const cases = [
      { snapshot: null, pending: [], meta: { documentId: DOC, localSeq: 2, state: "LOCAL_DURABLE" as const } },
      {
        snapshot: { documentId: DOC, revision: 0, document: { schemaVersion: 1, nodes: [] }, savedAt: "x" },
        pending: [],
        meta: { documentId: DOC, localSeq: 1, state: "LOCAL_DURABLE" as const },
      },
    ];
    for (const contents of cases) {
      const target = saver(patched(real, {
        read: async () => contents as never,
        saveLocal: async () => { writes += 1; throw new Error("unreachable"); },
      }));
      expect(await target.load()).toEqual({ kind: "recovery", document: null });
      expect(target.snapshot()).toMatchObject({ state: "RECOVERY_REQUIRED", failure: "corrupt" });
      await type(target, "");
      expect(target.snapshot()).toMatchObject({ state: "RECOVERY_REQUIRED", failure: "corrupt" });
    }
    expect(writes).toBe(0);
  });

  it("17: a sticky CONFLICT or RECOVERY_REQUIRED is shown with its text and never overwritten", async () => {
    const real = journal(scope());
    for (const state of ["CONFLICT", "RECOVERY_REQUIRED"] as const satisfies readonly SyncState[]) {
      let writes = 0;
      const target = saver(patched(real, {
        read: async () => ({
          snapshot: { documentId: DOC, revision: 1, document: text("sačuvaj"), savedAt: "2026-10-10T20:00:00.000Z" },
          pending: [],
          meta: { documentId: DOC, localSeq: 1, state },
        }),
        saveLocal: async () => { writes += 1; throw new Error("unreachable"); },
      }));
      const loaded = await target.load();
      expect(loaded.kind).toBe("recovery");
      expect(loaded.kind === "recovery" && documentsEqual(loaded.document!, text("sačuvaj"))).toBe(true);
      expect(target.snapshot().state).toBe(state);
      await type(target, "");
      expect(target.snapshot().state).toBe(state);
      expect(writes).toBe(0);
    }
  });

  it("13: a logout elsewhere stops saving; the saver never drives logout itself", async () => {
    const at = scope();
    const target = saver(journal(at));
    await target.load();
    await journal(at).destroyForLogout();
    await type(target, "nakon odjave");
    expect(target.snapshot()).toMatchObject({ state: "ERROR", failure: "unavailable" });
    await type(target, "i dalje nakon odjave");
    expect(target.snapshot()).toMatchObject({ state: "ERROR", failure: "unavailable" });
    expect((await journal(at).read(DOC)).snapshot).toBeNull();
    const source = readFileSync(new URL("./local-document-saver.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/destroyForLogout|hasPendingLogout|\bfetch\(/);
  });

  it("refuses a candidate proposed before a ready load instead of dropping it", async () => {
    const target = saver(journal(scope()));
    expect(() => target.propose(text("prerano"))).toThrow(/before a ready load/);
    expect(target.snapshot().state).toBe("EDITING");
    await target.load();
    await type(target, "nakon učitavanja");
    expect(target.snapshot().state).toBe("LOCAL_DURABLE");
  });

  it("maps journal and browser errors to visible reasons", () => {
    const named = (name: string) => Object.assign(new Error(name), { name });
    expect(failureOf(new JournalError("incomplete_store"))).toBe("corrupt");
    expect(failureOf(new JournalError("sticky_state"))).toBe("corrupt");
    expect(failureOf(new JournalError("stale_local_sequence"))).toBe("stale");
    expect(failureOf(new JournalError("logout_in_progress"))).toBe("unavailable");
    expect(failureOf(named("QuotaExceededError"))).toBe("quota");
    expect(failureOf(named("DatabaseClosedError"))).toBe("unavailable");
    expect(failureOf(named("SecurityError"))).toBe("unavailable");
    expect(failureOf(new JournalError("duplicate_transaction"))).toBe("unknown");
    expect(failureOf(null)).toBe("unknown");
  });
});

describe("LocalDocumentSaver: stored text (#197 attack 10)", () => {
  it("10: a lone surrogate and NUL are stored in a form the server accepts", async () => {
    const at = scope();
    const target = saver(journal(at));
    await target.load();
    await type(target, "a\uD800b\u0000c");
    const stored = (await journal(at).read(DOC)).snapshot!.document.nodes[0]!.children[0]!.text;
    expect(stored).toBe(storableText("a\uD800b\u0000c"));
    expect(stored).not.toMatch(/\u0000/);
  });
});

describe("LocalDocumentSaver: measurement (#197 attack 8)", () => {
  for (const count of [15_000, 80_000]) {
    it(`8: one save of ${count} words stays well inside the debounce window`, async () => {
      const target = saver(journal(scope()));
      await target.load();
      target.edit();
      const started = performance.now();
      await target.propose(text(words(count)));
      const elapsed = performance.now() - started;
      expect(target.snapshot().state).toBe("LOCAL_DURABLE");
      // fake-indexeddb in Node; the browser figure is measured in step 1b.
      expect(elapsed).toBeLessThan(2_000);
    });
  }

  it("an empty document reloads as an empty document", async () => {
    const at = scope();
    const target = saver(journal(at));
    await target.load();
    await type(target, "nešto");
    await type(target, "");
    const loaded = await saver(journal(at)).load();
    expect(loaded.kind === "ready" && documentsEqual(loaded.document, text(""))).toBe(true);
    expect(emptyDocument().nodes[0]!.children).toEqual([]);
  });
});
