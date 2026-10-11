// @vitest-environment node
/**
 * Local saving of one document (F-3 step 1a, plan #197). Numbers in test names
 * are the attacks of #197; attacks 1, 4, 11, 14, 15 and the editor half of
 * 5/6/9 are E2E in step 1b. All text here is synthetic.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import Dexie from "dexie";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import {
  documentsEqual, emptyDocument, newNodeId, paragraphNode, textNode, type CanonicalDocument,
} from "../../domain/document";
import { documentByteLength, MAX_DOCUMENT_BYTES } from "../../domain/serverSync/contract";
import type { SyncState } from "../../domain/sync/states";
import { storableText } from "../../editor/storable-text";
import { AtomicDexieJournal, JournalError } from "./atomic-dexie-journal";
import {
  failureOf, LocalDocumentSaver, reasonOf, type LoadResult, type SaverDeps, type SaverSnapshot,
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

  it("the next write carries the revision the loaded snapshot holds (#206 qa206j MANJE)", async () => {
    for (const revision of [0, 23, 2 ** 40, Number.MAX_SAFE_INTEGER]) {
      const real = journal(scope());
      const createdAt = "2026-10-10T20:00:00.000Z";
      await real.saveLocal(DOC, {
        kind: "REPLACE_DOCUMENT", clientTransactionId: `rev-${revision}`, baseRevision: revision,
        document: text("učitano"), createdAt,
      }, createdAt, 0);
      const target = saver(real);
      expect((await target.load()).kind).toBe("ready");
      await type(target, "novo");
      const { snapshot, pending } = await real.read(DOC);
      expect(pending.at(-1)!.tx).toMatchObject({ baseRevision: revision, document: text("novo") });
      expect(snapshot!.revision).toBe(revision);
    }
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

  it("9: text typed while a newer candidate waited is never claimed by that candidate", async () => {
    const real = journal(scope());
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const target = saver(patched(real, {
      saveLocal: async (...args: Parameters<AtomicDexieJournal["saveLocal"]>) => {
        await gate;
        return real.saveLocal(...args);
      },
    }));
    await target.load();
    target.edit();
    void target.propose(text("a"));
    void target.propose(text("b"));
    target.edit();
    release();
    await target.settled();
    expect(target.snapshot()).toMatchObject({ state: "EDITING", failure: null });
  });

  it("an unchanged candidate is still written, so only the journal confirms it", async () => {
    const at = scope();
    const target = saver(journal(at));
    await target.load();
    await type(target, "isto");
    await type(target, "isto");
    expect(target.snapshot().state).toBe("LOCAL_DURABLE");
    expect((await journal(at).read(DOC)).pending).toHaveLength(2);
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

  it("6: a ready load after an unavailable one resumes saving", async () => {
    const at = scope();
    const real = journal(at);
    let reads = 0;
    const target = saver(patched(real, {
      read: (...args: Parameters<AtomicDexieJournal["read"]>) => (reads += 1) === 1
        ? Promise.reject(Object.assign(new Error("no idb"), { name: "MissingAPIError" }))
        : real.read(...args),
    }));
    expect(await target.load()).toEqual({ kind: "unavailable" });
    expect((await target.load()).kind).toBe("ready");
    expect(target.snapshot()).toEqual({ state: "EDITING", failure: null, capacity: "ok" });
    await type(target, "nakon ponovnog čitanja");
    expect(target.snapshot()).toMatchObject({ state: "LOCAL_DURABLE", failure: null });
    expect((await journal(at).read(DOC)).pending).toHaveLength(1);
  });

  it("6: a reload while a write is in flight waits for it, so the next save is not stale", async () => {
    const at = scope();
    const real = journal(at);
    let gate = Promise.resolve();
    let open = () => {};
    let written = Promise.resolve();
    const target = saver(patched(real, {
      // Held until a read has seen the journal (or briefly, if none comes).
      saveLocal: (...args: Parameters<AtomicDexieJournal["saveLocal"]>) => {
        const result = gate.then(() => real.saveLocal(...args));
        written = result.then(() => undefined, () => undefined);
        return result;
      },
      // Resolves only after that write, with what it saw before it.
      read: async (...args: Parameters<AtomicDexieJournal["read"]>) => {
        const contents = await real.read(...args);
        open();
        await written;
        return contents;
      },
    }));
    await target.load();
    await type(target, "prvo");
    gate = new Promise<void>((resolve) => { open = resolve; setTimeout(resolve, 50); });
    target.edit();
    const flight = target.propose(text("drugo"));
    await Promise.all([flight, target.load()]);
    await type(target, "treće");
    expect(target.snapshot()).toMatchObject({ state: "LOCAL_DURABLE", failure: null });
    expect((await journal(at).read(DOC)).pending).toHaveLength(3);
  });

  it("6: text proposed during a reload is written after the read, and not claimed by the load", async () => {
    const at = scope();
    const real = journal(at);
    let reads = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const order: string[] = [];
    const target = saver(patched(real, {
      read: async (...args: Parameters<AtomicDexieJournal["read"]>) => {
        if ((reads += 1) === 2) await gate;
        order.push("read");
        return real.read(...args);
      },
      saveLocal: (...args: Parameters<AtomicDexieJournal["saveLocal"]>) => {
        order.push("write");
        return real.saveLocal(...args);
      },
    }));
    await target.load();
    await type(target, "prvo");
    const reload = target.load();
    target.edit();
    const flight = target.propose(text("drugo"));
    await Promise.resolve();
    expect(order).toEqual(["read", "write"]);
    release();
    await reload;
    await flight;
    expect(order).toEqual(["read", "write", "read", "write"]);
    expect(target.snapshot()).toMatchObject({ state: "LOCAL_DURABLE", failure: null });
    expect((await journal(at).read(DOC)).snapshot?.document).toEqual(text("drugo"));
  });

  it("6: a reload after a failed write keeps the failure and never claims the journal's older text", async () => {
    const at = scope();
    const real = journal(at);
    let failNext = false;
    const target = saver(patched(real, {
      saveLocal: async (...args: Parameters<AtomicDexieJournal["saveLocal"]>) => {
        if (failNext) { failNext = false; throw new Error("transient"); }
        return real.saveLocal(...args);
      },
    }));
    await target.load();
    await type(target, "prvo");
    failNext = true;
    target.edit();
    const [, loaded] = await Promise.all([target.propose(text("drugo")), target.load()]);
    expect(loaded).toEqual({ kind: "recovery", reason: "unsaved", document: text("prvo") });
    expect(target.snapshot()).toMatchObject({ state: "ERROR", failure: "unknown" });
    expect(await target.load()).toEqual({ kind: "recovery", reason: "unsaved", document: text("prvo") });
    expect(target.snapshot()).toMatchObject({ state: "ERROR", failure: "unknown" });
    // A failure that does not halt stays retryable across the reload.
    await type(target, "treće");
    expect(target.snapshot()).toMatchObject({ state: "LOCAL_DURABLE", failure: null });
    const stored = await journal(at).read(DOC);
    expect(stored.pending).toHaveLength(2);
    expect(stored.snapshot?.document).toEqual(text("treće"));
    expect(await target.load()).toEqual({ kind: "ready", document: text("treće") });
  });

  it("6: a full store across a reload stays retryable and saves once space returns (#206 review)", async () => {
    const at = scope();
    const real = journal(at);
    let full = false;
    const quota = () => Object.assign(new Error("full"), { name: "QuotaExceededError" });
    const target = saver(patched(real, {
      saveLocal: async (...args: Parameters<AtomicDexieJournal["saveLocal"]>) => {
        if (full) throw quota();
        return real.saveLocal(...args);
      },
    }));
    await target.load();
    await type(target, "prvi");
    full = true;
    await type(target, "drugi");
    expect(target.snapshot()).toMatchObject({ state: "ERROR", failure: "quota" });
    full = false;
    await type(target, "drugi");
    expect(target.snapshot()).toMatchObject({ state: "LOCAL_DURABLE", failure: null });
    full = true;
    await type(target, "treći");
    expect(target.snapshot()).toMatchObject({ state: "ERROR", failure: "quota" });
    full = false;
    expect(await target.load()).toEqual({ kind: "recovery", reason: "unsaved", document: text("drugi") });
    expect(target.snapshot()).toMatchObject({ state: "ERROR", failure: "quota" });
    await type(target, "treći");
    expect(target.snapshot()).toMatchObject({ state: "LOCAL_DURABLE", failure: null });
    expect((await journal(at).read(DOC)).snapshot?.document).toEqual(text("treći"));
    expect(await saver(journal(at)).load()).toEqual({ kind: "ready", document: text("treći") });
  });

  it("6: resume() after a halting failure saves the editor's text over the journal's older one", async () => {
    const at = scope();
    const real = journal(at);
    let closed = false;
    const target = saver(patched(real, {
      saveLocal: async (...args: Parameters<AtomicDexieJournal["saveLocal"]>) => {
        if (closed) throw Object.assign(new Error("closed"), { name: "DatabaseClosedError" });
        return real.saveLocal(...args);
      },
    }));
    await target.load();
    await type(target, "staro");
    closed = true;
    await type(target, "iz editora");
    expect(target.snapshot()).toMatchObject({ state: "ERROR", failure: "unavailable" });
    closed = false;
    expect(await target.load()).toEqual({ kind: "recovery", reason: "unsaved", document: text("staro") });
    await type(target, "iz editora");
    expect(target.snapshot()).toMatchObject({ state: "ERROR", failure: "unavailable" });
    expect(await target.resume(text("iz editora"))).toEqual({ kind: "ready", document: text("staro") });
    expect(target.snapshot()).toMatchObject({ state: "LOCAL_DURABLE", failure: null });
    expect((await journal(at).read(DOC)).snapshot?.document).toEqual(text("iz editora"));
    expect(await saver(journal(at)).load()).toEqual({ kind: "ready", document: text("iz editora") });
    expect(await target.load()).toEqual({ kind: "ready", document: text("iz editora") });
  });

  it("4, 6: resume() in a stale tab saves the chosen text and keeps the other writer's in the rows", async () => {
    const at = scope();
    const first = saver(journal(at));
    const second = saver(journal(at));
    await Promise.all([first.load(), second.load()]);
    await type(first, "A");
    await type(second, "B");
    expect(second.snapshot()).toMatchObject({ state: "ERROR", failure: "stale" });
    expect(await second.load()).toEqual({ kind: "recovery", reason: "stale", document: text("A") });
    expect(await second.resume(text("B"))).toEqual({ kind: "ready", document: text("A") });
    expect(second.snapshot()).toMatchObject({ state: "LOCAL_DURABLE", failure: null });
    const stored = await journal(at).read(DOC);
    expect(stored.snapshot?.document).toEqual(text("B"));
    expect(stored.pending.some((row) => documentsEqual(row.tx.document, text("A")))).toBe(true);
    // The tab that lost the race is now the stale one.
    await type(first, "A2");
    expect(first.snapshot()).toMatchObject({ state: "ERROR", failure: "stale" });
  });

  it("4, 6: resume() never writes over text another writer saved after the recovery (#206 review)", async () => {
    const at = scope();
    const a = saver(journal(at));
    const b = saver(journal(at));
    await Promise.all([a.load(), b.load()]);
    await type(b, "B1");
    await type(a, "A1");
    expect(await a.load()).toEqual({ kind: "recovery", reason: "stale", document: text("B1") });
    await type(b, "B2 newer");
    expect(b.snapshot()).toMatchObject({ state: "LOCAL_DURABLE", failure: null });
    expect(await a.resume(text("A2"))).toEqual({ kind: "recovery", reason: "stale", document: text("B2 newer") });
    expect(a.snapshot()).toMatchObject({ state: "ERROR", failure: "stale" });
    expect((await journal(at).read(DOC)).snapshot?.document).toEqual(text("B2 newer"));
    // Once the author has seen "B2 newer", resuming over it is a choice.
    expect(await a.resume(text("A2"))).toEqual({ kind: "ready", document: text("B2 newer") });
    expect(a.snapshot()).toMatchObject({ state: "LOCAL_DURABLE", failure: null });
    const stored = await journal(at).read(DOC);
    expect(stored.snapshot?.document).toEqual(text("A2"));
    expect(stored.pending.some((row) => documentsEqual(row.tx.document, text("B2 newer")))).toBe(true);
  });

  it("6: resume() after an unsaved recovery never writes over another writer's later text", async () => {
    const at = scope();
    const real = journal(at);
    let closed = false;
    const a = saver(patched(real, {
      saveLocal: async (...args: Parameters<AtomicDexieJournal["saveLocal"]>) => {
        if (closed) throw Object.assign(new Error("closed"), { name: "DatabaseClosedError" });
        return real.saveLocal(...args);
      },
    }));
    await a.load();
    await type(a, "staro");
    closed = true;
    await type(a, "iz editora");
    closed = false;
    expect(await a.load()).toEqual({ kind: "recovery", reason: "unsaved", document: text("staro") });
    const b = saver(journal(at));
    await b.load();
    await type(b, "druga kartica");
    expect(await a.resume(text("iz editora"))).toEqual({ kind: "recovery", reason: "stale", document: text("druga kartica") });
    expect((await journal(at).read(DOC)).snapshot?.document).toEqual(text("druga kartica"));
    expect(await a.resume(text("iz editora"))).toMatchObject({ kind: "ready" });
    expect((await journal(at).read(DOC)).snapshot?.document).toEqual(text("iz editora"));
  });

  it("4, 6: a writer between resume()'s read and its write makes it stale, never overwritten", async () => {
    const at = scope();
    const real = journal(at);
    let race: (() => Promise<void>) | null = null;
    const a = saver(patched(real, {
      saveLocal: async (...args: Parameters<AtomicDexieJournal["saveLocal"]>) => {
        const before = race;
        race = null;
        if (before) await before();
        return real.saveLocal(...args);
      },
    }));
    const b = saver(journal(at));
    await Promise.all([a.load(), b.load()]);
    await type(b, "B1");
    await type(a, "A1");
    expect(await a.load()).toMatchObject({ kind: "recovery", reason: "stale" });
    race = () => type(b, "B2 u utrci");
    expect(await a.resume(text("A2"))).toEqual({ kind: "ready", document: text("B1") });
    expect(a.snapshot()).toMatchObject({ state: "ERROR", failure: "stale" });
    expect((await journal(at).read(DOC)).snapshot?.document).toEqual(text("B2 u utrci"));
    expect(await a.load()).toEqual({ kind: "recovery", reason: "stale", document: text("B2 u utrci") });
  });

  it("6: resume() after a full store that this saver's own later write cleared is not stale", async () => {
    const at = scope();
    const real = journal(at);
    let full = false;
    const target = saver(patched(real, {
      saveLocal: async (...args: Parameters<AtomicDexieJournal["saveLocal"]>) => {
        if (full) throw Object.assign(new Error("full"), { name: "QuotaExceededError" });
        return real.saveLocal(...args);
      },
    }));
    await target.load();
    await type(target, "prvi");
    full = true;
    await type(target, "drugi");
    full = false;
    expect(await target.load()).toMatchObject({ kind: "recovery", reason: "unsaved" });
    await type(target, "drugi");
    expect(await target.resume(text("odabrani"))).toEqual({ kind: "ready", document: text("drugi") });
    expect(target.snapshot()).toMatchObject({ state: "LOCAL_DURABLE", failure: null });
    expect((await journal(at).read(DOC)).snapshot?.document).toEqual(text("odabrani"));
  });

  it("resume() refuses without an unsaved or stale recovery and never writes then", async () => {
    const real = journal(scope());
    let writes = 0;
    const counting = (over: Partial<AtomicDexieJournal>) => patched(real, {
      ...over,
      saveLocal: async (...args: Parameters<AtomicDexieJournal["saveLocal"]>) => {
        writes += 1;
        return real.saveLocal(...args);
      },
    });
    const fresh = saver(counting({}));
    await expect(fresh.resume(text("x"))).rejects.toThrow(/without an unsaved or stale recovery/);
    await fresh.load();
    await expect(fresh.resume(text("x"))).rejects.toThrow(/without an unsaved or stale recovery/);
    const corrupt = saver(counting({
      read: async () => ({ snapshot: null, pending: [], meta: { documentId: DOC, localSeq: 2, state: "LOCAL_DURABLE" } }) as never,
    }));
    expect(await corrupt.load()).toEqual({ kind: "recovery", reason: "corrupt", document: null });
    await expect(corrupt.resume(text("x"))).rejects.toThrow(/without an unsaved or stale recovery/);
    const sticky = saver(counting({
      read: async () => ({
        snapshot: { documentId: DOC, revision: 1, document: text("sačuvaj"), savedAt: "2026-10-10T20:00:00.000Z" },
        pending: [],
        meta: { documentId: DOC, localSeq: 1, state: "CONFLICT" as const },
      }),
    }));
    expect(await sticky.load()).toEqual({ kind: "recovery", reason: "sticky", document: text("sačuvaj") });
    await expect(sticky.resume(text("x"))).rejects.toThrow(/without an unsaved or stale recovery/);
    expect(sticky.snapshot().state).toBe("CONFLICT");
    expect(writes).toBe(0);
  });

  it("4, 6: a reload in a stale tab keeps it stopped, whether the write was in flight or done", async () => {
    const at = scope();
    const first = saver(journal(at));
    const second = saver(journal(at));
    await Promise.all([first.load(), second.load()]);
    await type(first, "A");
    second.edit();
    const [, during] = await Promise.all([second.propose(text("B")), second.load()]);
    expect(during).toEqual({ kind: "recovery", reason: "stale", document: text("A") });
    expect(second.snapshot()).toMatchObject({ state: "ERROR", failure: "stale" });
    const after = await second.load();
    expect(after).toEqual({ kind: "recovery", reason: "stale", document: text("A") });
    expect(second.snapshot()).toMatchObject({ state: "ERROR", failure: "stale" });
  });

  it("4, 6: a reload never claims text another writer saved after this tab's last write", async () => {
    const at = scope();
    const first = saver(journal(at));
    await first.load();
    await type(first, "eins");
    const second = saver(journal(at));
    await second.load();
    await type(second, "zwei");
    expect(await first.load()).toEqual({ kind: "recovery", reason: "stale", document: text("zwei") });
    expect(first.snapshot()).toMatchObject({ state: "ERROR", failure: "stale" });
  });

  it("6: text typed before or during a reload is not claimed by it", async () => {
    const real = journal(scope());
    let reads = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let entered!: () => void;
    const reading = new Promise<void>((resolve) => { entered = resolve; });
    const target = saver(patched(real, {
      read: async (...args: Parameters<AtomicDexieJournal["read"]>) => {
        if ((reads += 1) === 3) { entered(); await gate; }
        return real.read(...args);
      },
    }));
    await target.load();
    await type(target, "prvo");
    target.edit();
    expect((await target.load()).kind).toBe("ready");
    expect(target.snapshot().state).toBe("EDITING");
    await type(target, "drugo");
    const reload = target.load();
    await reading;
    target.edit();
    release();
    expect((await reload).kind).toBe("ready");
    expect(target.snapshot().state).toBe("EDITING");
  });

  it("6: a candidate waiting on a reload is not claimed by it, even without a new edit", async () => {
    const real = journal(scope());
    let reads = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let entered!: () => void;
    const reading = new Promise<void>((resolve) => { entered = resolve; });
    const target = saver(patched(real, {
      read: async (...args: Parameters<AtomicDexieJournal["read"]>) => {
        if ((reads += 1) === 2) { entered(); await gate; }
        return real.read(...args);
      },
    }));
    await target.load();
    await type(target, "prvo");
    const reload = target.load();
    await reading;
    const flight = target.propose(text("drugo"));
    const states = record(target);
    release();
    await reload;
    await flight;
    expect(states.map((s) => s.state)).toEqual(["EDITING", "SAVING_LOCAL", "LOCAL_DURABLE"]);
  });

  it("6: overlapping reloads hold writes until the last read, so the only writer is not stale", async () => {
    const at = scope();
    const real = journal(at);
    let reads = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const target = saver(patched(real, {
      // The third read sees the journal, then is held: it returns what it saw.
      read: async (...args: Parameters<AtomicDexieJournal["read"]>) => {
        const contents = await real.read(...args);
        if ((reads += 1) === 3) await gate;
        return contents;
      },
    }));
    await target.load();
    await type(target, "prvo");
    const first = target.load();
    const second = target.load();
    await first;
    target.edit();
    const flight = target.propose(text("drugo"));
    // Time for a write that does not wait to finish before the held read returns.
    await new Promise((resolve) => setTimeout(resolve, 50));
    release();
    await Promise.all([second, flight]);
    await type(target, "treće");
    expect(target.snapshot()).toMatchObject({ state: "LOCAL_DURABLE", failure: null });
    expect((await journal(at).read(DOC)).pending).toHaveLength(3);
  });

  it("4: a halting failure drops the candidate queued behind it", async () => {
    const real = journal(scope());
    let writes = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const target = saver(patched(real, {
      saveLocal: async () => {
        writes += 1;
        await gate;
        throw new JournalError("stale_local_sequence");
      },
    }));
    await target.load();
    target.edit();
    const flight = target.propose(text("a"));
    target.edit();
    void target.propose(text("b"));
    release();
    await flight;
    await target.settled();
    expect(writes).toBe(1);
    expect(target.snapshot()).toMatchObject({ state: "ERROR", failure: "stale" });
  });

  it("6: the store closing during a write halts saving", async () => {
    const real = journal(scope());
    let writes = 0;
    const target = saver(patched(real, {
      saveLocal: async () => {
        writes += 1;
        throw Object.assign(new Error("closed"), { name: "DatabaseClosedError" });
      },
    }));
    await target.load();
    await type(target, "x");
    expect(target.snapshot()).toMatchObject({ state: "ERROR", failure: "unavailable" });
    await type(target, "y");
    expect(writes).toBe(1);
  });

  it("an error while building the row is ERROR, not a save stuck in progress", async () => {
    const target = saver(journal(scope()), {
      newTransactionId: () => { throw new Error("no randomness"); },
    });
    await target.load();
    await type(target, "x");
    expect(target.snapshot()).toMatchObject({ state: "ERROR", failure: "unknown" });
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

  it("7: the character bound counts the rows this saver wrote", async () => {
    const probe = scope();
    const measure = saver(journal(probe));
    await measure.load();
    await type(measure, words(100));
    const size = JSON.stringify((await journal(probe).read(DOC)).pending[0]!.tx).length;
    const at = scope();
    const target = saver(journal(at), { limits: { maxPendingRows: 100, maxPendingChars: Math.floor(size * 1.5) } });
    await target.load();
    await type(target, words(100));
    expect(target.snapshot()).toMatchObject({ state: "LOCAL_DURABLE", failure: null });
    await type(target, words(100));
    expect(target.snapshot()).toMatchObject({ state: "ERROR", failure: "limit" });
    expect((await journal(at).read(DOC)).pending).toHaveLength(1);
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

  it("4: the same text as before is not trusted from memory after another tab saved", async () => {
    const at = scope();
    const first = saver(journal(at));
    await first.load();
    await type(first, "prva kartica");
    const second = saver(journal(at));
    await second.load();
    await type(second, "druga kartica");
    await type(first, "prva kartica");
    expect(first.snapshot()).toMatchObject({ state: "ERROR", failure: "stale" });
    const stored = await journal(at).read(DOC);
    expect(documentsEqual(stored.snapshot!.document, text("druga kartica"))).toBe(true);
  });

  it("4: a stale write proposed straight from LOCAL_DURABLE still shows ERROR", async () => {
    const at = scope();
    const first = saver(journal(at));
    await first.load();
    await type(first, "prva kartica");
    const second = saver(journal(at));
    await second.load();
    await type(second, "druga kartica");
    await first.propose(text("prva kartica 2"));
    expect(first.snapshot()).toMatchObject({ state: "ERROR", failure: "stale" });
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
      expect(await target.load()).toEqual({ kind: "recovery", reason: "corrupt", document: null });
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
      expect(loaded).toMatchObject({ kind: "recovery", reason: "sticky" });
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

  it("reports the queue bound as a full store and a stale journal as unknown to the reducer", () => {
    expect(reasonOf("limit")).toBe("quota");
    expect(reasonOf("stale")).toBe("unknown");
    expect(reasonOf("quota")).toBe("quota");
    expect(reasonOf("corrupt")).toBe("corrupt");
  });
});

describe("LocalDocumentSaver: resume and reload races (#206 qa206c)", () => {
  type Mode = "ok" | "quota" | "gate" | "stale";
  /** saveLocal by mode; a gated write waits for `open()`, then runs as "ok". */
  function moded(real: AtomicDexieJournal) {
    const control = { mode: "ok" as Mode, writes: 0, open: () => {} };
    const fake = patched(real, {
      saveLocal: async (...args: Parameters<AtomicDexieJournal["saveLocal"]>) => {
        control.writes += 1;
        const mode = control.mode;
        if (mode === "quota") throw Object.assign(new Error("full"), { name: "QuotaExceededError" });
        if (mode === "gate" || mode === "stale") {
          await new Promise<void>((resolve) => { control.open = resolve; });
          if (mode === "stale") throw new JournalError("stale_local_sequence");
        }
        return real.saveLocal(...args);
      },
    });
    return { fake, control };
  }

  it("C1: resume() while the only writer's own write is in flight is not stale", async () => {
    const at = scope();
    const { fake, control } = moded(journal(at));
    const s = saver(fake);
    await s.load();
    await type(s, "prvi");
    control.mode = "quota";
    await type(s, "drugi");
    expect(s.snapshot()).toMatchObject({ state: "ERROR", failure: "quota" });
    expect(await s.load()).toEqual({ kind: "recovery", reason: "unsaved", document: text("prvi") });
    control.mode = "gate";
    s.edit();
    const w = s.propose(text("treći"));
    const res = s.resume(text("treći"));
    control.mode = "ok";
    control.open();
    await w;
    expect(await res).toEqual({ kind: "ready", document: text("treći") });
    expect(s.snapshot()).toMatchObject({ state: "LOCAL_DURABLE", failure: null });
    expect((await journal(at).read(DOC)).snapshot?.document).toEqual(text("treći"));
  });

  it("A1: resume() claims nothing saved before the chosen text is written", async () => {
    const at = scope();
    const a = saver(journal(at));
    const b = saver(journal(at));
    await Promise.all([a.load(), b.load()]);
    await type(b, "B");
    await type(a, "A");
    expect(await a.load()).toMatchObject({ kind: "recovery", reason: "stale" });
    const states = record(a);
    expect(await a.resume(text("A1"))).toEqual({ kind: "ready", document: text("B") });
    expect(states.map((s) => s.state)).toEqual(["EDITING", "SAVING_LOCAL", "LOCAL_DURABLE"]);
  });

  it("A1: a tab that never typed is not shown saved for text the journal lacks", async () => {
    const at = scope();
    const real = journal(at);
    const a = saver(real);
    const b = saver(journal(at));
    await Promise.all([a.load(), b.load()]);
    await type(b, "B");
    expect(await a.load()).toEqual({ kind: "recovery", reason: "stale", document: text("B") });
    const claims: string[] = [];
    a.subscribe((s) => {
      if (s.state !== "LOCAL_DURABLE") return;
      void real.read(DOC).then((stored) => {
        claims.push(documentsEqual(stored.snapshot!.document, text("")) ? "written" : "missing");
      });
    });
    await a.resume(text(""));
    await a.settled();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(claims).toEqual(["written"]);
  });

  it("MANJE 1b: overlapping reloads start no write until the last one has read", async () => {
    const at = scope();
    const real = journal(at);
    const { fake, control } = moded(real);
    let reads = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const target = saver(patched(fake, {
      read: async (...args: Parameters<AtomicDexieJournal["read"]>) => {
        if ((reads += 1) === 3) await gate;
        return real.read(...args);
      },
    }));
    await target.load();
    await type(target, "prvo");
    const first = target.load();
    const second = target.load();
    await first;
    target.edit();
    const flight = target.propose(text("drugo"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(control.writes).toBe(1);
    release();
    expect((await second).kind).toBe("ready");
    await flight;
    expect(control.writes).toBe(2);
    expect(target.snapshot()).toMatchObject({ state: "LOCAL_DURABLE", failure: null });
  });

  it("MANJE 1a: a reload after a halting write failure writes nothing until resume()", async () => {
    const at = scope();
    const { fake, control } = moded(journal(at));
    const target = saver(fake);
    await target.load();
    await type(target, "prvo");
    control.mode = "stale";
    target.edit();
    const flight = target.propose(text("drugo"));
    control.open();
    await flight;
    control.mode = "ok";
    expect(await target.load()).toEqual({ kind: "recovery", reason: "unsaved", document: text("prvo") });
    expect(target.snapshot()).toMatchObject({ state: "ERROR", failure: "stale" });
    await type(target, "treće");
    expect(await target.load()).toMatchObject({ kind: "recovery", reason: "unsaved" });
    await type(target, "četvrto");
    expect(control.writes).toBe(2);
    expect(target.snapshot()).toMatchObject({ state: "ERROR", failure: "stale" });
  });

  it("MANJE 2: a pending row without a transaction is corrupt and changes nothing", async () => {
    const at = scope();
    const real = journal(at);
    let broken = false;
    let writes = 0;
    const read = async (...args: Parameters<AtomicDexieJournal["read"]>) => {
      const contents = await real.read(...args);
      return broken ? { ...contents, pending: [...contents.pending, { localSeq: 9 } as never] } : contents;
    };
    const target = saver(patched(real, {
      read,
      saveLocal: async (...args: Parameters<AtomicDexieJournal["saveLocal"]>) => {
        writes += 1;
        return real.saveLocal(...args);
      },
    }));
    await target.load();
    await type(target, "prvo");
    broken = true;
    expect(await target.load()).toEqual({ kind: "recovery", reason: "corrupt", document: null });
    expect(target.snapshot()).toMatchObject({ state: "RECOVERY_REQUIRED", failure: "corrupt" });
    await type(target, "drugo");
    expect(writes).toBe(1);
    const fresh = saver(patched(real, { read }));
    expect(await fresh.load()).toEqual({ kind: "recovery", reason: "corrupt", document: null });
  });

  it("MANJE 3: a candidate queued behind a halting failure is not written before the chosen text", async () => {
    const at = scope();
    const { fake, control } = moded(journal(at));
    const target = saver(fake);
    await target.load();
    await type(target, "prvo");
    control.mode = "stale";
    target.edit();
    const flight = target.propose(text("drugo"));
    target.edit();
    void target.propose(text("staro u redu"));
    control.open();
    await flight;
    await target.settled();
    control.mode = "ok";
    expect(await target.load()).toMatchObject({ kind: "recovery", reason: "unsaved" });
    expect(await target.resume(text("odabrano"))).toEqual({ kind: "ready", document: text("prvo") });
    expect(control.writes).toBe(3);
    const stored = await journal(at).read(DOC);
    expect(stored.pending.map((row) => row.tx.document)).toEqual([text("prvo"), text("odabrano")]);
    expect(target.snapshot()).toMatchObject({ state: "LOCAL_DURABLE", failure: null });
  });

  it("model: text typed while resume() reads is not claimed by the chosen text's write", async () => {
    const at = scope();
    const real = journal(at);
    let hold: Promise<void> | null = null;
    const a = saver(
      patched(real, {
        read: async (...args: Parameters<AtomicDexieJournal["read"]>) => {
          const contents = await real.read(...args);
          if (hold) await hold;
          return contents;
        },
      }),
    );
    const b = saver(journal(at));
    await Promise.all([a.load(), b.load()]);
    await type(b, "B");
    expect(await a.load()).toMatchObject({ kind: "recovery", reason: "stale" });
    let release!: () => void;
    hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const resumed = a.resume(text("odabrano"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    a.edit();
    hold = null;
    release();
    expect(await resumed).toEqual({ kind: "ready", document: text("B") });
    await a.settled();
    expect((await journal(at).read(DOC)).snapshot?.document).toEqual(text("odabrano"));
    expect(a.snapshot()).toMatchObject({ state: "EDITING", failure: null });
  });
});

describe("LocalDocumentSaver: resume() contract (#206 r6)", () => {
  /**
   * The real journal whose next `read()` after `hold()` waits before it reads:
   * `entered` resolves once that read is held, `open()` lets it read.
   */
  function heldRead(real: AtomicDexieJournal) {
    let armed = false;
    let calls = 0;
    let open = () => {};
    let entered: Promise<void> = Promise.resolve();
    let enter = () => {};
    const fake = patched(real, {
      read: async (...args: Parameters<AtomicDexieJournal["read"]>) => {
        calls += 1;
        if (armed) {
          armed = false;
          const gate = new Promise<void>((resolve) => { open = resolve; });
          enter();
          await gate;
        }
        return real.read(...args);
      },
    });
    return {
      fake,
      hold: () => {
        armed = true;
        entered = new Promise<void>((resolve) => { enter = resolve; });
      },
      entered: () => entered,
      /** Resolves once `count` reads have been called. */
      called: async (count: number) => {
        while (calls < count) await new Promise((resolve) => setImmediate(resolve));
      },
      open: () => open(),
    };
  }
  async function rows(at: string): Promise<CanonicalDocument[]> {
    return (await journal(at).read(DOC)).pending.map((row) => row.tx.document);
  }
  /** Tab A over a held journal with a stale recovery showing B's "B1". */
  async function staleTab(at: string) {
    const control = heldRead(journal(at));
    const a = saver(control.fake);
    const b = saver(journal(at));
    await Promise.all([a.load(), b.load()]);
    await type(b, "B1");
    await type(a, "A");
    expect(await a.load()).toEqual({ kind: "recovery", reason: "stale", document: text("B1") });
    return { a, b, control };
  }

  it("r6 finding 1: an overlapping load() showing newer text does not let resume() write over it", async () => {
    const at = scope();
    const { a, b, control } = await staleTab(at);
    control.hold();
    const resumed = a.resume(text("A2"));
    await control.entered();
    await type(b, "B2 newer");
    expect(await a.load()).toEqual({ kind: "recovery", reason: "stale", document: text("B2 newer") });
    control.open();
    expect(await resumed).toEqual({ kind: "recovery", reason: "stale", document: text("B2 newer") });
    await a.settled();
    expect(await rows(at)).toEqual([text("B1"), text("B2 newer")]);
    expect(a.snapshot()).toMatchObject({ state: "ERROR", failure: "stale" });
    // The newer text was shown, so choosing against it now writes.
    expect((await a.resume(text("A3"))).kind).toBe("ready");
    await a.settled();
    expect(await rows(at)).toEqual([text("B1"), text("B2 newer"), text("A3")]);
  });

  it("r6 finding 2: unsaved: text proposed while resume() reads is written, not the older choice", async () => {
    const at = scope();
    const real = journal(at);
    const control = heldRead(real);
    let full = false;
    const s = saver(patched(control.fake, {
      saveLocal: async (...args: Parameters<AtomicDexieJournal["saveLocal"]>) => {
        if (full) throw Object.assign(new Error("full"), { name: "QuotaExceededError" });
        return real.saveLocal(...args);
      },
    }));
    await s.load();
    await type(s, "prvi");
    full = true;
    await type(s, "drugi");
    full = false;
    expect(await s.load()).toEqual({ kind: "recovery", reason: "unsaved", document: text("prvi") });
    control.hold();
    const resumed = s.resume(text("odabrano"));
    await control.entered();
    s.edit();
    const proposed = s.propose(text("odabrano i novo"));
    control.open();
    expect(await resumed).toEqual({ kind: "ready", document: text("prvi") });
    await proposed;
    await s.settled();
    expect(await rows(at)).toEqual([text("prvi"), text("odabrano i novo")]);
    expect(s.snapshot()).toMatchObject({ state: "LOCAL_DURABLE", failure: null });
  });

  it("r6 finding 2: stopped tab: text proposed while resume() reads waits and is written", async () => {
    const at = scope();
    const { a, control } = await staleTab(at);
    control.hold();
    const resumed = a.resume(text("odabrano"));
    await control.entered();
    a.edit();
    const proposed = a.propose(text("odabrano i novo"));
    control.open();
    expect(await resumed).toEqual({ kind: "ready", document: text("B1") });
    await proposed;
    await a.settled();
    expect(await rows(at)).toEqual([text("B1"), text("odabrano i novo")]);
    expect(a.snapshot()).toMatchObject({ state: "LOCAL_DURABLE", failure: null });
  });

  it("r6: a resume that stays stale writes nothing proposed during it", async () => {
    const at = scope();
    const { a, b, control } = await staleTab(at);
    control.hold();
    const resumed = a.resume(text("odabrano"));
    await control.entered();
    await type(b, "B2");
    a.edit();
    const proposed = a.propose(text("novo"));
    control.open();
    expect(await resumed).toEqual({ kind: "recovery", reason: "stale", document: text("B2") });
    await proposed;
    await a.settled();
    expect(await rows(at)).toEqual([text("B1"), text("B2")]);
    expect(a.snapshot()).toMatchObject({ state: "ERROR", failure: "stale" });
    // The next choice supersedes the candidate left from the stale resume.
    expect((await a.resume(text("drugi odabir"))).kind).toBe("ready");
    await a.settled();
    expect(await rows(at)).toEqual([text("B1"), text("B2"), text("drugi odabir")]);
    expect(a.snapshot()).toMatchObject({ state: "LOCAL_DURABLE", failure: null });
  });

  it("r6: two resumes: the later choice is written last", async () => {
    for (const heldFirst of [true, false]) {
      const at = scope();
      const { a, control } = await staleTab(at);
      const before = 2;
      await control.called(before);
      if (heldFirst) control.hold();
      const first = a.resume(text("prvi odabir"));
      if (!heldFirst) {
        await control.called(before + 1);
        control.hold();
      }
      const second = a.resume(text("drugi odabir"));
      await control.entered();
      control.open();
      expect((await first).kind).toBe("ready");
      expect((await second).kind).toBe("ready");
      await a.settled();
      expect((await rows(at)).at(-1)).toEqual(text("drugi odabir"));
      expect(a.snapshot()).toMatchObject({ state: "LOCAL_DURABLE", failure: null });
    }
  });

  it("r6: a read held past this tab's own newer read is read again, not a false stale", async () => {
    const at = scope();
    const real = journal(at);
    let armed = false;
    let open = () => {};
    let entered = () => {};
    let readDone = () => {};
    const held = new Promise<void>((resolve) => { entered = resolve; });
    const a = saver(patched(real, {
      // Held after it has read: its contents are older than what comes next.
      read: async (...args: Parameters<AtomicDexieJournal["read"]>) => {
        const contents = await real.read(...args);
        if (armed) {
          armed = false;
          const gate = new Promise<void>((resolve) => { open = resolve; });
          entered();
          await gate;
        } else {
          readDone();
        }
        return contents;
      },
    }));
    const nextRead = () => new Promise<void>((resolve) => { readDone = resolve; })
      .then(() => new Promise((resolve) => setImmediate(resolve)));
    const b = saver(journal(at));
    await Promise.all([a.load(), b.load()]);
    armed = true;
    const old = a.load();
    await held;
    await type(b, "B1");
    expect(await a.load()).toEqual({ kind: "recovery", reason: "stale", document: text("B1") });
    // The resume reads the shown sequence and is ready before the held read
    // returns, so the held read is behind this saver's own sequence.
    const read = nextRead();
    const resumed = a.resume(text("A"));
    await read;
    open();
    expect((await old).kind).toBe("ready");
    expect((await resumed).kind).toBe("ready");
    await a.settled();
    expect((await rows(at)).at(-1)).toEqual(text("A"));
    expect(a.snapshot()).toMatchObject({ state: "LOCAL_DURABLE", failure: null });
  });

  it("r6: a read held from before a stale read never lifts the halt or shows older text", async () => {
    const at = scope();
    const real = journal(at);
    let armed = false;
    let open = () => {};
    let entered = () => {};
    const held = new Promise<void>((resolve) => { entered = resolve; });
    const a = saver(patched(real, {
      // Held after it has read: its contents are older than what comes next.
      read: async (...args: Parameters<AtomicDexieJournal["read"]>) => {
        const contents = await real.read(...args);
        if (armed) {
          armed = false;
          const gate = new Promise<void>((resolve) => { open = resolve; });
          entered();
          await gate;
        }
        return contents;
      },
    }));
    const b = saver(journal(at));
    await Promise.all([a.load(), b.load()]);
    armed = true;
    const old = a.load();
    await held;
    await type(b, "B1");
    expect(await a.load()).toEqual({ kind: "recovery", reason: "stale", document: text("B1") });
    open();
    expect(await old).toEqual({ kind: "recovery", reason: "stale", document: text("B1") });
    expect(a.snapshot()).toMatchObject({ state: "ERROR", failure: "stale" });
    expect(await a.resume(text("A"))).toEqual({ kind: "ready", document: text("B1") });
    await a.settled();
    expect((await rows(at)).at(-1)).toEqual(text("A"));
  });

  it("r6: a held read overtaken twice reads again until it is current (#206 Codex r4240797922)", async () => {
    const at = scope();
    const real = journal(at);
    let armed = false;
    let open = () => {};
    let entered = () => {};
    const a = saver(patched(real, {
      // Held after it has read: its contents are older than what comes next.
      read: async (...args: Parameters<AtomicDexieJournal["read"]>) => {
        const contents = await real.read(...args);
        if (armed) {
          armed = false;
          const gate = new Promise<void>((resolve) => { open = resolve; });
          entered();
          await gate;
        }
        return contents;
      },
    }));
    const hold = () => {
      armed = true;
      return new Promise<void>((resolve) => { entered = resolve; });
    };
    const b = saver(journal(at));
    await Promise.all([a.load(), b.load()]);
    let held = hold();
    const old = a.load();
    await held;
    await type(b, "B1");
    expect(await a.load()).toEqual({ kind: "recovery", reason: "stale", document: text("B1") });
    // The held read is behind and reads again; that read is held in turn
    // while another writer and a third load move past it.
    held = hold();
    open();
    await held;
    await type(b, "B2");
    expect(await a.load()).toEqual({ kind: "recovery", reason: "stale", document: text("B2") });
    open();
    expect(await old).toEqual({ kind: "recovery", reason: "stale", document: text("B2") });
    expect(a.snapshot()).toMatchObject({ state: "ERROR", failure: "stale" });
    expect(await a.resume(text("A"))).toEqual({ kind: "ready", document: text("B2") });
    await a.settled();
    expect((await rows(at)).at(-1)).toEqual(text("A"));
  });

  // #206 Codex r4240797922: a retry needs `seen` to have grown past what it
  // read, and only a read that returned grows it, so retries are bounded.
  it("r6: a journal that went back is read once more, not for ever", async () => {
    const at = scope();
    const real = journal(at);
    let calls = 0;
    let back: Awaited<ReturnType<AtomicDexieJournal["read"]>> | null = null;
    const a = saver(patched(real, {
      read: async (...args: Parameters<AtomicDexieJournal["read"]>) => {
        calls += 1;
        return back ?? await real.read(...args);
      },
    }));
    const b = saver(journal(at));
    await b.load();
    await type(b, "B1");
    const older = await real.read(DOC);
    await type(b, "B2");
    await a.load();
    back = older;
    calls = 0;
    expect((await a.load()).kind).toBe("recovery");
    expect(calls).toBe(2);
  });

  it("r6: held reads overtaken while the journal keeps growing all end on the newest text", async () => {
    const at = scope();
    const real = journal(at);
    let calls = 0;
    let holding = true;
    const gates: Array<() => void> = [];
    const a = saver(patched(real, {
      read: async (...args: Parameters<AtomicDexieJournal["read"]>) => {
        calls += 1;
        const contents = await real.read(...args);
        if (holding) await new Promise<void>((resolve) => { gates.push(resolve); });
        return contents;
      },
    }));
    const b = saver(journal(at));
    await b.load();
    holding = false;
    await a.load();
    holding = true;
    calls = 0;
    const loads: Promise<LoadResult>[] = [];
    for (const value of ["B1", "B2", "B3"]) {
      loads.push(a.load());
      while (gates.length < loads.length) await new Promise((resolve) => setImmediate(resolve));
      await type(b, value);
    }
    holding = false;
    const results: LoadResult[] = [];
    for (const index of [2, 1, 0]) {
      gates[index]!();
      results.push(await loads[index]!);
    }
    const stale = (value: string) => ({ kind: "recovery", reason: "stale", document: text(value) });
    expect(results).toEqual([stale("B2"), stale("B3"), stale("B3")]);
    expect(calls).toBe(5);
  });

  const badSeqs: [string, unknown][] = [
    ["NaN", Number.NaN], ["Infinity", Number.POSITIVE_INFINITY], ["-1", -1], ["1.5", 1.5],
    ["MAX_SAFE_INTEGER + 1", Number.MAX_SAFE_INTEGER + 1], ["the string \"1\"", "1"],
  ];
  for (const [name, bad] of badSeqs) it(`r6: a ${name} sequence read as corrupt never stops a later held read from reading again (#206 qa206j VAŽNO)`, async () => {
    const at = scope();
    const real = journal(at);
    let armed = false;
    let open = () => {};
    let entered = () => {};
    const held = new Promise<void>((resolve) => { entered = resolve; });
    const target = saver(patched(real, {
      // Held after it has read: its contents are older than what comes next.
      read: async (...args: Parameters<AtomicDexieJournal["read"]>) => {
        const contents = await real.read(...args);
        if (armed) {
          armed = false;
          const gate = new Promise<void>((resolve) => { open = resolve; });
          entered();
          await gate;
        }
        return contents;
      },
    }));
    const writer = saver(journal(at));
    await writer.load();
    await type(writer, "staro");
    expect((await target.load()).kind).toBe("ready");
    const db = (real as unknown as { db: Dexie }).db;
    await db.table("meta").update(DOC, { localSeq: bad });
    expect(await target.load()).toEqual({ kind: "recovery", reason: "corrupt", document: null });
    await db.table("meta").update(DOC, { localSeq: 1 });
    armed = true;
    const older = target.load();
    await held;
    await type(writer, "novo");
    const stale = { kind: "recovery", reason: "stale", document: text("novo") };
    expect(await target.load()).toEqual(stale);
    open();
    expect(await older).toEqual(stale);
    await target.settled();
    expect(target.snapshot()).toMatchObject({ state: "ERROR", failure: "stale" });
  });

  // #206 qa206k VAŽNO: valid sequences the rows contradict, and the values a
  // weaker sequence guard would let through.
  const refusedSeqs: [string, unknown][] = [
    ["3", 3], ["999", 999], ["MAX_SAFE_INTEGER", Number.MAX_SAFE_INTEGER], ["Infinity", Number.POSITIVE_INFINITY],
    ["1.5", 1.5], ["MAX_SAFE_INTEGER + 1", Number.MAX_SAFE_INTEGER + 1],
  ];
  for (const [name, bad] of refusedSeqs) it(`r6: a ${name} sequence refused as corrupt never lets a held retry undo a newer recovery (#206 qa206k VAŽNO)`, async () => {
    const at = scope();
    const real = journal(at);
    let armed = 0;
    let open = () => {};
    let entered = () => {};
    const held = new Promise<void>((resolve) => { entered = resolve; });
    const target = saver(patched(real, {
      // The second read that still sees the old text is held after reading.
      read: async (...args: Parameters<AtomicDexieJournal["read"]>) => {
        const contents = await real.read(...args);
        if (armed > 0 && contents.meta?.localSeq === 1 && ++armed === 3) {
          const gate = new Promise<void>((resolve) => { open = resolve; });
          entered();
          await gate;
        }
        return contents;
      },
    }));
    const writer = saver(journal(at));
    await writer.load();
    await type(writer, "staro");
    expect((await target.load()).kind).toBe("ready");
    const db = (real as unknown as { db: Dexie }).db;
    await db.table("meta").update(DOC, { localSeq: bad });
    expect(await target.load()).toEqual({ kind: "recovery", reason: "corrupt", document: null });
    await db.table("meta").update(DOC, { localSeq: 1 });
    armed = 1;
    const older = target.load();
    await Promise.race([held, older]);
    await type(writer, "novo");
    const stale = { kind: "recovery", reason: "stale", document: text("novo") };
    expect(await target.load()).toEqual(stale);
    open();
    await older;
    await target.settled();
    expect(target.snapshot()).toMatchObject({ state: "ERROR", failure: "stale" });
  });

  for (const [name, bad] of refusedSeqs) it(`r6: a held read that saw a ${name} sequence reads again rather than halt over a newer recovery (#206 qa206k VAŽNO)`, async () => {
    const at = scope();
    const real = journal(at);
    let armed = false;
    let open = () => {};
    let entered = () => {};
    const held = new Promise<void>((resolve) => { entered = resolve; });
    const target = saver(patched(real, {
      read: async (...args: Parameters<AtomicDexieJournal["read"]>) => {
        const contents = await real.read(...args);
        if (armed) {
          armed = false;
          const gate = new Promise<void>((resolve) => { open = resolve; });
          entered();
          await gate;
        }
        return contents;
      },
    }));
    const writer = saver(journal(at));
    await writer.load();
    await type(writer, "staro");
    expect((await target.load()).kind).toBe("ready");
    const db = (real as unknown as { db: Dexie }).db;
    await db.table("meta").update(DOC, { localSeq: bad });
    armed = true;
    const older = target.load();
    await held;
    await db.table("meta").update(DOC, { localSeq: 1 });
    await type(writer, "novo");
    const stale = { kind: "recovery", reason: "stale", document: text("novo") };
    expect(await target.load()).toEqual(stale);
    open();
    expect(await older).toEqual(stale);
    await target.settled();
    expect(target.snapshot()).toMatchObject({ state: "ERROR", failure: "stale" });
  });

  it("r6: settled() called between two resumes waits for both, not for the first one's end (#206 qa206j MANJE)", async () => {
    const at = scope();
    const { a, b } = await staleTab(at);
    await type(b, "B2");
    let fired = false;
    let done = false;
    let second: Promise<LoadResult> | undefined;
    // After the first resume's read is stale, before that resume has ended.
    a.subscribe((s) => {
      if (fired || s.state !== "ERROR") return;
      fired = true;
      queueMicrotask(() => queueMicrotask(() => {
        void a.settled().then(() => { done = true; });
        second = a.resume(text("drugi odabir"));
      }));
    });
    expect(await a.resume(text("prvi odabir"))).toEqual({ kind: "recovery", reason: "stale", document: text("B2") });
    expect(second).toBeDefined();
    expect((await second!).kind).toBe("ready");
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
    expect(done).toBe(true);
    expect((await rows(at)).at(-1)).toEqual(text("drugi odabir"));
  });

  it("r6: text proposed while a failed read halted the saver is written by the next ready reload", async () => {
    const at = scope();
    const real = journal(at);
    let reads = 0;
    let writes = 0;
    const target = saver(patched(real, {
      read: (...args: Parameters<AtomicDexieJournal["read"]>) => (reads += 1) === 2
        ? Promise.reject(Object.assign(new Error("no idb"), { name: "MissingAPIError" }))
        : real.read(...args),
      saveLocal: (...args: Parameters<AtomicDexieJournal["saveLocal"]>) => {
        writes += 1;
        return real.saveLocal(...args);
      },
    }));
    expect((await target.load()).kind).toBe("ready");
    await type(target, "prije greške");
    expect(await target.load()).toEqual({ kind: "unavailable" });
    const before = writes;
    target.edit();
    await target.propose(text("za vrijeme greške"));
    expect(writes).toBe(before);
    expect(target.snapshot()).toMatchObject({ state: "ERROR", failure: "unavailable" });
    expect((await target.load()).kind).toBe("ready");
    await target.settled();
    expect((await rows(at)).at(-1)).toEqual(text("za vrijeme greške"));
    expect(target.snapshot()).toMatchObject({ state: "LOCAL_DURABLE", failure: null });
  });
});

describe("LocalDocumentSaver: a halt racing a ready read (#206 qa206d)", () => {
  const closed = () => Object.assign(new Error("closed"), { name: "DatabaseClosedError" });
  const quota = () => Object.assign(new Error("full"), { name: "QuotaExceededError" });
  /** Lets every pending promise callback and macrotask run. */
  const drained = async () => {
    for (let i = 0; i < 100; i += 1) await new Promise((resolve) => setImmediate(resolve));
  };
  function plain(doc: CanonicalDocument | null | undefined): string {
    const node = doc?.nodes[0];
    return node && "children" in node ? node.children.map((c) => ("text" in c ? c.text : "")).join("") : "";
  }

  // `delay` microtasks after resume()'s ready read, the read of an
  // overlapping load() fails and halts the saver: before (0, 1) or after the
  // chosen text was queued, the choice must reach the journal.
  for (const delay of [0, 1, 2, 3, 5, 10, 20]) {
    it(`V-1 (D1, delay ${delay}): resume()'s choice survives an overlapping load() failing after its ready read`, async () => {
      const at = scope();
      const real = journal(at);
      let split = false;
      let calls = 0;
      let failLoad = () => {};
      const a = saver(patched(real, {
        read: (id: string) => {
          if (!split) return real.read(id);
          calls += 1;
          if (calls === 1) return new Promise((_, reject) => { failLoad = () => reject(closed()); });
          return real.read(id).then((contents) => {
            let later = Promise.resolve();
            for (let i = 0; i < delay; i += 1) later = later.then(() => undefined);
            void later.then(() => failLoad());
            return contents;
          });
        },
      }));
      await a.load();
      await type(a, "prvi");
      const b = saver(journal(at));
      await b.load();
      await type(b, "tuđi");
      await type(a, "moj noviji");
      expect(await a.load()).toMatchObject({ kind: "recovery", reason: "stale" });
      split = true;
      const overlapping = a.load();
      const resumed = a.resume(text("moj noviji"));
      expect(await overlapping).toEqual({ kind: "unavailable" });
      expect((await resumed).kind).toBe("ready");
      split = false;
      await a.settled();
      expect(a.snapshot()).toMatchObject({ state: "ERROR", failure: "unavailable" });
      expect((await a.load()).kind).toBe("ready");
      await a.settled();
      await drained();
      expect(plain((await journal(at).read(DOC)).snapshot?.document)).toBe("moj noviji");
      expect(a.snapshot()).toMatchObject({ state: "LOCAL_DURABLE", failure: null });
      const fresh = await saver(journal(at)).load();
      expect(fresh.kind === "ready" && plain(fresh.document)).toBe("moj noviji");
    });
  }

  it("load(): text held while halted survives a second load() failing after a ready one", async () => {
    const at = scope();
    const real = journal(at);
    let reads = 0;
    let failFirst = () => {};
    const target = saver(patched(real, {
      read: (id: string) => {
        reads += 1;
        if (reads === 2) return Promise.reject(closed());
        if (reads === 3) return new Promise((_, reject) => { failFirst = () => reject(closed()); });
        if (reads === 4) return real.read(id).then((contents) => { void Promise.resolve().then(() => failFirst()); return contents; });
        return real.read(id);
      },
    }));
    expect((await target.load()).kind).toBe("ready");
    await type(target, "prije");
    expect(await target.load()).toEqual({ kind: "unavailable" });
    await type(target, "za vrijeme greške");
    const first = target.load();
    const second = target.load();
    expect((await second).kind).toBe("ready");
    expect(await first).toEqual({ kind: "unavailable" });
    await target.settled();
    expect(target.snapshot()).toMatchObject({ state: "ERROR", failure: "unavailable" });
    expect(plain((await journal(at).read(DOC)).snapshot?.document)).toBe("prije");
    expect((await target.load()).kind).toBe("ready");
    await target.settled();
    expect(plain((await journal(at).read(DOC)).snapshot?.document)).toBe("za vrijeme greške");
    expect(target.snapshot()).toMatchObject({ state: "LOCAL_DURABLE", failure: null });
  });

  it("M-1 (D2): resume() whose text a same-gen proposal already wrote shows it saved", async () => {
    const at = scope();
    const real = journal(at);
    let mode: "ok" | "quota" | "gate" = "ok";
    let open = () => {};
    const a = saver(patched(real, {
      saveLocal: async (...args: Parameters<AtomicDexieJournal["saveLocal"]>) => {
        if (mode === "quota") throw quota();
        if (mode === "gate") {
          mode = "ok";
          await new Promise<void>((resolve) => { open = resolve; });
        }
        return real.saveLocal(...args);
      },
    }));
    await a.load();
    await type(a, "prvi");
    mode = "quota";
    await type(a, "drugi");
    expect(a.snapshot().failure).toBe("quota");
    expect(await a.load()).toMatchObject({ kind: "recovery", reason: "unsaved" });
    mode = "gate";
    a.edit();
    const written = a.propose(text("drugi"));
    await drained();
    const states = record(a);
    const resumed = a.resume(text("drugi"));
    // The editor's debounce fires after the click, at the choice's gen.
    const proposed = a.propose(text("drugi"));
    open();
    expect((await resumed).kind).toBe("ready");
    await written;
    await proposed;
    await a.settled();
    await drained();
    expect(plain((await journal(at).read(DOC)).snapshot?.document)).toBe("drugi");
    expect(states.at(-1)?.state).toBe("LOCAL_DURABLE");
    expect(a.snapshot()).toMatchObject({ state: "LOCAL_DURABLE", failure: null });
  });
});

describe("LocalDocumentSaver: a journal whose rows disagree (#206 qa206e V-1)", () => {
  type Damage = (db: Dexie) => Promise<unknown>;
  /** Two saves, then one damage straight on the tables, as storage damage would. */
  async function damaged(damage: Damage): Promise<{ real: AtomicDexieJournal; db: Dexie }> {
    const real = journal(scope());
    const first = saver(real);
    await first.load();
    await type(first, "starije");
    await type(first, "najnovije");
    const db = (real as unknown as { db: Dexie }).db;
    await damage(db);
    return { real, db };
  }
  const cases: [string, Damage][] = [
    ["(a) a snapshot older than the newest pending row", (db) =>
      db.table("snapshots").update(DOC, { document: text("starije") })],
    ["(b) pending rows without snapshot and meta", async (db) => {
      await db.table("snapshots").delete(DOC);
      await db.table("meta").delete(DOC);
    }],
    ["(c) a pending row of an unknown kind", (db) =>
      db.table("pending").update([DOC, 2], { "tx.kind": "UNKNOWN_SYNTHETIC" })],
    ["an unknown meta state", (db) => db.table("meta").update(DOC, { state: "UNKNOWN_SYNTHETIC" })],
    ["a negative local sequence", (db) => db.table("meta").update(DOC, { localSeq: -1 })],
    ["a pending row past the recorded sequence", (db) => db.table("meta").update(DOC, { localSeq: 1 })],
    // #206 reviewB: each case below is caught by one condition alone.
    ["a fractional local sequence with no pending rows", async (db) => {
      await db.table("pending").where("documentId").equals(DOC).delete();
      await db.table("meta").update(DOC, { localSeq: 2.5 });
    }],
    ["a negative local sequence with no pending rows", async (db) => {
      await db.table("pending").where("documentId").equals(DOC).delete();
      await db.table("meta").update(DOC, { localSeq: -1 });
    }],
    ["a pending row with a fractional sequence", async (db) => {
      const row = await db.table("pending").get([DOC, 1]);
      await db.table("pending").delete([DOC, 1]);
      await db.table("pending").put({ ...row, localSeq: 1.5 });
    }],
    ["a pending row at sequence zero", async (db) => {
      const row = await db.table("pending").get([DOC, 1]);
      await db.table("pending").delete([DOC, 1]);
      await db.table("pending").put({ ...row, localSeq: 0 });
    }],
    ["a pending row whose transaction id is not text", (db) =>
      db.table("pending").update([DOC, 1], { "tx.clientTransactionId": 42 })],
    ["an invalid document in a pending row before the newest", (db) =>
      db.table("pending").update([DOC, 1], { "tx.document": { synthetic: true } })],
    ["a recorded sequence past the newest pending row", (db) =>
      db.table("meta").update(DOC, { localSeq: 3 })],
    // #206 Codex r4240541630: rows the commit request refuses would block the drain for ever.
    ["a pending row whose transaction is null", (db) =>
      db.table("pending").update([DOC, 1], { tx: null })],
    ["a pending row with an empty transaction id", (db) =>
      db.table("pending").update([DOC, 1], { "tx.clientTransactionId": "" })],
    ["a pending row with a transaction id over 128 characters", (db) =>
      db.table("pending").update([DOC, 1], { "tx.clientTransactionId": "t".repeat(129) })],
    ["a pending row with an invalid base revision", (db) =>
      db.table("pending").update([DOC, 1], { "tx.baseRevision": -1 })],
    ["a pending row whose document exceeds the size limit", (db) =>
      db.table("pending").update([DOC, 1], { "tx.document": text("x".repeat(MAX_DOCUMENT_BYTES)) })],
    // #206 Codex r4240617145: the next write would inherit a base every save refuses.
    ["a snapshot with a negative revision", (db) => db.table("snapshots").update(DOC, { revision: -1 })],
    ["a snapshot with a fractional revision", (db) => db.table("snapshots").update(DOC, { revision: 0.5 })],
    // #206 Codex r4240729191: IndexedDB stores a BigInt that JSON cannot serialise.
    ["a pending row that cannot be serialised", (db) =>
      db.table("pending").update([DOC, 1], { "tx.createdAt": 1n })],
    ["a pending row with a cycle", async (db) => {
      const row = await db.table("pending").get([DOC, 1]);
      row.tx.self = row.tx;
      await db.table("pending").put(row);
    }],
    ["a recorded sequence stored as a BigInt", (db) => db.table("meta").update(DOC, { localSeq: 1n })],
    ["a snapshot document holding a BigInt", (db) =>
      db.table("snapshots").update(DOC, { "document.schemaVersion": 1n })],
    ["a snapshot document stored as a Map", (db) =>
      db.table("snapshots").update(DOC, { document: new Map([["nodes", []]]) })],
    // #206 Codex r4240797929: text JCS or jsonb refuses would sit as LOCAL_DURABLE for ever.
    ["a newest row and snapshot holding a lone surrogate", async (db) => {
      await db.table("pending").update([DOC, 2], { "tx.document": text("a\uD800b") });
      await db.table("snapshots").update(DOC, { document: text("a\uD800b") });
    }],
    ["a newest row and snapshot holding NUL", async (db) => {
      await db.table("pending").update([DOC, 2], { "tx.document": text("a\u0000b") });
      await db.table("snapshots").update(DOC, { document: text("a\u0000b") });
    }],
    ["an older pending row holding NUL", (db) =>
      db.table("pending").update([DOC, 1], { "tx.document": text("a\u0000b") })],
    // #206 qa206i MANJE: a failure reason restore cannot name.
    ...([
      ["a BigInt", 1n], ["a Date", new Date(0)], ["a Map", new Map()], ["NaN", Number.NaN],
      ["an unknown reason", "UNKNOWN_SYNTHETIC"], ["a long string", "q".repeat(10_000)],
    ] as [string, unknown][]).map(([what, value]): [string, Damage] =>
      [`a meta failure reason stored as ${what}`, (db) => db.table("meta").update(DOC, { lastError: value })]),
    ["a meta failure reason with a cycle", async (db) => {
      const cycle: Record<string, unknown> = {};
      cycle.self = cycle;
      await db.table("meta").update(DOC, { lastError: cycle });
    }],
  ];
  it("17: a snapshot without meta or pending rows is corrupt, never shown as saved (#206 qa206k MANJE)", async () => {
    const { real } = await damaged(async (db) => {
      await db.table("pending").clear();
      await db.table("meta").delete(DOC);
    });
    const before = await real.read(DOC);
    expect(before.snapshot).not.toBeNull();
    expect(before.meta).toBeNull();
    expect(before.pending).toEqual([]);
    const fresh = saver(real);
    expect(await fresh.load()).toEqual({ kind: "recovery", reason: "corrupt", document: null });
    expect(fresh.snapshot()).toMatchObject({ state: "RECOVERY_REQUIRED", failure: "corrupt" });
    await type(fresh, "zamjena");
    expect(await real.read(DOC)).toEqual(before);
  });

  for (const [name, damage] of cases) {
    it(`17: ${name} is corrupt, never older or empty text shown as saved, and nothing is written`, async () => {
      const { real } = await damaged(damage);
      const before = await real.read(DOC);
      const fresh = saver(real);
      expect(await fresh.load()).toEqual({ kind: "recovery", reason: "corrupt", document: null });
      expect(fresh.snapshot()).toMatchObject({ state: "RECOVERY_REQUIRED", failure: "corrupt" });
      await type(fresh, "zamjena");
      expect(fresh.snapshot()).toMatchObject({ state: "RECOVERY_REQUIRED", failure: "corrupt" });
      expect(await real.read(DOC)).toEqual(before);
    });
  }

  // #206 Codex r4240797929: the storable check refuses only what the server refuses.
  function atLimit(): CanonicalDocument {
    return text("x".repeat(MAX_DOCUMENT_BYTES - documentByteLength(text("x")) + 1));
  }
  const valid: [string, CanonicalDocument][] = [
    ["an emoji and other valid surrogate pairs", text("ok \u{1F600} \u{1D49C} \u{1F469}\u200D\u{1F4BB}")],
    ["combining marks", text("e\u0301 c\u030C a\u0328")],
    ["an empty document", text("")],
    ["a document exactly at the size limit", atLimit()],
  ];
  for (const [name, doc] of valid) {
    it(`17: a newest row and snapshot holding ${name} still load as saved`, async () => {
      if (name.includes("size limit")) expect(documentByteLength(doc)).toBe(MAX_DOCUMENT_BYTES);
      const { real } = await damaged(async (db) => {
        await db.table("pending").update([DOC, 2], { "tx.document": doc });
        await db.table("snapshots").update(DOC, { document: doc });
      });
      const fresh = saver(real);
      const loaded = await fresh.load();
      expect(loaded.kind === "ready" && documentsEqual(loaded.document, doc)).toBe(true);
      expect(fresh.snapshot()).toMatchObject({ state: "LOCAL_DURABLE", failure: null });
    });
  }

  it("17: a meta failure reason restore names still loads with the journal's text (#206 qa206i MANJE)", async () => {
    const { real } = await damaged((db) => db.table("meta").update(DOC, { lastError: "quota" }));
    const loaded = await saver(real).load();
    expect(loaded.kind === "ready" && documentsEqual(loaded.document, text("najnovije"))).toBe(true);
  });

  // "Newest pending row is the snapshot" holds only while rows remain: once an
  // ACK clears them (F-8), snapshot and meta alone are a whole journal.
  it("17: snapshot and meta with no pending rows, or with only the newest left, still load", async () => {
    for (const keep of [0, 1]) {
      const { real } = await damaged((db) =>
        db.table("pending").where("[documentId+localSeq]").between([DOC, 1], [DOC, 2 - keep], true, true).delete());
      expect((await real.read(DOC)).pending).toHaveLength(keep);
      const fresh = saver(real);
      const loaded = await fresh.load();
      expect(loaded.kind === "ready" && documentsEqual(loaded.document, text("najnovije"))).toBe(true);
      expect(fresh.snapshot()).toMatchObject({ state: "LOCAL_DURABLE", failure: null });
    }
  });
});

describe("LocalDocumentSaver: stored text (#197 attack 10)", () => {
  it("10: text saved with a lone surrogate or NUL reloads as saved, never as corrupt (#206 Codex r4240797929)", async () => {
    const at = scope();
    const target = saver(journal(at));
    await target.load();
    for (const value of ["a\uD800b", "\uDC00\uD800", "a\u0000b", "\u0000", "x\uD83D\u0000\uDE00y"]) {
      await type(target, value);
    }
    expect((await journal(at).read(DOC)).pending).toHaveLength(5);
    const fresh = saver(journal(at));
    expect((await fresh.load()).kind).toBe("ready");
    expect(fresh.snapshot()).toMatchObject({ state: "LOCAL_DURABLE", failure: null });
  });
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

describe("LocalDocumentSaver: listeners (#206 Codex r4240240768)", () => {
  it("a listener that throws neither stops the save nor hides its error", async () => {
    const at = scope();
    const target = saver(journal(at));
    await target.load();
    const states = record(target);
    const failure = new Error("izmišljeni kvar pretplatnika");
    target.subscribe((s) => { if (s.state === "SAVING_LOCAL") throw failure; });
    // Dexie also queues microtasks: they run as before, and only what one
    // throws is caught here instead of failing the run.
    const rethrown: unknown[] = [];
    const queue = globalThis.queueMicrotask.bind(globalThis);
    const spy = vi.spyOn(globalThis, "queueMicrotask").mockImplementation((callback) => {
      queue(() => { try { callback(); } catch (error) { rethrown.push(error); } });
    });
    try {
      await type(target, "spremljeno unatoč kvaru");
    } finally {
      spy.mockRestore();
    }
    expect(rethrown).toEqual([failure]);
    expect(states.map((s) => s.state)).toEqual(["SAVING_LOCAL", "LOCAL_DURABLE"]);
    expect((await journal(at).read(DOC)).snapshot!.document).toEqual(text("spremljeno unatoč kvaru"));
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

describe("LocalDocumentSaver: settled() during a reload (#206 Codex r4240541632)", () => {
  /** The real journal whose second `read()` waits for `release()`, then reads or throws. */
  function slowSecondRead(real: AtomicDexieJournal, fails = false) {
    let reads = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fake = patched(real, {
      read: async (...args: Parameters<AtomicDexieJournal["read"]>) => {
        if ((reads += 1) === 2) {
          await gate;
          if (fails) throw Object.assign(new Error("izmišljeni kvar"), { name: "OpenFailedError" });
        }
        return real.read(...args);
      },
    });
    return { fake, release: () => release() };
  }
  const turns = async (count: number) => {
    for (let i = 0; i < count; i += 1) await new Promise((resolve) => setImmediate(resolve));
  };

  it("pagehide: settled() waits for text proposed during a reload until it is in the journal", async () => {
    const at = scope();
    const slow = slowSecondRead(journal(at));
    const target = saver(slow.fake);
    await target.load();
    await type(target, "prvo");
    const reload = target.load();
    target.edit();
    void target.propose(text("drugo"));
    let done = false;
    const settled = target.settled().then(() => { done = true; });
    await turns(5);
    expect(done).toBe(false);
    slow.release();
    await settled;
    expect((await journal(at).read(DOC)).snapshot?.document).toEqual(text("drugo"));
    await reload;
  });

  it("settled() during a reload that waits for a write in flight resolves with both", async () => {
    const at = scope();
    const real = journal(at);
    let open = () => {};
    let gate = Promise.resolve();
    const target = saver(patched(real, {
      saveLocal: (...args: Parameters<AtomicDexieJournal["saveLocal"]>) =>
        gate.then(() => real.saveLocal(...args)),
    }));
    await target.load();
    gate = new Promise<void>((resolve) => { open = resolve; });
    target.edit();
    const flight = target.propose(text("prvo"));
    const reload = target.load();
    const settled = target.settled();
    await turns(5);
    open();
    await Promise.all([flight, reload, settled]);
    expect((await reload).kind).toBe("ready");
    expect(target.snapshot()).toMatchObject({ state: "LOCAL_DURABLE", failure: null });
  });

  it("settled() ends when the reload fails, with the candidate kept unwritten", async () => {
    const at = scope();
    const slow = slowSecondRead(journal(at), true);
    const target = saver(slow.fake);
    await target.load();
    await type(target, "prvo");
    const reload = target.load();
    target.edit();
    void target.propose(text("drugo"));
    const settled = target.settled();
    slow.release();
    await settled;
    expect(await reload).toEqual({ kind: "unavailable" });
    expect(target.snapshot().state).not.toBe("LOCAL_DURABLE");
    expect((await journal(at).read(DOC)).snapshot?.document).toEqual(text("prvo"));
  });

  // #206 qa206g: `reading` ends before `resume()` queues the chosen text.
  it("settled() during resume() waits until the chosen text is in the journal", async () => {
    const at = scope();
    const real = journal(at);
    let full = false;
    let readGate: Promise<void> | null = null;
    let writeGate: Promise<void> | null = null;
    let openRead = () => {};
    let openWrite = () => {};
    let writeStarted = false;
    const target = saver(patched(real, {
      read: async (...args: Parameters<AtomicDexieJournal["read"]>) => {
        if (readGate) await readGate;
        return real.read(...args);
      },
      saveLocal: async (...args: Parameters<AtomicDexieJournal["saveLocal"]>) => {
        if (full) throw Object.assign(new Error("full"), { name: "QuotaExceededError" });
        if (writeGate) { writeStarted = true; await writeGate; }
        return real.saveLocal(...args);
      },
    }));
    await target.load();
    await type(target, "staro");
    full = true;
    await type(target, "odabrano");
    expect((await target.load()).kind).toBe("recovery");
    full = false;
    readGate = new Promise<void>((resolve) => { openRead = resolve; });
    writeGate = new Promise<void>((resolve) => { openWrite = resolve; });
    const resumed = target.resume(text("odabrano"));
    let done = false;
    const settled = target.settled().then(() => { done = true; });
    openRead();
    await turns(10);
    expect(writeStarted).toBe(true);
    expect(done).toBe(false);
    openWrite();
    await settled;
    expect((await journal(at).read(DOC)).snapshot?.document).toEqual(text("odabrano"));
    expect((await resumed).kind).toBe("ready");
  });

  // #206 qa206i VAŽNO: a listener runs inside `save()`, before its write.
  function heldWrite(real: AtomicDexieJournal) {
    let open = () => {};
    let gate: Promise<void> | null = null;
    const started: string[] = [];
    const fake = patched(real, {
      saveLocal: async (...args: Parameters<AtomicDexieJournal["saveLocal"]>) => {
        const tx = args[1] as { document: CanonicalDocument };
        started.push(JSON.stringify(tx.document));
        if (gate) await gate;
        return real.saveLocal(...args);
      },
    });
    return {
      fake, started,
      hold: () => { gate = new Promise<void>((resolve) => { open = resolve; }); },
      open: () => { gate = null; open(); },
    };
  }

  it("settled() waits for a write proposed on its own until it is in the journal (#206 qa206i MANJE)", async () => {
    const at = scope();
    const held = heldWrite(journal(at));
    const target = saver(held.fake);
    await target.load();
    held.hold();
    target.edit();
    void target.propose(text("samo"));
    let done = false;
    const settled = target.settled().then(() => { done = true; });
    await turns(5);
    expect(held.started).toHaveLength(1);
    expect(done).toBe(false);
    held.open();
    await settled;
    expect((await journal(at).read(DOC)).snapshot?.document).toEqual(text("samo"));
  });

  it("A: settled() called by a SAVING_LOCAL listener waits for that write", async () => {
    const at = scope();
    const held = heldWrite(journal(at));
    const target = saver(held.fake);
    await target.load();
    await type(target, "staro");
    held.hold();
    let done = false;
    let inner: Promise<void> | null = null;
    target.subscribe((s) => {
      if (s.state === "SAVING_LOCAL" && !inner) inner = target.settled().then(() => { done = true; });
    });
    target.edit();
    void target.propose(text("novo"));
    await turns(5);
    expect(inner).not.toBeNull();
    expect(done).toBe(false);
    held.open();
    await inner;
    expect((await journal(at).read(DOC)).snapshot?.document).toEqual(text("novo"));
  });

  it("B: text a SAVING_LOCAL listener proposes is written after, never beside, the write in flight", async () => {
    const at = scope();
    const held = heldWrite(journal(at));
    const target = saver(held.fake);
    await target.load();
    held.hold();
    let proposed = false;
    target.subscribe((s) => {
      if (s.state !== "SAVING_LOCAL" || proposed) return;
      proposed = true;
      target.edit();
      void target.propose(text("novije"));
    });
    target.edit();
    void target.propose(text("starije"));
    let done = false;
    const settled = target.settled().then(() => { done = true; });
    await turns(5);
    expect(held.started).toEqual([JSON.stringify(text("starije"))]);
    expect(done).toBe(false);
    held.open();
    await settled;
    expect(held.started).toEqual([JSON.stringify(text("starije")), JSON.stringify(text("novije"))]);
    const after = await journal(at).read(DOC);
    expect(after.snapshot?.document).toEqual(text("novije"));
    expect(after.pending.map((row) => row.localSeq)).toEqual([1, 2]);
    expect(target.snapshot()).toMatchObject({ state: "LOCAL_DURABLE", failure: null });
  });
});
