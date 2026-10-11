import { fc, test } from "@fast-check/vitest";
import { getSchema } from "@tiptap/core";
import { Step } from "@tiptap/pm/transform";
import { describe, expect } from "vitest";

import { createEditorExtensions } from "@/editor/schema";
import { canonicalizeJcs, type JcsJsonValue } from "@/domain/forensics/jcs";

const schema = getSchema(createEditorExtensions());

import {
  EDIT_STEP_FORMAT_V1,
  EDIT_STEP_REJECTIONS,
  parseEditStep,
  parseEditSteps,
} from "./edit-step";

/**
 * Property tests of the edit-step format (attack plan #203): every valid
 * step has exactly one canonical form, and nothing else is ever accepted,
 * rewritten or allowed to crash the reader. All data is generated.
 */

const position = fc.nat({ max: 1_000_000 });
const sha256 = fc.stringMatching(/^[0-9a-f]{64}$/);
const nodeId = fc.uuid({ version: 4 });
const maybeNodeId = fc.option(nodeId, { nil: null });
/** Well-formed text over the whole of Unicode, without NUL. */
const text = fc
  .string({ unit: "binary", minLength: 1, maxLength: 40 })
  .filter((value) => !value.includes("\u0000"));
const marks = fc.constantFrom(
  undefined,
  [{ type: "bold" }],
  [{ type: "italic" }],
  [{ type: "bold" }, { type: "italic" }],
);
const textNode = fc
  .record({ text, marks })
  .map(({ text: value, marks: list }) =>
    list ? { type: "text", text: value, marks: list } : { type: "text", text: value },
  );
/** A run of text as ProseMirror keeps it: neighbours never share their marks. */
const textRun = fc
  .array(textNode, { minLength: 1, maxLength: 4 })
  .map((list) =>
    list.filter(
      (node, i) => i === 0 || JSON.stringify(node.marks) !== JSON.stringify(list[i - 1].marks),
    ),
  );
const content = fc.option(textRun, { nil: undefined });
type Block = { type: string; attrs: { level?: number; nodeId: string | null }; content?: unknown[] };
type TestSlice = { content: unknown[]; openStart?: 1; openEnd?: 1 };
/** A block as a slice creates it: without an id (owner decision 3). */
const block: fc.Arbitrary<Block> = fc.oneof(
  fc.record({ content }).map((b) => ({
    type: "paragraph", attrs: { nodeId: null }, ...(b.content ? { content: b.content } : {}),
  })),
  fc.record({ content, level: fc.constantFrom(1, 2, 3) }).map((b) => ({
    type: "heading", attrs: { level: b.level, nodeId: null },
    ...(b.content ? { content: b.content } : {}),
  })),
);
const open = fc.constantFrom({}, { openStart: 1 }, { openEnd: 1 }, { openStart: 1, openEnd: 1 });
const withId = (b: Block, id: string | null): Block => ({ ...b, attrs: { ...b.attrs, nodeId: id } });
const blockSlice: fc.Arbitrary<TestSlice> = fc
  .record({ list: fc.array(block, { minLength: 1, maxLength: 4 }), open, ids: fc.tuple(maybeNodeId, maybeNodeId) })
  // One block open on both sides is written as text, and is not a form.
  .filter((s) => !(s.list.length === 1 && "openStart" in s.open && "openEnd" in s.open))
  .filter((s) => s.ids[0] === null || s.ids[0] !== s.ids[1])
  // Only a block on an open side continues an existing one and may carry its id.
  .map((s) => {
    const list = [...s.list];
    if ("openStart" in s.open) list[0] = withId(list[0], s.ids[0]);
    if ("openEnd" in s.open) list[list.length - 1] = withId(list[list.length - 1], s.ids[1]);
    return { content: list, ...s.open };
  });
const hasText = (s: TestSlice) =>
  s.content.some((item) => (item as Block).type === "text" || "content" in (item as Block));
const isSplit = (s: TestSlice) => "openStart" in s && "openEnd" in s && !hasText(s);
const openOn = (s: TestSlice, start: boolean, end: boolean) =>
  "openStart" in s === start && "openEnd" in s === end;
/** Text, or blocks open on both sides: both ends of the range lie inside a block. */
const insideSlice: fc.Arbitrary<TestSlice> = fc.oneof(
  textRun.map((list) => ({ content: list })),
  blockSlice.filter((s) => openOn(s, true, true)),
);
/** Blocks open only at the end: the range starts before a block and ends inside one. */
const endSlice = blockSlice.filter((s) => openOn(s, false, true));
const startSlice = blockSlice.filter((s) => openOn(s, true, false));
const closedSlice = blockSlice.filter((s) => openOn(s, false, false));
/** A position inside a block: never 0, which lies before the first block. */
const inside = fc.integer({ min: 1, max: 1_000_000 });
const width = fc.integer({ min: 1, max: 5_000 });
const range = fc.tuple(position, width);
const replace = (from: number, to: number, rest: Record<string, unknown>, s?: TestSlice) => ({
  stepType: "replace", from, to, ...rest, ...(s ? { slice: s } : {}),
});

