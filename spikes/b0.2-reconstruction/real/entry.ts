/**
 * B0.2 workload (DAN-388, M3.4-P01): the real code the measurement runs, and
 * nothing of its own. `build.mjs` bundles this into `out/real/real.mjs`; nothing in
 * `src/` imports it.
 */
export { Editor } from "@tiptap/core";

export { createEditStepsV1Replayer } from "@/adapters/evidence/edit-steps-v1-replayer";
export { verifyCanonicalEvidencePayloadV2 } from "@/domain/forensics/evidence-chain-v2";
export { replayEvidenceFromCheckpointV2 } from "@/domain/forensics/evidence-checkpoint-v2";
export { digestCanonicalDocumentV2, replayEvidenceSegmentsV2 } from "@/domain/forensics/evidence-replay-v2";
export {
  changeOf, createEditorExtensions, EvidenceRecorder, MAX_SEGMENT_EVENTS, MAX_SEGMENT_SPAN_MS, tiptapToCanonical,
} from "@/editor";
export { canonicalizeJcs } from "@/domain/forensics/jcs";
