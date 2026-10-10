import { fc, test } from "@fast-check/vitest";
import { describe, expect } from "vitest";

import { canonicalizeJcs, type JcsJsonValue } from "@/domain/forensics/jcs";

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
const content = fc.option(fc.array(textNode, { minLength: 1, maxLength: 4 }), { nil: undefined });
const block = fc.oneof(
  fc.record({ nodeId: maybeNodeId, content }).map((b) => ({
    type: "paragraph", attrs: { nodeId: b.nodeId }, ...(b.content ? { content: b.content } : {}),
  })),
  fc.record({ nodeId: maybeNodeId, content, level: fc.constantFrom(1, 2, 3) }).map((b) => ({
    type: "heading", attrs: { level: b.level, nodeId: b.nodeId },
    ...(b.content ? { content: b.content } : {}),
  })),
);
const open = fc.constantFrom({}, { openStart: 1 }, { openEnd: 1 }, { openStart: 1, openEnd: 1 });
const slice = fc.oneof(
  fc.array(textNode, { minLength: 1, maxLength: 4 }).map((list) => ({ content: list })),
  fc.record({ list: fc.array(block, { minLength: 1, maxLength: 4 }), open }).map((s) => ({
    content: s.list, ...s.open,
  })),
);
const range = fc.tuple(position, fc.integer({ min: 1, max: 5_000 }));

const validStep: fc.Arbitrary<Record<string, unknown>> = fc.oneof(
  fc.record({ from: position, slice }).map((s) => ({ stepType: "replace", from: s.from, to: s.from, slice: s.slice })),
  fc.record({ range, sha256, slice: fc.option(slice, { nil: undefined }) }).map((s) => ({
    stepType: "replace", from: s.range[0], to: s.range[0] + s.range[1], removedSha256: s.sha256,
    ...(s.slice ? { slice: s.slice } : {}),
  })),
  fc.record({ range, slice: fc.option(slice, { nil: undefined }) }).map((s) => ({
    stepType: "replace", from: s.range[0], to: s.range[0] + s.range[1], structure: true,
    ...(s.slice ? { slice: s.slice } : {}),
  })),
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
  fc.record({ range, type: fc.constantFrom("addMark", "removeMark"), mark: fc.constantFrom("bold", "italic") })
    .map((s) => ({ stepType: s.type, from: s.range[0], to: s.range[0] + s.range[1], mark: { type: s.mark } })),
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
