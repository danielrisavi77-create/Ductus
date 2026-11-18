/**
 * The steps of the v2 editor (the one with the citation, DAN-620 b) as the
 * format `ductus-edit-steps-v2` writes them, so that the replayer
 * (`edit-steps-v2-replayer.ts`) ends in the editor's document.
 *
 * The same capture as v1 (`changeSteps` of `capture.ts`), with three rules of
 * the v2 format:
 *
 * - a citation in a slice is written in its document form (`sourceId`,
 *   `locator` when it has one) and never with a mark (contract §3.1, §5.1):
 *   the step is applied here with the marks of its citations taken off, as
 *   the replayer applies what it reads, and written by `editStepJsonV2`;
 * - after every step the citations are unmarked, as the replayer does after
 *   each one (`settle`);
 * - the guard's own transaction (`CITATION_UNMARK_META`, `citation.ts`) is no
 *   step of the author: it is left out, since the replayer has already taken
 *   those marks off. The change still ends in the document after it.
 *
 * Not wired to the recorder yet: the evidence segment takes only the v1
 * format (`evidence-segment-v2.ts`).
 */

import type { Node as PmNode } from "@tiptap/pm/model";
import type { Step } from "@tiptap/pm/transform";
import type { Transaction } from "@tiptap/pm/state";

import { editStepJsonV2 } from "@/adapters/evidence/edit-steps-v2-rules";
import { EDIT_STEP_FORMAT_V2, parseEditSteps } from "@/domain/document/edit-step";
import type { EvidenceSource } from "@/domain/forensics/evidence-segment-v2";
import type { JcsJsonValue } from "@/domain/forensics/jcs";

import { CaptureError, changeSteps, type CaptureRules, type CapturedChange } from "./capture";
import { CITATION, CITATION_UNMARK_META, unmarked } from "./citation";

/** The change of a transaction of the v2 editor and those appended to it, without the guard's own. */
export function changeOfV2(transactions: readonly Transaction[], source: EvidenceSource, at: number): CapturedChange {
  const steps: Step[] = [];
  const docs: PmNode[] = [];
  for (const tr of transactions) {
    if (tr.getMeta(CITATION_UNMARK_META) === true) continue;
    steps.push(...tr.steps);
    docs.push(...tr.docs);
  }
  // A change of the guard alone (initial content unmarked) starts where it ends.
  if (docs.length === 0) docs.push(transactions[0]!.before);
  return { steps, docs, after: transactions[transactions.length - 1]!.doc, source, at };
}

/** A copy of step JSON with no mark on any citation. */
function withoutCitationMarks(json: unknown): unknown {
  if (Array.isArray(json)) return json.map(withoutCitationMarks);
  if (typeof json !== "object" || json === null) return json;
  const object = json as Record<string, unknown>;
  const copy = Object.fromEntries(Object.entries(object).map(([key, item]) => [key, withoutCitationMarks(item)]));
  if (object.type === CITATION) delete copy.marks;
  return copy;
}

const V2_RULES: CaptureRules = {
  written(json) {
    const apply = withoutCitationMarks(json) as Record<string, unknown>;
    return { apply, write: editStepJsonV2(apply) as Record<string, unknown> };
  },
  settle: unmarked,
};

/**
 * Every step of one change of the v2 editor in the canonical form of
 * `ductus-edit-steps-v2`. Throws `CaptureError` as `changeSteps` does, and
 * when the parser refuses the steps.
 */
export async function changeStepsV2(change: CapturedChange): Promise<JcsJsonValue[]> {
  const steps = await changeSteps(change, V2_RULES);
  // A change that leaves the replayer's document as it was writes no event
  // (the parser refuses an empty list); the recorder skips it, as in v1.
  if (steps.length === 0) return [];
  const parsed = parseEditSteps(EDIT_STEP_FORMAT_V2, steps);
  if (!parsed.ok) throw new CaptureError(parsed.code === "too_large" ? "too_large" : "unsupported_step");
  return parsed.steps as unknown as JcsJsonValue[];
}
