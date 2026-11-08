import { createHash } from "node:crypto";

import { EDIT_STEP_FORMAT_V2 } from "@/domain/document/edit-step";
import type { DocumentSource } from "@/domain/document/schema";
import type { EvidenceStepReplayerV2 } from "@/domain/forensics/evidence-replay-v2";
import type { EvidenceEventV3 } from "@/domain/forensics/evidence-segment-v2";
import { canonicalizeJcs, type JcsJsonValue } from "@/domain/forensics/jcs";

import { refuse } from "./edit-steps-v1-rules";
import {
  editStepsV2Canonical,
  loadEditStepsV2Document,
  runEditStepsV2,
  type EditStepsV2Document,
} from "./edit-steps-v2-rules";

/**
 * Server replayer of `ductus-edit-steps-v2` (DAN-619, contract §5). The rules
 * are in `edit-steps-v2-rules.ts`, shared with the browser; this driver checks
 * each claim (a removed range or an old source record) synchronously with
 * `node:crypto`, at the point the rules ask for it. The browser driver is
 * `edit-steps-v2-browser-replayer.ts`.
 */

const sha256Hex = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/**
 * `removedSha256` of a `sourceSet` that replaces `source`, or of a
 * `sourceRemove` of it (§5.3): SHA-256 of the JCS of the record as the
 * document holds it right before the step. A removed range is hashed with
 * `removedRangeSha256` from the v1 driver; the definition is the same.
 */
export function sourceRecordSha256(source: DocumentSource): string {
  return sha256Hex(canonicalizeJcs(source as unknown as JcsJsonValue));
}

/** Replayer of `ductus-edit-steps-v2` for `replayEvidenceSegmentsV2`. */
export function createEditStepsV2Replayer(): EvidenceStepReplayerV2<EditStepsV2Document> {
  return {
    transactionFormat: EDIT_STEP_FORMAT_V2,
    load: loadEditStepsV2Document,
    apply(state: EditStepsV2Document, event: EvidenceEventV3): EditStepsV2Document {
      const run = runEditStepsV2(state, event);
      for (let next = run.next(); ; next = run.next()) {
        if (next.done) {
          return next.value;
        }
        if (sha256Hex(next.value.canonical) !== next.value.recorded) {
          refuse("removed_range_hash");
        }
      }
    },
    toCanonical: editStepsV2Canonical,
  };
}
