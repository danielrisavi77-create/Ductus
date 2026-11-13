"use client";

/**
 * The toolbar above the sheet (F-8 step 1, design editor-v11 §5.1 point 2).
 *
 * Only what the F1 schema holds: undo and redo, paragraph and headings 1-3,
 * bold and italic, bullet item and quote (E1), in the order and the words of
 * the approved toolbar (DAN-211, m0-rad-reference), groups set apart by a rule.
 * Every button runs an editor command, so a change reaches the journal
 * exactly as typing does; the toolbar itself stores nothing.
 *
 * One Tab stop (WAI-ARIA toolbar): arrows, Home and End move between buttons.
 * While the editor may not be written in (loading, another tab, a failure,
 * signing out) every button says so with `aria-disabled` and does nothing,
 * and stays reachable, so a keyboard user learns why nothing happens.
 *
 * FE-D5 (editor-v11 "Više ▾", "Prikaz ▾"): when the toolbar is too narrow the
 * headings move, smallest first, then the quote, the list and "Ponovi", into
 * the "Više" menu, where each item runs the very same command with the very
 * same check as its button; "Prikaz" holds the sheet theme. Layout, grouping and labels only: no command changes.
 *
 * This module never imports the local document (journal, sync, sign-out), so
 * the public sandbox (DAN-354) can load it alone; `EditorToolbar.tsx` binds it
 * to the writing page's document.
 */

import { useEditorState, type Editor } from "@tiptap/react";
import {
  Fragment, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode,
} from "react";

import { setSheetTheme, useSheetTheme } from "@/components/shell/useSheetTheme";
import { messagesHr as t } from "@/lib/i18n/messages.hr";
import type { SheetTheme } from "@/lib/ui/sheet-theme";

import ToolbarMenu from "./ToolbarMenu";
import { MAX_COLLAPSED, rovingIndex, splitTools } from "./toolbar-menu";

type ToolbarState = {
  editable: boolean;
  paragraph: boolean;
  bulletItem: boolean;
  quote: boolean;
  heading1: boolean;
  heading2: boolean;
  heading3: boolean;
  bold: boolean;
  italic: boolean;
  canUndo: boolean;
  canRedo: boolean;
};

const IDLE: ToolbarState = {
  editable: false, paragraph: false, bulletItem: false, quote: false, heading1: false, heading2: false, heading3: false,
  bold: false, italic: false, canUndo: false, canRedo: false,
};

function stateOf(editor: Editor | null): ToolbarState {
  if (!editor || editor.isDestroyed) return IDLE;
  const editable = editor.isEditable;
  return {
    editable,
    paragraph: editor.isActive("paragraph"),
    bulletItem: editor.isActive("bulletItem"),
    quote: editor.isActive("quote"),
    heading1: editor.isActive("heading", { level: 1 }),
    heading2: editor.isActive("heading", { level: 2 }),
    heading3: editor.isActive("heading", { level: 3 }),
    bold: editor.isActive("bold"),
    italic: editor.isActive("italic"),
    canUndo: editable && editor.can().undo(),
    canRedo: editable && editor.can().redo(),
  };
}

type Tool = {
  key: string;
  label: string;
  /** Tools of one group sit together; a rule separates the groups (reference `.sep`). */
  group: "history" | "block" | "mark" | "list";
  /** What the button shows when it is not its label; the label is its accessible name and title. */
  glyph?: ReactNode;
  /** Toggle buttons only: whether it is on. */
  pressed?: (state: ToolbarState) => boolean;
  enabled?: (state: ToolbarState) => boolean;
  run: (editor: Editor) => void;
};