/** Every shape of `replace` the format keeps (the table in the description of #213). */
const validReplace: fc.Arbitrary<Record<string, unknown>> = fc.oneof(
  // An insertion inside a block; `structure` stands exactly on a split.
  fc.record({ from: inside, slice: insideSlice }).map((s) =>
    replace(s.from, s.from, isSplit(s.slice) ? { structure: true } : {}, s.slice)),
  // New blocks before the first block.
  closedSlice.map((s) => replace(0, 0, {}, s)),
  // Text or blocks removed, from inside a block to inside a block.
  fc.record({ from: inside, width, sha256, slice: fc.option(insideSlice, { nil: undefined }) })
    .map((s) => replace(s.from, s.from + s.width, { removedSha256: s.sha256 }, s.slice)),
  // Whole blocks removed from the start of the document.
  fc.record({ width: fc.integer({ min: 2, max: 5_000 }), sha256 })
    .map((s) => replace(0, s.width, { removedSha256: s.sha256 })),
  // A join, with or without something put in its place.
  fc.record({ from: inside, slice: fc.option(insideSlice, { nil: undefined }) })
    .map((s) => replace(s.from, s.from + 2, { structure: true }, s.slice)),
  // New blocks before a block, and text at its start.
  fc.record({ from: position, slice: endSlice })
    .filter((s) => s.slice.content.length > 1 && "content" in (s.slice.content.at(-1) as Block))
    .map((s) => replace(s.from, s.from + 1, { structure: true }, s.slice)),
  // The same over the first letters of that block, or over blocks before it.
  fc.record({ from: position, width: fc.integer({ min: 2, max: 5_000 }), sha256, slice: endSlice })
    .filter((s) => s.width > 2 || s.slice.content.length > 1)
    .map((s) => replace(s.from, s.from + s.width, { removedSha256: s.sha256 }, s.slice)),
);

const validStep: fc.Arbitrary<Record<string, unknown>> = fc.oneof(
  { arbitrary: validReplace, weight: 3 },
  fc.record({ range, nodeId: maybeNodeId, level: fc.constantFrom(0, 1, 2, 3) }).map((s) => ({
    stepType: "replaceAround", from: s.range[0], to: s.range[0] + s.range[1] + 1,
    gapFrom: s.range[0] + 1, gapTo: s.range[0] + s.range[1], insert: 1, structure: true,
    slice: {
      content: [
        s.level === 0
          ? { type: "paragraph", attrs: { nodeId: s.nodeId } }
          : { type: "heading", attrs: { level: s.level, nodeId: s.nodeId } },
      ],
    },
  })),
  fc.record({ from: inside, width, type: fc.constantFrom("addMark", "removeMark"), mark: fc.constantFrom("bold", "italic") })
    .map((s) => ({ stepType: s.type, from: s.from, to: s.from + s.width, mark: { type: s.mark } })),
  fc.record({ pos: position, value: nodeId }).map((s) => ({ stepType: "attr", attr: "nodeId", ...s })),
);

/** Every plain object inside `value`, the value itself first. */
function objectsIn(value: unknown, found: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    value.forEach((item) => objectsIn(item, found));
  } else if (value !== null && typeof value === "object") {
    found.push(value as Record<string, unknown>);
    Object.values(value).forEach((item) => objectsIn(item, found));
  }
  return found;
}

/** Same value, every object rebuilt with its keys in reverse order. */
function reversedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reversedKeys);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).reverse().map(([key, item]) => [key, reversedKeys(item)]),
  );
}

const TIME_KEYS = ["time", "ts", "at", "occurredAt", "elapsedMs", "timestamp", "createdAt"];
const extraKey = fc.oneof(
  fc.constantFrom(...TIME_KEYS, "__proto__", "constructor", "prototype", "toString"),
  fc.string({ minLength: 1, maxLength: 12 }),
);

