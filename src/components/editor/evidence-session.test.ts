// @vitest-environment node
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { decodeBase64, type OpenedWork, type OpenOutcome } from "@/client/evidence-ingest";
import { createBrowserEditStepsV1Replayer } from "@/adapters/evidence/edit-steps-v1-browser-replayer";
import type { CanonicalDocument } from "@/domain/document";
import { MAX_DOCUMENT_SNAPSHOT_BYTES } from "@/domain/document/snapshot";
import { canonicalizeJcs, jcsUtf8Bytes } from "@/domain/forensics/jcs";
import { watchClosedBySubmission } from "@/client/evidence-session-deps";
import { CaptureError, EvidenceRecorder } from "@/editor/capture";
import { canonicalToTiptap, tiptapToCanonical } from "@/editor/interop";
import { createEditorExtensions } from "@/editor/schema";
import type { AtomicDexieJournal } from "@/lib/journal/atomic-dexie-journal";
import { createDrainRunner } from "@/lib/sync/drain-runner";
import { createEvidenceTransport, evidenceVerifierFor } from "@/lib/sync/evidence-transport";
import {
  DOC, DOMAIN, journalKit, json, R0, receiptKey, server, sha256, trusted, type Answer,
} from "@/lib/sync/evidence-test-kit";
import type { QueuedTransaction } from "@/domain/sync/journal-types";

import { EvidenceSession, type EvidenceSessionDeps } from "./evidence-session";

/**
 * F-8 3d-2c2 (contract #476 c.6391714810 §6 unit, G2/G3 c.6393716541): the
 * evidence session over the real recorder on a headless editor, journals on
 * fake-indexeddb, the real commit client against the kit's fake route,
 * receipts signed with an invented Ed25519 key, and the real browser
 * replayer. Every id, key and text is invented.
 */

const PROFILE = "profil-izmisljeni";
const ASSIGNED: CanonicalDocument = (() => {
  const editor = new Editor({
    element: null,
    extensions: createEditorExtensions(),
    content: { type: "doc", content: [{ type: "paragraph", attrs: { nodeId: "aaaaaaaa-0000-4000-8000-00000000000a" }, content: [{ type: "text", text: "Uvod" }] }] },
  });
  const canonical = tiptapToCanonical(editor.getJSON());
  editor.destroy();
  if (!canonical.ok) throw new Error("test document is not canonical");
  return canonical.doc;
})();

const { open: openJournal, cleanup } = journalKit("c");
const editors: Editor[] = [];
afterEach(async () => {
  for (const editor of editors.splice(0)) editor.destroy();
  await cleanup();
  vi.restoreAllMocks();
});

function workFor(doc: CanonicalDocument, over: Partial<OpenedWork> = {}): OpenedWork {
  const document = jcsUtf8Bytes(doc);
  return {
    documentId: DOC, evidenceProfileId: PROFILE, currentRevision: R0, documentHash: sha256(document),
    headSegmentHash: null, lastSequenceTo: 0, document, evidenceDomainId: DOMAIN, receiptKeys: [trusted.key], submitted: false, ...over,
  };
}

function network(initial = true) {
  let up = initial;
  const listeners = new Set<() => void>();
  return {
    online: () => up,
    onOnline: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    set(value: boolean) {
      up = value;
      if (value) for (const listener of [...listeners]) listener();
    },
  };
}

type Setup = {
  journal?: AtomicDexieJournal;
  net?: ReturnType<typeof server>;
  open?: () => Promise<OpenOutcome>;
  online?: ReturnType<typeof network>;
  over?: Partial<EvidenceSessionDeps>;
};

/** A session, a headless editor wired to it, and the clock and timers of its drain. */
function setup({ journal = openJournal(), net = server(), open, online = network(), over = {} }: Setup = {}) {
  let clock = 0;
  const timers: { run: () => void; at: number }[] = [];
  const opens = { count: 0 };
  const session = new EvidenceSession({
    journal,
    documentId: DOC,
    open: open ?? (async () => { opens.count += 1; return { status: "opened", work: workFor(ASSIGNED) }; }),
    replayer: createBrowserEditStepsV1Replayer,
    createRunner: (work) => createDrainRunner<QueuedTransaction>({
      journal, transport: createEvidenceTransport(net.fetchImpl), verifyFor: evidenceVerifierFor(work),
      now: () => clock, jitter: () => 0.5,
    }),
    network: online,
    clock: () => clock,
    setTimer: (run, ms) => { const timer = { run, at: clock + ms }; timers.push(timer); return timer; },
    clearTimer: (handle) => { const i = timers.indexOf(handle as never); if (i >= 0) timers.splice(i, 1); },
    ...over,
  });
  /** Moves the drain's clock and fires every timer due by then. */
  const advance = (ms: number) => {
    clock += ms;
    for (const timer of timers.filter((t) => t.at <= clock)) {
      timers.splice(timers.indexOf(timer), 1);
      timer.run();
    }
  };
  return { session, journal, net, online, advance, opens };
}

