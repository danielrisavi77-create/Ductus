// @vitest-environment node
import { describe, expect, it } from "vitest";

import { createEditStepsV1Replayer } from "@/adapters/evidence/edit-steps-v1-replayer";
import { verifyCanonicalEvidencePayloadV2 } from "@/domain/forensics/evidence-chain-v2";
import { digestCanonicalDocumentV2, replayEvidenceSegmentsV2 } from "@/domain/forensics/evidence-replay-v2";
import {
  EVIDENCE_SEGMENT_SCHEMA_V2,
  EVIDENCE_SEGMENT_SCHEMA_V3,
} from "@/domain/forensics/evidence-segment-v2";

import type { SegmentContext } from "./capture";
import { canonical, recordedEditor, typeChar } from "./capture.fixture";

/**
 * DAN-343 (contract on #896, P1): the recorder writes a segment as v3 only
 * when one of its events is citation-form, and every other segment keeps its
 * v2 bytes. The attribution itself comes with #866; here the test sets it.
 * Invented text and ids only.
 */

const CONTEXT: SegmentContext = {
  documentId: "dokument-izmisljeni",
  sessionId: "11111111-1111-4111-8111-111111111111",
  segmentId: "22222222-2222-4222-8222-222222222222",
  evidenceProfileId: "profil-izmisljeni",
  sequenceFrom: 1,
  predecessorSegmentHash: null,
};

async function recorded(withCitation: boolean) {
  const t = recordedEditor("Uvod");
  t.editor.commands.setTextSelection(5);
  for (const char of " navodi ") typeChar(t.editor, char);
  if (withCitation) {
    t.as("citation-form");
    t.editor.view.dispatch(t.editor.state.tr.insertText("(Primjer, 2026, str. 7)"));
  }
  t.as("editor");
  typeChar(t.editor, ".");
  t.recorder.close();
  const built = (await t.recorder.takeSegment(CONTEXT))!;
  return { t, built };
}

describe("capture: the schema of a segment (v3)", () => {
  it("writes v3 for a segment with a citation-form event, and the server's check accepts and replays it", async () => {
    const { t, built } = await recorded(true);
    expect(built.segment.evidenceSchema).toBe(EVIDENCE_SEGMENT_SCHEMA_V3);
    expect(built.segment.events.map((event) => event.source)).toEqual(["editor", "citation-form", "editor"]);
    const payload = await verifyCanonicalEvidencePayloadV2(built.bytes);
    expect(payload).toMatchObject({ ok: true, sha256: built.sha256 });
    if (!payload.ok) return;
    const replay = await replayEvidenceSegmentsV2(t.initial, [payload.segment], createEditStepsV1Replayer());
    expect(replay).toMatchObject({ ok: true, documentSha256: payload.segment.finalDocumentHash });
    expect(payload.segment.finalDocumentHash).toBe((await digestCanonicalDocumentV2(canonical(t.editor))).sha256);
  });

  it("keeps v2 for a segment without one", async () => {
    const { built } = await recorded(false);
    expect(built.segment.evidenceSchema).toBe(EVIDENCE_SEGMENT_SCHEMA_V2);
    expect(built.segment.events.map((event) => event.source)).toEqual(["editor", "editor"]);
    expect(new TextDecoder().decode(built.bytes)).toContain('"evidenceSchema":"ductus-evidence-segment-v2"');
    expect(await verifyCanonicalEvidencePayloadV2(built.bytes)).toMatchObject({ ok: true, sha256: built.sha256 });
  });
});
