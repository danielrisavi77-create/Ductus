/**
 * Pure keyboard and layout logic of the editor toolbar and its menus (FE-D5,
 * design editor-v11: "Više ▾" and "Prikaz ▾"; WAI-ARIA toolbar and menu
 * button patterns). No DOM here, so every key is unit-tested.
 */

/** Roving focus among the toolbar's own buttons; -1 for a key it ignores. */
export function rovingIndex(key: string, at: number, count: number): number {
  if (count <= 0 || at < 0) return -1;
  switch (key) {
    case "ArrowRight": return (at + 1) % count;
    case "ArrowLeft": return (at - 1 + count) % count;
    case "Home": return 0;
    case "End": return count - 1;
    default: return -1;
  }
}

/**
 * A key on a menu button: which item the menu opens on, or null. Enter and
 * Space are left to the button's own click, which opens on the first item,
 * so one key press never both opens and closes.
 */
export function openerKey(key: string): "first" | "last" | null {
  if (key === "ArrowDown") return "first";
  if (key === "ArrowUp") return "last";
  return null;
}

export type MenuKeyAction = { kind: "move"; to: number } | { kind: "close" } | null;

/**
 * A key inside an open menu with `count` items, focus on item `at`. Enter and
 * Space are the item's own click; Tab leaves and the blur closes the menu.
 */
export function menuKey(key: string, at: number, count: number): MenuKeyAction {
  if (key === "Escape") return { kind: "close" };
  if (count <= 0) return null;
  switch (key) {
    case "ArrowDown": return { kind: "move", to: (at + 1) % count };
    case "ArrowUp": return { kind: "move", to: (at - 1 + count) % count };
    case "Home": return { kind: "move", to: 0 };
    case "End": return { kind: "move", to: count - 1 };
    default: return null;
  }
}

/**
 * The order in which tools leave the toolbar for "Više" when it is too narrow
 * (prototype `c` values: the smaller heading first, then the list, E1).
 * Paragraph, bold, italic, undo and redo always stay on the toolbar.
 */
export const COLLAPSE_ORDER = ["heading3", "heading2", "heading1", "bulletItem"] as const;

export const MAX_COLLAPSED = COLLAPSE_ORDER.length;

/** Splits the tools, kept in toolbar order, into shown and moved to "Više". */
export function splitTools<T extends { key: string }>(
  tools: readonly T[],
  collapsed: number,
): { shown: T[]; more: T[] } {
  const n = Math.max(0, Math.min(collapsed, MAX_COLLAPSED));
  const out = new Set<string>(COLLAPSE_ORDER.slice(0, n));
  return {
    shown: tools.filter((tool) => !out.has(tool.key)),
    more: tools.filter((tool) => out.has(tool.key)),
  };
}