/** A headless editor holding `doc` whose changes go to `session.record`. */
function editorFor(session: EvidenceSession, doc: CanonicalDocument = ASSIGNED) {
  const editor = new Editor({ element: null, extensions: createEditorExtensions(), content: canonicalToTiptap(doc) });
  editor.view.updateState(editor.state.reconfigure({ plugins: editor.extensionManager.plugins }));
  editors.push(editor);
  let at = Date.parse("2026-10-24T09:00:00.000Z");
  const wiring = { muted: false };
  editor.on("transaction", ({ transaction, appendedTransactions }) => {
    if (!wiring.muted) session.record([transaction, ...appendedTransactions], undefined, (at += 100));
  });
  const type = (text: string) => editor.view.dispatch(editor.state.tr.insertText(text));
  const enter = () => editor.commands.splitBlock();
  const save = async () => {
    const candidate = tiptapToCanonical(editor.getJSON());
    if (!candidate.ok) throw new Error("not canonical");
    session.edit();
    await session.propose(candidate.doc);
    await session.settled();
    return candidate.doc;
  };
  const current = () => (tiptapToCanonical(editor.getJSON()) as { doc: CanonicalDocument }).doc;
  return { editor, type, enter, save, current, wiring };
}

async function ready(session: EvidenceSession) {
  const result = await session.load();
  expect(result.kind).toBe("ready");
  await session.settled();
  return result;
}

const segmentsOf = (net: ReturnType<typeof server>) =>
  net.calls.map(({ body }) => JSON.parse(new TextDecoder().decode(decodeBase64(body.segments[0])!)) as {
    sequenceFrom: number; sequenceTo: number; predecessorSegmentHash: string | null; sessionId: string; segmentId: string;
  });

describe("3d-2c2 evidence session: the chain comes from the journal", () => {
  it("1: typing, Enter and two changes in one save chain from the journal; a new instance continues it", async () => {
    const { session, journal, net } = setup({ online: network(false) });
    await ready(session);
    const sheet = editorFor(session);
    sheet.type(" prvi");
    sheet.enter();
    sheet.type("drugi");
    await sheet.save();
    const first = await journal.readEvidence(DOC);
    expect(first.pending.length).toBeGreaterThan(0);
    expect(first.pending[0]!.tx.sequenceFrom).toBe(1);
    expect(first.pending[0]!.tx.segment).toBeDefined();
    expect(session.snapshot().state).toBe("LOCAL_DURABLE");
    expect(net.calls).toHaveLength(0);

    // A new instance over the same journal: the head is the last queued row.
    const tail = first.pending.at(-1)!.tx;
    const again = setup({ journal, net, online: network(false) });
    const loaded = await ready(again.session);
    const sheet2 = editorFor(again.session, (loaded as { document: CanonicalDocument }).document);
    sheet2.type("!");
    await sheet2.save();
    const second = await journal.readEvidence(DOC);
    const added = second.pending.slice(first.pending.length);
    expect(added[0]!.tx.sequenceFrom).toBe(tail.sequenceTo + 1);
    expect(added[0]!.tx.segment).toBeDefined();
    const segment = JSON.parse(new TextDecoder().decode(
      (added[0]!.tx as unknown as { segment: Uint8Array }).segment)) as { predecessorSegmentHash: string };
    expect(segment.predecessorSegmentHash).toBe(tail.segmentHash);

    // Online: everything drains in order, one key per row, to SYNCED.
    again.online.set(true);
    await again.session.settled();
    expect(again.session.snapshot().state).toBe("SYNCED");
    const sent = segmentsOf(net);
    for (let i = 1; i < sent.length; i++) expect(sent[i]!.sequenceFrom).toBe(sent[i - 1]!.sequenceTo + 1);
    expect(new Set(sent.map((s) => s.segmentId)).size).toBe(sent.length);
    expect(new Set(sent.map((s) => s.sessionId)).size).toBe(2);
    const { pending, snapshot } = await journal.readEvidence(DOC);
    expect(pending).toEqual([]);
    expect(canonicalizeJcs(snapshot!.document)).toBe(canonicalizeJcs(sheet2.current()));
  });

  it("11: with rows owed, load never calls startEvidence and the chain continues the last row", async () => {
    const journal = openJournal();
    const first = setup({ journal, online: network(false) });
    await ready(first.session);
    const sheet = editorFor(first.session);
    sheet.type("a");
    await sheet.save();
    const before = await journal.readEvidence(DOC);
    const start = vi.spyOn(journal, "startEvidence");
    const second = setup({ journal, online: network(false) });
    const loaded = await ready(second.session);
    expect(start).not.toHaveBeenCalled();
    const sheet2 = editorFor(second.session, (loaded as { document: CanonicalDocument }).document);
    sheet2.type("b");
    await sheet2.save();
    const after = await journal.readEvidence(DOC);
    expect(after.pending.at(-1)!.tx.sequenceFrom).toBe(before.pending.at(-1)!.tx.sequenceTo + 1);
  });

  it("15: a write of another instance makes the next save stale and stops the session", async () => {
    const journal = openJournal();
    const a = setup({ journal, online: network(false) });
    await ready(a.session);
    const b = setup({ journal, online: network(false) });
    await ready(b.session);
    const sheetA = editorFor(a.session);
    const sheetB = editorFor(b.session);
    sheetA.type("a");
    await sheetA.save();
    const saveSegment = vi.spyOn(journal, "saveSegment");
    sheetB.type("b");
    await sheetB.save();
    expect(b.session.snapshot()).toMatchObject({ state: "ERROR", failure: "stale" });
    expect(saveSegment).not.toHaveBeenCalled();
    sheetB.type("c");
    await sheetB.save();
    expect(saveSegment).not.toHaveBeenCalled();
  });

  it("6: settled() right after a change inside 400 ms has the segment in the journal", async () => {
    const { session, journal } = setup({ online: network(false) });
    await ready(session);
    const sheet = editorFor(session);
    sheet.type("brzo");
    const candidate = tiptapToCanonical(sheet.editor.getJSON());
    session.edit();
    void session.propose((candidate as { doc: CanonicalDocument }).doc);
    await session.settled();
    const { pending, snapshot } = await journal.readEvidence(DOC);
    expect(pending).toHaveLength(1);
    expect(canonicalizeJcs(snapshot!.document)).toBe(canonicalizeJcs((candidate as { doc: CanonicalDocument }).doc));
  });
});

