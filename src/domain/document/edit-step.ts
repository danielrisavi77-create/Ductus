/**
 * Serialised form of one editing step, shared by the client and the server.
 *
 * Pure: no DOM, no editor library, no clock, no I/O. The editor's capture and
 * the server's replayer both read steps through `parseEditStep`, so neither
 * can accept a shape the other does not know.
 *
 * The shape is the JSON that ProseMirror's own steps serialise to, narrowed
 * to what the F1 schema can produce (paragraph, heading 1-3, text, bold,
 * italic), plus `removedSha256` on a step that removes content. Everything
 * else is refused, never guessed:
 *   - every object has a closed set of keys, so an unknown field, a
 *     `__proto__` or `constructor` key and any time field (owner decision 6:
 *     steps carry no time) have nowhere to sit;
 *   - a step has exactly one serialised form: optional parts are absent
 *     rather than empty, `false` or `0`;
 *   - positions are non-negative safe integers; whether they lie inside a
 *     document is the replayer's check, because only it holds the document;
 *   - text is well-formed Unicode without NUL and is never normalised: the
 *     hash covers exactly what was recorded.
 *
 * The result is a fresh copy built from known fields only, with keys in
 * sorted order, so `JSON.stringify` of it is already its RFC 8785 form.
 */

import { isPlainObject } from "../json";
import {
  isHeadingLevel,
  isMark,
  isNodeId,
  MARK_ORDER,
  type HeadingLevel,
  type Mark,
  type NodeId,
} from "./schema";

/** Value of `captureContext.transactionFormat` for this step format. */
export const EDIT_STEP_FORMAT_V1 = "ductus-edit-steps-v1" as const;

export const EDIT_STEP_TYPES = [
  "replace",
  "replaceAround",
  "addMark",
  "removeMark",
  "attr",
] as const;

export type EditStepType = (typeof EDIT_STEP_TYPES)[number];

/**
 * Upper bound of one step, and of all steps of one event, in bytes: the limit of a whole evidence segment
 * (D-96, 2 MiB). A step is counted by a lower bound of its canonical size, so
 * a step refused here could not have fitted into a segment either.
 */
export const MAX_EDIT_STEP_BYTES = 2_097_152;

export type EditStepMark = { type: Mark };
export type EditStepText = { marks?: EditStepMark[]; text: string; type: "text" };
/** `nodeId` is `null` only on a block the editor has not yet given an id. */
export type EditStepBlock =
  | { attrs: { nodeId: NodeId | null }; content?: EditStepText[]; type: "paragraph" }
  | {
      attrs: { level: HeadingLevel; nodeId: NodeId | null };
      content?: EditStepText[];
      type: "heading";
    };
export type EditStepSlice = {
  content: EditStepBlock[] | EditStepText[];
  openEnd?: 1;
  openStart?: 1;
};

export type EditStepV1 =
  | {
      from: number;
      /** Present exactly when the step removes content: `to > from`, not `structure`. */
      removedSha256?: string;
      slice?: EditStepSlice;
      stepType: "replace";
      structure?: true;
      to: number;
    }
  | {
      from: number;
      gapFrom: number;
      gapTo: number;
      insert: 1;
      slice: EditStepSlice;
      stepType: "replaceAround";
      structure: true;
      to: number;
    }
  | { from: number; mark: EditStepMark; stepType: "addMark" | "removeMark"; to: number }
  | { attr: "nodeId"; pos: number; stepType: "attr"; value: NodeId };

export const EDIT_STEP_REJECTIONS = [
  "unsupported_format",
  "steps_not_array",
  "steps_empty",
  "not_object",
  "forbidden_key",
  "unknown_field",
  "missing_field",
  "unknown_step_type",
  "invalid_position",
  "invalid_value",
  "invalid_slice",
  "invalid_node",
  "invalid_mark",
  "invalid_text",
  "invalid_node_id",
  "invalid_removed_hash",
  "too_large",
  "unreadable",
] as const;

export type EditStepRejection = (typeof EDIT_STEP_REJECTIONS)[number];

export type EditStepResult =
  | { ok: true; step: EditStepV1 }
  | { ok: false; code: EditStepRejection; path: string };

