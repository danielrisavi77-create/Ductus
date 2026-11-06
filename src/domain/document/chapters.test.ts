import { describe, expect, it } from "vitest";

import { deriveChapters, NEUTRAL_CHAPTER_PROFILE, type Chapter, type ChapterProfile } from "./chapters";
import {
  DOCUMENT_SCHEMA_VERSION,
  textNode,
  type CanonicalDocument,
  type DocumentNode,
  type HeadingLevel,
  type NodeId,
} from "./schema";

/** Invented ids: readable in failures, unique inside one document. */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}` as NodeId;
const h = (n: number, level: HeadingLevel, text = `Naslov ${n}`): DocumentNode => ({
  type: "heading",
  id: id(n),
  level,
  children: text === "" ? [] : [textNode(text)],
});
const p = (n: number): DocumentNode => ({ type: "paragraph", id: id(n), children: [textNode(`Odlomak ${n}`)] });
const doc = (...nodes: DocumentNode[]): CanonicalDocument => ({ schemaVersion: DOCUMENT_SCHEMA_VERSION, nodes });
const numbers = (d: CanonicalDocument, profile?: ChapterProfile) =>
  deriveChapters(d, profile).chapters.map((c) => c.number);

describe("deriveChapters: input classes", () => {
  it("empty document (one empty paragraph): no chapters, the paragraph is preamble", () => {
    const empty = doc({ type: "paragraph", id: id(1), children: [] });
    expect(deriveChapters(empty)).toEqual({ preambleBlockIds: [id(1)], chapters: [] });
  });

  it("no nodes at all: nothing", () => {
    expect(deriveChapters(doc())).toEqual({ preambleBlockIds: [], chapters: [] });
  });

  it("paragraphs only: everything is preamble", () => {
    expect(deriveChapters(doc(p(1), p(2)))).toEqual({ preambleBlockIds: [id(1), id(2)], chapters: [] });
  });

  it("headings of levels 1 to 3 get the neutral numbering 1, 1.1, 1.1.1 (D-229)", () => {
    const d = doc(h(1, 1), h(2, 2), h(3, 3), h(4, 3), h(5, 2), h(6, 1), h(7, 3));
    expect(numbers(d)).toEqual(["1", "1.1", "1.1.1", "1.1.2", "1.2", "2", "2.0.1"]);
  });

  it("a skipped level keeps the level and shows the gap as 0", () => {
    const [chapter] = deriveChapters(doc(h(1, 1), h(2, 3))).chapters.slice(1);
    expect(chapter).toMatchObject({ level: 3, path: [1, 0, 1], number: "1.0.1", parentId: id(1) });
  });

  it("a document that starts with a level 2 or 3 heading", () => {
    expect(numbers(doc(h(1, 2), h(2, 3), h(3, 1)))).toEqual(["0.1", "0.1.1", "1"]);
    expect(deriveChapters(doc(h(1, 3))).chapters[0]).toMatchObject({ path: [0, 0, 1], parentId: null });
  });

  it("parent is the nearest earlier heading of a lower level", () => {
    const { chapters } = deriveChapters(doc(h(1, 1), h(2, 2), h(3, 3), h(4, 2), h(5, 1)));
    expect(chapters.map((c) => c.parentId)).toEqual([null, id(1), id(2), id(1), null]);
  });

  it("a shallower heading ends the deeper ones: they are no longer parents", () => {
    const { chapters } = deriveChapters(doc(h(1, 1), h(2, 2), h(3, 1), h(4, 3), h(5, 2), h(6, 1), h(7, 3)));
    expect(chapters.map((c) => c.parentId)).toEqual([null, id(1), null, id(3), id(3), null, id(6)]);
  });

  it("an empty heading is still a chapter with an empty title", () => {
    expect(deriveChapters(doc(h(1, 1, ""))).chapters[0]).toMatchObject({ title: "", number: "1" });
  });

  it("title joins every text node without marks and is trimmed", () => {
    const heading: DocumentNode = {
      type: "heading",
      id: id(1),
      level: 1,
      children: [textNode("  Uvod "), textNode("i", ["bold"]), textNode(" cilj  ", ["italic"])],
    };
    expect(deriveChapters(doc(heading)).chapters[0]!.title).toBe("Uvod i cilj");
  });

  it("every body block type belongs to the chapter above it, up to the next heading", () => {
    const d = doc(
      p(1),
      h(2, 1),
      p(3),
      { type: "bulletItem", id: id(4), children: [textNode("Stavka")] },
      { type: "quote", id: id(5), children: [textNode("Citat")] },
      h(6, 2),
      p(7),
      h(8, 1),
    );
    const { preambleBlockIds, chapters } = deriveChapters(d);
    expect(preambleBlockIds).toEqual([id(1)]);
    expect(chapters.map((c) => c.ownBlockIds)).toEqual([[id(3), id(4), id(5)], [id(7)], []]);
  });

  it("a profile replaces the label and nothing else", () => {
    const profile: ChapterProfile = { label: (path) => `${path.join(".")}.` };
    const d = doc(h(1, 1), h(2, 2));
    expect(numbers(d, profile)).toEqual(["1.", "1.1."]);
    const unlabelled = (c: Chapter) => ({ ...c, number: undefined });
    expect(deriveChapters(d, profile).chapters.map(unlabelled)).toEqual(deriveChapters(d).chapters.map(unlabelled));
  });

  it("without a profile the neutral one applies", () => {
    const d = doc(h(1, 1), h(2, 2), h(3, 3));
    expect(deriveChapters(d)).toEqual(deriveChapters(d, NEUTRAL_CHAPTER_PROFILE));
  });

  it("a profile gets its own copy of the path", () => {
    const profile: ChapterProfile = {
      label: (path) => {
        (path as number[]).push(99);
        return "x";
      },
    };
    expect(deriveChapters(doc(h(1, 1)), profile).chapters[0]!.path).toEqual([1]);
  });
});
