import { getSchema } from "@tiptap/core";
import { Fragment, Schema, type Node as PmNode, type NodeSpec, type ResolvedPos } from "@tiptap/pm/model";
import { Step } from "@tiptap/pm/transform";

import { validateVersionedDocument } from "@/domain/document";
import {
  EDIT_STEP_FORMAT_V2,
  parseEditSteps,
  type EditStepBlockOf,
  type EditStepInlineV2,
  type EditStepV2,
} from "@/domain/document/edit-step";
import {
  canonicalMarks,
  isMark,
  isPlainBlockType,
  MAX_DOCUMENT_SOURCES,
  type DocumentSource,
  type InlineNodeV2,
  type Mark,
} from "@/domain/document/schema";
import { EvidenceContentNotSupportedV2 } from "@/domain/forensics/evidence-replay-v2";
import type { EvidenceEventV3 } from "@/domain/forensics/evidence-segment-v2";
import { canonicalizeJcs, type JcsJsonValue } from "@/domain/forensics/jcs";
import { createEditorExtensions } from "@/editor/schema";

import { refuse, removedRangeCanonical, type RemovedRangeClaim } from "./edit-steps-v1-rules";

/**
 * Rules of the `ductus-edit-steps-v2` replayer (DAN-619, contract
 * `docs/contracts/document-schema-v2.md` §5), shared by the server and the
 * browser like the v1 rules: no Node module may be imported here. Everything
 * v1 checks is checked here the same way (`edit-steps-v1-rules.ts`), on the
 * v2 schema below and with three additions:
 *
 *   1. a citation is an atom of one position. A removal that holds one is a
 *      removal of content, so it carries `removedSha256` over the same
 *      `removedRangeCanonical` as v1, which includes `sourceId` and `locator`
 *      (§5.2); `structure` over a citation is refused;
 *   2. `addMark` and `removeMark` never mark a citation: ProseMirror marks
 *      every leaf in the range, so the marks are taken off again. A step is
 *      refused as changing nothing only if ProseMirror's own result is the
 *      document it started from; one that marks a lone citation is accepted
 *      and leaves the document as it was (§3.1, §5.1);
 *   3. `sourceSet` and `sourceRemove` change the list of sources. Replacing
 *      or removing a record yields a claim over the JCS of the old record, so
 *      the driver checks its hash exactly as it checks a removed range (§5.3).
 *
 * Every refusal is internal; `replayEvidenceSegmentsV2` reports `step_failed`.
 */

/** The state a v2 replay carries: the ProseMirror document and the sources. */
export type EditStepsV2Document = { readonly doc: PmNode; readonly sources: readonly DocumentSource[] };

/** The replay of one event: yields every claim in order, returns the state. */
export type EditStepsV2Run = Generator<RemovedRangeClaim, EditStepsV2Document, void>;

const CITATION_SPEC: NodeSpec = {
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  attrs: { sourceId: {}, locator: { default: null } },
};

let v2Schema: Schema | null = null;

/**
 * The F1 schema with the citation atom of schema v2: a heading holds text
 * only (§3.1), every other block also citations. The v2 editor (DAN-620)
 * must use a schema that gives the same JSON, or its steps do not replay.
 */
export function editStepsV2Schema(): Schema {
  if (v2Schema) return v2Schema;
  const f1 = getSchema(createEditorExtensions());
  const heading = f1.spec.nodes.get("heading");
  if (!heading) throw new Error("F1 schema has no heading");
  v2Schema = new Schema({
    topNode: f1.spec.topNode,
    nodes: f1.spec.nodes.update("heading", { ...heading, content: "text*" }).addToEnd("citation", CITATION_SPEC),
    marks: f1.spec.marks,
  });
  return v2Schema;
}

const isHigh = (unit: number) => unit >= 0xd800 && unit <= 0xdbff;
const isLow = (unit: number) => unit >= 0xdc00 && unit <= 0xdfff;

