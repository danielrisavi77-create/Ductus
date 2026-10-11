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
  failureOf, LocalDocumentSaver, reasonOf, type SaverDeps, type SaverSnapshot,
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
