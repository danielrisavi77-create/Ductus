import { describe, expect, it } from "vitest";

import {
  COLLAPSE_ORDER, MAX_COLLAPSED, menuKey, openerKey, rovingIndex, splitTools,
} from "./toolbar-menu";

const TOOLS = ["paragraph", "heading1", "heading2", "heading3", "bold", "italic", "undo", "redo"]
  .map((key) => ({ key }));
const keys = (tools: { key: string }[]) => tools.map((tool) => tool.key);

describe("toolbar roving focus", () => {
  it("moves with the arrows and wraps at both ends", () => {
    expect(rovingIndex("ArrowRight", 0, 4)).toBe(1);
    expect(rovingIndex("ArrowRight", 3, 4)).toBe(0);
    expect(rovingIndex("ArrowLeft", 0, 4)).toBe(3);
    expect(rovingIndex("Home", 2, 4)).toBe(0);
    expect(rovingIndex("End", 0, 4)).toBe(3);
  });

  it("ignores other keys, focus outside the buttons and an empty toolbar", () => {
    expect(rovingIndex("ArrowDown", 1, 4)).toBe(-1);
    expect(rovingIndex("Tab", 1, 4)).toBe(-1);
    expect(rovingIndex("ArrowRight", -1, 4)).toBe(-1);
    expect(rovingIndex("ArrowRight", 0, 0)).toBe(-1);
  });
});

describe("menu button", () => {
  it("opens on the first item with ArrowDown and on the last with ArrowUp", () => {
    expect(openerKey("ArrowDown")).toBe("first");
    expect(openerKey("ArrowUp")).toBe("last");
  });

  it("leaves Enter and Space to the button's own click, so one press never opens and closes", () => {
    expect(openerKey("Enter")).toBeNull();
    expect(openerKey(" ")).toBeNull();
    expect(openerKey("ArrowRight")).toBeNull();
  });
});

describe("open menu", () => {
  it("moves with the arrows, wraps, and jumps with Home and End", () => {
    expect(menuKey("ArrowDown", 0, 3)).toEqual({ kind: "move", to: 1 });
    expect(menuKey("ArrowDown", 2, 3)).toEqual({ kind: "move", to: 0 });
    expect(menuKey("ArrowUp", 0, 3)).toEqual({ kind: "move", to: 2 });
    expect(menuKey("Home", 2, 3)).toEqual({ kind: "move", to: 0 });
    expect(menuKey("End", 0, 3)).toEqual({ kind: "move", to: 2 });
  });

  it("closes on Escape, even when empty", () => {
    expect(menuKey("Escape", 1, 3)).toEqual({ kind: "close" });
    expect(menuKey("Escape", 0, 0)).toEqual({ kind: "close" });
  });

  it("leaves Enter, Space, Tab and other keys to the item and the browser", () => {
    for (const key of ["Enter", " ", "Tab", "a", "ArrowLeft"]) expect(menuKey(key, 0, 3)).toBeNull();
    expect(menuKey("ArrowDown", 0, 0)).toBeNull();
  });
});

describe("tools that do not fit", () => {
  it("all stay on the toolbar until the toolbar is too narrow", () => {
    const { shown, more } = splitTools(TOOLS, 0);
    expect(keys(shown)).toEqual(keys(TOOLS));
    expect(more).toEqual([]);
  });

  it("move to Više smallest heading first, in toolbar order inside the menu", () => {
    expect(keys(splitTools(TOOLS, 1).more)).toEqual(["heading3"]);
    expect(keys(splitTools(TOOLS, 2).more)).toEqual(["heading2", "heading3"]);
    expect(keys(splitTools(TOOLS, 3).more)).toEqual(["heading1", "heading2", "heading3"]);
    expect(keys(splitTools(TOOLS, 3).shown)).toEqual(["paragraph", "bold", "italic", "undo", "redo"]);
  });

  it("then the list (E1), after every heading, in toolbar order", () => {
    const withList = ["paragraph", "heading1", "heading2", "heading3", "bold", "italic", "bulletItem", "undo", "redo"]
      .map((key) => ({ key }));
    expect(keys(splitTools(withList, 3).shown)).toContain("bulletItem");
    expect(keys(splitTools(withList, 4).more)).toEqual(["heading1", "heading2", "heading3", "bulletItem"]);
    expect(keys(splitTools(withList, 4).shown)).toEqual(["paragraph", "bold", "italic", "undo", "redo"]);
  });

  it("never moves paragraph, bold, italic, undo or redo, whatever the count", () => {
    expect(MAX_COLLAPSED).toBe(COLLAPSE_ORDER.length);
    for (const collapsed of [-1, 3, 4, 99]) {
      const { shown, more } = splitTools(TOOLS, collapsed);
      expect(keys(shown)).toEqual(expect.arrayContaining(["paragraph", "bold", "italic", "undo", "redo"]));
      expect(shown.length + more.length).toBe(TOOLS.length);
    }
    expect(splitTools(TOOLS, -1).more).toEqual([]);
  });
});
