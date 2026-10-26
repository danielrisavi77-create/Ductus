import { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import { expect } from "vitest";

import { createEditStepsV1Replayer } from "@/adapters/evidence/edit-steps-v1-replayer";
import { verifyCanonicalEvidencePayloadV2 } from "@/domain/forensics/evidence-chain-v2";
import { digestCanonicalDocumentV2, replayEvidenceSegmentsV2 } from "@/domain/forensics/evidence-replay-v2";
import type { EvidenceSourceV2 } from "@/domain/forensics/evidence-segment-v2";
import type { JcsJsonValue } from "@/domain/forensics/jcs";

import { changeOf, EvidenceRecorder, type SegmentContext } from "./capture";
import { tiptapToCanonical } from "./interop";
import { createEditorExtensions } from "./schema";

/**
 * Test harness only (E1, #823): a headless editor whose every change is
 * recorded, and the check that the recorded segment replays on the server's
 * replayer to exactly what the editor holds. Invented ids and text only.
 */

export const ID_A = "aaaaaaaa-0000-4000-8000-00000000000a";

const T0 = Date.parse("2026-10-26T09:00:00.000Z");
const CONTEXT: SegmentContext = {
  documentId: "dokument-izmisljeni",
  sessionId: "11111111-1111-4111-8111-111111111111",
  segmentId: "22222222-2222-4222-8222-222222222222",
  evidenceProfileId: "profil-izmisljeni",
  sequenceFrom: 1,
  predecessorSegmentHash: null,
};

export type Recorded = ReturnType<typeof recordedEditor>;

/** One paragraph with id `ID_A` holding `text`; `as` starts a new event. */
export function recordedEditor(text: string) {
  const editor = new Editor({
    element: null,
    extensions: createEditorExtensions(),
    content: {
      type: "doc",
      content: [{ type: "paragraph", attrs: { nodeId: ID_A }, ...(text ? { content: [{ type: "text", text }] } : {}) }],
    },
  });
  editor.view.updateState(editor.state.reconfigure({ plugins: editor.extensionManager.plugins }));
  const recorder = new EvidenceRecorder();
  const initial = canonical(editor);
  let source: EvidenceSourceV2 = "editor";
  let at = T0 + 5_000;
  editor.on("transaction", ({ transaction, appendedTransactions }) => {
    const all: Transaction[] = [transaction, ...appendedTransactions];
    if (all.some((tr) => tr.docChanged)) recorder.record(changeOf(all, source, (at += 50)));
  });
  return {
    editor, recorder, initial,
    as(next: EvidenceSourceV2) {
      source = next;
      at += 1_000;
    },
  };
}

export function canonical(editor: Editor): JcsJsonValue {
  const candidate = tiptapToCanonical(editor.getJSON());
  if (!candidate.ok) throw new Error("test document is not canonical");
  return candidate.doc as unknown as JcsJsonValue;
}

export function typeChar(editor: Editor, char: string): void {
  editor.view.dispatch(editor.state.tr.insertText(char));
}

/** Type, text and id of every block. */
export const blocks = (editor: Editor) =>
  editor.state.doc.content.content.map((block) => [block.type.name, block.textContent, block.attrs.nodeId as string | null]);

/** The recorder stayed intact and its segment replays to what the editor holds. */
export async function replays(t: Recorded): Promise<void> {
  expect(t.recorder.intact).toBe(true);
  t.recorder.close();
  const built = (await t.recorder.takeSegment(CONTEXT))!;
  expect(built).not.toBeNull();
  const payload = await verifyCanonicalEvidencePayloadV2(built.bytes);
  expect(payload.ok).toBe(true);
  if (!payload.ok) return;
  const replay = await replayEvidenceSegmentsV2(t.initial, [payload.segment], createEditStepsV1Replayer());
  expect(replay).toMatchObject({ ok: true });
  if (replay.ok) {
    expect(replay.documentSha256).toBe(payload.segment.finalDocumentHash);
    expect(replay.documentSha256).toBe((await digestCanonicalDocumentV2(canonical(t.editor))).sha256);
  }
}
