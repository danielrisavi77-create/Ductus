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
 *   - an accepted step is written the way ProseMirror would write it back:
 *     optional parts are absent rather than empty, `false` or `0`, text
 *     nodes that ProseMirror would join are already joined, and a slice is
 *     never empty;
 *   - where two forms of the same change can be told apart without the
 *     document, one of them is refused: a block made by a slice carries no id
 *     (owner decision 3: the id comes from an `attr` step), `structure` on an
 *     insertion stands only on a split, one block open on both sides is written
 *     as text, and a change of a block's type is written as `replaceAround`.
 *     This does not make every change have one form. The rest needs the
 *     document and is the replayer's job (listed in the description of #213):
 *     the block on an open side of a slice, the range of a mark step, a range
 *     that removes and re-inserts the same block boundary;
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
 * The limit of a whole evidence segment (D-96, 2 MiB), applied to the UTF-8
 * bytes of the canonical (RFC 8785) form: of one step in `parseEditStep`, and
 * of the JSON array of all steps of one event in `parseEditSteps`. Exactly
 * this many bytes are accepted, one more is `too_large`.
 */
export const MAX_EDIT_STEP_BYTES = 2_097_152;

export type EditStepMark = { type: Mark };
export type EditStepText = { marks?: EditStepMark[]; text: string; type: "text" };
/**
 * `nodeId` is `null` on every block a `replace` creates. It is an id only on
 * a block that continues an existing one: on an open side of a slice, and in
 * `replaceAround`.
 */
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
  "new_block_has_id",
  "invalid_removed_hash",
  "not_canonical",
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

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);const SHA256_HEX = /^[0-9a-f]{64}$/;
/**
 * A node id in a step is a random UUID (version 4) in lower case, and nothing
 * else. Versions 1, 6 and 7 carry a timestamp finer than a minute, which a
 * step may not hold (owner decision 6, D-24); upper case would be a second
 * way to write the same id. Narrower than `isNodeId` on purpose.
 */
const STEP_NODE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function isStepNodeId(value: unknown): value is NodeId {
  return typeof value === "string" && STEP_NODE_ID.test(value);
}
/** Smaller than the canonical form of any node, mark or step. */
const MIN_OBJECT_BYTES = 16;

/** No array that fits the byte limit is longer; checked before it is copied. */
const MAX_ITEMS = MAX_EDIT_STEP_BYTES / MIN_OBJECT_BYTES;

/**
 * `floor` is a lower bound of the canonical size, kept while reading so that
 * oversized input is refused before it is copied or serialised. `exact` is
 * the real canonical size of what has been accepted so far; it decides.
 */
type Budget = { floor: number; exact: number };

function spend(budget: Budget, bytes: number, path: string): void {
  budget.floor += bytes;
  if (budget.floor > MAX_EDIT_STEP_BYTES) {
    reject("too_large", path);
  }
}