/** The position exists and does not split a surrogate pair. */
function at(document: PmNode, pos: number): ResolvedPos {
  if (pos > document.content.size) {
    refuse("position_outside_document");
  }
  const resolved = document.resolve(pos);
  // A block can hold citations now, so the text around the position is read
  // from the nodes next to it, not from the text of the whole block.
  const before = resolved.nodeBefore;
  const after = resolved.nodeAfter;
  if (before?.isText && after?.isText) {
    const left = before.text ?? "";
    if (isHigh(left.charCodeAt(left.length - 1)) && isLow((after.text ?? "").charCodeAt(0))) {
      refuse("position_splits_surrogate_pair");
    }
  }
  return resolved;
}

type Block = EditStepBlockOf<EditStepInlineV2>;
type ContentStep = Exclude<EditStepV2, { stepType: "sourceSet" | "sourceRemove" }>;

function sameBlock(written: Block, block: PmNode): boolean {
  const level = written.type === "heading" ? written.attrs.level : undefined;
  return (
    written.type === block.type.name &&
    level === block.attrs.level &&
    written.attrs.nodeId === block.attrs.nodeId
  );
}

/** Whether `from..to` holds a character, a citation or both ends of one block. */
function removesContent(document: PmNode, from: number, to: number): boolean {
  if (document.textBetween(from, to, undefined, "￼").length > 0) {
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
  step: Extract<ContentStep, { stepType: "replace" }>,
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
  const first = slice?.content[0];
  if (!slice || first?.type === "text" || first?.type === "citation") {
    return;
  }
  const blocks = slice.content as Block[];
  if ("openStart" in slice && ($from.depth !== 1 || !sameBlock(blocks[0], $from.parent))) {
    refuse("open_start_block");
  }
  if ("openEnd" in slice) {
    const last = blocks[blocks.length - 1];
    const sameParent = $from.depth === 1 && $to.depth === 1 && $from.before() === $to.before();
    const ok = sameParent ? last.attrs.nodeId === null : $to.depth === 1 && sameBlock(last, $to.parent);
    if (!ok) {
      refuse("open_end_block");
    }
  }
}

function checkReplaceAround(
  document: PmNode,
  step: Extract<ContentStep, { stepType: "replaceAround" }>,
): void {
  const $from = at(document, step.from);
  at(document, step.to);
  const block = $from.depth === 0 ? document.nodeAt(step.from) : null;
  if (!block || step.from + block.nodeSize !== step.to) {
    refuse("replace_around_range");
  }
  const wrapper = step.slice.content[0] as Block;
  if (wrapper.attrs.nodeId !== block.attrs.nodeId) {
    refuse("replace_around_identity");
  }
  const level = wrapper.type === "heading" ? wrapper.attrs.level : undefined;
  if (wrapper.type === block.type.name && level === block.attrs.level) {
    refuse("replace_around_unchanged");
  }
}

function* checkStep(document: PmNode, step: ContentStep): Generator<RemovedRangeClaim, void, void> {
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

/**
 * The step in ProseMirror's JSON: without `removedSha256`, and with every
 * citation in the node form `{type, attrs: {sourceId, locator}}`.
 */
function toPmJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toPmJson);
  if (typeof value !== "object" || value === null) return value;
  const object = value as Record<string, unknown>;
  if (object.type === "citation") {
    return { type: "citation", attrs: { locator: object.locator ?? null, sourceId: object.sourceId } };
  }
  return Object.fromEntries(Object.entries(object).map(([key, item]) => [key, toPmJson(item)]));
}

/**
 * The inverse of `toPmJson` for capture: ProseMirror's JSON of a step with
 * every citation in the document form of a slice (§5.1), `locator` left out
 * when it is `null`. Capture adds `removedSha256` itself.
 */