describe("3d-2c2 evidence session: stops never patch the chain", () => {
  it("2: a replay that fails saves the text uncovered; no segment is saved and nothing is sent", async () => {
    const net = server();
    const { session, journal } = setup({
      net,
      over: {
        replayer: () => ({
          ...createBrowserEditStepsV1Replayer(),
          apply: () => { throw new Error("step_failed"); },
        }),
      },
    });
    await ready(session);
    const saveSegment = vi.spyOn(journal, "saveSegment");
    const sheet = editorFor(session);
    sheet.type("x");
    const doc = await sheet.save();
    expect(saveSegment).not.toHaveBeenCalled();
    const { meta, snapshot, pending } = await journal.readEvidence(DOC);
    expect(meta?.evidenceStopped).toBe("unsupported_step");
    expect(pending).toEqual([]);
    expect(canonicalizeJcs(snapshot!.document)).toBe(canonicalizeJcs(doc));
    expect(net.calls).toHaveLength(0);
    expect(session.snapshot().state).toBe("LOCAL_DURABLE");
  });

  it("3: a gap saves uncovered once; later saves never take, chain, start or send", async () => {
    const net = server();
    const { session, journal } = setup({ net });
    await ready(session);
    const sheet = editorFor(session);
    // A change the recorder saw, one it never saw, then one it did: a gap.
    sheet.type("a");
    sheet.wiring.muted = true;
    sheet.type("skriveno");
    sheet.wiring.muted = false;
    sheet.type("x");
    await sheet.save();
    expect((await journal.readEvidence(DOC)).meta?.evidenceStopped).toBe("gap");
    const take = vi.spyOn(EvidenceRecorder.prototype, "takeSegment");
    const saveSegment = vi.spyOn(journal, "saveSegment");
    const start = vi.spyOn(journal, "startEvidence");
    sheet.type("y");
    const doc = await sheet.save();
    expect(take).not.toHaveBeenCalled();
    expect(saveSegment).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    expect(net.calls).toHaveLength(0);
    expect(canonicalizeJcs((await journal.readEvidence(DOC)).snapshot!.document)).toBe(canonicalizeJcs(doc));
    // A reload keeps the stop: no startEvidence, still uncovered.
    const again = setup({ journal, net });
    await ready(again.session);
    expect(start).not.toHaveBeenCalled();
    expect(again.session.snapshot().state).toBe("LOCAL_DURABLE");
  });
});

describe("3d-2c2 evidence session: SYNCED only with a verified receipt", () => {
  it("4: a receipt under a key outside receiptKeys, or over another segment hash, is never SYNCED", async () => {
    const stranger = receiptKey("kljuc-tudi");
    const forge = (over: Parameters<typeof trusted.sign>[0], signer = trusted): Answer => (body) =>
      json(200, { status: "committed", revision: R0 + 1, receipt: { status: "signed", signedReceipt: signer.sign({
        documentId: DOC, clientTransactionId: body.clientTransactionId, revision: R0 + 1,
        segmentHash: sha256(decodeBase64(body.segments[0])!), ...over,
      }) } });
    for (const answer of [forge({}, stranger), forge({ segmentHash: "0".repeat(64) })]) {
      const net = server(R0, answer);
      const { session, journal } = setup({ net });
      await ready(session);
      const head = (await journal.readEvidence(DOC)).meta!.evidenceHead;
      const sheet = editorFor(session);
      sheet.type("x");
      await sheet.save();
      expect(net.calls).toHaveLength(1);
      expect(session.snapshot().state).not.toBe("SYNCED");
      const { meta, pending } = await journal.readEvidence(DOC);
      expect(meta?.state).not.toBe("SYNCED");
      expect(pending).toHaveLength(1);
      expect(meta?.evidenceHead).toEqual(head);
      await cleanup();
    }
  });

  it("5: with three segments, SYNCED appears only after the third receipt", async () => {
    const net = server();
    const online = network(false);
    const { session } = setup({ net, online });
    await ready(session);
    const sheet = editorFor(session);
    for (const text of ["a", "b", "c"]) {
      sheet.type(text);
      await sheet.save();
    }
    const seen: number[] = [];
    session.subscribe((snapshot) => { if (snapshot.state === "SYNCED") seen.push(net.calls.length); });
    online.set(true);
    await session.settled();
    expect(net.calls).toHaveLength(3);
    expect(seen.length).toBeGreaterThan(0);
    expect(Math.min(...seen)).toBe(3);
  });

  it("12: a duplicate with a valid receipt is SYNCED; one with a forged receipt is not", async () => {
    const stranger = receiptKey("kljuc-krivotvoren");
    const duplicate = (signer: typeof trusted): Answer => (body) => json(200, {
      status: "duplicate", revision: R0 + 1, receipt: { status: "signed", signedReceipt: signer.sign({
        documentId: DOC, clientTransactionId: body.clientTransactionId, revision: R0 + 1,
        segmentHash: sha256(decodeBase64(body.segments[0])!),
      }) },
    });
    for (const [signer, synced] of [[trusted, true], [stranger, false]] as const) {
      const net = server(R0, duplicate(signer));
      const { session } = setup({ net });
      await ready(session);
      const sheet = editorFor(session);
      sheet.type("x");
      await sheet.save();
      expect(session.snapshot().state === "SYNCED").toBe(synced);
      await cleanup();
    }
  });

  it("G3: a reload never shows SYNCED from stored meta; it starts at LOCAL_DURABLE", async () => {
    const journal = openJournal();
    const first = setup({ journal });
    await ready(first.session);
    const sheet = editorFor(first.session);
    sheet.type("x");
    await sheet.save();
    expect(first.session.snapshot().state).toBe("SYNCED");
    expect((await journal.readEvidence(DOC)).meta?.state).toBe("SYNCED");
    // The server's head is now the device's: the next open reports it.
    const { snapshot, meta } = await journal.readEvidence(DOC);
    const bytes = jcsUtf8Bytes(snapshot!.document);
    const work = workFor(snapshot!.document, {
      currentRevision: snapshot!.revision, documentHash: sha256(bytes), document: bytes,
      headSegmentHash: meta!.evidenceHead!.segmentHash, lastSequenceTo: meta!.evidenceHead!.lastSequenceTo,
    });
    const second = setup({ journal, open: async () => ({ status: "opened", work }) });
    const states: string[] = [];
    second.session.subscribe((s) => states.push(s.state));
    await ready(second.session);
    expect(second.session.snapshot().state).toBe("LOCAL_DURABLE");
    expect(states).not.toContain("SYNCED");
    // Stored meta is kept, only not shown.
    expect((await journal.readEvidence(DOC)).meta?.state).toBe("SYNCED");
  });
});

