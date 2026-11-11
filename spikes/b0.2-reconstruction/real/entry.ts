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
export { changeOf, EvidenceRecorder, MAX_SEGMENT_EVENTS, MAX_SEGMENT_SPAN_MS } from "@/editor/capture";
export { canonicalizeJcs } from "@/domain/forensics/jcs";
export { tiptapToCanonical } from "@/editor/interop";
export { createEditorExtensions } from "@/editor/schema";
