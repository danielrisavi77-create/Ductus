// @vitest-environment node
/**
 * Random model of one to three tabs saving one document into one journal
 * (#206 qa206c). Each tab's writes may succeed, fail (quota, unknown, closed
 * store) or hang until released, a read may fail once or return late, and
 * loads (overlapping too), resumes, proposes and page reloads interleave
 * freely, with 0-12 IndexedDB tasks between steps. Four invariants hold
 * throughout:
 * 1. LOCAL_DURABLE only for text this tab wrote, or for a clean tab whose
 *    last read still saw the text it loaded;
 * 2. a successful write only ever replaces journal text this tab was shown;
 * 3. `stale` only after another tab committed past this tab's base;
 * 4. once every write is released and settled, no tab is left in
 *    SAVING_LOCAL, and a tab in LOCAL_DURABLE has its text in the journal.
 * All text here is synthetic.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { fc, test } from "@fast-check/vitest";
import { expect } from "vitest";
import Dexie from "dexie";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { documentsEqual, newNodeId, paragraphNode, textNode, type CanonicalDocument } from "../../domain/document";
import { AtomicDexieJournal } from "./atomic-dexie-journal";
import { LocalDocumentSaver, type LoadResult } from "./local-document-saver";

const DOC = "model-document";
const P1 = newNodeId(() => "bbbbbbbb-0000-4000-8000-000000000001");
const idb = { indexedDB, IDBKeyRange };
/** Which load or resume call a journal read belongs to. */
const caller = new AsyncLocalStorage<number>();
let serial = 0x7a00;

function text(value: string): CanonicalDocument {
  return { schemaVersion: 1, nodes: [paragraphNode(P1, value === "" ? [] : [textNode(value)])] };
}
function plain(doc: CanonicalDocument | null | undefined): string {
  const node = doc?.nodes[0];
  return node && "children" in node ? node.children.map((c) => ("text" in c ? c.text : "")).join("") : "";
}
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 1));
/** One IndexedDB task: a read or write needs several, so a step may end mid-way. */
const task = () => new Promise<void>((resolve) => setImmediate(resolve));

type Mode = "ok" | "quota" | "unknown" | "closed" | "gate";
const op = fc.oneof(
  { arbitrary: fc.record({ kind: fc.constant("edit" as const), tab: fc.nat(2) }), weight: 3 },
  { arbitrary: fc.record({ kind: fc.constant("propose" as const), tab: fc.nat(2) }), weight: 4 },
  { arbitrary: fc.record({ kind: fc.constant("load" as const), tab: fc.nat(2) }), weight: 3 },
  { arbitrary: fc.record({ kind: fc.constant("resume" as const), tab: fc.nat(2) }), weight: 4 },
  {
    arbitrary: fc.record({
      kind: fc.constant("mode" as const), tab: fc.nat(2),
      mode: fc.constantFrom<Mode>("ok", "ok", "quota", "quota", "unknown", "closed", "gate", "gate"),
    }),
    weight: 4,
  },
  { arbitrary: fc.record({ kind: fc.constant("readFail" as const), tab: fc.nat(2) }), weight: 1 },
  { arbitrary: fc.record({ kind: fc.constant("slowRead" as const), tab: fc.nat(2) }), weight: 2 },
  { arbitrary: fc.record({ kind: fc.constant("release" as const), tab: fc.nat(2) }), weight: 1 },
  { arbitrary: fc.record({ kind: fc.constant("tick" as const), tab: fc.nat(2) }), weight: 2 },
  { arbitrary: fc.record({ kind: fc.constant("reload" as const), tab: fc.nat(2) }), weight: 1 },
);
type Op = (typeof op extends fc.Arbitrary<infer T> ? T : never) & { wait?: number };
/** After each step 0-12 IndexedDB tasks pass, so reads and writes end between any two steps. */
const step = fc.tuple(op, fc.nat(12)).map(([o, wait]): Op => ({ ...o, wait }));

type Tab = {
  readonly id: number;
  readonly journal: AtomicDexieJournal;
  saver: LocalDocumentSaver;
  mode: Mode;
  readFails: boolean;
  /** The next read returns only on release, with what the journal held when it ran. */
  readSlow: boolean;
  gated: (() => void)[];
  writing: number;
  loading: Promise<void> | null;
  instanceLoaded: boolean;
  last: LoadResult | null;
  editor: string;
  edits: number;
  clean: boolean;
  loadedText: string;
  loadedAt: number;
  lastReadAt: number;
  /** Sequence the read of each load or resume call returned. */
  readAt: Map<number, number>;
  loadCalls: number;
  lastWritten: string | null;
  /** Sequences whose text this tab was shown: may be written over (2). */
  known: Set<number>;
  /** Sequences this tab based its text on: stale needs a commit past them (3). */
  base: Set<number>;
  failure: string | null;
};