export type EditStepsResult =
  | { ok: true; steps: EditStepV1[] }
  | { ok: false; code: EditStepRejection; path: string };

class Rejected extends Error {
  constructor(
    readonly code: EditStepRejection,
    readonly path: string,
  ) {
    super(code);
  }
}

function reject(code: EditStepRejection, path: string): never {
  throw new Rejected(code, path);
}

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const SHA256_HEX = /^[0-9a-f]{64}$/;
/** Smaller than the canonical form of any node, mark or step. */
const MIN_OBJECT_BYTES = 16;

/** No array that fits the byte limit is longer; checked before it is copied. */
const MAX_ITEMS = MAX_EDIT_STEP_BYTES / MIN_OBJECT_BYTES;

type Budget = { bytes: number };

function spend(budget: Budget, bytes: number, path: string): void {
  budget.bytes += bytes;
  if (budget.bytes > MAX_EDIT_STEP_BYTES) {
    reject("too_large", path);
  }
}

/**
 * Own values of a plain object whose keys are exactly `required` plus any of
 * `optional`. Inherited members are never read, and every own key counts,
 * enumerable or not.
 */
function fields(
  value: unknown,
  path: string,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (!isPlainObject(value)) {
    reject("not_object", path);
  }
  const own: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || FORBIDDEN_KEYS.has(key)) {
      reject("forbidden_key", path);
    }
    if (!required.includes(key) && !optional.includes(key)) {
      reject("unknown_field", `${path}.${key}`);
    }
    own[key] = value[key];
  }
  for (const key of required) {
    if (!(key in own)) {
      reject("missing_field", `${path}.${key}`);
    }
  }
  return own;
}

function position(value: unknown, path: string): number {
  // -0 is refused too: it would be a second way to write position 0.
  if (
    typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)
  ) {
    reject("invalid_position", path);
  }
  return value;
}

function items(value: unknown, path: string, code: EditStepRejection): unknown[] {
  if (!Array.isArray(value) || value.length === 0) {
    reject(code, path);
  }
  if (value.length > MAX_ITEMS) {
    reject("too_large", path);
  }
  // Array.from turns holes into `undefined`, which no element parser accepts.
  return Array.from(value);
}

/** Well-formed, NUL-free, non-empty text; returns its UTF-8 length. */
function textBytes(value: unknown, path: string): number {
  if (typeof value !== "string" || value.length === 0) {
    reject("invalid_text", path);
  }
  let bytes = 0;
  for (let i = 0; i < value.length; i += 1) {
    const unit = value.charCodeAt(i);
    if (unit === 0) {
      reject("invalid_text", path);
    }
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        reject("invalid_text", path);
      }
      i += 1;
      bytes += 4;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      reject("invalid_text", path);
    } else {
      bytes += unit < 0x80 ? 1 : unit < 0x800 ? 2 : 3;
    }
  }
  return bytes;
}

function mark(value: unknown, path: string): EditStepMark {
  const own = fields(value, path, ["type"]);
  if (!isMark(own.type)) {
    reject("invalid_mark", `${path}.type`);
  }
  return { type: own.type };
}

/** Non-empty, without repeats, in the canonical order (bold before italic). */
function marks(value: unknown, path: string): EditStepMark[] {
  const parsed = items(value, path, "invalid_mark").map((item, i) => mark(item, `${path}[${i}]`));
  for (let i = 1; i < parsed.length; i += 1) {
    if (MARK_ORDER.indexOf(parsed[i - 1].type) >= MARK_ORDER.indexOf(parsed[i].type)) {
      reject("invalid_mark", `${path}[${i}]`);
    }
  }
  return parsed;
}

function text(value: unknown, path: string, budget: Budget): EditStepText {
  const own = fields(value, path, ["type", "text"], ["marks"]);
  if (own.type !== "text") {
    reject("invalid_node", `${path}.type`);
  }
  spend(budget, MIN_OBJECT_BYTES + textBytes(own.text, `${path}.text`), path);
  const parsed: EditStepText = { text: own.text as string, type: "text" };
  return "marks" in own ? { marks: marks(own.marks, `${path}.marks`), ...parsed } : parsed;
}