describe("3d-2c2 evidence session: opening", () => {
  it("7: an open naming another document loads unavailable and writes nothing", async () => {
    const other = "33333333-3333-4333-8333-333333333333";
    const { session, journal } = setup({ open: async () => ({ status: "opened", work: workFor(ASSIGNED, { documentId: other }) }) });
    expect(await session.load()).toEqual({ kind: "unavailable" });
    expect(await journal.readEvidence(DOC)).toMatchObject({ meta: null, snapshot: null, pending: [] });
  });

  it("10: open without a network and no local document is unavailable and creates nothing", async () => {
    const { session, journal } = setup({ open: async () => ({ status: "unavailable" }), online: network(false) });
    expect(await session.load()).toEqual({ kind: "unavailable" });
    expect(await journal.readEvidence(DOC)).toMatchObject({ meta: null, snapshot: null, pending: [] });
  });

  it("9 (O3 b): offline with a stored profile builds segments, sends nothing, then drains to SYNCED once open succeeds", async () => {
    const journal = openJournal();
    const net = server();
    const first = setup({ journal, net, online: network(false) });
    await ready(first.session);
    let reachable = false;
    const online = network(false);
    const second = setup({
      journal, net, online,
      open: async () => (reachable ? { status: "opened", work: workFor(ASSIGNED) } : { status: "unavailable" }),
      over: { storedProfile: () => PROFILE },
    });
    const loaded = await ready(second.session);
    const sheet = editorFor(second.session, (loaded as { document: CanonicalDocument }).document);
    sheet.type("offline");
    await sheet.save();
    expect((await journal.readEvidence(DOC)).pending).toHaveLength(1);
    expect(net.calls).toHaveLength(0);
    expect(second.session.snapshot().state).toBe("LOCAL_DURABLE");
    reachable = true;
    online.set(true);
    await second.session.settled();
    expect(second.session.snapshot().state).toBe("SYNCED");
    expect(net.calls).toHaveLength(1);
  });

  it("9 (O3 a, before BE-2): without a stored profile nothing is built until open succeeds", async () => {
    const journal = openJournal();
    const net = server();
    const first = setup({ journal, net, online: network(false) });
    await ready(first.session);
    let reachable = false;
    const online = network(false);
    const second = setup({
      journal, net, online,
      open: async () => (reachable ? { status: "opened", work: workFor(ASSIGNED) } : { status: "unavailable" }),
    });
    const loaded = await ready(second.session);
    const sheet = editorFor(second.session, (loaded as { document: CanonicalDocument }).document);
    sheet.type("offline");
    await sheet.save();
    expect((await journal.readEvidence(DOC)).pending).toHaveLength(0);
    expect(second.session.snapshot().state).toBe("EDITING");
    reachable = true;
    online.set(true);
    await second.session.settled();
    expect((await journal.readEvidence(DOC)).pending).toHaveLength(0);
    expect(net.calls).toHaveLength(1);
    expect(second.session.snapshot().state).toBe("SYNCED");
  });
});

