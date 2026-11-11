import { createHash } from "node:crypto";

import type { Node as PmNode } from "@tiptap/pm/model";
import { Transform } from "@tiptap/pm/transform";

import { createEditStepsV1Replayer, removedRangeSha256 } from "@/adapters/evidence/edit-steps-v1-replayer";
import { EDIT_STEP_FORMAT_V1 } from "@/domain/document/edit-step";
import {
  canonicalEvidenceSegmentV2,
  EVIDENCE_CANONICALIZATION_V2,
  EVIDENCE_HASH_ALGORITHM_V2,
  EVIDENCE_SEGMENT_SCHEMA_V2,
  type EvidenceSourceV2,
  type EvidenceStepV2,
} from "@/domain/forensics/evidence-segment-v2";
import { canonicalizeJcs, type JcsJsonValue } from "@/domain/forensics/jcs";

/**
 * Synthetic replay records for tests (DAN-537): invented ids and filler text,
 * no real work or person. Each segment is a list of events, each event the
 * steps of one transaction, written as capture writes them.
 */

export const BLOCK_A = "aaaaaaaa-0000-4000-8000-000000000001";
export const BLOCK_B = "aaaaaaaa-0000-4000-8000-000000000002";
export const BLOCK_C = "aaaaaaaa-0000-4000-8000-000000000003";
export const BLOCK_D = "aaaaaaaa-0000-4000-8000-000000000004";
export const RECORD_DOCUMENT_ID = "doc-test-z1";

const text = (value: string) => ({ type: "text", text: value, marks: [] });
export const START_DOCUMENT: JcsJsonValue = {
  schemaVersion: 1,
  nodes: [
    { type: "paragraph", id: BLOCK_A, children: [text("Odlomak A lorem.")] },
    { type: "heading", id: BLOCK_B, level: 2, children: [text("Odlomak B")] },
    { type: "paragraph", id: BLOCK_C, children: [text("Odlomak C ipsum.")] },
  ],
};

export const serverReplayer = createEditStepsV1Replayer();
export const recordSchema = serverReplayer.load(START_DOCUMENT).type.schema;
export const startNode = serverReplayer.load(START_DOCUMENT);
export const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
export const jcsOf = (document: PmNode) => canonicalizeJcs(serverReplayer.toCanonical(document));

export type RecordEdit = { source?: EvidenceSourceV2; edit: (tr: Transform) => void };
/** `from` starts the segment from another document: a break in the chain. */
export type RecordSegmentPlan = { at: string; until?: string; events: RecordEdit[]; from?: PmNode };

export function buildRecord(start: PmNode, plans: RecordSegmentPlan[]) {
  const segments: string[] = [];
  const hashes: string[] = [];
  const ends: PmNode[] = [];
  let document = start;
  let sequence = 0;
  for (const [index, plan] of plans.entries()) {
    document = plan.from ?? document;
    const initial = sha(jcsOf(document));
    const events = plan.events.map(({ source, edit }) => {
      const tr = new Transform(document);
      edit(tr);
      const json = tr.steps.map((step, i) => {
        const value = step.toJSON() as Record<string, unknown>;
        if (value.stepType === "replace" && (value.to as number) > (value.from as number) && !value.structure) {
          value.removedSha256 = removedRangeSha256(tr.docs[i], value.from as number, value.to as number);
        }
        return JSON.parse(JSON.stringify(value)) as EvidenceStepV2;
      });
      const before = sha(jcsOf(document));
      document = tr.doc;
      sequence++;
      return { sequence, source: source ?? "editor", steps: json, beforeDocumentHash: before, afterDocumentHash: sha(jcsOf(document)) };
    });
    const payload = canonicalEvidenceSegmentV2({
      evidenceSchema: EVIDENCE_SEGMENT_SCHEMA_V2,
      canonicalization: EVIDENCE_CANONICALIZATION_V2,
      hashAlgorithm: EVIDENCE_HASH_ALGORITHM_V2,
      documentId: RECORD_DOCUMENT_ID,
      sessionId: "session-test",
      segmentId: `segment-${index + 1}`,
      sequenceFrom: events[0].sequence,
      sequenceTo: events[events.length - 1].sequence,
      observedStartedAt: `2026-10-20T${plan.at}:00.000Z`,
      observedEndedAt: `2026-10-20T${plan.until ?? plan.at}:00.000Z`,
      initialDocumentHash: initial,
      finalDocumentHash: sha(jcsOf(document)),
      predecessorSegmentHash: hashes.at(-1) ?? null,
      events,
      captureContext: { editorModel: "prosemirror", transactionFormat: EDIT_STEP_FORMAT_V1 },
      evidenceProfileId: "standard-v1",
    });
    segments.push(payload);
    hashes.push(sha(payload));
    ends.push(document);
  }
  return { segments, hashes, ends, head: hashes.length ? { segmentHash: hashes.at(-1)!, segmentCount: hashes.length } : null };
}

export type BuiltRecord = ReturnType<typeof buildRecord>;