/** UTF-8 length of a well-formed string. */
function utf8Length(value: string): number {
  let bytes = value.length;
  for (let i = 0; i < value.length; i += 1) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      // A pair: two units, four bytes.
      bytes += 2;
      i += 1;
    } else if (unit >= 0x80) {
      bytes += unit < 0x800 ? 1 : 2;
    }
  }
  return bytes;
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
  // The engine lists all keys of an object before the first can be looked at
  // (`for…in` does the same), so an object with millions of keys costs time
  // in proportion to them, unlike a long array or text. The size limit cannot
  // stop that here: the route that parses the request must bound the body
  // before `JSON.parse`, which is the slower of the two anyway.
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
  // Every UTF-16 unit is at least one byte: refuse before scanning.
  if (value.length > MAX_EDIT_STEP_BYTES) {
    reject("too_large", path);
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

/**
 * A run of text nodes. Neighbours with the same marks are refused: ProseMirror
 * joins them when it reads the step, so they would be a second form of it.
 */
function texts(raw: readonly unknown[], path: string, budget: Budget): EditStepText[] {
  const parsed = raw.map((item, i) => text(item, `${path}[${i}]`, budget));
  for (let i = 1; i < parsed.length; i += 1) {
    if (JSON.stringify(parsed[i - 1].marks) === JSON.stringify(parsed[i].marks)) {
      reject("not_canonical", `${path}[${i}]`);
    }
  }
  return parsed;
}

function nodeId(value: unknown, path: string): NodeId | null {
  if (value === null || isStepNodeId(value)) {
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
      ? texts(items(own.content, `${path}.content`, "invalid_node"), `${path}.content`, budget)
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

/**
 * Owner decision 3: a block made by a slice arrives without an id and gets one
 * from an `attr` step. Only a block on an open side of the slice may carry an
 * id, because it is not new: it continues a block of the document. Which block
 * that is, and that the id matches it, only the replayer can tell.
 */
function newBlocksHaveNoId(parsed: EditStepSlice, path: string): void {
  const last = parsed.content.length - 1;
  parsed.content.forEach((item, i) => {
    const continues = (i === 0 && "openStart" in parsed) || (i === last && "openEnd" in parsed);
    if (item.type !== "text" && item.attrs.nodeId !== null && !continues) {
      reject("new_block_has_id", `${path}.content[${i}].attrs.nodeId`);
    }
  });
  const [first, end] = [parsed.content[0], parsed.content[last]];
  if (
    last > 0 && first.type !== "text" && end.type !== "text" &&
    first.attrs.nodeId !== null && first.attrs.nodeId === end.attrs.nodeId
  ) {
    reject("invalid_node_id", `${path}.content[${last}].attrs.nodeId`);
  }
}

/** Blocks or text, never a mix; an open side only on a slice of blocks. */
function slice(value: unknown, path: string, budget: Budget): EditStepSlice {
  const own = fields(value, path, ["content"], ["openStart", "openEnd"]);
  const raw = items(own.content, `${path}.content`, "invalid_slice");
  const first = raw[0];
  const inline = isPlainObject(first) && Object.hasOwn(first, "type") && first.type === "text";
  const content = inline
    ? texts(raw, `${path}.content`, budget)
    : raw.map((item, i) => block(item, `${path}.content[${i}]`, budget));
  const parsed: EditStepSlice = { content };
  let open = 0;
  for (const side of ["openEnd", "openStart"] as const) {
    if (side in own) {
      if (own[side] !== 1 || inline) {
        reject("invalid_slice", `${path}.${side}`);
      }
      parsed[side] = 1;
      open += 1;
    }
  }
  // One block open on both sides brings only its text (or nothing): the same
  // step is written with a slice of text, or without a slice.
  if (open === 2 && content.length === 1) {
    reject("not_canonical", path);
  }
  return parsed;
}

/** A slice of one empty block that is open only at its end. */
function isBlockOpening(parsed: EditStepSlice): boolean {
  const only = parsed.content[0];
  return (
    parsed.content.length === 1 && only.type !== "text" && !("content" in only) &&
    "openEnd" in parsed && !("openStart" in parsed)
  );
}

/** Blocks without text, open on both sides: the slice only divides a block. */
function isSplit(parsed: EditStepSlice): boolean {
  return (
    "openStart" in parsed && "openEnd" in parsed &&
    parsed.content.every((item) => item.type !== "text" && !("content" in item))
  );
}

/** A join removes the end of one block and the start of the next: two positions. */
const MAX_STRUCTURE_RANGE = 2;

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
  if ("structure" in own && to - from > MAX_STRUCTURE_RANGE) {
    reject("invalid_position", `${path}.to`);
  }
  const parsed = "slice" in own ? slice(own.slice, `${path}.slice`, budget) : null;
  if (parsed) {
    newBlocksHaveNoId(parsed, `${path}.slice`);
    // Replacing only the opening of a block changes its type or attributes
    // and keeps its content: that step is written as `replaceAround`.
    if (to === from + 1 && isBlockOpening(parsed)) {
      reject("not_canonical", `${path}.slice`);
    }
    // With nothing removed the flag changes nothing, so it would be a second
    // form of the same insertion. It is kept exactly where ProseMirror's own
    // split writes it, and refused everywhere else.
    if (to === from && "structure" in own !== isSplit(parsed)) {
      reject("not_canonical", `${path}.structure`);
    }
  }
  return {
    from,
    ...(removes ? { removedSha256: own.removedSha256 as string } : {}),
    ...(parsed ? { slice: parsed } : {}),
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
  if (!isStepNodeId(own.value)) {
    reject("invalid_node_id", `${path}.value`);
  }
  return { attr: "nodeId", pos, stepType: "attr", value: own.value };
}

/**
 * Reads one step and charges its real canonical size. The result has sorted
 * keys, so `JSON.stringify` of it is the canonical form; it is serialised
 * once, which keeps the whole check linear in the size of the input.
 */
function step(value: unknown, path: string, budget: Budget): EditStepV1 {
  const parsed = stepShape(value, path, budget);
  budget.exact += utf8Length(JSON.stringify(parsed));
  if (budget.exact > MAX_EDIT_STEP_BYTES) {
    reject("too_large", path);
  }
  return parsed;
}

function stepShape(value: unknown, path: string, budget: Budget): EditStepV1 {
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
      // One pass over the keys: looking each one up in a list of them all
      // would cost the square of their number.
      for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== "string" || FORBIDDEN_KEYS.has(key)) {
          reject("forbidden_key", path);
        }
      }
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
  return guarded(() => ({ ok: true, step: step(value, "$", { floor: 0, exact: 0 }) }));
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
    // One budget for the event: all of its steps travel in one segment. The
    // array costs its two brackets and one comma between neighbours.
    const budget: Budget = { floor: 0, exact: 2 };
    const list = items(steps, "$", "steps_empty");
    return {
      ok: true,
      steps: list.map((item, i) => {
        budget.exact += i === 0 ? 0 : 1;
        return step(item, `$[${i}]`, budget);
      }),
    };
  });
}