describe("3d-2c2 evidence session: the drain", () => {
  it("G2: nothing is sent while the browser reports no network; the online event starts the drain", async () => {
    const net = server();
    const online = network(false);
    const { session } = setup({ net, online });
    await ready(session);
    const sheet = editorFor(session);
    sheet.type("x");
    await sheet.save();
    expect(net.calls).toHaveLength(0);
    expect(session.snapshot().state).toBe("LOCAL_DURABLE");
    online.set(true);
    await session.settled();
    expect(net.calls).toHaveLength(1);
    expect(session.snapshot().state).toBe("SYNCED");
  });

  it("13: a 409 stale_base is CONFLICT; nothing more is saved or sent", async () => {
    const net = server(R0, () => json(409, { status: "stale_base", currentRevision: R0 + 3 }));
    const { session, journal } = setup({ net });
    await ready(session);
    const sheet = editorFor(session);
    sheet.type("x");
    await sheet.save();
    expect(session.snapshot().state).toBe("CONFLICT");
    const saveSegment = vi.spyOn(journal, "saveSegment");
    sheet.type("y");
    await sheet.save();
    expect(saveSegment).not.toHaveBeenCalled();
    expect(net.calls).toHaveLength(1);
    expect(session.snapshot().state).toBe("CONFLICT");
  });

  it("14: pause() while a step is in flight starts no new step, and settled() waits for the one in flight", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const net = server(R0, async (body, accept) => { await held; return accept(body); });
    const { session, journal } = setup({ net });
    await ready(session);
    const sheet = editorFor(session);
    sheet.type("a");
    session.edit();
    await session.propose(sheet.current());
    await vi.waitFor(() => expect(net.calls).toHaveLength(1));
    session.pause();
    sheet.type("b");
    session.edit();
    await session.propose(sheet.current());
    let done = false;
    const settled = session.settled().then(() => { done = true; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(done).toBe(false);
    release();
    await settled;
    expect(net.calls).toHaveLength(1);
    expect((await journal.readEvidence(DOC)).pending).toHaveLength(1);
    session.resume();
    await session.settled();
    expect(net.calls).toHaveLength(2);
    expect(session.snapshot().state).toBe("SYNCED");
  });

  it("16: 413 and 426 are sent once in ten simulated minutes", async () => {
    for (const answer of [json(413, { status: "too_large" }), json(426, { status: "upgrade_required" })]) {
      const net = server(R0, () => answer.clone());
      const online = network();
      const { session, advance } = setup({ net, online });
      await ready(session);
      const sheet = editorFor(session);
      sheet.type("x");
      await sheet.save();
      for (let minute = 0; minute < 10; minute++) {
        advance(60_000);
        online.set(true);
        await session.settled();
      }
      expect(net.calls).toHaveLength(1);
      expect(session.snapshot().state).toBe("ERROR");
      await cleanup();
    }
  });

  it("transport errors are retried on schedule with the same key and bytes", async () => {
    const net = server(R0, () => new TypeError("offline"), () => json(503, {}));
    const { session, advance } = setup({ net });
    await ready(session);
    const sheet = editorFor(session);
    sheet.type("x");
    await sheet.save();
    expect(net.calls).toHaveLength(1);
    for (let i = 0; i < 20 && session.snapshot().state !== "SYNCED"; i++) {
      advance(60_000);
      await session.settled();
    }
    expect(session.snapshot().state).toBe("SYNCED");
    expect(new Set(net.calls.map((c) => c.text)).size).toBe(1);
  });

  it("17: fifty saves never put two requests in flight", async () => {
    const net = server();
    const { session } = setup({ net });
    await ready(session);
    const sheet = editorFor(session);
    for (let i = 0; i < 50; i++) {
      sheet.type(String.fromCharCode(97 + (i % 26)));
      session.edit();
      void session.propose(sheet.current());
      if (i % 5 === 0) await Promise.resolve();
    }
    await session.settled();
    expect(net.maxInFlight).toBe(1);
    expect(session.snapshot().state).toBe("SYNCED");
  }, 60_000);

  it("close() stops recording, saving and sending", async () => {
    const net = server();
    const online = network(false);
    const { session, journal } = setup({ net, online });
    await ready(session);
    const sheet = editorFor(session);
    sheet.type("a");
    await sheet.save();
    session.close();
    const saveSegment = vi.spyOn(journal, "saveSegment");
    sheet.type("b");
    await sheet.save();
    online.set(true);
    await session.settled();
    expect(saveSegment).not.toHaveBeenCalled();
    expect(net.calls).toHaveLength(0);
  });
});

describe("3d-2c2 evidence session: SYNCING while a step runs (P2, #476 c.6395903987)", () => {
  it("SYNCING shows while the request is in flight and SYNCED follows the receipt", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const net = server(R0, async (body, accept) => { await held; return accept(body); });
    const { session } = setup({ net });
    await ready(session);
    const sheet = editorFor(session);
    sheet.type("a");
    session.edit();
    await session.propose(sheet.current());
    await vi.waitFor(() => expect(net.calls).toHaveLength(1));
    expect(session.snapshot().state).toBe("SYNCING");
    release();
    await session.settled();
    expect(session.snapshot().state).toBe("SYNCED");
  });

  it("SYNCING lives in memory only: a step cut off after its hold loads as LOCAL_DURABLE", async () => {
    const journal = openJournal();
    const first = setup({ journal, online: network(false) });
    await ready(first.session);
    const sheet = editorFor(first.session);
    sheet.type("a");
    await sheet.save();
    // The drain's own hold (beginSend) writes SYNCING; the page dies before the answer.
    const row = (await journal.readEvidence(DOC)).pending[0]!;
    await journal.beginSend(DOC, row as never);
    expect((await journal.readEvidence(DOC)).meta?.state).toBe("SYNCING");
    const second = setup({ journal, online: network(false), open: async () => ({ status: "unavailable" }) });
    await ready(second.session);
    expect(second.session.snapshot().state).toBe("LOCAL_DURABLE");
  });

  it("a step that throws after its hold shows LOCAL_DURABLE, never SYNCING or SYNCED", async () => {
    const journal = openJournal();
    const { session } = setup({
      journal,
      over: {
        createRunner: () => ({
          async step(documentId) {
            const row = (await journal.readEvidence(documentId)).pending[0];
            if (!row) return { kind: "idle" };
            await journal.beginSend(documentId, row as never);
            throw new Error("step cut off after beginSend");
          },
        }),
      },
    });
    const states: string[] = [];
    await ready(session);
    session.subscribe((s) => states.push(s.state));
    const sheet = editorFor(session);
    sheet.type("x");
    await sheet.save();
    expect((await journal.readEvidence(DOC)).meta?.state).toBe("SYNCING");
    expect(session.snapshot().state).toBe("LOCAL_DURABLE");
    expect(states.at(-1)).toBe("LOCAL_DURABLE");
    expect(states).not.toContain("SYNCED");
  });

  it("after a lost answer or a 503 the state comes from meta, never SYNCING", async () => {
    for (const lost of [() => new TypeError("offline"), () => json(503, {})] as Answer[]) {
      const net = server(R0, lost);
      const { session } = setup({ net });
      await ready(session);
      const sheet = editorFor(session);
      sheet.type("x");
      await sheet.save();
      expect(net.calls).toHaveLength(1);
      expect(session.snapshot().state).toBe("ERROR");
      await cleanup();
    }
  });

  it("offline, no step runs and SYNCING never shows", async () => {
    const { session } = setup({ online: network(false) });
    const states: string[] = [];
    session.subscribe((s) => states.push(s.state));
    await ready(session);
    const sheet = editorFor(session);
    sheet.type("x");
    await sheet.save();
    expect(states).not.toContain("SYNCING");
    expect(session.snapshot().state).toBe("LOCAL_DURABLE");
  });

  it("SYNCING with a forged receipt never turns into SYNCED", async () => {
    const stranger = receiptKey("kljuc-lazni");
    const net = server(R0, (body) => json(200, { status: "committed", revision: R0 + 1, receipt: { status: "signed", signedReceipt: stranger.sign({
      documentId: DOC, clientTransactionId: body.clientTransactionId, revision: R0 + 1, segmentHash: sha256(decodeBase64(body.segments[0])!),
    }) } }));
    const { session } = setup({ net });
    const states: string[] = [];
    session.subscribe((s) => states.push(s.state));
    await ready(session);
    const sheet = editorFor(session);
    sheet.type("x");
    await sheet.save();
    expect(states).toContain("SYNCING");
    expect(states).not.toContain("SYNCED");
    expect(session.snapshot().state).not.toBe("SYNCING");
  });

  it("a reload with nothing owed shows neither SYNCING nor SYNCED (G3)", async () => {
    const journal = openJournal();
    const first = setup({ journal });
    await ready(first.session);
    const sheet = editorFor(first.session);
    sheet.type("x");
    await sheet.save();
    expect(first.session.snapshot().state).toBe("SYNCED");
    const second = setup({ journal, open: async () => ({ status: "unavailable" }) });
    const states: string[] = [];
    second.session.subscribe((s) => states.push(s.state));
    await ready(second.session);
    expect(states).not.toContain("SYNCING");
    expect(states).not.toContain("SYNCED");
  });
});

