// @vitest-environment node
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { OpenedWork } from "@/client/evidence-ingest";
import { createBrowserEditStepsV1Replayer } from "@/adapters/evidence/edit-steps-v1-browser-replayer";
import type { CanonicalDocument } from "@/domain/document";
import { canonicalizeJcs, jcsUtf8Bytes } from "@/domain/forensics/jcs";
import type { QueuedTransaction } from "@/domain/sync/journal-types";
import { canonicalToTiptap, tiptapToCanonical } from "@/editor/interop";
import { createEditorExtensions } from "@/editor/schema";
import { createDrainRunner } from "@/lib/sync/drain-runner";
import { createEvidenceTransport, evidenceVerifierFor } from "@/lib/sync/evidence-transport";
import { DOC, DOMAIN, journalKit, R0, server, sha256, trusted } from "@/lib/sync/evidence-test-kit";

import { EvidenceSession } from "./evidence-session";

/**
 * M0.1 continuation (DAN-376, #1071), snimanje 10 of the core port map
 * (`docs/engineering/prijenos-jezgre-M0.1-jednakovrijednost.md`): a save checks
 * the editor's actual document even when the change the recorder missed is the
 * last one. The helpers follow `evidence-session.test.ts`. Every id, key and
 * text is invented.
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

const { open: openJournal, cleanup } = journalKit("2");
const editors: Editor[] = [];
afterEach(async () => {
  for (const editor of editors.splice(0)) editor.destroy();
  await cleanup();
  vi.restoreAllMocks();
});

function workFor(doc: CanonicalDocument): OpenedWork {
  const document = jcsUtf8Bytes(doc);
  return {
    documentId: DOC, evidenceProfileId: PROFILE, currentRevision: R0, documentHash: sha256(document),
    headSegmentHash: null, lastSequenceTo: 0, document, evidenceDomainId: DOMAIN, receiptKeys: [trusted.key], submitted: false,
  };
}

/** A session online against the kit's fake route, with a drain on a fixed clock. */
function setup() {
  const journal = openJournal();
  const net = server();
  const session = new EvidenceSession({
    journal,
    documentId: DOC,
    open: async () => ({ status: "opened", work: workFor(ASSIGNED) }),
    replayer: createBrowserEditStepsV1Replayer,
    createRunner: (work) => createDrainRunner<QueuedTransaction>({
      journal, transport: createEvidenceTransport(net.fetchImpl), verifyFor: evidenceVerifierFor(work),
      now: () => 0, jitter: () => 0.5,
    }),
    network: { online: () => true, onOnline: () => () => undefined },
    clock: () => 0,
    setTimer: () => ({}),
    clearTimer: () => undefined,
  });
  return { session, journal, net };
}

/** A headless editor whose changes go to `session.record` unless muted. */
function editorFor(session: EvidenceSession) {
  const editor = new Editor({ element: null, extensions: createEditorExtensions(), content: canonicalToTiptap(ASSIGNED) });
  editor.view.updateState(editor.state.reconfigure({ plugins: editor.extensionManager.plugins }));
  editors.push(editor);
  let at = Date.parse("2026-10-31T09:00:00.000Z");
  const wiring = { muted: false };
  editor.on("transaction", ({ transaction, appendedTransactions }) => {
    if (!wiring.muted) session.record([transaction, ...appendedTransactions], undefined, (at += 100));
  });
  const type = (text: string) => editor.view.dispatch(editor.state.tr.insertText(text));
  const save = async () => {
    const candidate = tiptapToCanonical(editor.getJSON());
    if (!candidate.ok) throw new Error("not canonical");
    session.edit();
    await session.propose(candidate.doc);
    await session.settled();
    return candidate.doc;
  };
  return { editor, type, save, wiring };
}

async function ready(session: EvidenceSession) {
  const result = await session.load();
  expect(result.kind).toBe("ready");
  await session.settled();
}

describe("M0.1 snimanje 10: a save checks the actual document, even when the missed change was last", () => {
  it("a seen change, then an unseen one right before the save: the save is uncovered as a gap", async () => {
    const { session, journal } = setup();
    await ready(session);
    const saveSegment = vi.spyOn(journal, "saveSegment");
    const sheet = editorFor(session);
    sheet.type("a");
    sheet.wiring.muted = true;
    sheet.type("skriveno");
    // No recorded change after the unseen one: nothing else could reveal it.
    const doc = await sheet.save();
    const { meta, snapshot } = await journal.readEvidence(DOC);
    expect(meta?.evidenceStopped).toBe("gap");
    expect(canonicalizeJcs(snapshot!.document)).toBe(canonicalizeJcs(doc));
    expect(JSON.stringify(doc)).toContain("askrivenoUvod");
    // The seen change got its segment; it ends before the unseen text and never covers it.
    expect(saveSegment).toHaveBeenCalledTimes(1);
    const built = saveSegment.mock.calls[0]![1];
    const ends = new TextDecoder().decode(built.document);
    expect(ends).toContain("aUvod");
    expect(ends).not.toContain("skriveno");
    expect(new TextDecoder().decode(built.bytes)).not.toContain("skriveno");
    expect(session.snapshot().state).not.toBe("SYNCED");
  });

  it("the only change of the session is unseen: the save is a gap and no segment is taken or sent", async () => {
    const { session, journal, net } = setup();
    await ready(session);
    const saveSegment = vi.spyOn(journal, "saveSegment");
    const sheet = editorFor(session);
    sheet.wiring.muted = true;
    sheet.type("skriveno");
    const doc = await sheet.save();
    const { meta, snapshot, pending } = await journal.readEvidence(DOC);
    expect(meta?.evidenceStopped).toBe("gap");
    expect(canonicalizeJcs(snapshot!.document)).toBe(canonicalizeJcs(doc));
    expect(saveSegment).not.toHaveBeenCalled();
    expect(pending).toEqual([]);
    expect(net.calls).toHaveLength(0);
    expect(session.snapshot().state).toBe("LOCAL_DURABLE");
  });

  it("control: the same typing with nothing unseen is covered, not a gap", async () => {
    const { session, journal } = setup();
    await ready(session);
    const sheet = editorFor(session);
    sheet.type("a");
    sheet.type("skriveno");
    await sheet.save();
    expect((await journal.readEvidence(DOC)).meta?.evidenceStopped ?? null).toBeNull();
  });
});
