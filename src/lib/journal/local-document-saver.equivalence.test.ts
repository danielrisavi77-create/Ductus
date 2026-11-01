// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";

import { newNodeId, paragraphNode, textNode, type CanonicalDocument } from "../../domain/document";
import { journalKit, raw } from "../sync/evidence-test-kit";
import type { AtomicDexieJournal } from "./atomic-dexie-journal";
import { failureOf, LocalDocumentSaver } from "./local-document-saver";

/**
 * M0.1 (DAN-376, #1071): saver cases of the core port that had no Ductus
 * test (map: docs/engineering/prijenos-jezgre-M0.1-jednakovrijednost.md).
 * Every text here is invented.
 */

const DOC = "izmisljeni-dokument";
const kit = journalKit("f");
afterEach(kit.cleanup);
const now = () => new Date("2026-10-10T20:00:00.000Z");
let txSerial = 0;
const ids = { now, newTransactionId: () => `eq-tx-${(txSerial += 1)}` };

function nodeId(index: number) {
  return newNodeId(() => `aaaaaaaa-0000-4000-8000-${index.toString(16).padStart(12, "0")}`);
}
function text(value: string): CanonicalDocument {
  return { schemaVersion: 1, nodes: [paragraphNode(nodeId(1), value === "" ? [] : [textNode(value)])] };
}
function paragraphs(count: number, round: number): CanonicalDocument {
  return {
    schemaVersion: 1,
    nodes: Array.from({ length: count }, (_, i) =>
      paragraphNode(nodeId(i + 1), [textNode(`Odlomak ${i + 1}, verzija ${round}: ${"izmišljena riječ ".repeat(20).trim()}`)])),
  };
}
function patched(real: AtomicDexieJournal, over: Partial<AtomicDexieJournal>): AtomicDexieJournal {
  return Object.assign(Object.create(real) as AtomicDexieJournal, over);
}
async function type(target: LocalDocumentSaver, value: string) {
  target.edit();
  await target.propose(text(value));
}
const named = (name: string) => Object.assign(new Error(name), { name });

describe("M0.1 saver: failures", () => {
  it.each(["InvalidStateError", "MissingAPIError", "OpenFailedError"])("3: maps %s to unavailable", (name) => {
    expect(failureOf(named(name))).toBe("unavailable");
    expect(failureOf(Object.assign(new Error("wrapped"), { name: "AbortError", inner: { name } }))).toBe("unavailable");
  });

  it("18: an InvalidStateError during the write is ERROR unavailable, writes nothing and halts saving", async () => {
    const real = kit.open();
    let writes = 0;
    const target = new LocalDocumentSaver(patched(real, {
      saveLocal: async () => {
        writes += 1;
        throw named("InvalidStateError");
      },
    }), DOC, ids);
    await target.load();
    await type(target, "prvi pokušaj");
    expect(target.snapshot()).toMatchObject({ state: "ERROR", failure: "unavailable" });
    await type(target, "drugi pokušaj");
    expect(target.snapshot()).toMatchObject({ state: "ERROR", failure: "unavailable" });
    expect(writes).toBe(1);
    expect(await real.read(DOC)).toEqual({ snapshot: null, pending: [], meta: null });
  });

  it("47, 86: a journal that recorded ERROR loads, saves, and the save clears the ERROR", async () => {
    const scope = kit.nextScope();
    const first = kit.open(scope);
    await first.saveLocal(DOC, {
      kind: "REPLACE_DOCUMENT", clientTransactionId: "eq-before-error", baseRevision: 0,
      document: text("prije kvara"), createdAt: "2026-10-10T20:00:00.000Z",
    }, "2026-10-10T20:00:00.000Z", 0);
    await raw(first).table("meta").put({ documentId: DOC, localSeq: 1, state: "ERROR", lastError: "unknown" });

    const target = new LocalDocumentSaver(kit.open(scope), DOC, ids);
    expect(await target.load()).toMatchObject({ kind: "ready" });
    await type(target, "nakon kvara");
    expect(target.snapshot()).toMatchObject({ state: "LOCAL_DURABLE", failure: null });
    const after = await kit.open(scope).read(DOC);
    expect(after.meta).toEqual({ documentId: DOC, localSeq: 2, state: "LOCAL_DURABLE" });
    expect(after.snapshot?.document).toEqual(text("nakon kvara"));
  });

  it.each(["CONFLICT", "RECOVERY_REQUIRED"] as const)(
    "43: %s survives closing the tab: a new saver loads it as sticky recovery and writes nothing",
    async (state) => {
      const scope = kit.nextScope();
      const first = kit.open(scope);
      const writer = new LocalDocumentSaver(first, DOC, ids);
      await writer.load();
      await type(writer, "sačuvani tekst");
      await raw(first).table("meta").put({ documentId: DOC, localSeq: 1, state });
      const before = await first.read(DOC);
      first.close();

      const reopened = kit.open(scope);
      const target = new LocalDocumentSaver(reopened, DOC, ids);
      const loaded = await target.load();
      expect(loaded).toMatchObject({ kind: "recovery", reason: "sticky", document: text("sačuvani tekst") });
      expect(target.snapshot().state).toBe(state);
      await type(target, "");
      expect(target.snapshot().state).toBe(state);
      expect(await reopened.read(DOC)).toEqual(before);
    },
  );
});

describe("M0.1 saver: keys and cost", () => {
  it("15: without an injected generator every write gets its own fresh transaction id", async () => {
    const journal = kit.open();
    const target = new LocalDocumentSaver(journal, DOC, { now });
    await target.load();
    for (const value of ["jedan", "dva", "dva", "tri"]) await type(target, value);
    const keys = (await journal.read(DOC)).pending.map((row) => row.tx.clientTransactionId);
    expect(keys).toHaveLength(4);
    expect(new Set(keys).size).toBe(4);
    for (const key of keys) expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("24: ten saves of a 200-paragraph document stay well inside a coarse ceiling", async () => {
    const journal = kit.open();
    const target = new LocalDocumentSaver(journal, DOC, ids);
    await target.load();
    const started = performance.now();
    for (let round = 1; round <= 10; round += 1) {
      target.edit();
      await target.propose(paragraphs(200, round));
      expect(target.snapshot().state).toBe("LOCAL_DURABLE");
    }
    const elapsed = performance.now() - started;
    const saved = await journal.read(DOC);
    expect(saved.pending).toHaveLength(10);
    expect(saved.snapshot?.document).toEqual(paragraphs(200, 10));
    // fake-indexeddb in Node: a coarse bound on the cost per write, not a browser figure.
    expect(elapsed).toBeLessThan(5_000);
  });
});
