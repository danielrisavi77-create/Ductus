/**
 * Browser side of the evidence journal suite (F-8 3d-2b, QA points 12-20):
 * the editor as the application builds it (`createEditorExtensions`), the
 * recorder, the journal on the engine's own IndexedDB and the drain runner
 * with the evidence transport and verifier, on a bare page. The commit route
 * is answered by `page.route` in Node (`evidence-harness.ts`). It is bundled
 * by `evidence-harness.ts` and never shipped: nothing under `app/` imports it.
 */

import { Editor } from "@tiptap/core";

import { encodeBase64 } from "../../src/client/evidence-ingest";
import type { EvidenceDomainKey } from "../../src/domain/forensics/evidence-receipt-verifier";
import { jcsUtf8Bytes } from "../../src/domain/forensics/jcs";
import type { CanonicalDocument } from "../../src/domain/document/schema";
import type { EvidenceOpening, QueuedTransaction, SyncMeta } from "../../src/domain/sync/journal-types";
import { CaptureError, changeOf, EvidenceRecorder } from "../../src/editor/capture";
import { canonicalToTiptap, tiptapToCanonical } from "../../src/editor/interop";
import { createEditorExtensions } from "../../src/editor/schema";
import { AtomicDexieJournal, JournalError } from "../../src/lib/journal/atomic-dexie-journal";
import { createDrainRunner, type DrainStepResult } from "../../src/lib/sync/drain-runner";
import { createEvidenceTransport, evidenceVerifierFor } from "../../src/lib/sync/evidence-transport";

export type HarnessConfig = {
  scope: string;
  documentId: string;
  evidenceDomainId: string;
  receiptKeys: EvidenceDomainKey[];
  revision: number;
  seedText: string;
};

export type HarnessRow = {
  localSeq: number;
  key: string;
  segmentHash: string;
  sequenceFrom: number;
  sequenceTo: number;
  baseRevision: number;
  segment: string;
  document: string;
  segmentIsBytes: boolean;
  documentIsBytes: boolean;
};

export type HarnessTiming = { segmentHash: string; sequenceFrom: number; events: { sequence: number; stepOffsetsMs: number[] }[] };

export type HarnessState = {
  meta: SyncMeta | null;
  rows: HarnessRow[];
  snapshotText: string | null;
  snapshotRevision: number | null;
  timings: HarnessTiming[];
};

export type Failure = { error: string };
export type Saved = { sha256: string; sequenceFrom: number; sequenceTo: number };
export type ServerVersion = { text: string; currentRevision: number; headSegmentHash: string; lastSequenceTo: number };

export type EvidenceHarness = {
  ready: boolean;
  /** Set when the journal could not be opened or started on load. */
  startFailure: string | null;
  /** Set when the recorder refused a change. */
  captureFailure: string | null;
  /** Closes the open event and saves what was typed since the last save as one segment. */
  save(): Promise<Saved | null | Failure>;
  step(): Promise<DrainStepResult | Failure>;
  /** Steps until a step sends nothing; the results in order. */
  drain(limit?: number): Promise<(DrainStepResult | Failure)[]>;
  state(): Promise<HarnessState | Failure>;
  text(): string;
  adopt(server: ServerVersion, confirmed: boolean): Promise<SyncMeta | Failure>;
  salvage(): Promise<{ id: number; cause: string; text: string; localSeq: number }[] | Failure>;
  release(id: number): Promise<null | Failure>;
  logout(): Promise<null | Failure>;
  databases(): Promise<string[] | null>;
  /** Whether this engine's Web Crypto verifies Ed25519 at all. */
  ed25519(): Promise<boolean>;
  /** Writes a journal at version 2 with the raw IndexedDB API, then opens it with the journal. */
  upgradeFromV2(scope: string): Promise<{ verno: number; tables: string[]; same: boolean; fence: boolean }>;
};

declare global {
  interface Window {
    __evidenceConfig?: HarnessConfig;
    __evidence?: EvidenceHarness;
  }
}

const config = window.__evidenceConfig!;
const DOC = config.documentId;
const NODE_ID = "aaaaaaaa-0000-4000-8000-00000000000a";

function failure(error: unknown): Failure {
  if (error instanceof JournalError || error instanceof CaptureError) return { error: error.code };
  return { error: `unexpected: ${String(error)}` };
}

