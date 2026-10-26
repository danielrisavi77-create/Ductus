import { getSchema } from "@tiptap/core";
import type { Node as PmNode, ResolvedPos, Schema } from "@tiptap/pm/model";
import { Step } from "@tiptap/pm/transform";

import { validateDocument } from "@/domain/document";
import {
  EDIT_STEP_FORMAT_V1,
  parseEditSteps,
  type EditStepBlock,
  type EditStepV1,
} from "@/domain/document/edit-step";
import type { EvidenceEventV3 } from "@/domain/forensics/evidence-segment-v2";
import { canonicalizeJcs, type JcsJsonValue } from "@/domain/forensics/jcs";
import { canonicalToTiptap, tiptapToCanonical } from "@/editor/interop";
import { createEditorExtensions } from "@/editor/schema";

/**
 * Rules of the `ductus-edit-steps-v1` replayer (B-12, first step), shared by
 * the server and the browser. No Node module may be imported here, directly
 * or through another module: the browser runs this file (granica 8, #638).
 * The steps of an event are applied with ProseMirror on the editor's own F1
 * schema, so the replay rebuilds the document with the same code the editor
 * used. Every step is checked against the document before it is applied; a
 * step that fails a check throws, and `replayEvidenceSegmentsV2` turns any
 * throw into `step_failed`. Nothing is guessed or repaired.
 *
 * Checks done here (obligations of the replayer, description of #213):
 *   1. every position lies in the document and never between the two halves
 *      of a surrogate pair;
 *   2. a range that removes a character or a whole block carries
 *      `removedSha256` and no `structure`, and the hash is the hash of the
 *      removed range (definition below); a range that removes only block
 *      boundaries carries `structure` and no hash;
 *   3. an existing block keeps its identity: `attr` only on a block whose id
 *      is `null`, `replaceAround` wraps exactly one block, keeps its id and
 *      changes its type or level, the open sides of a slice repeat the block
 *      they continue, and the tail of a divided block is new (`null`);
 *   4. after each event every block has an id, no id repeats and the document
 *      passes `validateDocument` (in `toCanonical`);
 *   6. ProseMirror exceptions as well as `StepResult.failed` refuse the step.
 * From obligation 5 only two rules are here: a step reads back as itself and
 * changes the document. The rules that need equal block boundaries and the
 * narrowest mark range are the next step (see the PR description).
 *
 * The hash of check 2 is the one thing this file does not compute: SHA-256 is
 * synchronous in Node and asynchronous in Web Crypto. Where the check is, the
 * replay yields a `RemovedRangeClaim` and stops until its driver has compared
 * the hash (`edit-steps-v1-replayer.ts` in Node, `edit-steps-v1-browser-replayer.ts`
 * in the browser). Both drivers resume at the same point, so the checks run in
 * the same order and refuse with the same code.
 */

/** Why a step was refused. Internal: the replay reports only `step_failed`. */
export class EditStepReplayRefusal extends Error {
  constructor(readonly code: string) {
    super(`edit step refused: ${code}`);
    this.name = "EditStepReplayRefusal";
  }
}

export function refuse(code: string): never {
  throw new EditStepReplayRefusal(code);
}

/**
 * A removed range whose hash the driver must check before the replay goes on:
 * `canonical` is the JCS text of the removed slice, `recorded` the step's
 * `removedSha256`. The driver refuses with `removed_range_hash` unless the
 * SHA-256 of the UTF-8 bytes of `canonical`, in lowercase hex, is `recorded`.
 */
export type RemovedRangeClaim = { readonly canonical: string; readonly recorded: unknown };

/** The replay of one event: yields every claim in order, returns the document. */
export type EditStepsV1Run = Generator<RemovedRangeClaim, PmNode, void>;

let f1Schema: Schema | null = null;

/** The editor's F1 schema, built once. */
function schema(): Schema {
  f1Schema ??= getSchema(createEditorExtensions());
  return f1Schema;
}

/**
 * Definition of `removedSha256` in `ductus-edit-steps-v1`: lowercase hex
 * SHA-256 of the UTF-8 bytes of the RFC 8785 (JCS) form of
 * `document.slice(from, to).toJSON()`, where `document` is the document right
 * before the step (after the earlier steps of the same event). That is
 * ProseMirror's own JSON of the removed slice (without parents): inside one
 * block only its text nodes; across blocks the blocks with every attribute of
 * the schema (`nodeId`, `level`) and `openStart` / `openEnd` when they are not
 * 0. Marks are kept and text is never normalised. This function gives the JCS
 * text; JCS refuses a lone surrogate, so the text is always well-formed and
 * its UTF-8 bytes are the same in every encoder.
 */
export function removedRangeCanonical(document: PmNode, from: number, to: number): string {
  return canonicalizeJcs(document.slice(from, to).toJSON());
}

const isHigh = (unit: number) => unit >= 0xd800 && unit <= 0xdbff;
const isLow = (unit: number) => unit >= 0xdc00 && unit <= 0xdfff;

/** Obligation 1: the position exists and does not split a surrogate pair. */
function at(document: PmNode, pos: number): ResolvedPos {
  if (pos > document.content.size) {
    refuse("position_outside_document");
  }
  const resolved = document.resolve(pos);
  if (resolved.parent.isTextblock) {
    // F1 blocks hold text only, so the offset in the block is the offset in its text.
    const text = resolved.parent.textContent;
    const offset = resolved.parentOffset;
    if (isHigh(text.charCodeAt(offset - 1)) && isLow(text.charCodeAt(offset))) {
      refuse("position_splits_surrogate_pair");
    }
  }
  return resolved;
}

