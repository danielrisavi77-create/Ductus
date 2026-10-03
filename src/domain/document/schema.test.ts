import { describe, expect, it } from "vitest";

import {
  DOCUMENT_SCHEMA_VERSION,
  MARK_ORDER,
  canonicalMarks,
  compareMarks,
  headingNode,
  isHeadingLevel,
  isMark,
  isNodeId,
  marksAreCanonical,
  marksEqual,
  newNodeId,
  paragraphNode,
  textNode,
  type Mark,
} from "./schema";

const UUID_A = "11111111-1111-4111-8111-111111111111";

describe("node ids", () => {
  it("accepts an RFC 4122 shaped uuid", () => {
    expect(isNodeId(UUID_A)).toBe(true);
    expect(isNodeId("3f2504e0-4f89-11d3-9a0c-0305e82c3301")).toBe(true);
  });

  it("accepts uppercase uuids", () => {
    expect(isNodeId(UUID_A.toUpperCase())).toBe(true);
  });

  it("rejects the nil uuid, malformed strings and non-strings", () => {
    expect(isNodeId("00000000-0000-0000-0000-000000000000")).toBe(false);
    expect(isNodeId("not-a-uuid")).toBe(false);
    expect(isNodeId(`${UUID_A}extra`)).toBe(false);
    expect(isNodeId(42)).toBe(false);
    expect(isNodeId(null)).toBe(false);
  });

  it("mints ids with an injected generator", () => {
    expect(newNodeId(() => UUID_A)).toBe(UUID_A);
  });

  it("mints unique ids with the default generator", () => {
    const first = newNodeId();
    const second = newNodeId();
    expect(isNodeId(first)).toBe(true);
    expect(first).not.toBe(second);
  });

  it("throws when the generator returns a non-uuid", () => {
    expect(() => newNodeId(() => "nope")).toThrow(/non-UUID/);
  });
});

describe("marks", () => {
  it("has bold before italic as canonical order", () => {
    expect(MARK_ORDER).toEqual(["bold", "italic"]);
    expect(compareMarks("bold", "italic")).toBeLessThan(0);
    expect(compareMarks("italic", "bold")).toBeGreaterThan(0);
    expect(compareMarks("bold", "bold")).toBe(0);
  });

  it("recognises only bold and italic", () => {
    expect(isMark("bold")).toBe(true);
    expect(isMark("italic")).toBe(true);
    expect(isMark("underline")).toBe(false);
    expect(isMark(undefined)).toBe(false);
  });

  it("canonicalises by sorting and deduplicating", () => {
    const messy = ["italic", "bold", "italic"] as Mark[];
    expect(canonicalMarks(messy)).toEqual(["bold", "italic"]);
    expect(canonicalMarks([])).toEqual([]);
  });

  it("detects non-canonical mark arrays", () => {
    expect(marksAreCanonical([])).toBe(true);
    expect(marksAreCanonical(["bold", "italic"])).toBe(true);
    expect(marksAreCanonical(["italic", "bold"])).toBe(false);
    expect(marksAreCanonical(["bold", "bold"])).toBe(false);
  });

  it("compares marks as sets", () => {
    expect(marksEqual(["italic", "bold"], ["bold", "italic"])).toBe(true);
    expect(marksEqual(["bold"], ["italic"])).toBe(false);
    expect(marksEqual(["bold"], [])).toBe(false);
  });
});

describe("node builders", () => {
  it("builds a text node with canonical marks", () => {
    expect(textNode("rad", ["italic", "bold"])).toEqual({
      type: "text",
      text: "rad",
      marks: ["bold", "italic"],
    });
    expect(textNode("rad").marks).toEqual([]);
  });

  it("builds paragraphs and headings and copies the children array", () => {
    const id = newNodeId(() => UUID_A);
    const children = [textNode("Uvod")];
    const paragraph = paragraphNode(id, children);
    const heading = headingNode(id, 2, children);

    expect(paragraph).toEqual({ type: "paragraph", id, children });
    expect(heading.level).toBe(2);
    expect(paragraph.children).not.toBe(children);
    expect(paragraphNode(id).children).toEqual([]);
  });

  it("accepts only heading levels 1 to 3", () => {
    expect(isHeadingLevel(1)).toBe(true);
    expect(isHeadingLevel(3)).toBe(true);
    expect(isHeadingLevel(0)).toBe(false);
    expect(isHeadingLevel(4)).toBe(false);
    expect(isHeadingLevel("2")).toBe(false);
  });

  it("stamps schema version 1", () => {
    expect(DOCUMENT_SCHEMA_VERSION).toBe(1);
  });
});
