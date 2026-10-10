import { describe, expect, it } from "vitest";

import {
  createEditorExtensions,
  DEFAULT_PLACEHOLDER,
  F1_EXTENSION_NAMES,
  F1_HEADING_LEVELS,
  NODE_ID_ATTRIBUTE,
  NodeIdentity,
} from "./schema";

/**
 * These tests are the guard against schema creep. If someone swaps the
 * explicit extension list for StarterKit, or widens the heading levels, the
 * editor would start producing nodes the canonical model cannot hold — and
 * `tiptapToCanonical` would reject the author's document at save time.
 */
describe("createEditorExtensions", () => {
  it("registers exactly the F1 extension set", () => {
    const names = createEditorExtensions().map((extension) => extension.name);
    expect([...names].sort()).toEqual([...F1_EXTENSION_NAMES].sort());
  });

  it("registers no node or mark outside the F1 schema", () => {
    const names = new Set(createEditorExtensions().map((extension) => extension.name));
    for (const forbidden of [
      "bulletList",
      "orderedList",
      "listItem",
      "blockquote",
      "codeBlock",
      "code",
      "strike",
      "horizontalRule",
      "hardBreak",
      "link",
      "image",
      "starterKit",
    ]) {
      expect(names.has(forbidden)).toBe(false);
    }
  });

  it("restricts headings to levels 1-3", () => {
    const heading = createEditorExtensions().find(
      (extension) => extension.name === "heading",
    );
    expect(heading?.options.levels).toEqual([...F1_HEADING_LEVELS]);
  });

  it("uses the Croatian placeholder by default", () => {
    const placeholder = createEditorExtensions().find(
      (extension) => extension.name === "placeholder",
    );
    expect(placeholder?.options.placeholder).toBe(DEFAULT_PLACEHOLDER);
    expect(DEFAULT_PLACEHOLDER).toBe("Počni pisati…");
  });

  it("lets the caller override the placeholder", () => {
    const placeholder = createEditorExtensions("Nastavi…").find(
      (extension) => extension.name === "placeholder",
    );
    expect(placeholder?.options.placeholder).toBe("Nastavi…");
  });

  it("returns a fresh array each call so configuration never leaks", () => {
    expect(createEditorExtensions()).not.toBe(createEditorExtensions());
  });
});

describe("NodeIdentity", () => {
  it("adds the node id attribute to paragraph and heading only", () => {
    const globals = NodeIdentity.config.addGlobalAttributes?.call(
      NodeIdentity as never,
    );
    expect(globals).toHaveLength(1);
    expect(globals?.[0].types).toEqual(["paragraph", "heading"]);
    expect(Object.keys(globals?.[0].attributes ?? {})).toEqual([NODE_ID_ATTRIBUTE]);
  });

  it("does not keep the id on split, so a new block gets a new identity", () => {
    const globals = NodeIdentity.config.addGlobalAttributes?.call(
      NodeIdentity as never,
    );
    const attribute = globals?.[0].attributes[NODE_ID_ATTRIBUTE] as {
      default: unknown;
      keepOnSplit: boolean;
    };

    expect(attribute.keepOnSplit).toBe(false);
    expect(attribute.default).toBeNull();
  });
});