export function editStepJsonV2(pmJson: unknown): unknown {
  if (Array.isArray(pmJson)) return pmJson.map(editStepJsonV2);
  if (typeof pmJson !== "object" || pmJson === null) return pmJson;
  const object = pmJson as Record<string, unknown>;
  if (object.type === "citation" && typeof object.attrs === "object" && object.attrs !== null) {
    const { locator, sourceId } = object.attrs as Record<string, unknown>;
    return locator === null ? { sourceId, type: "citation" } : { locator, sourceId, type: "citation" };
  }
  return Object.fromEntries(Object.entries(object).map(([key, item]) => [key, editStepJsonV2(item)]));
}

/** The document with the marks taken off every citation (§3.1). */
function unmarkCitations(document: PmNode): PmNode {
  let marked = false;
  document.descendants((node) => {
    marked ||= node.type.name === "citation" && node.marks.length > 0;
    return !marked;
  });
  if (!marked) return document;
  const blocks: PmNode[] = [];
  document.forEach((block) => {
    const children: PmNode[] = [];
    block.forEach((child) => children.push(child.type.name === "citation" ? child.mark([]) : child));
    blocks.push(block.copy(Fragment.from(children)));
  });
  return document.copy(Fragment.from(blocks));
}

function* applyContentStep(document: PmNode, step: ContentStep): Generator<RemovedRangeClaim, PmNode, void> {
  yield* checkStep(document, step);
  const pmJson = toPmJson(step) as Record<string, unknown>;
  delete pmJson.removedSha256;
  const pmStep = Step.fromJSON(editStepsV2Schema(), pmJson);
  if (canonicalizeJcs(pmStep.toJSON()) !== canonicalizeJcs(pmJson as JcsJsonValue)) {
    refuse("step_reads_back_differently");
  }
  const result = pmStep.apply(document);
  if (result.failed !== null || !result.doc) {
    refuse("step_does_not_apply");
  }
  // Judged before the citations are unmarked: where the text around a citation
  // already has a mark, ProseMirror's addMark writes a step for the citation
  // alone. That step is the editor's own and leaves the document as it was
  // (§5.1); one that changes nothing even to ProseMirror is still refused.
  if (result.doc.eq(document)) {
    refuse("step_changes_nothing");
  }
  const next = unmarkCitations(result.doc);
  next.check();
  return next;
}

const sourceCanonical = (source: DocumentSource) => canonicalizeJcs(source as unknown as JcsJsonValue);

function* applySourceStep(
  sources: readonly DocumentSource[],
  step: Extract<EditStepV2, { stepType: "sourceSet" | "sourceRemove" }>,
): Generator<RemovedRangeClaim, readonly DocumentSource[], void> {
  const id = step.stepType === "sourceSet" ? step.source.id : step.sourceId;
  const index = sources.findIndex((source) => source.id === id);
  if (step.stepType === "sourceRemove") {
    if (index < 0) refuse("unknown_source");
    yield { canonical: sourceCanonical(sources[index]), recorded: step.removedSha256 };
    return sources.filter((_, i) => i !== index);
  }
  if (index < 0) {
    if ("removedSha256" in step) refuse("removed_range_record");
    if (sources.length >= MAX_DOCUMENT_SOURCES) refuse("too_many_sources");
    return [...sources, step.source];
  }
  if (!("removedSha256" in step)) refuse("removed_range_record");
  const old = sourceCanonical(sources[index]);
  yield { canonical: old, recorded: step.removedSha256 };
  if (sourceCanonical(step.source) === old) refuse("step_changes_nothing");
  return sources.map((source, i) => (i === index ? step.source : source));
}

/** Every node and mark type this replayer knows, in any position. */
function isKnownType(value: string): boolean {
  return (
    value === "heading" || value === "text" || value === "citation" || isPlainBlockType(value) || isMark(value)
  );
}

const TYPE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/**
 * As in v1 (F-150): true when the refused steps name a node or mark type this
 * replayer knows nowhere. Besides attribute values, a source record is also
 * skipped: its `type` is a source type (`book`, ...), never a node type.
 */