function nodeId(value: unknown, path: string): NodeId | null {
  if (value === null || isNodeId(value)) {
    return value;
  }
  return reject("invalid_node_id", path);
}

function block(value: unknown, path: string, budget: Budget): EditStepBlock {
  const own = fields(value, path, ["type", "attrs"], ["content"]);
  if (own.type !== "paragraph" && own.type !== "heading") {
    reject("invalid_node", `${path}.type`);
  }
  spend(budget, MIN_OBJECT_BYTES, path);
  const content =
    "content" in own
      ? items(own.content, `${path}.content`, "invalid_node").map((child, i) =>
          text(child, `${path}.content[${i}]`, budget),
        )
      : null;
  if (own.type === "paragraph") {
    const attrs = fields(own.attrs, `${path}.attrs`, ["nodeId"]);
    const node = { attrs: { nodeId: nodeId(attrs.nodeId, `${path}.attrs.nodeId`) } };
    return content ? { ...node, content, type: "paragraph" } : { ...node, type: "paragraph" };
  }
  const attrs = fields(own.attrs, `${path}.attrs`, ["level", "nodeId"]);
  if (!isHeadingLevel(attrs.level)) {
    reject("invalid_node", `${path}.attrs.level`);
  }
  const node = {
    attrs: { level: attrs.level, nodeId: nodeId(attrs.nodeId, `${path}.attrs.nodeId`) },
  };
  return content ? { ...node, content, type: "heading" } : { ...node, type: "heading" };
}

/** Blocks or text, never a mix; an open side only on a slice of blocks. */
function slice(value: unknown, path: string, budget: Budget): EditStepSlice {
  const own = fields(value, path, ["content"], ["openStart", "openEnd"]);
  const raw = items(own.content, `${path}.content`, "invalid_slice");
  const first = raw[0];
  const inline = isPlainObject(first) && Object.hasOwn(first, "type") && first.type === "text";
  const content = inline
    ? raw.map((item, i) => text(item, `${path}.content[${i}]`, budget))
    : raw.map((item, i) => block(item, `${path}.content[${i}]`, budget));
  const parsed: EditStepSlice = { content };
  for (const side of ["openEnd", "openStart"] as const) {
    if (side in own) {
      if (own[side] !== 1 || inline) {
        reject("invalid_slice", `${path}.${side}`);
      }
      parsed[side] = 1;
    }
  }
  return parsed;
}

function replaceStep(value: unknown, path: string, budget: Budget): EditStepV1 {
  const own = fields(value, path, ["stepType", "from", "to"], ["slice", "structure", "removedSha256"]);
  const from = position(own.from, `${path}.from`);
  const to = position(own.to, `${path}.to`);
  if (to < from || (to === from && !("slice" in own))) {
    reject("invalid_position", `${path}.to`);
  }
  if ("structure" in own && own.structure !== true) {
    reject("invalid_value", `${path}.structure`);
  }
  const removes = to > from && !("structure" in own);
  if (removes !== "removedSha256" in own) {
    reject(removes ? "missing_field" : "invalid_removed_hash", `${path}.removedSha256`);
  }
  if (removes && (typeof own.removedSha256 !== "string" || !SHA256_HEX.test(own.removedSha256))) {
    reject("invalid_removed_hash", `${path}.removedSha256`);
  }
  return {
    from,
    ...(removes ? { removedSha256: own.removedSha256 as string } : {}),
    ...("slice" in own ? { slice: slice(own.slice, `${path}.slice`, budget) } : {}),
    stepType: "replace",
    ...("structure" in own ? { structure: true as const } : {}),
    to,
  };
}

/**
 * Only the form that changes the type or attributes of one block and keeps
 * its content: the gap is the whole inside of the block, and the slice is the
 * one new, empty block around it.
 */
