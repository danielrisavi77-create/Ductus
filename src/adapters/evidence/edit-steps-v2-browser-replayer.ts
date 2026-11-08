import { EDIT_STEP_FORMAT_V2 } from "@/domain/document/edit-step";
import { sha256WebCrypto } from "@/domain/forensics/crypto";
import type { AsyncEvidenceStepReplayerV2 } from "@/domain/forensics/evidence-replay-v2";
import type { EvidenceEventV3 } from "@/domain/forensics/evidence-segment-v2";

import { refuse } from "./edit-steps-v1-rules";
import {
  editStepsV2Canonical,
  loadEditStepsV2Document,
  runEditStepsV2,
  type EditStepsV2Document,
} from "./edit-steps-v2-rules";

/**
 * Browser entry of the `ductus-edit-steps-v2` replayer: the same rules and the
 * same order of checks as `edit-steps-v2-replayer.ts`, with every claim hashed
 * by Web Crypto, so `apply` is async. No Node module may be imported here.
 * Without Web Crypto every hash fails and the replay fails closed, as in v1.
 */
export function createBrowserEditStepsV2Replayer(): AsyncEvidenceStepReplayerV2<EditStepsV2Document> {
  return {
    transactionFormat: EDIT_STEP_FORMAT_V2,
    load: loadEditStepsV2Document,
    async apply(state: EditStepsV2Document, event: EvidenceEventV3): Promise<EditStepsV2Document> {
      const run = runEditStepsV2(state, event);
      for (let next = run.next(); ; next = run.next()) {
        if (next.done) {
          return next.value;
        }
        if ((await sha256WebCrypto(next.value.canonical)) !== next.value.recorded) {
          refuse("removed_range_hash");
        }
      }
    },
    toCanonical: editStepsV2Canonical,
  };
}