function namesUnknownType(steps: unknown): boolean {
  const pending: unknown[] = [steps];
  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value !== "object" || value === null) continue;
    for (const key of Object.keys(value)) {
      const own = Object.getOwnPropertyDescriptor(value, key);
      if (key === "attrs" || key === "value" || key === "source" || own === undefined || !("value" in own)) continue;
      if (key !== "type") pending.push(own.value);
      else if (typeof own.value === "string" && TYPE_NAME.test(own.value) && !isKnownType(own.value)) return true;
    }
  }
  return false;
}

/** The steps of `event` applied to `state` in order, one claim per removed range or record. */
export function* runEditStepsV2(state: EditStepsV2Document, event: EvidenceEventV3): EditStepsV2Run {
  const parsed = parseEditSteps(EDIT_STEP_FORMAT_V2, event.steps);
  if (!parsed.ok) {
    if (namesUnknownType(event.steps)) {
      throw new EvidenceContentNotSupportedV2(parsed.code);
    }
    refuse(parsed.code);
  }
  let { doc, sources } = state;
  for (const step of parsed.steps) {
    if (step.stepType === "sourceSet" || step.stepType === "sourceRemove") {
      sources = yield* applySourceStep(sources, step);
    } else {
      doc = yield* applyContentStep(doc, step);
    }
  }
  return { doc, sources };
}

function inlineToPm(child: InlineNodeV2): Record<string, unknown> {
  if (child.type === "citation") {
    return { type: "citation", attrs: { locator: child.locator ?? null, sourceId: child.sourceId } };
  }
  return child.marks.length > 0
    ? { type: "text", text: child.text, marks: child.marks.map((mark) => ({ type: mark })) }
    : { type: "text", text: child.text };
}

/** `load` of the replayer: reads a canonical v2 document, or refuses (v1 included, §5.4). */
export function loadEditStepsV2Document(canonical: JcsJsonValue): EditStepsV2Document {
  const valid = validateVersionedDocument(canonical);
  if (!valid.ok || valid.doc.schemaVersion !== 2) {
    refuse("invalid_document");
  }
  const content = valid.doc.nodes.map((node) => {
    const attrs = node.type === "heading" ? { level: node.level, nodeId: node.id } : { nodeId: node.id };
    const children = (node.children as InlineNodeV2[]).map(inlineToPm);
    return children.length > 0 ? { type: node.type, attrs, content: children } : { type: node.type, attrs };
  });
  const doc = editStepsV2Schema().nodeFromJSON({ type: "doc", content });
  doc.check();
  return { doc, sources: valid.doc.sources };
}

function inlineToCanonical(child: PmNode): InlineNodeV2 {
  if (child.type.name === "citation") {
    const { sourceId, locator } = child.attrs as { sourceId: unknown; locator: unknown };
    return (locator === null ? { type: "citation", sourceId } : { type: "citation", sourceId, locator }) as InlineNodeV2;
  }
  return { type: "text", text: child.text ?? "", marks: canonicalMarks(child.marks.map((mark) => mark.type.name as Mark)) };
}

/** `toCanonical` of the replayer: the canonical v2 document, or refuses. */
export function editStepsV2Canonical(state: EditStepsV2Document): JcsJsonValue {
  const seen = new Set<string>();
  const nodes: unknown[] = [];
  state.doc.forEach((block) => {
    const id: unknown = block.attrs.nodeId;
    if (typeof id !== "string" || seen.has(id.toLowerCase())) {
      refuse("block_identity");
    }
    seen.add(id.toLowerCase());
    const children: InlineNodeV2[] = [];
    block.forEach((child) => children.push(inlineToCanonical(child)));
    nodes.push(
      block.type.name === "heading"
        ? { type: "heading", id, level: block.attrs.level, children }
        : { type: block.type.name, id, children },
    );
  });
  const valid = validateVersionedDocument({ schemaVersion: 2, nodes, sources: state.sources });
  if (!valid.ok || valid.doc.schemaVersion !== 2) {
    refuse("invalid_document");
  }
  return valid.doc as unknown as JcsJsonValue;
}
