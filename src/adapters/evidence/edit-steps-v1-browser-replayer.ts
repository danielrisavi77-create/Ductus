import type { Node as PmNode } from "@tiptap/pm/model";

import { EDIT_STEP_FORMAT_V1 } from "@/domain/document/edit-step";
import { sha256WebCrypto } from "@/domain/forensics/crypto";
import type { AsyncEvidenceStepReplayerV2 } from "@/domain/forensics/evidence-replay-v2";
import type { EvidenceEventV3 } from "@/domain/forensics/evidence-segment-v2";

import {
  editStepsV1Canonical,
  loadEditStepsV1Document,
  refuse,
  removedRangeCanonical,
  runEditStepsV1,
} from "./edit-steps-v1-rules";

/**
 * Browser entry of the `ductus-edit-steps-v1` replayer (granica 8, #638): the
 * browser checks every segment with the same rules as the server before it
 * sends it. Same rules (`edit-steps-v1-rules.ts`), same order of checks; only
 * the removed-range hash is computed with Web Crypto, so `apply` is async.
 * Use it as `replayEvidenceSegmentsV2(initial, segments, createBrowserEditStepsV1Replayer())`.
 *
 * No Node module may be imported here, directly or through another module.
 * Without Web Crypto (no secure context) every hash fails, so the replay
 * fails closed: never `ok: true`, and a refusal then does not mean the segment
 * is wrong. Check `globalThis.crypto?.subtle` before relying on a refusal.
 */

/** `removedSha256` of `from..to` in `document`, as `removedRangeSha256` gives it on the server. */
export function removedRangeSha256WebCrypto(document: PmNode, from: number, to: number): Promise<string> {
  return sha256WebCrypto(removedRangeCanonical(document, from, to));
}

/** Replayer of `ductus-edit-steps-v1` for `replayEvidenceSegmentsV2` in the browser. */
export function createBrowserEditStepsV1Replayer(): AsyncEvidenceStepReplayerV2<PmNode> {
  return {
    transactionFormat: EDIT_STEP_FORMAT_V1,
    load: loadEditStepsV1Document,
    async apply(document: PmNode, event: EvidenceEventV3): Promise<PmNode> {
      const run = runEditStepsV1(document, event);
      for (let next = run.next(); ; next = run.next()) {
        if (next.done) {
          return next.value;
        }
        if ((await sha256WebCrypto(next.value.canonical)) !== next.value.recorded) {
          refuse("removed_range_hash");
        }
      }
    },
    toCanonical: editStepsV1Canonical,
  };
}
