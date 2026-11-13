// @vitest-environment node
import { fc, test } from "@fast-check/vitest";
import { Editor } from "@tiptap/core";
import { describe, expect } from "vitest";

import { normalizeDocument, VALIDATION_ERROR_CODES, type CanonicalDocumentV2, type NodeId } from "../domain/document";

import { INTEROP_ERROR_CODES, type IdFactory } from "./interop";
import { canonicalToTiptapV2, tiptapToCanonicalV2 } from "./interop-v2";
import { createEditorExtensionsV2 } from "./schema";

/**
 * DAN-620 a, properties of the v2 projection: (a) canonical → Tiptap →
 * canonical is the identity, (b) also through the real v2 editor, (c) the
 * projection back is total and reports only known codes. Generated content
 * only; the arbitraries follow `validate-v2.property.test.ts`.
 */

const nodeId = (i: number) => `${i.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`;
const sourceId = (i: number) => `${i.toString(16).padStart(8, "0")}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
const mint: IdFactory = (i) => `cccccccc-0000-4000-8000-${i.toString(16).padStart(12, "0")}` as NodeId;

const unit = fc.constantFrom("a", "Z", "1", "č", "Ž", "-", " ", " ", "\u{1F600}");
const field = fc.string({ unit, maxLength: 8 }).map((inner) => `x${inner}y`);
const locator = fc.string({ unit, minLength: 1, maxLength: 12 });

const author = fc.record({ kind: fc.constant("person"), family: field, given: field });
const source = fc.record({
  type: fc.constant("book"),
  authors: fc.array(author, { minLength: 1, maxLength: 2 }),
  year: fc.integer({ min: 1000, max: 9999 }),
  title: field,
  place: field,
  publisher: field,
});
const sources = fc
  .array(source, { maxLength: 3 })
  .map((list) => list.map((record, i) => ({ id: sourceId(i), ...record })));

const MARKS = [[], ["bold"], ["italic"], ["bold", "italic"]] as const;
const textRun = fc.tuple(field, fc.nat(3)).map(([t, m]) => ({ type: "text", text: t, marks: [...MARKS[m]] }));
const citation = fc.record(
  { type: fc.constant("citation"), sourceId: fc.nat(4).map(sourceId), locator },
  { requiredKeys: ["type", "sourceId"] },
);

const block = fc.oneof(
  fc.record({
    type: fc.constantFrom("paragraph", "bulletItem", "quote"),
    children: fc.array(fc.oneof(textRun, citation), { maxLength: 5 }),
  }),
  fc.record({ type: fc.constant("heading"), level: fc.integer({ min: 1, max: 3 }), children: fc.array(textRun, { maxLength: 4 }) }),
);

/** A valid v2 document in normal form (adjacent same-mark runs merged). */
const v2Doc = fc
  .record({ nodes: fc.array(block, { minLength: 1, maxLength: 4 }), sources })
  .map(({ nodes, sources: list }) =>
    normalizeDocument({
      schemaVersion: 2,
      nodes: nodes.map((node, i) => ({ ...node, id: nodeId(i) })),
      sources: list,
    } as unknown as CanonicalDocumentV2),
  );

/** Every object or array inside `value`, with the root. */
function containers(value: unknown, out: object[] = []): object[] {
  if (value !== null && typeof value === "object") {
    out.push(value);
    for (const child of Object.values(value)) containers(child, out);
  }
  return out;
}

/** Tiptap JSON of a valid document with one value replaced or one key added. */
const brokenJson = fc
  .tuple(v2Doc, fc.nat(), fc.nat(), fc.jsonValue({ maxDepth: 2 }), fc.boolean())
  .map(([input, pick, keyPick, replacement, addKey]) => {
    const copy = canonicalToTiptapV2(input) as unknown;
    const all = containers(copy);
    const target = all[pick % all.length] as Record<string, unknown>;
    const keys = Object.keys(target);
    if (addKey || keys.length === 0) target.extra = replacement;
    else target[keys[keyPick % keys.length]!] = replacement;
    return copy;
  });

const KNOWN = new Set<string>([...INTEROP_ERROR_CODES, ...VALIDATION_ERROR_CODES]);

describe("v2 projection properties", () => {
  test.prop([v2Doc])("(a) canonical → Tiptap → canonical is the identity", (input) => {
    const back = tiptapToCanonicalV2(JSON.parse(JSON.stringify(canonicalToTiptapV2(input))), mint);
    expect(back).toEqual({ ok: true, doc: input });
  });

  test.prop([v2Doc], { numRuns: 50 })("(b) the same through the real v2 editor", (input) => {
    const editor = new Editor({ element: null, extensions: createEditorExtensionsV2(), content: canonicalToTiptapV2(input) });
    try {
      expect(tiptapToCanonicalV2(editor.getJSON(), mint)).toEqual({ ok: true, doc: input });
    } finally {
      editor.destroy();
    }
  });

  test.prop([fc.oneof(brokenJson, fc.anything())])("(c) is total: a document or known codes", (input) => {
    const outcome = tiptapToCanonicalV2(input, mint);
    if (!outcome.ok) {
      expect(outcome.errors.length).toBeGreaterThan(0);
      for (const error of outcome.errors) expect(KNOWN.has(error.code)).toBe(true);
    }
  });
});
