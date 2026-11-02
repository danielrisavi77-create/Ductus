// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";

import type { CanonicalDocument } from "@/domain/document/schema";
import { verifyDocumentSnapshot } from "@/domain/document/snapshot";
import { canonicalizeJcs } from "@/domain/forensics/jcs";

import { changeOf, EvidenceRecorder, type SegmentContext } from "./capture";
import { canonical, recordedEditor, replays, typeChar, type Recorded } from "./capture.fixture";
import { canonicalToTiptap } from "./interop";
import { createEditorExtensions } from "./schema";

// DAN-453 PR 0 (contract on #1091, attack plan #1258 A1 and A2): a v1
// document opens, edits and saves as v1 with the same bytes, and moving the
// cursor or the selection writes nothing. The document is the vector derived
// outside the code; every id and text in it is invented.

type DocumentVector = { name: string; value: CanonicalDocument; utf8Hex: string; sha256: string };

function v1Vector(): DocumentVector {
  const bytes = readFileSync(new URL("../domain/forensics/golden-vectors/format-reservation.json", import.meta.url));
  if (bytes.some((byte) => byte > 0x7e || byte === 0x0d)) throw new Error("vectors must be ASCII with LF");
  const vectors = (JSON.parse(bytes.toString("latin1")) as { documentsV1: DocumentVector[] }).documentsV1;
  return vectors.find((entry) => entry.name === "v1-every-block-type")!;
}

const VECTOR = v1Vector();
const VECTOR_TEXT = Buffer.from(VECTOR.utf8Hex, "hex").toString("utf8");
const CONTEXT: SegmentContext = {
  documentId: "dokument-izmisljeni",
  sessionId: "11111111-1111-4111-8111-111111111111",
  segmentId: "22222222-2222-4222-8222-222222222222",
  evidenceProfileId: "profil-izmisljeni",
  sequenceFrom: 1,
  predecessorSegmentHash: null,
};

/** The vector's document in a headless editor whose every change is recorded. */
function recordedVector(): Recorded {
  const editor = new Editor({
    element: null,
    extensions: createEditorExtensions(),
    content: canonicalToTiptap(VECTOR.value),
  });
  editor.view.updateState(editor.state.reconfigure({ plugins: editor.extensionManager.plugins }));
  const recorder = new EvidenceRecorder();
  const initial = canonical(editor);
  let at = Date.parse("2026-10-26T09:00:05.000Z");
  editor.on("transaction", ({ transaction, appendedTransactions }) => {
    const all: Transaction[] = [transaction, ...appendedTransactions];
    if (all.some((tr) => tr.docChanged)) recorder.record(changeOf(all, "editor", (at += 50)));
  });
  return { editor, recorder, initial, as: () => {} };
}

const jcs = (editor: Editor) => canonicalizeJcs(canonical(editor));
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

describe("schema v1 compatibility", () => {
  it("A1: a v1 document opens and saves with the same bytes and hash", async () => {
    const t = recordedVector();
    expect(jcs(t.editor)).toBe(VECTOR_TEXT);
    expect(sha256(jcs(t.editor))).toBe(VECTOR.sha256);
    const snapshot = await verifyDocumentSnapshot(new TextEncoder().encode(jcs(t.editor)));
    expect(snapshot).toMatchObject({ ok: true, sha256: VECTOR.sha256 });
    expect(t.recorder.pendingEvents).toBe(0);
  });

  it("A1: an edit with no new node stays v1, and its segment replays to the editor's document", async () => {
    const t = recordedVector();
    t.editor.commands.setTextSelection(4);
    typeChar(t.editor, "x");
    const edited = canonical(t.editor) as { schemaVersion: number };
    expect(edited.schemaVersion).toBe(1);
    expect(jcs(t.editor)).not.toBe(VECTOR_TEXT);
    t.editor.view.dispatch(t.editor.state.tr.delete(4, 5));
    expect(jcs(t.editor)).toBe(VECTOR_TEXT);
    await replays(t);
  });

  it("A2: moving the cursor or the selection writes no event and keeps the bytes", async () => {
    const t = recordedVector();
    const size = t.editor.state.doc.content.size;
    for (const position of [1, 4, size - 1, 2]) t.editor.commands.setTextSelection(position);
    t.editor.commands.setTextSelection({ from: 2, to: size - 2 });
    t.editor.commands.selectAll();
    t.editor.commands.focus("end");
    expect(t.recorder.pendingEvents).toBe(0);
    t.recorder.close();
    expect(t.recorder.pendingEvents).toBe(0);
    await expect(t.recorder.takeSegment(CONTEXT)).resolves.toBeNull();
    expect(jcs(t.editor)).toBe(VECTOR_TEXT);
  });

  it("A2: a selection between two edits adds nothing to the recorded segment", async () => {
    const t = recordedEditor("abc");
    typeChar(t.editor, "d");
    t.editor.commands.setTextSelection(1);
    t.editor.commands.setTextSelection({ from: 1, to: 3 });
    t.editor.commands.setTextSelection(5);
    typeChar(t.editor, "e");
    t.recorder.close();
    expect(t.recorder.pendingEvents).toBe(1);
    await replays(t);
  });
});
