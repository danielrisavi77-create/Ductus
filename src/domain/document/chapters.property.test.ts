import { fc, test } from "@fast-check/vitest";
import { describe, expect } from "vitest";

import { deriveChapters, type Chapter } from "./chapters";
import {
  DOCUMENT_SCHEMA_VERSION,
  textNode,
  type CanonicalDocument,
  type DocumentNode,
  type HeadingLevel,
  type NodeId,
} from "./schema";

/**
 * Property tests of the chapter projection (M5.3-P01, DAN-395): chapters are
 * keyed by the heading's block id, so an edit elsewhere never renames,
 * renumbers or reparents a chapter it does not touch. All data is generated.
 */

const text = fc.string({ maxLength: 12 });
const children = fc.array(text.filter((t) => t !== ""), { maxLength: 3 }).map((list) => list.map((t) => textNode(t)));
type Shape = { kind: "heading"; level: HeadingLevel } | { kind: "paragraph" | "bulletItem" | "quote" };
// Body blocks twice as often as headings, so long sections are generated too.
const shape: fc.Arbitrary<Shape> = fc.oneof(
  { weight: 1, arbitrary: fc.constantFrom(1, 2, 3).map((level) => ({ kind: "heading" as const, level: level as HeadingLevel })) },
  { weight: 2, arbitrary: fc.constantFrom("paragraph", "bulletItem", "quote").map((kind) => ({ kind })) },
);
const block = fc.record({ id: fc.uuid({ version: 4 }), shape, children }).map(({ id, shape: s, children: c }) =>
  s.kind === "heading"
    ? ({ type: "heading", id: id as NodeId, level: s.level, children: c } satisfies DocumentNode)
    : ({ type: s.kind, id: id as NodeId, children: c } satisfies DocumentNode),
);
const nodes = fc.uniqueArray(block, { maxLength: 40, selector: (b) => b.id });
const heading = block.filter((b) => b.type === "heading");
const body = block.filter((b) => b.type !== "heading");

const doc = (list: DocumentNode[]): CanonicalDocument => ({ schemaVersion: DOCUMENT_SCHEMA_VERSION, nodes: list });
const fresh = (list: DocumentNode[], b: DocumentNode) => !list.some((n) => n.id === b.id);
/** What a chapter is to a consumer that only knows its id. */
const view = (c: Chapter) => ({ blockId: c.blockId, number: c.number, title: c.title, parentId: c.parentId });
const named = (chapters: readonly Chapter[]) => new Map(chapters.map((c) => [c.blockId, c.title]));

describe("deriveChapters properties", () => {
  test.prop([nodes])("chapters are exactly the headings in order; every block is placed once", (list) => {
    const { preambleBlockIds, chapters } = deriveChapters(doc(list));
    expect(chapters.map((c) => c.blockId)).toEqual(list.filter((n) => n.type === "heading").map((n) => n.id));
    const placed = [...preambleBlockIds, ...chapters.flatMap((c) => [c.blockId, ...c.ownBlockIds])];
    expect([...placed].sort()).toEqual(list.map((n) => n.id).sort());
  });

  test.prop([nodes])("numbering: path length is the level, neutral label, strictly increasing", (list) => {
    const { chapters } = deriveChapters(doc(list));
    let previous: readonly number[] = [];
    for (const c of chapters) {
      expect(c.path.length).toBe(c.level);
      expect(c.number).toBe(c.path.join("."));
      expect(c.path[c.level - 1]).toBeGreaterThan(0);
      const padded = [...c.path, 0, 0, 0].slice(0, 3);
      const before = [...previous, 0, 0, 0].slice(0, 3);
      expect(compare(padded, before)).toBeGreaterThan(0);
      previous = c.path;
    }
  });

  test.prop([nodes], { numRuns: 500 })("path and parent match a count over the headings alone", (list) => {
    const { chapters } = deriveChapters(doc(list));
    chapters.forEach((c, i) => {
      // A deeper heading never resets a shallower counter; a shallower one resets it.
      const counter = (depth: number) => {
        let count = 0;
        for (let j = i; j >= 0 && chapters[j]!.level >= depth + 1; j -= 1) if (chapters[j]!.level === depth + 1) count += 1;
        return count;
      };
      expect(c.path).toEqual(Array.from({ length: c.level }, (_, d) => counter(d)));
      const parent = chapters.slice(0, i).reverse().find((p) => p.level < c.level);
      expect(c.parentId).toBe(parent ? parent.blockId : null);
    });
  });

  test.prop([nodes, body, fc.nat()])("inserting a body block changes no chapter", (list, b, at) => {
    fc.pre(fresh(list, b));
    const i = at % (list.length + 1);
    const after = deriveChapters(doc([...list.slice(0, i), b, ...list.slice(i)]));
    expect(after.chapters.map(view)).toEqual(deriveChapters(doc(list)).chapters.map(view));
  });

  test.prop([nodes, fc.nat()])("deleting a body block changes no chapter", (list, at) => {
    const bodies = list.map((n, i) => (n.type === "heading" ? -1 : i)).filter((i) => i >= 0);
    fc.pre(bodies.length > 0);
    const i = bodies[at % bodies.length]!;
    const after = deriveChapters(doc(list.filter((_, j) => j !== i)));
    expect(after.chapters.map(view)).toEqual(deriveChapters(doc(list)).chapters.map(view));
  });

  test.prop([nodes, heading, fc.nat()])("inserting a heading keeps earlier chapters and every id's title", (list, b, at) => {
    fc.pre(fresh(list, b));
    const i = at % (list.length + 1);
    const before = deriveChapters(doc(list)).chapters;
    const after = deriveChapters(doc([...list.slice(0, i), b, ...list.slice(i)])).chapters;
    const earlier = list.slice(0, i).filter((n) => n.type === "heading").length;
    expect(after.slice(0, earlier).map(view)).toEqual(before.slice(0, earlier).map(view));
    expect(after.filter((c) => c.blockId !== b.id).map((c) => c.blockId)).toEqual(before.map((c) => c.blockId));
    const titles = named(after);
    for (const c of before) expect(titles.get(c.blockId)).toBe(c.title);
  });

  test.prop([nodes, fc.nat()])("deleting a heading removes only its chapter", (list, at) => {
    const headings = list.map((n, i) => (n.type === "heading" ? i : -1)).filter((i) => i >= 0);
    fc.pre(headings.length > 0);
    const i = headings[at % headings.length]!;
    const before = deriveChapters(doc(list)).chapters;
    const after = deriveChapters(doc(list.filter((_, j) => j !== i))).chapters;
    const k = before.findIndex((c) => c.blockId === list[i]!.id);
    expect(after.slice(0, k).map(view)).toEqual(before.slice(0, k).map(view));
    expect(after.map((c) => c.blockId)).toEqual(before.filter((_, j) => j !== k).map((c) => c.blockId));
    const titles = named(before);
    for (const c of after) expect(c.title).toBe(titles.get(c.blockId));
  });

  test.prop([nodes])("pure: the input is not changed and the same input gives the same output", (list) => {
    const d = doc(list);
    const copy = structuredClone(d);
    const first = deriveChapters(d);
    expect(d).toEqual(copy);
    expect(deriveChapters(copy)).toEqual(first);
  });
});

function compare(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}