describe("edit step format: valid steps", () => {
  test.prop([validStep])("has one canonical form, kept through a round trip", (input) => {
    const result = parseEditStep(input);
    if (!result.ok) throw new Error(`${result.code} at ${result.path}`);
    const bytes = JSON.stringify(result.step);
    expect(bytes).toBe(canonicalizeJcs(input as JcsJsonValue));
    expect(result.step).toEqual(input);
    // Key order of the input, a JSON round trip and a second reading change nothing.
    for (const again of [reversedKeys(input), JSON.parse(JSON.stringify(input)), result.step]) {
      const repeated = parseEditStep(again);
      expect(repeated.ok && JSON.stringify(repeated.step)).toBe(bytes);
    }
  });

  // QA of #213, V1: what the reader accepts is what ProseMirror writes back.
  test.prop([validStep])("is written back unchanged by ProseMirror itself", (input) => {
    const result = parseEditStep(input);
    if (!result.ok) throw new Error(`${result.code} at ${result.path}`);
    const { removedSha256, ...pmJson } = result.step as Record<string, unknown>;
    const written = Step.fromJSON(schema, pmJson).toJSON() as Record<string, unknown>;
    expect(removedSha256 === undefined ? written : { ...written, removedSha256 }).toEqual(input);
  });

  // Owner decision 3, QA of #213 (second round, B1).
  test.prop([blockSlice, fc.nat(), nodeId, position])(
    "is refused when a block that the slice creates brings an id",
    (made, pick, id, from) => {
      const last = made.content.length - 1;
      const created = made.content
        .map((_, i) => i)
        .filter((i) => !((i === 0 && "openStart" in made) || (i === last && "openEnd" in made)));
      fc.pre(created.length > 0);
      const at = created[pick % created.length];
      const content = made.content.map((item, i) => (i === at ? withId(item as Block, id) : item));
      const step = {
        stepType: "replace", from, to: from + 3, removedSha256: "0".repeat(64),
        slice: { ...made, content },
      };
      expect(parseEditStep(step)).toEqual({
        ok: false, code: "new_block_has_id", path: `$.slice.content[${at}].attrs.nodeId`,
      });
    },
  );

  // QA of #213 (fourth round): no document makes these right, so the step
  // alone is enough to refuse them.
  test.prop([startSlice, position, fc.nat({ max: 5_000 }), fc.boolean()])(
    "is refused when its slice is open only at its start",
    (made, from, size, structure) => {
      const flag = size === 0 ? {} : structure ? { structure: true } : { removedSha256: "0".repeat(64) };
      fc.pre(!(structure && size > 2));
      expect(parseEditStep(replace(from, from + size, flag, made))).toEqual({
        ok: false, code: "not_canonical", path: "$.slice",
      });
    },
  );

  test.prop([closedSlice, position, fc.nat({ max: 5_000 })])(
    "is refused when whole blocks go anywhere but before the first block",
    (made, from, size) => {
      fc.pre(from + size > 0);
      const flag = size === 0 ? {} : { removedSha256: "0".repeat(64) };
      const result = parseEditStep(replace(from, from + size, flag, made));
      expect(result).toMatchObject({ ok: false });
      expect(["not_canonical", "invalid_position"]).toContain(result.ok ? "" : result.code);
    },
  );

  test.prop([insideSlice, fc.nat({ max: 5_000 })])(
    "is refused when text or a slice open at its start is put at position 0",
    (made, size) => {
      const flag = size === 0 ? (isSplit(made) ? { structure: true } : {}) : { removedSha256: "0".repeat(64) };
      expect(parseEditStep(replace(0, size, flag, made))).toEqual({
        ok: false, code: "invalid_position", path: "$.from",
      });
    },
  );

  test.prop([fc.array(validStep, { minLength: 1, maxLength: 6 })])(
    "reads a list as the same steps in the same order",
    (inputs) => {
      const result = parseEditSteps(EDIT_STEP_FORMAT_V1, inputs);
      expect(result).toEqual({ ok: true, steps: inputs });
    },
  );

  test.prop([validStep, fc.nat(), extraKey, fc.jsonValue()])(
    "is refused as soon as any object in it gains one more key",
    (input, pick, key, value) => {
      const copy = JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
      const objects = objectsIn(copy);
      const target = objects[pick % objects.length];
      fc.pre(!Object.hasOwn(target, key));
      Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true });
      const before = Object.getOwnPropertyNames(Object.prototype);
      const result = parseEditStep(copy);
      expect(result.ok).toBe(false);
      // The added key stayed on its own object and reached no prototype.
      expect(Object.getPrototypeOf(target)).toBe(Object.prototype);
      expect(Object.getOwnPropertyNames(Object.prototype)).toEqual(before);
    },
  );
});

describe("edit step format: arbitrary input", () => {
  const checkOutcome = (input: unknown) => {
    const result = parseEditStep(input);
    if (result.ok) {
      // Accepted means the input already was the canonical value: nothing guessed.
      expect(JSON.stringify(result.step)).toBe(canonicalizeJcs(input as JcsJsonValue));
    } else {
      expect(EDIT_STEP_REJECTIONS).toContain(result.code);
      expect(result.path.startsWith("$")).toBe(true);
    }
  };

  test.prop([fc.anything({ withNullPrototype: true, withBigInt: true, withSparseArray: true })])(
    "never throws and never accepts something that is not a step",
    (input) => {
      const result = parseEditStep(input);
      expect(result.ok).toBe(false);
      expect(parseEditSteps(EDIT_STEP_FORMAT_V1, input).ok).toBe(false);
    },
  );

  test.prop([validStep, fc.nat(), fc.nat(), fc.jsonValue({ stringUnit: "binary-ascii" })])(
    "a step with one value swapped is refused or still canonical",
    (input, pick, field, value) => {
      const copy = JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
      const objects = objectsIn(copy);
      const target = objects[pick % objects.length];
      const keys = Object.keys(target);
      target[keys[field % keys.length]] = value;
      checkOutcome(copy);
    },
  );

  test.prop([validStep, fc.nat(), fc.nat()])(
    "a step with one key removed is refused or still canonical",
    (input, pick, field) => {
      const copy = JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
      const objects = objectsIn(copy);
      const target = objects[pick % objects.length];
      const keys = Object.keys(target);
      delete target[keys[field % keys.length]];
      checkOutcome(copy);
    },
  );
});