/** Type, level and id: what a block of a slice must repeat to continue a block. */
function sameBlock(written: EditStepBlock, block: PmNode): boolean {
  const level = written.type === "heading" ? written.attrs.level : undefined;
  return (
    written.type === block.type.name &&
    level === block.attrs.level &&
    written.attrs.nodeId === block.attrs.nodeId
  );
}

/** Whether `from..to` holds a character or both ends of one block (QA VAŽNO 1). */
function removesContent(document: PmNode, from: number, to: number): boolean {
  if (document.textBetween(from, to).length > 0) {
    return true;
  }
  let wholeBlock = false;
  document.forEach((block, offset) => {
    wholeBlock ||= offset >= from && offset + block.nodeSize <= to;
  });
  return wholeBlock;
}

function* checkReplace(
  document: PmNode,
  step: Extract<EditStepV1, { stepType: "replace" }>,
): Generator<RemovedRangeClaim, void, void> {
  const $from = at(document, step.from);
  const $to = at(document, step.to);
  if (step.to > step.from) {
    const content = removesContent(document, step.from, step.to);
    if (content !== "removedSha256" in step || content === "structure" in step) {
      refuse("removed_range_record");
    }
    if (content) {
      yield { canonical: removedRangeCanonical(document, step.from, step.to), recorded: step.removedSha256 };
    }
  }
  const slice = step.slice;
  if (!slice || slice.content[0].type === "text") {
    return;
  }
  const blocks = slice.content as EditStepBlock[];
  if ("openStart" in slice && ($from.depth !== 1 || !sameBlock(blocks[0], $from.parent))) {
    refuse("open_start_block");
  }
  if ("openEnd" in slice) {
    const last = blocks[blocks.length - 1];
    const sameParent = $from.depth === 1 && $to.depth === 1 && $from.before() === $to.before();
    const ok = sameParent
      ? last.attrs.nodeId === null
      : $to.depth === 1 && sameBlock(last, $to.parent);
    if (!ok) {
      refuse("open_end_block");
    }
  }
}

function checkReplaceAround(
  document: PmNode,
  step: Extract<EditStepV1, { stepType: "replaceAround" }>,
): void {
  const $from = at(document, step.from);
  at(document, step.to);
  const block = $from.depth === 0 ? document.nodeAt(step.from) : null;
  if (!block || step.from + block.nodeSize !== step.to) {
    refuse("replace_around_range");
  }
  const wrapper = step.slice.content[0] as EditStepBlock;
  if (wrapper.attrs.nodeId !== block.attrs.nodeId) {
    refuse("replace_around_identity");
  }
  const level = wrapper.type === "heading" ? wrapper.attrs.level : undefined;
  if (wrapper.type === block.type.name && level === block.attrs.level) {
    refuse("replace_around_unchanged");
  }
}

function* checkStep(document: PmNode, step: EditStepV1): Generator<RemovedRangeClaim, void, void> {
  switch (step.stepType) {
    case "replace":
      return yield* checkReplace(document, step);
    case "replaceAround":
      return checkReplaceAround(document, step);
    case "addMark":
    case "removeMark":
      at(document, step.from);
      at(document, step.to);
      return;
    case "attr": {
      const $pos = at(document, step.pos);
      const block = $pos.depth === 0 ? document.nodeAt(step.pos) : null;
      if (!block?.isTextblock || block.attrs.nodeId !== null) {
        refuse("attr_identity");
      }
    }
  }
}

function* applyStep(document: PmNode, step: EditStepV1): Generator<RemovedRangeClaim, PmNode, void> {
  yield* checkStep(document, step);
  // ProseMirror does not know `removedSha256`; the rest is its own JSON.
  const pmJson: Record<string, unknown> = { ...step };
  delete pmJson.removedSha256;
  const pmStep = Step.fromJSON(schema(), pmJson);
  if (canonicalizeJcs(pmStep.toJSON()) !== canonicalizeJcs(pmJson)) {
    refuse("step_reads_back_differently");
  }
  const result = pmStep.apply(document);
  if (result.failed !== null || !result.doc) {
    refuse("step_does_not_apply");
  }
  if (result.doc.eq(document)) {
    refuse("step_changes_nothing");
  }
  result.doc.check();
  return result.doc;
}

/** The steps of `event` applied to `document` in order, one claim per removed range. */
export function* runEditStepsV1(document: PmNode, event: EvidenceEventV3): EditStepsV1Run {
  const parsed = parseEditSteps(EDIT_STEP_FORMAT_V1, event.steps);
  if (!parsed.ok) {
    refuse(parsed.code);
  }
  let current = document;
  for (const step of parsed.steps) {
    current = yield* applyStep(current, step);
  }
  return current;
}

/** `load` of the replayer: reads a canonical document, or refuses. */
export function loadEditStepsV1Document(canonical: JcsJsonValue): PmNode {
  const valid = validateDocument(canonical);
  if (!valid.ok) {
    refuse("invalid_document");
  }
  const document = schema().nodeFromJSON(canonicalToTiptap(valid.doc));
  document.check();
  return document;
}

/** `toCanonical` of the replayer: the canonical document, or refuses. */
export function editStepsV1Canonical(document: PmNode): JcsJsonValue {
  // Obligation 4. Checked here because the interop would mint an id for a
  // block without one, or for a repeated one, instead of refusing.
  const seen = new Set<string>();
  document.forEach((block) => {
    const id: unknown = block.attrs.nodeId;
    if (typeof id !== "string" || seen.has(id.toLowerCase())) {
      refuse("block_identity");
    }
    seen.add(id.toLowerCase());
  });
  const canonical = tiptapToCanonical(
    document.toJSON(),
    () => refuse("block_identity"),
    () => refuse("empty_document"),
  );
  if (!canonical.ok) {
    refuse("invalid_document");
  }
  return canonical.doc as unknown as JcsJsonValue;
}