async function run(tabCount: number, ops: readonly Op[]): Promise<void> {
  serial += 1;
  const at = serial.toString(16).padStart(64, "0");
  const commits: { tab: number; seq: number }[] = [];
  const staleEvents: { tab: number; maxBase: number; where: string }[] = [];
  const violations: string[] = [];
  const background = new Set<Promise<unknown>>();
  const tabs: Tab[] = [];
  const track = (promise: Promise<unknown>) => {
    const settled = promise.catch(() => {}).finally(() => background.delete(settled));
    background.add(settled);
  };

  const newSaver = (tab: Tab): LocalDocumentSaver => {
    let tx = 0;
    const wrapped = Object.assign(Object.create(tab.journal) as AtomicDexieJournal, {
      read: async (...args: Parameters<AtomicDexieJournal["read"]>) => {
        const call = caller.getStore();
        if (tab.readFails) {
          tab.readFails = false;
          throw Object.assign(new Error("closed"), { name: "DatabaseClosedError" });
        }
        const contents = await tab.journal.read(...args);
        if (tab.readSlow) {
          tab.readSlow = false;
          await new Promise<void>((resolve) => { tab.gated.push(resolve); });
        }
        tab.lastReadAt = contents.meta?.localSeq ?? 0;
        if (call !== undefined) tab.readAt.set(call, tab.lastReadAt);
        return contents;
      },
      saveLocal: async (...args: Parameters<AtomicDexieJournal["saveLocal"]>) => {
        const mode = tab.mode;
        tab.writing += 1;
        try {
          if (mode === "quota") throw Object.assign(new Error("full"), { name: "QuotaExceededError" });
          if (mode === "unknown") throw new Error("something else");
          if (mode === "closed") throw Object.assign(new Error("closed"), { name: "DatabaseClosedError" });
          if (mode === "gate") await new Promise<void>((resolve) => { tab.gated.push(resolve); });
          const result = await tab.journal.saveLocal(...args);
          // 2: the replaced text was shown to this tab. Sequences grow by one
          // per write, so this holds even if the saver passed no expectation.
          if (!tab.known.has(result.localSeq - 1)) {
            violations.push(`2: tab ${tab.id} wrote over unseen sequence ${result.localSeq - 1}`);
          }
          commits.push({ tab: tab.id, seq: result.localSeq });
          tab.known.add(result.localSeq);
          tab.base.add(result.localSeq);
          tab.lastWritten = plain(args[1].document);
          return result;
        } finally {
          tab.writing -= 1;
        }
      },
    });
    const saver = new LocalDocumentSaver(wrapped, DOC, {
      now: () => new Date("2026-10-10T20:00:00.000Z"),
      newTransactionId: () => `t${tab.id}-${(tx += 1)}`,
    });
    saver.subscribe((snapshot) => {
      if (tab.saver !== saver) return;
      // 1: "Spremljeno na uređaju" only for text that is in the journal.
      // A first load fills the editor with what it read, after this emit.
      if (snapshot.state === "LOCAL_DURABLE" && tab.instanceLoaded && tab.editor !== tab.lastWritten &&
          !(tab.clean && tab.editor === tab.loadedText && tab.lastReadAt === tab.loadedAt)) {
        violations.push(`1: tab ${tab.id} LOCAL_DURABLE for unwritten "${tab.editor}"`);
      }
      if (snapshot.failure === "stale" && tab.failure !== "stale") {
        staleEvents.push({ tab: tab.id, maxBase: Math.max(...tab.base), where: "snapshot" });
      }
      tab.failure = snapshot.failure;
    });
    return saver;
  };

  const loaded = (tab: Tab, saver: LocalDocumentSaver, result: LoadResult, resuming: boolean, call: number) => {
    if (tab.saver !== saver) return;
    const readAt = tab.readAt.get(call) ?? -1;
    tab.last = result;
    if (result.kind === "recovery") {
      if (result.reason === "stale") {
        staleEvents.push({ tab: tab.id, maxBase: Math.max(...tab.base), where: "recovery" });
      }
      tab.known.add(readAt);
      return;
    }
    if (result.kind !== "ready") return;
    tab.base.add(readAt);
    if (!tab.instanceLoaded && !resuming) {
      tab.instanceLoaded = true;
      tab.known.add(readAt);
      tab.editor = plain(result.document);
      tab.loadedText = tab.editor;
      tab.loadedAt = readAt;
      tab.clean = true;
    }
  };

  const startLoad = (tab: Tab, resuming: boolean) => {
    const saver = tab.saver;
    const call = tab.loadCalls++;
    const promise = caller.run(call, () => (resuming ? saver.resume(text(tab.editor)) : saver.load()))
      .then((result) => loaded(tab, saver, result, resuming, call), () => {})
      .finally(() => { if (tab.loading === promise) tab.loading = null; });
    tab.loading = promise;
    track(promise);
  };

  const fresh = (tab: Tab) => {
    tab.saver = newSaver(tab);
    tab.instanceLoaded = false;
    tab.last = null;
    tab.editor = "";
    tab.clean = false;
    tab.lastWritten = null;
    tab.known = new Set([0]);
    tab.base = new Set([0]);
    tab.failure = null;
    tab.readAt = new Map();
    tab.loadCalls = 0;
    startLoad(tab, false);
  };

  try {
    for (let id = 0; id < tabCount; id += 1) {
      const tab = {
        id, journal: new AtomicDexieJournal(at, idb), mode: "ok", readFails: false, readSlow: false, gated: [], writing: 0,
        loading: null, loadedText: "", loadedAt: 0, lastReadAt: 0, edits: 0,
      } as unknown as Tab;
      tabs.push(tab);
      fresh(tab);
    }
    await Promise.all(tabs.map((tab) => tab.loading));

    const checkStale = (label: string) => {
      for (const event of staleEvents.splice(0)) {
        if (!commits.some((c) => c.tab !== event.tab && c.seq > event.maxBase)) {
          violations.push(`3: tab ${event.tab} stale (${event.where}) without a newer commit of another tab, ${label}`);
        }
      }
    };

    for (const [index, step] of ops.entries()) {
      const tab = tabs[step.tab % tabCount]!;
      switch (step.kind) {
        case "edit":
          if (!tab.instanceLoaded) break;
          tab.edits += 1;
          tab.editor = `k${tab.id}-${tab.edits}`;
          tab.clean = false;
          tab.saver.edit();
          break;
        case "propose":
          if (!tab.instanceLoaded) break;
          track(tab.saver.propose(text(tab.editor)));
          break;
        case "load":
          // Loads may overlap (#206 V1); a resume waits for them.
          startLoad(tab, false);
          break;
        case "resume":
          if (!tab.loading && tab.last?.kind === "recovery" &&
              (tab.last.reason === "stale" || tab.last.reason === "unsaved")) {
            startLoad(tab, true);
          }
          break;
        case "mode":
          tab.mode = step.mode;
          break;
        case "readFail":
          tab.readFails = true;
          break;
        case "slowRead":
          tab.readSlow = true;
          break;
        case "release":
          for (const open of tab.gated.splice(0)) open();
          break;
        case "tick":
          await tick();
          break;
        case "reload":
          if (!tab.loading && tab.writing === 0 && tab.gated.length === 0) {
            tab.readSlow = false;
            fresh(tab);
          }
          break;
      }
      await Promise.resolve();
      for (let i = 0; i < (step.wait ?? 0); i += 1) await task();
      checkStale(`step ${index} ${step.kind}`);
    }

    // 4: release everything and let it settle.
    for (const tab of tabs) tab.mode = "ok";
    for (let round = 0; background.size > 0 || tabs.some((t) => t.gated.length > 0); round += 1) {
      if (round > 200) throw new Error("the model did not settle: a write or load hangs");
      for (const tab of tabs) for (const open of tab.gated.splice(0)) open();
      await tick();
    }
    for (const tab of tabs) await tab.saver.settled();
    checkStale("after settle");
    const stored = await tabs[0]!.journal.read(DOC);
    const rows = stored.pending.map((row) => plain(row.tx.document));
    for (const tab of tabs) {
      const { state } = tab.saver.snapshot();
      if (state === "SAVING_LOCAL") violations.push(`4: tab ${tab.id} stuck in SAVING_LOCAL`);
      if (state === "LOCAL_DURABLE" && !rows.includes(tab.editor) &&
          !(tab.clean && documentsEqual(stored.snapshot?.document ?? text(""), text(tab.editor)))) {
        violations.push(`4: tab ${tab.id} LOCAL_DURABLE but "${tab.editor}" is not in the journal`);
      }
    }
    expect(violations).toEqual([]);
  } finally {
    for (const tab of tabs) tab.journal.close();
    await new Dexie(`ductus-journal-v1-${at}`, idb).delete();
  }
}

// Races need many interleavings: four times the global run count.
const numRuns = 4 * Number(process.env.FC_NUM_RUNS ?? 100);

test.prop([fc.integer({ min: 1, max: 3 }), fc.array(step, { minLength: 5, maxLength: 40 })], { numRuns })(
  "1-3 tabs: durable only for written text, no write over unseen text, no false stale, nothing stuck",
  (tabCount, ops) => run(tabCount, ops),
);

/** QA C1 (#206 qa206c): resume() while its own write is in flight; always run first. */
const C1: Op[] = [
  { kind: "edit", tab: 0 }, { kind: "mode", tab: 0, mode: "quota" }, { kind: "propose", tab: 0 },
  { kind: "tick", tab: 0 }, { kind: "load", tab: 0 }, { kind: "tick", tab: 0 },
  { kind: "mode", tab: 0, mode: "gate" }, { kind: "propose", tab: 0 }, { kind: "resume", tab: 0 },
  { kind: "release", tab: 0 }, { kind: "tick", tab: 0 },
];
test.prop([fc.array(step, { minLength: 5, maxLength: 40 })], { numRuns, examples: [[C1]] })(
  "1 tab: the only writer never sees stale",
  (ops) => run(1, ops),
);
