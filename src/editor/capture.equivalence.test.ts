// @vitest-environment node
import { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";

import { createEditStepsV1Replayer } from "@/adapters/evidence/edit-steps-v1-replayer";
import { verifyDocumentSnapshot } from "@/domain/document/snapshot";
import { verifyCanonicalEvidencePayloadV2 } from "@/domain/forensics/evidence-chain-v2";
import { digestCanonicalDocumentV2, replayEvidenceSegmentsV2 } from "@/domain/forensics/evidence-replay-v2";
import type { EvidenceSourceV2 } from "@/domain/forensics/evidence-segment-v2";
import type { JcsJsonValue } from "@/domain/forensics/jcs";

import { changeOf, EvidenceRecorder, type SegmentContext } from "./capture";
import { tiptapToCanonical } from "./interop";
import { createEditorExtensions } from "./schema";

/**
 * M0.1 continuation (DAN-376, #1071): capture cases of the core port that had
 * no Ductus test (map `docs/engineering/prijenos-jezgre-M0.1-jednakovrijednost.md`,
 * snimanje 2 and 8). Synthetic text and ids only.
 */

const ID_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const T0 = Date.parse("2026-10-31T09:00:00.000Z");
const CONTEXT: SegmentContext = {
  documentId: "dokument-izmisljeni",
  sessionId: "11111111-1111-4111-8111-111111111111",
  segmentId: "22222222-2222-4222-8222-222222222222",
  evidenceProfileId: "profil-izmisljeni",
  sequenceFrom: 1,
  predecessorSegmentHash: null,
};

/** An editor whose every change is recorded with the source and time the test sets (as in capture.test.ts). */
function setup(text = "Odlomak B") {
  const editor = new Editor({
    element: null,
    extensions: createEditorExtensions(),
    content: { type: "doc", content: [{ type: "paragraph", attrs: { nodeId: ID_A }, content: [{ type: "text", text }] }] },
  });
  editor.view.updateState(editor.state.reconfigure({ plugins: editor.extensionManager.plugins }));
  const recorder = new EvidenceRecorder();
  const initial = canonical(editor);
  let source: EvidenceSourceV2 = "editor";
  let at = T0 + 5_000;
  editor.on("transaction", ({ transaction, appendedTransactions }) => {
    const all: Transaction[] = [transaction, ...appendedTransactions];
    if (all.some((tr) => tr.docChanged)) recorder.record(changeOf(all, source, at));
  });
  return {
    editor, recorder, initial,
    as(next: EvidenceSourceV2, wait = 50) {
      source = next;
      at += wait;
    },
    type(chars: string, wait = 50) {
      for (const char of chars) {
        at += wait;
        editor.view.dispatch(editor.state.tr.insertText(char));
      }
    },
  };
}

function canonical(editor: Editor): JcsJsonValue {
  const candidate = tiptapToCanonical(editor.getJSON());
  if (!candidate.ok) throw new Error("test document is not canonical");
  return candidate.doc as unknown as JcsJsonValue;
}

/** The segment verifies, replays on the server's replayer, and ends on the editor's own document. */
async function replaysTo(editor: Editor, initial: JcsJsonValue, built: { bytes: Uint8Array; document: Uint8Array }) {
  const payload = await verifyCanonicalEvidencePayloadV2(built.bytes);
  expect(payload.ok).toBe(true);
  if (!payload.ok) return;
  const replay = await replayEvidenceSegmentsV2(initial, [payload.segment], createEditStepsV1Replayer());
  const snapshot = await verifyDocumentSnapshot(built.document);
  expect(replay).toMatchObject({ ok: true });
  expect(snapshot).toMatchObject({ ok: true });
  const expected = await digestCanonicalDocumentV2(canonical(editor));
  if (replay.ok) expect(replay.documentSha256).toBe(expected.sha256);
  expect(payload.segment.finalDocumentHash).toBe(expected.sha256);
  expect(new TextDecoder().decode(built.document)).toBe(expected.canonical);
}

const textOf = (editor: Editor) => editor.state.doc.textContent;

describe("M0.1 snimanje 2: Croatian and emoji text replays exactly", () => {
  it("typed Croatian letters, an emoji and a ZWJ sequence replay to the same document", async () => {
    const t = setup("Uvod");
    t.editor.commands.setTextSelection(5);
    // for..of walks code points, so the ZWJ sequence goes in as three changes.
    t.type(" Čćžšđ ČĆŽŠĐ 😀 👩‍💻");
    t.recorder.close();
    const built = await t.recorder.takeSegment(CONTEXT);
    expect(built).not.toBeNull();
    expect(textOf(t.editor)).toBe("Uvod Čćžšđ ČĆŽŠĐ 😀 👩‍💻");
    await replaysTo(t.editor, t.initial, built!);
  });

  it("an emoji inserted whole, pasted, and one deleted whole (both halves) replay", async () => {
    const t = setup("Uvod");
    t.editor.commands.setTextSelection(5);
    t.editor.view.dispatch(t.editor.state.tr.insertText(" 🇭🇷 i 😀"));
    t.as("paste", 500);
    t.editor.view.dispatch(t.editor.state.tr.insertText(" đak 🧑🏽‍🎓"));
    t.as("editor", 500);
    // "😀" sits right before " đak": remove both of its UTF-16 units.
    const end = t.editor.state.doc.content.size - 1;
    const from = end - " đak 🧑🏽‍🎓".length - "😀".length;
    t.editor.view.dispatch(t.editor.state.tr.delete(from, from + "😀".length));
    t.recorder.close();
    const built = await t.recorder.takeSegment(CONTEXT);
    expect(built).not.toBeNull();
    expect(textOf(t.editor)).toBe("Uvod 🇭🇷 i  đak 🧑🏽‍🎓");
    expect(built!.segment.events.map((e) => e.source)).toEqual(["editor", "paste", "editor"]);
    await replaysTo(t.editor, t.initial, built!);
  });
});

describe("M0.1 snimanje 8: a transaction changed after capture never changes the evidence", () => {
  it("changeOf keeps its own copy of the steps and documents", () => {
    const { editor } = setup("Odlomak");
    const tr = editor.state.tr.insertText("x", 8);
    const change = changeOf([tr], "editor", T0);
    const steps = [...change.steps];
    const docs = [...change.docs];
    const after = change.after;
    tr.insertText("naknadno", 9);
    tr.delete(1, 3);
    expect(tr.steps).toHaveLength(3);
    expect(change.steps).toEqual(steps);
    expect(change.steps).toHaveLength(1);
    expect(change.docs).toEqual(docs);
    expect(change.after).toBe(after);
    expect(change.after.textContent).toBe("Odlomakx");
  });

  it("a dispatched transaction changed afterwards: the segment still replays to the editor's document", async () => {
    const t = setup("Odlomak");
    t.editor.commands.setTextSelection(8);
    t.type(" a");
    const tr = t.editor.state.tr.insertText("b");
    t.editor.view.dispatch(tr);
    // The recorder took the change during dispatch; these edits land on a spent transaction.
    tr.insertText("naknadno");
    tr.delete(1, 4);
    t.type("c");
    t.recorder.close();
    const built = await t.recorder.takeSegment(CONTEXT);
    expect(built).not.toBeNull();
    expect(textOf(t.editor)).toBe("Odlomak abc");
    await replaysTo(t.editor, t.initial, built!);
  });
});
