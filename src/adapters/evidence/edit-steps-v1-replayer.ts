import { createHash } from "node:crypto";

import type { Node as PmNode } from "@tiptap/pm/model";

import { EDIT_STEP_FORMAT_V1 } from "@/domain/document/edit-step";
import type { EvidenceStepReplayerV2 } from "@/domain/forensics/evidence-replay-v2";
import type { EvidenceEventV3 } from "@/domain/forensics/evidence-segment-v2";

import {
  editStepsV1Canonical,
  loadEditStepsV1Document,
  refuse,
  removedRangeCanonical,
  runEditStepsV1,
} from "./edit-steps-v1-rules";

/**
 * Server replayer of `ductus-edit-steps-v1` (B-12, first step). The rules are
 * in `edit-steps-v1-rules.ts`, shared with the browser; this driver checks
 * each removed-range hash synchronously with `node:crypto`, at the point the
 * rules ask for it. The browser driver is `edit-steps-v1-browser-replayer.ts`.
 */

export { EditStepReplayRefusal } from "./edit-steps-v1-rules";

const sha256Hex = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/**
 * `removedSha256` of the range `from..to` of `document` (definition at
 * `removedRangeCanonical`, BACKEND 4.1). Capture computes the same value on
 * the client before it sends the step.
 */
export function removedRangeSha256(document: PmNode, from: number, to: number): string {
  return sha256Hex(removedRangeCanonical(document, from, to));
}

/** Replayer of `ductus-edit-steps-v1` for `replayEvidenceSegmentsV2`. */
export function createEditStepsV1Replayer(): EvidenceStepReplayerV2<PmNode> {
  return {
    transactionFormat: EDIT_STEP_FORMAT_V1,
    load: loadEditStepsV1Document,
    apply(document: PmNode, event: EvidenceEventV3): PmNode {
      const run = runEditStepsV1(document, event);
      for (let next = run.next(); ; next = run.next()) {
        if (next.done) {
          return next.value;
        }
        if (sha256Hex(next.value.canonical) !== next.value.recorded) {
          refuse("removed_range_hash");
        }
      }
    },
    toCanonical: editStepsV1Canonical,
  };
}