describe("3d-2c2a P1 (#476 c.6395903987): a capture failure in record() stays closed", () => {
  it("P1: a CaptureError thrown while recording saves uncovered once; no segment is taken, chained, started or sent", async () => {
    const net = server();
    const { session, journal } = setup({ net });
    await ready(session);
    const sheet = editorFor(session);
    sheet.type("a");
    vi.spyOn(EvidenceRecorder.prototype, "record").mockImplementationOnce(() => { throw new CaptureError("too_large"); });
    sheet.type("b");
    const take = vi.spyOn(EvidenceRecorder.prototype, "takeSegment");
    const saveSegment = vi.spyOn(journal, "saveSegment");
    const saveUncovered = vi.spyOn(journal, "saveUncovered");
    const start = vi.spyOn(journal, "startEvidence");
    await sheet.save();
    sheet.type("c");
    const doc = await sheet.save();
    expect(take).not.toHaveBeenCalled();
    expect(saveSegment).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    expect(saveUncovered.mock.calls[0]?.[2]).toBe("too_large");
    expect(net.calls).toHaveLength(0);
    const contents = await journal.readEvidence(DOC);
    expect(contents.meta?.evidenceStopped).toBe("too_large");
    expect(contents.pending).toHaveLength(0);
    expect(canonicalizeJcs(contents.snapshot!.document)).toBe(canonicalizeJcs(doc));
  });
});