// The order and the words of the approved toolbar (m0-rad-reference
// radni-prostor.html): Poništi Ponovi | Odlomak Naslov 1-3 | B I | Popis
// Blok-citat. Words, not icons (D-203 t. 8); only what the F1 schema holds.
const TOOLS: readonly Tool[] = [
  {
    key: "undo", label: t.toolbar.undo, group: "history",
    enabled: (s) => s.canUndo, run: (e) => e.chain().focus().undo().run(),
  },
  {
    key: "redo", label: t.toolbar.redo, group: "history",
    enabled: (s) => s.canRedo, run: (e) => e.chain().focus().redo().run(),
  },
  {
    key: "paragraph", label: t.toolbar.paragraph, group: "block",
    pressed: (s) => s.paragraph, run: (e) => e.chain().focus().setParagraph().run(),
  },
  ...([1, 2, 3] as const).map((level): Tool => ({
    key: `heading${level}`, label: t.toolbar[`heading${level}`], group: "block",
    pressed: (s) => s[`heading${level}`],
    run: (e) => e.chain().focus().setHeading({ level }).run(),
  })),
  {
    key: "bold", label: t.toolbar.bold, group: "mark", glyph: <b>B</b>,
    pressed: (s) => s.bold, run: (e) => e.chain().focus().toggleBold().run(),
  },
  {
    key: "italic", label: t.toolbar.italic, group: "mark", glyph: <i>I</i>,
    pressed: (s) => s.italic, run: (e) => e.chain().focus().toggleItalic().run(),
  },
  {
    key: "bulletItem", label: t.toolbar.bulletItem, group: "list",
    pressed: (s) => s.bulletItem, run: (e) => e.chain().focus().toggleNode("bulletItem", "paragraph").run(),
  },
  {
    key: "quote", label: t.toolbar.quote, group: "list",
    pressed: (s) => s.quote, run: (e) => e.chain().focus().toggleNode("quote", "paragraph").run(),
  },
];

/** Whether the toolbar's own buttons have wrapped onto a second line. */
function wraps(toolbar: HTMLElement): boolean {
  const buttons = toolbar.querySelectorAll<HTMLElement>("[data-roving]");
  if (buttons.length < 2) return false;
  const first = buttons[0]!.getBoundingClientRect();
  const last = buttons[buttons.length - 1]!.getBoundingClientRect();
  return last.top >= first.bottom - 1;
}

const THEMES: readonly { key: SheetTheme; label: string }[] = [
  { key: "dark", label: t.workspace.sheetThemeDark },
  { key: "light", label: t.workspace.sheetThemeLight },
];

/**
 * The same toolbar for any editor, e.g. the public sandbox (DAN-354), which
 * has no local document: it only runs that editor's own commands.
 */