async function attempt<T>(run: () => Promise<T>): Promise<T | Failure> {
  try {
    return await run();
  } catch (error) {
    return failure(error);
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function textOf(document: CanonicalDocument): string {
  return document.nodes.map((node) => node.children.map((child) => child.text).join("")).join("\n");
}

function paragraph(text: string) {
  return { type: "doc", content: [{ type: "paragraph", attrs: { nodeId: NODE_ID }, content: [{ type: "text", text }] }] };
}

function canonical(json: object): CanonicalDocument {
  const result = tiptapToCanonical(json as Parameters<typeof tiptapToCanonical>[0]);
  if (!result.ok) throw new Error(`not canonical: ${JSON.stringify(result.errors)}`);
  return result.doc;
}

async function openingOf(document: CanonicalDocument, revision: number, head: string | null, lastSequenceTo: number): Promise<EvidenceOpening> {
  const bytes = jcsUtf8Bytes(document);
  return { documentId: DOC, currentRevision: revision, documentHash: await sha256Hex(bytes), headSegmentHash: head, lastSequenceTo, document: bytes };
}

const journal = new AtomicDexieJournal(config.scope);
const rawDb = (target: AtomicDexieJournal) =>
  (target as unknown as { db: { verno: number; tables: { name: string }[]; table(name: string): { where(index: string): { equals(value: string): { toArray(): Promise<unknown[]> } } } } }).db;

// Every step is past any backoff, so only the plan decides what goes.
let clock = 0;
const runner = createDrainRunner<QueuedTransaction>({
  journal,
  transport: createEvidenceTransport((input, init) => fetch(input, init)),
  verifyFor: evidenceVerifierFor({ evidenceDomainId: config.evidenceDomainId, receiptKeys: config.receiptKeys }),
  now: () => (clock += 60_000),
  jitter: () => 0.5,
});

let recorder = new EvidenceRecorder();
let paused = false;
const sessionId = crypto.randomUUID();

async function start(): Promise<object> {
  const contents = await journal.readEvidence(DOC);
  if (contents.snapshot) return canonicalToTiptap(contents.snapshot.document);
  const seed = paragraph(config.seedText);
  await journal.startEvidence(DOC, await openingOf(canonical(seed), config.revision, null, 0), new Date().toISOString());
  return seed;
}

let editor: Editor;

function mount(content: object) {
  editor = new Editor({ element: document.querySelector("#editor"), extensions: createEditorExtensions(), content });
  editor.on("transaction", ({ transaction, appendedTransactions }) => {
    const all = [transaction, ...appendedTransactions];
    if (paused || !all.some((tr) => tr.docChanged)) return;
    try {
      recorder.record(changeOf(all, "editor", Date.now()));
    } catch (error) {
      harness.captureFailure = failure(error).error;
    }
  });
}

/** Shows `document` without recording it: it is not the author's edit. */
function show(document: CanonicalDocument) {
  paused = true;
  editor.commands.setContent(canonicalToTiptap(document), { emitUpdate: false });
  recorder = new EvidenceRecorder();
  paused = false;
}

const harness: EvidenceHarness = {
  ready: false,
  startFailure: null,
  captureFailure: null,
  save: () => attempt(async () => {
    recorder.close();
    const { meta, pending } = await journal.readEvidence(DOC);
    const tail = pending.at(-1)?.tx;
    const built = await recorder.takeSegment({
      documentId: DOC,
      sessionId,
      segmentId: crypto.randomUUID(),
      evidenceProfileId: "profil-izmisljeni",
      sequenceFrom: (tail ? tail.sequenceTo : meta!.evidenceHead!.lastSequenceTo) + 1,
      predecessorSegmentHash: tail ? tail.segmentHash : meta!.evidenceHead!.segmentHash,
    });
    if (built === null) return null;
    await journal.saveSegment(DOC, built, new Date().toISOString(), meta!.localSeq);
    return { sha256: built.sha256, sequenceFrom: built.segment.sequenceFrom, sequenceTo: built.segment.sequenceTo };
  }),
  step: () => attempt(() => runner.step(DOC)),
  async drain(limit = 20) {
    const results: (DrainStepResult | Failure)[] = [];
    for (let i = 0; i < limit; i++) {
      const result = await harness.step();
      results.push(result);
      if (!("kind" in result) || result.kind !== "sent") break;
    }
    return results;
  },
  state: () => attempt(async () => {
    const { meta, pending, snapshot } = await journal.readEvidence(DOC);
    const timings = (await rawDb(journal).table("timings").where("documentId").equals(DOC).toArray()) as HarnessTiming[];
    return {
      meta,
      snapshotText: snapshot ? textOf(snapshot.document) : null,
      snapshotRevision: snapshot?.revision ?? null,
      timings: timings.map(({ segmentHash, sequenceFrom, events }) => ({ segmentHash, sequenceFrom, events })),
      rows: pending.map(({ localSeq, tx }) => ({
        localSeq,
        key: tx.clientTransactionId,
        segmentHash: tx.segmentHash,
        sequenceFrom: tx.sequenceFrom,
        sequenceTo: tx.sequenceTo,
        baseRevision: tx.baseRevision,
        segment: encodeBase64(tx.segment),
        document: encodeBase64(tx.document),
        segmentIsBytes: tx.segment instanceof Uint8Array,
        documentIsBytes: tx.document instanceof Uint8Array,
      })),
    };
  }),
  text: () => textOf(canonical(editor.getJSON())),
  adopt: (server, confirmed) => attempt(async () => {
    const opened = await openingOf(canonical(paragraph(server.text)), server.currentRevision, server.headSegmentHash, server.lastSequenceTo);
    const { meta } = await journal.readEvidence(DOC);
    const adopted = await journal.adoptServerEvidence(DOC, opened, confirmed, new Date().toISOString(), meta!.localSeq);
    const { snapshot } = await journal.readEvidence(DOC);
    show(snapshot!.document);
    return adopted;
  }),
  salvage: () => attempt(async () =>
    (await journal.readSalvage(DOC)).map(({ id, cause, document, localSeq }) => ({ id, cause, text: textOf(document), localSeq }))),
  release: (id) => attempt(async () => {
    await journal.releaseSalvage(DOC, id);
    return null;
  }),
  logout: () => attempt(async () => {
    await journal.destroyForLogout();
    return null;
  }),
  async databases() {
    if (typeof indexedDB.databases !== "function") return null;
    return (await indexedDB.databases()).map((database) => database.name ?? "");
  },
  async ed25519() {
    try {
      // The RFC 8032 test 1 public key: any valid point would do.
      const hex = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";
      const key = new Uint8Array(hex.match(/../g)!.map((pair) => parseInt(pair, 16)));
      await crypto.subtle.importKey("raw", key, { name: "Ed25519" }, false, ["verify"]);
      return true;
    } catch {
      return false;
    }
  },
  async upgradeFromV2(scope) {
    const name = `ductus-journal-v1-${scope}`;
    const document = canonical(paragraph("Stari tekst"));
    const tx = { kind: "REPLACE_DOCUMENT", clientTransactionId: "tx-stari", baseRevision: 3, document, createdAt: "2026-10-24T12:00:00.000Z" };
    const rows = {
      snapshots: { documentId: "stari-dokument", revision: 3, document, savedAt: "2026-10-24T12:00:00.000Z" },
      pending: { documentId: "stari-dokument", localSeq: 1, tx, queuedAt: "2026-10-24T12:00:00.000Z" },
      meta: { documentId: "stari-dokument", localSeq: 1, state: "LOCAL_DURABLE" },
    };
    // Dexie keeps version n as IndexedDB version 10 * n.
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(name, 20);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore("snapshots", { keyPath: "documentId" });
        db.createObjectStore("pending", { keyPath: ["documentId", "localSeq"] }).createIndex("documentId", "documentId");
        db.createObjectStore("meta", { keyPath: "documentId" });
        db.createObjectStore("control", { keyPath: "key" });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const write = db.transaction(["snapshots", "pending", "meta", "control"], "readwrite");
        write.objectStore("snapshots").put(rows.snapshots);
        write.objectStore("pending").put(rows.pending);
        write.objectStore("meta").put(rows.meta);
        write.objectStore("control").put({ key: "logout", state: "closing" });
        write.oncomplete = () => {
          db.close();
          resolve();
        };
        write.onerror = () => reject(write.error);
      };
    });
    const upgraded = new AtomicDexieJournal(scope);
    const read = await upgraded.read("stari-dokument");
    const fence = await upgraded.hasPendingLogout();
    const db = rawDb(upgraded);
    const same = JSON.stringify(read) === JSON.stringify({ snapshot: rows.snapshots, pending: [rows.pending], meta: rows.meta });
    const result = { verno: db.verno, tables: db.tables.map((table) => table.name).sort(), same, fence };
    upgraded.close();
    return result;
  },
};

window.__evidence = harness;
// No top-level await: the bundle is a classic script.
start().then((content) => {
  mount(content);
  harness.ready = true;
}, (error: unknown) => {
  harness.startFailure = failure(error).error;
});