describe("3d-2c2a §4 (DAN-289 A1): a submission closes the session", () => {
  const notAccepting = () => json(409, { status: "not_accepting" });

  /** A session whose commits go through the O1 (a) wrapper of the browser deps. */
  function closedSetup(net: ReturnType<typeof server>, journal: AtomicDexieJournal = openJournal(), online = network()) {
    const closed = watchClosedBySubmission(net.fetchImpl);
    let clock = 0;
    const made = setup({
      net, online, journal,
      over: {
        watchSubmission: closed.watch,
        createRunner: (work) => createDrainRunner<QueuedTransaction>({
          journal, transport: createEvidenceTransport(closed.fetchImpl), verifyFor: evidenceVerifierFor(work),
          now: () => clock, jitter: () => 0.5,
        }),
      },
    });
    const advance = (ms: number) => { clock += ms; made.advance(ms); };
    return { ...made, advance };
  }

  it("S1: a 409 not_accepting closes by submission at LOCAL_DURABLE, neither ERROR nor SYNCED", async () => {
    const { session } = closedSetup(server(R0, notAccepting));
    await ready(session);
    const sheet = editorFor(session);
    sheet.type("x");
    await sheet.save();
    expect(session.snapshot()).toEqual({ state: "LOCAL_DURABLE", failure: null, capacity: "ok", closedBy: "submission" });
  });

  it("S2-S4: after it nothing is recorded, saved, started or sent, and the refused row stays", async () => {
    const net = server(R0, notAccepting);
    const online = network();
    const { session, journal, advance } = closedSetup(net, undefined, online);
    await ready(session);
    const sheet = editorFor(session);
    sheet.type("x");
    await sheet.save();
    const before = await journal.readEvidence(DOC);
    const take = vi.spyOn(EvidenceRecorder.prototype, "takeSegment");
    const record = vi.spyOn(EvidenceRecorder.prototype, "record");
    const saveSegment = vi.spyOn(journal, "saveSegment");
    const saveUncovered = vi.spyOn(journal, "saveUncovered");
    const start = vi.spyOn(journal, "startEvidence");
    sheet.type("y");
    await sheet.save();
    session.pause();
    session.resume();
    for (let minute = 0; minute < 10; minute++) {
      advance(60_000);
      online.set(true);
      await session.settled();
    }
    for (const spy of [take, record, saveSegment, saveUncovered, start]) expect(spy).not.toHaveBeenCalled();
    expect(net.calls).toHaveLength(1);
    const after = await journal.readEvidence(DOC);
    expect(after.meta?.localSeq).toBe(before.meta?.localSeq);
    expect(after.pending).toHaveLength(1);
    expect(after.pending[0]?.tx.clientTransactionId).toBe(net.calls[0]?.body.clientTransactionId);
    expect(session.snapshot().closedBy).toBe("submission");
  });

  it("S5: a reload sends the refused row exactly once and closes by submission again", async () => {
    const net = server(R0, notAccepting, notAccepting);
    const first = closedSetup(net);
    await ready(first.session);
    const sheet = editorFor(first.session);
    sheet.type("x");
    await sheet.save();
    first.session.close();
    const online = network();
    const again = closedSetup(net, first.journal, online);
    await ready(again.session);
    expect(again.session.snapshot().closedBy).toBe("submission");
    for (let minute = 0; minute < 10; minute++) {
      again.advance(60_000);
      online.set(true);
      await again.session.settled();
    }
    expect(net.calls).toHaveLength(2);
    expect(net.calls[1]?.text).toBe(net.calls[0]?.text);
    expect((await first.journal.readEvidence(DOC)).pending).toHaveLength(1);
  });

  it("S6: a 404 not_found stays ERROR and never closes by submission", async () => {
    const { session } = closedSetup(server(R0, () => json(404, { status: "not_found" })));
    await ready(session);
    const sheet = editorFor(session);
    sheet.type("x");
    await sheet.save();
    expect(session.snapshot().state).toBe("ERROR");
    expect(session.snapshot().closedBy).toBeNull();
  });

  it("S7: an open answering 409 not_accepting loads unavailable, not closed by submission", async () => {
    const net = server();
    const closed = watchClosedBySubmission(net.fetchImpl);
    const { session, journal } = setup({
      net, open: async () => ({ status: "not_accepting" }), over: { watchSubmission: closed.watch },
    });
    expect((await session.load()).kind).toBe("unavailable");
    expect(session.snapshot().closedBy).toBeNull();
    expect((await journal.readEvidence(DOC)).meta).toBeNull();
    expect(net.calls).toHaveLength(0);
  });
});

