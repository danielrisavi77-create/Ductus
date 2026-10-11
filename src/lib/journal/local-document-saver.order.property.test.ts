// @vitest-environment node
/**
 * Random interleaving of one tab's reads with another tab's writes (#206
 * qa206k): reads held and released in any order, failing on the first read
 * of a load or on its retry, and the journal's meta damaged and restored in
 * between. An outcome is applied by the last read of its load; every step is
 * followed by enough IndexedDB tasks for whatever is not held to finish, so
 * a sequence of steps always runs the same way. Invariants:
 * (a) an outcome from the contents is never applied after one from a read
 *     started later;
 * (b) the last applied outcome, once settled, decides the state: a read
 *     that threw leaves ERROR, and LOCAL_DURABLE needs a last ready read of
 *     text the undamaged journal still holds.
 * All text here is synthetic.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { fc, test } from "@fast-check/vitest";
import { expect } from "vitest";
import Dexie from "dexie";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { newNodeId, paragraphNode, textNode, type CanonicalDocument } from "../../domain/document";
import { AtomicDexieJournal } from "./atomic-dexie-journal";
import { LocalDocumentSaver, type LoadResult } from "./local-document-saver";

const DOC = "order-document";
const P1 = newNodeId(() => "cccccccc-0000-4000-8000-000000000001");
const idb = { indexedDB, IDBKeyRange };
const caller = new AsyncLocalStorage<number>();
let serial = 0x7c00;

function text(value: string): CanonicalDocument {
  return { schemaVersion: 1, nodes: [paragraphNode(P1, [textNode(value)])] };
}
function plain(doc: CanonicalDocument | null | undefined): string {
  const node = doc?.nodes[0];
  return node && "children" in node ? node.children.map((c) => ("text" in c ? c.text : "")).join("") : "";
}
async function tick(): Promise<void> {
  for (let i = 0; i < 100; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

const op = fc.oneof(
  fc.record({ kind: fc.constant("write" as const) }),
  fc.record({ kind: fc.constant("load" as const), at: fc.nat(1), hold: fc.boolean(), fail: fc.boolean() }),
  fc.record({ kind: fc.constant("release" as const), which: fc.nat(3) }),
  fc.record({ kind: fc.constant("damage" as const) }),
  fc.record({ kind: fc.constant("restore" as const) }),
);
type Plan = { at: number; hold: boolean; fail: boolean };
type Read = { load: number; start: number; done: number; fail: boolean; text: string | null };

test.prop([fc.array(op, { minLength: 3, maxLength: 30 })], { numRuns: 4 * Number(process.env.FC_NUM_RUNS ?? 100) })(
  "an older read never applies over a newer outcome, and a settled tab shows what its last read applied (#206 qa206k)",
  async (ops) => {
    serial += 1;
    const name = serial.toString(16).padStart(64, "0");
    const real = new AtomicDexieJournal(name, idb);
    const other = new AtomicDexieJournal(name, idb);
    const db = (real as unknown as { db: Dexie }).db;
    const plans = new Map<number, Plan>();
    const tried = new Map<number, number>();
    const held: (() => void)[] = [];
    const reads: Read[] = [];
    let starts = 0;
    let clock = 0;
    const target = new LocalDocumentSaver(Object.assign(Object.create(real) as AtomicDexieJournal, {
      read: async (id: string) => {
        const load = caller.getStore() ?? 0;
        const n = tried.get(load) ?? 0;
        tried.set(load, n + 1);
        const plan = plans.get(load);
        const mine = plan && plan.at === n ? plan : null;
        const entry: Read = { load, start: ++starts, done: 0, fail: !!mine?.fail, text: null };
        reads.push(entry);
        const contents = await real.read(id);
        if (mine?.hold) await new Promise<void>((resolve) => held.push(resolve));
        entry.done = ++clock;
        if (entry.fail) throw Object.assign(new Error("closed"), { name: "DatabaseClosedError" });
        entry.text = contents.meta?.localSeq === 999 ? "#corrupt" : plain(contents.snapshot?.document);
        return contents;
      },
    }), DOC, {});
    const writer = new LocalDocumentSaver(other, DOC, {});
    try {
      await writer.load();
      writer.edit();
      await writer.propose(text("t0"));
      await caller.run(0, () => target.load());
      const loads: Promise<LoadResult>[] = [];
      let damaged: number | null = null;
      let written = 0;
      /** Reads started before the journal last changed. */
      let mutated = 0;
      for (const [i, step] of ops.entries()) {
        if (step.kind === "write" && damaged === null) {
          writer.edit();
          await writer.propose(text(`t${(written += 1)}`));
          mutated = starts;
        } else if (step.kind === "load") {
          plans.set(i + 1, step);
          loads.push(caller.run(i + 1, () => target.load()));
        } else if (step.kind === "release" && held.length > 0) {
          held.splice(step.which % held.length, 1)[0]();
        } else if (step.kind === "damage" && damaged === null) {
          damaged = (await db.table("meta").get(DOC)).localSeq;
          await db.table("meta").update(DOC, { localSeq: 999 });
          mutated = starts;
        } else if (step.kind === "restore" && damaged !== null) {
          await db.table("meta").update(DOC, { localSeq: damaged });
          damaged = null;
          mutated = starts;
        }
        await tick();
      }
      while (held.length > 0) { held.shift()!(); await tick(); }
      await Promise.all(loads);
      await target.settled();
      // The read that decided each load is its last; those were applied in `done` order.
      const last = new Map<number, Read>();
      for (const read of reads) last.set(read.load, read);
      const applied = [...last.values()].sort((x, y) => x.done - y.done);
      for (const [k, read] of applied.entries()) {
        if (read.fail) continue;
        for (const earlier of applied.slice(0, k)) expect(earlier.start).toBeLessThan(read.start);
      }
      const final = applied.at(-1)!;
      const shown = target.snapshot();
      if (final.fail) expect(shown).toMatchObject({ state: "ERROR", failure: "unavailable" });
      // A change the tab has not read yet it cannot know; after one more read it must.
      const durable = async (by: Read) => {
        const now = await real.read(DOC);
        expect(now.meta?.localSeq).not.toBe(999);
        expect(by.text).toBe(plain(now.snapshot?.document));
      };
      if (shown.state === "LOCAL_DURABLE" && final.start > mutated) await durable(final);
      await caller.run(-1, () => target.load());
      if (target.snapshot().state === "LOCAL_DURABLE") await durable(reads.at(-1)!);
    } finally {
      real.close();
      other.close();
      await new Dexie(`ductus-journal-v1-${name}`, idb).delete();
    }
  },
);