function replaceAroundStep(value: unknown, path: string, budget: Budget): EditStepV1 {
  const own = fields(value, path, [
    "stepType", "from", "to", "gapFrom", "gapTo", "insert", "slice", "structure",
  ]);
  const from = position(own.from, `${path}.from`);
  const to = position(own.to, `${path}.to`);
  const gapFrom = position(own.gapFrom, `${path}.gapFrom`);
  const gapTo = position(own.gapTo, `${path}.gapTo`);
  if (gapFrom !== from + 1 || gapTo !== to - 1 || gapTo < gapFrom) {
    reject("invalid_position", `${path}.gapFrom`);
  }
  if (own.insert !== 1 || own.structure !== true) {
    reject("invalid_value", `${path}.${own.insert !== 1 ? "insert" : "structure"}`);
  }
  const parsed = slice(own.slice, `${path}.slice`, budget);
  const only = parsed.content[0];
  if (
    parsed.content.length !== 1 || only.type === "text" || "content" in only ||
    "openStart" in parsed || "openEnd" in parsed
  ) {
    reject("invalid_slice", `${path}.slice`);
  }
  return { from, gapFrom, gapTo, insert: 1, slice: parsed, stepType: "replaceAround", structure: true, to };
}

function markStep(value: unknown, path: string, stepType: "addMark" | "removeMark"): EditStepV1 {
  const own = fields(value, path, ["stepType", "from", "to", "mark"]);
  const from = position(own.from, `${path}.from`);
  const to = position(own.to, `${path}.to`);
  if (to <= from) {
    reject("invalid_position", `${path}.to`);
  }
  return { from, mark: mark(own.mark, `${path}.mark`), stepType, to };
}

function attrStep(value: unknown, path: string): EditStepV1 {
  const own = fields(value, path, ["stepType", "pos", "attr", "value"]);
  const pos = position(own.pos, `${path}.pos`);
  if (own.attr !== "nodeId") {
    reject("invalid_value", `${path}.attr`);
  }
  if (!isNodeId(own.value)) {
    reject("invalid_node_id", `${path}.value`);
  }
  return { attr: "nodeId", pos, stepType: "attr", value: own.value };
}

function step(value: unknown, path: string, budget: Budget): EditStepV1 {
  if (!isPlainObject(value)) {
    reject("not_object", path);
  }
  const stepType = Object.hasOwn(value, "stepType") ? value.stepType : undefined;
  spend(budget, MIN_OBJECT_BYTES, path);
  switch (stepType) {
    case "replace":
      return replaceStep(value, path, budget);
    case "replaceAround":
      return replaceAroundStep(value, path, budget);
    case "addMark":
    case "removeMark":
      return markStep(value, path, stepType);
    case "attr":
      return attrStep(value, path);
    default:
      // Checked for forbidden keys first, so the answer names the worse fault.
      fields(value, path, [], Reflect.ownKeys(value).filter((key) => typeof key === "string"));
      return reject("unknown_step_type", `${path}.stepType`);
  }
}

function guarded<T>(parse: () => T): T | { ok: false; code: EditStepRejection; path: string } {
  try {
    return parse();
  } catch (error) {
    // Anything else (a throwing getter, a revoked proxy) is refused as well.
    return error instanceof Rejected
      ? { ok: false, code: error.code, path: error.path }
      : { ok: false, code: "unreadable", path: "$" };
  }
}

/** Reads one untrusted step of `EDIT_STEP_FORMAT_V1`. Never throws. */
export function parseEditStep(value: unknown): EditStepResult {
  return guarded(() => ({ ok: true, step: step(value, "$", { bytes: 0 }) }));
}

/**
 * Reads the steps of one event recorded under `transactionFormat`. An unknown
 * format is refused before a single step is looked at. Never throws.
 */
export function parseEditSteps(transactionFormat: unknown, steps: unknown): EditStepsResult {
  if (transactionFormat !== EDIT_STEP_FORMAT_V1) {
    return { ok: false, code: "unsupported_format", path: "$" };
  }
  return guarded(() => {
    if (!Array.isArray(steps)) {
      return reject("steps_not_array", "$");
    }
    // One budget for the event: all of its steps travel in one segment.
    const budget: Budget = { bytes: 0 };
    const list = items(steps, "$", "steps_empty");
    return { ok: true, steps: list.map((item, i) => step(item, `$[${i}]`, budget)) };
  });
}