describe("3d-2c2a Codex #803: a failed write keeps its segment, and a closed session writes nothing", () => {
  it("C1: a quota failure of saveSegment keeps the segment; the next save writes it first and the chain stays covered", async () => {
    const net = server();
    const online = network(false);
    const { session, journal } = setup({ net, online });
    await ready(session);
    const sheet = editorFor(session);
    sheet.type("a");
    vi.spyOn(journal, "saveSegment").mockRejectedValueOnce(new DOMException("invented", "QuotaExceededError"));
    await sheet.save();
    expect(session.snapshot().state).toBe("ERROR");
    expect((await journal.readEvidence(DOC)).pending).toEqual([]);

    // Space is back: the kept segment goes first, then the new change.
    sheet.type("b");
    const doc = await sheet.save();
    const { meta, pending, snapshot } = await journal.readEvidence(DOC);
    expect(meta?.evidenceStopped).toBeUndefined();
    expect(pending.length).toBeGreaterThanOrEqual(2);
    expect(pending[0]!.tx.sequenceFrom).toBe(1);
    expect(canonicalizeJcs(snapshot!.document)).toBe(canonicalizeJcs(doc));
    online.set(true);
    await session.settled();
    expect(session.snapshot().state).toBe("SYNCED");
  });

  /** A session whose replay of the next segment closes it by submission first. */
  function closingDuringReplay(replayFails: boolean) {
    let fire: () => void = () => {};
    let armed = false;
    const made = setup({
      online: network(false),
      over: {
        watchSubmission: (onClosed) => { fire = onClosed; return () => {}; },
        replayer: () => {
          const base = createBrowserEditStepsV1Replayer();
          return {
            ...base,
            apply: (...args: Parameters<typeof base.apply>) => {
              if (armed) {
                armed = false;
                fire();
                if (replayFails) throw new Error("step_failed");
              }
              return base.apply(...args);
            },
          };
        },
      },
    });
    return { ...made, arm: () => { armed = true; } };
  }

  it("C2: a submission closing the session during the replay leaves no new row", async () => {
    const { session, journal, arm } = closingDuringReplay(false);
    await ready(session);
    const sheet = editorFor(session);
    sheet.type("a");
    await sheet.save();
    const before = await journal.readEvidence(DOC);
    const saveSegment = vi.spyOn(journal, "saveSegment");
    arm();
    sheet.type("b");
    await sheet.save();
    expect(saveSegment).not.toHaveBeenCalled();
    const after = await journal.readEvidence(DOC);
    expect(after.meta?.localSeq).toBe(before.meta?.localSeq);
    expect(after.pending).toHaveLength(before.pending.length);
    expect(session.snapshot().closedBy).toBe("submission");
  });

  it("C3: a replay that fails after the session closed saves nothing uncovered", async () => {
    const { session, journal, arm } = closingDuringReplay(true);
    await ready(session);
    const sheet = editorFor(session);
    const saveUncovered = vi.spyOn(journal, "saveUncovered");
    arm();
    sheet.type("a");
    await sheet.save();
    expect(saveUncovered).not.toHaveBeenCalled();
    expect((await journal.readEvidence(DOC)).meta?.evidenceStopped).toBeUndefined();
    expect(session.snapshot()).toMatchObject({ closedBy: "submission", state: "LOCAL_DURABLE" });
  });
});

describe("3d-2c2a Codex #803 (2): close() during a save, and a snapshot over the limit", () => {
  it("C4: close() during the replay leaves no new row and saves nothing uncovered", async () => {
    let armed = false;
    let closeNow: () => void = () => {};
    const { session, journal } = setup({
      online: network(false),
      over: {
        replayer: () => {
          const base = createBrowserEditStepsV1Replayer();
          return {
            ...base,
            apply: (...args: Parameters<typeof base.apply>) => {
              if (armed) {
                armed = false;
                closeNow();
              }
              return base.apply(...args);
            },
          };
        },
      },
    });
    closeNow = () => session.close();
    await ready(session);
    const sheet = editorFor(session);
    sheet.type("a");
    await sheet.save();
    const before = await journal.readEvidence(DOC);
    const saveSegment = vi.spyOn(journal, "saveSegment");
    const saveUncovered = vi.spyOn(journal, "saveUncovered");
    armed = true;
    sheet.type("b");
    const candidate = tiptapToCanonical(sheet.editor.getJSON());
    if (!candidate.ok) throw new Error("not canonical");
    session.edit();
    await session.propose(candidate.doc);
    await session.settled();
    expect(saveSegment).not.toHaveBeenCalled();
    expect(saveUncovered).not.toHaveBeenCalled();
    const after = await journal.readEvidence(DOC);
    expect(after.meta?.localSeq).toBe(before.meta?.localSeq);
    expect(after.pending).toHaveLength(before.pending.length);
  });

  it("C5: a segment whose snapshot passes the limit stops evidence and keeps the text, and later saves still land", async () => {
    const big: CanonicalDocument = (() => {
      const filler = "x".repeat(MAX_DOCUMENT_SNAPSHOT_BYTES - jcsUtf8Bytes(ASSIGNED).byteLength - 64);
      const editor = new Editor({
        element: null,
        extensions: createEditorExtensions(),
        content: { type: "doc", content: [{ type: "paragraph", attrs: { nodeId: "aaaaaaaa-0000-4000-8000-00000000000b" }, content: [{ type: "text", text: filler }] }] },
      });
      const canonical = tiptapToCanonical(editor.getJSON());
      editor.destroy();
      if (!canonical.ok) throw new Error("test document is not canonical");
      return canonical.doc;
    })();
    expect(jcsUtf8Bytes(big).byteLength).toBeLessThanOrEqual(MAX_DOCUMENT_SNAPSHOT_BYTES);
    const { session, journal } = setup({
      online: network(false),
      open: async () => ({ status: "opened", work: workFor(big) }),
    });
    await ready(session);
    const sheet = editorFor(session, big);
    sheet.type("y".repeat(200));
    const over = await sheet.save();
    expect(jcsUtf8Bytes(over).byteLength).toBeGreaterThan(MAX_DOCUMENT_SNAPSHOT_BYTES);
    let contents = await journal.readEvidence(DOC);
    expect(contents.meta?.evidenceStopped).toBe("too_large");
    expect(contents.pending).toEqual([]);
    expect(canonicalizeJcs(contents.snapshot!.document)).toBe(canonicalizeJcs(over));

    // Text removed below the limit: the save still lands instead of retrying the refused segment.
    sheet.editor.commands.setContent(canonicalToTiptap(ASSIGNED));
    const after = await sheet.save();
    contents = await journal.readEvidence(DOC);
    expect(canonicalizeJcs(contents.snapshot!.document)).toBe(canonicalizeJcs(after));
    expect(session.snapshot().failure).toBeNull();
  });
});