export default function EditorToolbarFor({ editor }: { editor: Editor | null }) {
  const state = useEditorState({ editor, selector: ({ editor: e }) => stateOf(e) }) ?? IDLE;
  const theme = useSheetTheme();
  const listRef = useRef<HTMLDivElement>(null);
  const [focusKey, setFocusKey] = useState<string>(TOOLS[0]!.key);
  const [openMenu, setOpenMenu] = useState<"more" | "view" | null>(null);
  const [collapsed, setCollapsed] = useState(0);
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);
  // Set when a new width closed a menu that held focus (review524, 1 and 2).
  const refocusRef = useRef(false);

  // A new width starts again with every tool shown (prototype fitToolbar).
  // It also closes "Više": its tools are measured again, so the menu goes
  // away for a moment, and left open in state it would open again later by
  // itself and take focus from the sheet. Focus that was in it goes back to
  // the toolbar once the new layout has settled, never to the page body.
  // "Prikaz" never moves, so a new width leaves it as it is.
  useLayoutEffect(() => {
    const element = listRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry?.contentRect.width ?? 0);
      if (next === widthRef.current) return;
      widthRef.current = next;
      if (element.querySelector(".editor-menu--more")?.contains(document.activeElement)) refocusRef.current = true;
      setOpenMenu((open) => (open === "more" ? null : open));
      setCollapsed(0);
      setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Each pass that still wraps moves one more heading into "Više", before paint.
  useLayoutEffect(() => {
    const element = listRef.current;
    if (!element) return;
    if (collapsed < MAX_COLLAPSED && wraps(element)) {
      setCollapsed(collapsed + 1);
      return;
    }
    if (refocusRef.current) {
      refocusRef.current = false;
      element.querySelector<HTMLElement>("[data-roving][tabindex='0']")?.focus();
    }
  }, [collapsed, width]);

  const { shown, more } = splitTools(TOOLS, collapsed);
  const moreOpen = openMenu === "more" && more.length > 0;
  const usableOf = (tool: Tool) => state.editable && (tool.enabled?.(state) ?? true);
  const rovingKeys = [...shown.map((tool) => tool.key), ...(more.length ? ["more"] : []), "view"];
  const stop = rovingKeys.includes(focusKey) ? focusKey : rovingKeys[0];

  // Checked again at the click: a sign-out stops writing without a render.
  const run = (tool: Tool): boolean => {
    if (!usableOf(tool) || !editor || editor.isDestroyed || !editor.isEditable) return false;
    tool.run(editor);
    return true;
  };

  // Roving focus between the toolbar's own buttons; Tab leaves the toolbar.
  // Keys inside an open menu are the menu's own and never reach here.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("[data-roving]") ?? []);
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = rovingIndex(event.key, at, buttons.length);
    if (next === -1) return;
    event.preventDefault();
    setOpenMenu(null);
    setFocusKey(buttons[next]!.dataset.roving!);
    buttons[next]!.focus();
  };

  return (
    <div
      ref={listRef}
      className="editor-toolbar"
      role="toolbar"
      aria-label={t.toolbar.label}
      onKeyDown={onKeyDown}
    >
      {shown.map((tool, index) => {
        const usable = usableOf(tool);
        const opensGroup = index > 0 && shown[index - 1]!.group !== tool.group;
        return (
          <Fragment key={tool.key}>
            {opensGroup ? <span className="editor-toolbar__sep" aria-hidden="true" /> : null}
            <button
              type="button"
              className="btn editor-toolbar__button"
              data-tool={tool.key}
              data-roving={tool.key}
              aria-label={tool.label}
              title={tool.glyph ? tool.label : undefined}
              aria-pressed={tool.pressed ? tool.pressed(state) : undefined}
              aria-disabled={usable ? undefined : "true"}
              tabIndex={tool.key === stop ? 0 : -1}
              // Keeps the selection in the sheet; the command refocuses it.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setFocusKey(tool.key);
                run(tool);
              }}
            >
              {tool.glyph ? <span aria-hidden="true">{tool.glyph}</span> : tool.label}
            </button>
          </Fragment>
        );
      })}
      {more.length ? (
        <ToolbarMenu
          className="editor-menu--more"
          label={t.toolbar.more}
          menuLabel={t.toolbar.moreMenu}
          roving="more"
          tabIndex={stop === "more" ? 0 : -1}
          open={moreOpen}
          onOpenChange={(open) => {
            setFocusKey("more");
            setOpenMenu(open ? "more" : null);
          }}
          items={more.map((tool) => ({
            key: tool.key,
            label: tool.label,
            ...(tool.glyph ? { glyph: tool.glyph } : {}),
            role: tool.pressed ? "menuitemcheckbox" : "menuitem",
            checked: tool.pressed ? tool.pressed(state) : false,
            disabled: !usableOf(tool),
          }))}
          // Same command, same check as the button; it refocuses the sheet.
          onSelect={(key) => {
            const tool = more.find((candidate) => candidate.key === key);
            return tool && run(tool) ? "close" : "keep";
          }}
        />
      ) : null}
      <ToolbarMenu
        className="editor-menu--end"
        label={t.toolbar.view}
        menuLabel={t.toolbar.viewMenu}
        groupLabel={t.toolbar.sheet}
        roving="view"
        tabIndex={stop === "view" ? 0 : -1}
        open={openMenu === "view"}
        onOpenChange={(open) => {
          setFocusKey("view");
          setOpenMenu(open ? "view" : null);
        }}
        items={THEMES.map(({ key, label }) => ({
          key, label, role: "menuitemradio", checked: theme === key,
        }))}
        onSelect={(key) => {
          setSheetTheme(key === "light" ? "light" : "dark");
          return "close-return";
        }}
      />
    </div>
  );
}
